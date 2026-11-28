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
//  • Only real movement crosses to the UI thread. Every tilt-bound layer (cover, light,
//    backdrop, glow, dust) is re-composited when the values change — and under a music video's
//    ambient blur that means a full-screen blur pass. A phone held still (or lying on a table)
//    still reports gyro noise and a slowly leaking angle, which used to cost a frame update at
//    60 Hz forever. Now rates under the gyro's noise floor count as zero, and a value is only
//    pushed when it moved by more than ~a quarter of a point on the largest layer; once it has
//    settled near the centre it snaps to 0 and stays quiet.
//
// Web (preview): there is no gyroscope on a desktop, so the pointer position stands in for
// the eye, eased toward on each animation frame.

import { Animated, AppState, AppStateStatus, Platform } from 'react-native';
import { perfCount } from '../perfProbe';

const NATIVE = Platform.OS !== 'web';

/** seconds for a held tilt to fade back to centre (iOS parallax re-centres similarly) */
const LEAK_TAU = 3.2;
/** degrees of tilt that read as ~76 % of the full effect (tanh(1)) */
const RANGE_DEG = 10;
/** hard limit on the integrated angle (degrees), so a fast spin can't wind it up */
const MAX_DEG = 28;
/** sensor interval (ms) — 60 Hz; CoreMotion fuses at 100 Hz+ anyway */
const INTERVAL_MS = 16;
/** deg/s below which the gyroscope is just noise / bias (CoreMotion's is ~0.1–0.3 °/s) */
const NOISE_DPS = 0.35;
/** smallest change worth sending: × ~150 pt (the cover light's travel) ≈ 0.2 pt */
const EPS = 0.0015;

function makeValue() {
  return new Animated.Value(0, NATIVE ? { useNativeDriver: true } : undefined);
}

/** eye offset, −1…1 (× gain): right / down are positive */
const X = makeValue();
const Y = makeValue();

type Sub = { remove: () => void };
type SampleListener = (s: MotionSample) => void;

/** raw-ish sample handed to other motion features (shake…) on the same subscription */
export interface MotionSample {
  /** user acceleration (gravity removed), m/s², device axes */
  ux: number;
  uy: number;
  uz: number;
  /** seconds since the previous sample */
  dt: number;
}

let refs = 0;
/** holders that draw with the tilt values (shake alone doesn't need them updated) */
let visualRefs = 0;
let gain = 1;
let sensorSub: Sub | null = null;
let appSub: Sub | null = null;
/** 'unknown' (launch) counts as in front; only background / inactive stop the sensor */
const isFront = (st: string | null | undefined) => st !== 'background' && st !== 'inactive';
let appActive = isFront(AppState.currentState);
let angX = 0; // eye-right, degrees
let angY = 0; // eye-down, degrees
let lastT = 0;
/** last values sent to the UI side */
let sentX = 0;
let sentY = 0;
let sensorOk: boolean | null = null;
const sampleListeners = new Set<SampleListener>();
/** low-passed gravity, only for sources without a gravity-free acceleration */
const grav = { x: 0, y: 0, z: 0 };

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

/** send x / y to the UI side only when they moved visibly; snap to rest near the centre */
function push(x: number, y: number) {
  if (Math.abs(x) < EPS * 2) x = 0;
  if (Math.abs(y) < EPS * 2) y = 0;
  if (Math.abs(x - sentX) > EPS || (x === 0 && sentX !== 0)) {
    sentX = x;
    X.setValue(x);
    perfCount('setValue:tilt');
  }
  if (Math.abs(y - sentY) > EPS || (y === 0 && sentY !== 0)) {
    sentY = y;
    Y.setValue(y);
    perfCount('setValue:tilt');
  }
}

function onMotion(m: any) {
  const t = now();
  const dt = lastT ? Math.min(0.1, Math.max(0, (t - lastT) / 1000)) : 0;
  lastT = t;
  const rr = m?.rotationRate;
  if (rr && dt > 0) {
    // degrees / second around the device's X (pitch) and Y (left/right) axes
    let rateX = Platform.OS === 'ios' ? Number(rr.gamma) : Number(rr.beta);
    let rateY = Platform.OS === 'ios' ? Number(rr.beta) : Number(rr.gamma);
    if (Number.isFinite(rateX) && Number.isFinite(rateY)) {
      // a still phone: noise, not motion (keeps the angle from wandering)
      if (Math.abs(rateX) < NOISE_DPS) rateX = 0;
      if (Math.abs(rateY) < NOISE_DPS) rateY = 0;
      // right-hand rule: +Y turns the right edge away → the eye moves left of the normal;
      // +X brings the top edge toward you → the eye moves below it
      angX -= rateY * dt;
      angY += rateX * dt;
      const k = Math.exp(-dt / LEAK_TAU);
      angX = Math.max(-MAX_DEG, Math.min(MAX_DEG, angX * k));
      angY = Math.max(-MAX_DEG, Math.min(MAX_DEG, angY * k));
      if (visualRefs > 0) push(shape(angX), shape(angY));
    }
  }
  if (sampleListeners.size) {
    // gravity-free acceleration (CoreMotion's userAcceleration); a few web browsers only give
    // the version with gravity — then remove a steady 1 g estimate from its magnitude's axis
    const u = m?.acceleration;
    let s: MotionSample | null = null;
    if (u && Number.isFinite(+u.x)) s = { ux: +u.x || 0, uy: +u.y || 0, uz: +u.z || 0, dt };
    else if (m?.accelerationIncludingGravity) {
      const g = m.accelerationIncludingGravity;
      grav.x += (+g.x - grav.x) * 0.1;
      grav.y += (+g.y - grav.y) * 0.1;
      grav.z += (+g.z - grav.z) * 0.1;
      s = { ux: +g.x - grav.x, uy: +g.y - grav.y, uz: +g.z - grav.z, dt };
    }
    if (!s) return;
    const sample = s;
    sampleListeners.forEach((fn) => {
      try {
        fn(sample);
      } catch {
        /* one bad listener must not stop the others */
      }
    });
  }
}

function settle() {
  angX = angY = 0;
  curX = curY = 0;
  sentX = sentY = 0;
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
    if (visualRefs === 0) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    curX += (pointerX - curX) * 0.12;
    curY += (pointerY - curY) * 0.12;
    push(curX * gain, curY * gain);
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
  const active = isFront(s);
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
    appActive = isFront(AppState.currentState);
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
  /**
   * Start using the sensor; call the returned function when done (ref-counted).
   * `visual: false` = only raw samples are needed (shake): the tilt values aren't pushed.
   */
  acquire(opts?: { visual?: boolean }): () => void {
    const visual = opts?.visual !== false;
    if (visual) {
      // first effect on screen: start from the centre, not from an angle wound up unseen
      if (visualRefs === 0) angX = angY = 0;
      visualRefs += 1;
    }
    retain();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (visual) {
        visualRefs = Math.max(0, visualRefs - 1);
        // the last effect left but the sensor keeps running (shake): ease back to centre
        if (visualRefs === 0 && refs > 1) settle();
      }
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
