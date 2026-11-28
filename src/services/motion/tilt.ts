// Device tilt for the motion effects (3D cover, sliding light, foil, background parallax).
//
// One sensor subscription for the whole app, shared by every effect on screen (ref-counted).
// Nothing re-renders while the phone moves: the two Animated values are created on the
// native driver, so each sample is a single `setAnimatedNodeValue` and every bound transform
// / opacity is updated on the UI side.
//
// How the tilt is measured
//  • The gyroscope's rotation rate is integrated into an angle, and that angle leaks back to
//    zero with a time constant of a few seconds (a high-pass filter). The effect therefore
//    always re-centres on however the phone is being held — lying down, standing, in a car —
//    which is how iOS's own parallax (UIInterpolatingMotionEffect) behaves. No calibration,
//    no gimbal lock near upright (Euler angles flip there), no drift.
//  • Output is a "viewer offset" in −1…1, like UIKit's: x > 0 = the eye is to the right of the
//    screen's normal, y > 0 = the eye is below it. Layers in front move against it, layers
//    behind move with it, a surface turns to face it.
//  • expo-sensors' iOS module reports rotationRate.beta = Y axis and .gamma = X axis (the W3C
//    event used on web has them the other way round). Both are mapped here.
//
// Web (preview): there is no gyroscope on a desktop, so the pointer position stands in for
// the eye, eased toward on each animation frame.

import { Animated, AppState, AppStateStatus, Platform } from 'react-native';

const NATIVE = Platform.OS !== 'web';

/** seconds for a held tilt to fade back to centre (iOS parallax re-centres similarly) */
const LEAK_TAU = 3.2;
/** degrees of tilt that read as ~76 % of the full effect (tanh(1)) */
const RANGE_DEG = 10;
/** hard limit on the integrated angle (degrees), so a fast spin can't wind it up */
const MAX_DEG = 28;
/** sensor interval (ms) — 60 Hz; CoreMotion fuses at 100 Hz+ anyway */
const INTERVAL_MS = 16;

function makeValue() {
  return new Animated.Value(0, NATIVE ? { useNativeDriver: true } : undefined);
}

/** eye offset, −1…1 (× gain): right / down are positive */
const X = makeValue();
const Y = makeValue();

type Sub = { remove: () => void };
type SampleListener = (s: MotionSample) => void;

/** raw-ish sample handed to other motion features (shake, face-down…) on the same subscription */
export interface MotionSample {
  /** acceleration including gravity, m/s², device axes */
  ax: number;
  ay: number;
  az: number;
  /** seconds since the previous sample */
  dt: number;
}

let refs = 0;
let gain = 1;
let sensorSub: Sub | null = null;
let appSub: Sub | null = null;
let appActive = AppState.currentState === 'active' || AppState.currentState == null;
let angX = 0; // eye-right, degrees
let angY = 0; // eye-down, degrees
let lastT = 0;
let sensorOk: boolean | null = null;
const sampleListeners = new Set<SampleListener>();

// web pointer fallback
let rafId: number | null = null;
let pointerX = 0;
let pointerY = 0;
let curX = 0;
let curY = 0;
let detachPointer: (() => void) | null = null;

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

function shape(deg: number) {
  return Math.tanh(deg / RANGE_DEG) * gain;
}

function onMotion(m: any) {
  const t = now();
  const dt = lastT ? Math.min(0.1, Math.max(0, (t - lastT) / 1000)) : 0;
  lastT = t;
  const rr = m?.rotationRate;
  if (rr && dt > 0) {
    // degrees / second around the device's X (pitch) and Y (left/right) axes
    const rateX = Platform.OS === 'ios' ? Number(rr.gamma) : Number(rr.beta);
    const rateY = Platform.OS === 'ios' ? Number(rr.beta) : Number(rr.gamma);
    if (Number.isFinite(rateX) && Number.isFinite(rateY)) {
      // right-hand rule: +Y turns the right edge away → the eye moves left of the normal;
      // +X brings the top edge toward you → the eye moves below it
      angX -= rateY * dt;
      angY += rateX * dt;
      const k = Math.exp(-dt / LEAK_TAU);
      angX = Math.max(-MAX_DEG, Math.min(MAX_DEG, angX * k));
      angY = Math.max(-MAX_DEG, Math.min(MAX_DEG, angY * k));
      X.setValue(shape(angX));
      Y.setValue(shape(angY));
    }
  }
  if (sampleListeners.size && m?.accelerationIncludingGravity) {
    const g = m.accelerationIncludingGravity;
    const s: MotionSample = { ax: +g.x || 0, ay: +g.y || 0, az: +g.z || 0, dt };
    sampleListeners.forEach((fn) => {
      try {
        fn(s);
      } catch {
        /* one bad listener must not stop the others */
      }
    });
  }
}

