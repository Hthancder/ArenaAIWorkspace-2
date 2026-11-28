// Shake gesture from the gravity-free acceleration (CoreMotion userAcceleration, m/s²).
//
// A deliberate shake is a quick back-and-forth: several strong jolts whose directions REVERSE.
// Walking or running also produce strong peaks (arm swing ≈ 8–15 m/s², twice per stride), but
// slowly and without rapid reversals — so a single threshold isn't enough. Rules:
//  • a jolt = the acceleration rises above JOLT (≈1.75 g) after having dropped below REARM;
//  • its direction is the acceleration vector at its peak;
//  • a shake = MIN_JOLTS jolts inside WINDOW ms, each pointing against the one before
//    (dot product < 0), with consecutive jolts at least MIN_GAP ms apart (one jolt isn't two);
//  • after a shake nothing fires for COOLDOWN ms.

import type { MotionSample } from './tilt';

const G = 9.80665;
export const SHAKE = {
  JOLT: 1.75 * G,
  REARM: 0.8 * G,
  MIN_JOLTS: 3,
  WINDOW: 900,
  MIN_GAP: 70,
  COOLDOWN: 1600,
};

interface Jolt {
  t: number;
  x: number;
  y: number;
  z: number;
}

/** Feed samples in; `onShake` fires once per shake. `now` is injectable for tests. */
export function createShakeDetector(onShake: () => void, now: () => number = Date.now) {
  let armed = true;
  let peak: Jolt | null = null;
  let peakMag = 0;
  let jolts: Jolt[] = [];
  let quietUntil = 0;

  const close = () => {
    // the jolt ended (fell below re-arm): keep its peak direction
    if (!peak) return;
    const j = peak;
    peak = null;
    peakMag = 0;
    const prev = jolts[jolts.length - 1];
    if (prev) {
      const reversed = prev.x * j.x + prev.y * j.y + prev.z * j.z < 0;
      const tooClose = j.t - prev.t < SHAKE.MIN_GAP;
      if (tooClose) return;
      // same direction twice = a bump or a step, not a shake: start the run again from here
      if (!reversed) jolts = [];
    }
    jolts.push(j);
    jolts = jolts.filter((k) => j.t - k.t <= SHAKE.WINDOW);
    if (jolts.length >= SHAKE.MIN_JOLTS && j.t >= quietUntil) {
      jolts = [];
      quietUntil = j.t + SHAKE.COOLDOWN;
      onShake();
    }
  };

  return (s: MotionSample) => {
    const mag = Math.sqrt(s.ux * s.ux + s.uy * s.uy + s.uz * s.uz);
    if (!Number.isFinite(mag)) return;
    if (armed && mag >= SHAKE.JOLT) {
      armed = false;
      peak = { t: now(), x: s.ux, y: s.uy, z: s.uz };
      peakMag = mag;
      return;
    }
    if (!armed) {
      // flipped direction while still above the threshold (a fast shake at 60 Hz may never
      // show a quiet sample in between): that ends this jolt and starts the next
      if (peak && mag >= SHAKE.JOLT && peak.x * s.ux + peak.y * s.uy + peak.z * s.uz < 0) {
        close();
        peak = { t: now(), x: s.ux, y: s.uy, z: s.uz };
        peakMag = mag;
        return;
      }
      if (peak && mag > peakMag) {
        peak = { t: peak.t, x: s.ux, y: s.uy, z: s.uz };
        peakMag = mag;
      }
      if (mag < SHAKE.REARM) {
        armed = true;
        close();
      }
    }
  };
}
