// The exact filters the native DSP (modules/holysic-dsp) and the Web Audio graph run, evaluated
// in JS: used to draw the EQ response curve and to pick the pre-amp that keeps boosts from
// clipping. RBJ Audio-EQ-Cookbook biquads — 32 Hz low shelf, 64 Hz…8 kHz peaking (Q 1.41),
// 16 kHz high shelf, plus the 95 Hz bass shelf.

import type { AudioLabSettings } from '../../types/music';

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_Q = 1.41;
export const BASS_HZ = 95;
/** Bass Boost 100% = +10 dB shelf */
export const bassDbOf = (bassBoost: number) => (Math.max(0, Math.min(100, bassBoost)) / 100) * 10;

type Kind = 'peak' | 'low' | 'high';
interface Coef {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function design(kind: Kind, fc: number, gainDb: number, q: number, sr: number): Coef | null {
  if (Math.abs(gainDb) < 0.05) return null;
  fc = Math.min(fc, sr * 0.45);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === 'peak') {
    const al = sw / (2 * q);
    b0 = 1 + al * A;
    b1 = -2 * cw;
    b2 = 1 - al * A;
    a0 = 1 + al / A;
    a1 = -2 * cw;
    a2 = 1 - al / A;
  } else {
    const al = (sw / 2) * Math.SQRT2;
    const sA = 2 * Math.sqrt(A) * al;
    if (kind === 'low') {
      b0 = A * (A + 1 - (A - 1) * cw + sA);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - sA);
      a0 = A + 1 + (A - 1) * cw + sA;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - sA;
    } else {
      b0 = A * (A + 1 + (A - 1) * cw + sA);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - sA);
      a0 = A + 1 - (A - 1) * cw + sA;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - sA;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function magDb(c: Coef, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export function filtersOf(gains: number[], bassDb: number, sr = 48000): Coef[] {
  const out: Coef[] = [];
  EQ_FREQS.forEach((f, i) => {
    const kind: Kind = i === 0 ? 'low' : i === EQ_FREQS.length - 1 ? 'high' : 'peak';
    const c = design(kind, f, gains[i] || 0, EQ_Q, sr);
    if (c) out.push(c);
  });
  const b = design('low', BASS_HZ, bassDb, 0.71, sr);
  if (b) out.push(b);
  return out;
}

/** Response in dB at `points` log-spaced frequencies from 20 Hz to 20 kHz */
export function responseCurve(
  gains: number[],
  bassDb: number,
  points = 96,
  sr = 48000
): { f: number; db: number }[] {
  const fs = filtersOf(gains, bassDb, sr);
  const out: { f: number; db: number }[] = [];
  for (let i = 0; i < points; i++) {
    const f = 20 * Math.pow(1000, i / (points - 1));
    let db = 0;
    for (const c of fs) db += magDb(c, Math.min(f, sr * 0.49), sr);
    out.push({ f, db });
  }
  return out;
}

/** Highest boost anywhere in the audible band (dB, ≥ 0) */
export function peakBoostDb(gains: number[], bassDb: number): number {
  let peak = 0;
  for (const p of responseCurve(gains, bassDb, 160)) if (p.db > peak) peak = p.db;
  return peak;
}

/** Automatic pre-amp: pull the level down by the peak boost so the EQ never clips */
export function autoPreampDb(lab: AudioLabSettings): number {
  if (!lab.enabled) return 0;
  const peak = peakBoostDb(
    lab.bands.map((b) => b.gainDb),
    bassDbOf(lab.bassBoost)
  );
  return -Math.min(15, peak);
}