function settle() {
  angX = angY = 0;
  curX = curY = 0;
  lastT = 0;
  if (NATIVE) {
    [X, Y].forEach((v) =>
      Animated.spring(v, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 40,
      }).start()
    );
  } else {
    X.setValue(0);
    Y.setValue(0);
  }
}

async function startSensor() {
  if (sensorSub || !appActive) return;
  if (!NATIVE) return startPointer();
  try {
    // required lazily: a build without the native module simply has no motion effects
    const { DeviceMotion } = require('expo-sensors');
    if (sensorOk === null) sensorOk = await DeviceMotion.isAvailableAsync().catch(() => false);
    if (!sensorOk || sensorSub || refs === 0 || !appActive) return;
    DeviceMotion.setUpdateInterval(INTERVAL_MS);
    lastT = 0;
    sensorSub = DeviceMotion.addListener(onMotion);
  } catch {
    sensorOk = false;
  }
}

function stopSensor() {
  sensorSub?.remove();
  sensorSub = null;
  stopPointer();
  settle();
}

// ---------------------------------------------------------------- web pointer stand-in

function startPointer() {
  if (typeof window === 'undefined' || rafId != null) return;
  const move = (e: PointerEvent) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    pointerX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1));
    pointerY = Math.max(-1, Math.min(1, (e.clientY / h) * 2 - 1));
  };
  const leave = () => {
    pointerX = pointerY = 0;
  };
  window.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', leave);
  detachPointer = () => {
    window.removeEventListener('pointermove', move);
    document.removeEventListener('pointerleave', leave);
  };
  const tick = () => {
    curX += (pointerX - curX) * 0.12;
    curY += (pointerY - curY) * 0.12;
    X.setValue(curX * gain);
    Y.setValue(curY * gain);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopPointer() {
  if (rafId != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
  rafId = null;
  detachPointer?.();
  detachPointer = null;
}

// ---------------------------------------------------------------- lifecycle

function onAppState(s: AppStateStatus) {
  const active = s === 'active';
  if (active === appActive) return;
  appActive = active;
  // backgrounded / Control Centre / call: the sensor stops; it resumes on return
  if (!active) stopSensor();
  else if (refs > 0) startSensor();
}

function retain() {
  refs += 1;
  if (refs === 1) {
    appSub = AppState.addEventListener('change', onAppState) as unknown as Sub;
    appActive = AppState.currentState === 'active' || AppState.currentState == null;
    startSensor();
  }
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs === 0) {
    appSub?.remove();
    appSub = null;
    stopSensor();
  }
}

export const Tilt = {
  /** eye offset right (+) / left (−) */
  x: X as Animated.Value,
  /** eye offset below (+) / above (−) */
  y: Y as Animated.Value,
  /** start using the sensor; call the returned function when done (ref-counted) */
  acquire(): () => void {
    retain();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      release();
    };
  },
  /** strength multiplier from Settings (0.6 subtle · 1 medium · 1.45 strong) */
  setGain(g: number) {
    gain = Math.max(0, Math.min(2, g));
  },
  /** listen to raw samples while the sensor runs (does not keep it running by itself) */
  onSample(fn: SampleListener): () => void {
    sampleListeners.add(fn);
    return () => {
      sampleListeners.delete(fn);
    };
  },
  /** true once the device reported it has no motion sensor */
  get unavailable() {
    return sensorOk === false;
  },
  /** tests / diagnostics */
  get running() {
    return !!sensorSub || rafId != null;
  },
};

/** Strength names → gain. */
export const TILT_GAIN = { off: 0, low: 0.6, medium: 1, high: 1.45 } as const;
export type TiltStrength = keyof typeof TILT_GAIN;
