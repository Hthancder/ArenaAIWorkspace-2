// Sample-based General MIDI renderer — plays a parsed MIDI through the HolySic sample bank
// (GeneralUser GS: real multi-sampled pianos, strings, guitars, drums …) and writes a 16-bit
// stereo WAV. SoundFont 2 voice model: per-region sample playback with 4-point Hermite
// interpolation and loops, DAHDSR volume/modulation envelopes, two LFOs, a resonant low-pass,
// note-on modulators (velocity curves, key tracking, CC sends), exclusive classes (hi-hat choke),
// per-voice pan, chorus + reverb sends and a peak limiter.
//
// The native renderer (modules/holysic-dsp/ios/HSSampleSynth.m) is a line-by-line C port of this
// file and must stay in step with it — every formula, constant and evaluation order. Controls are
// updated once per segment (≤ 64 frames, split at events); audio runs per frame.

import { Ev, ParsedMidi, writeWavHeader } from '../midiSynth';
import { GEN_COUNT, SoundBank } from './soundBank';

export interface SampleRenderOptions {
  sampleRate?: number;
  onProgress?: (f: number) => void;
  sliceMs?: number;
  signal?: { cancelled?: boolean };
  /** replaces GM program 0 (Acoustic Grand) — e.g. { bank: 0, program: 1 } for Bright Grand */
  piano?: { bank: number; program: number } | null;
}

const MAX_VOICES = 64;
const SEG = 64;
const MASTER = 0.6;

// SF2 generator numbers
const G_MODLFO_PITCH = 5;
const G_VIBLFO_PITCH = 6;
const G_MODENV_PITCH = 7;
const G_FC = 8;
const G_Q = 9;
const G_MODLFO_FC = 10;
const G_MODENV_FC = 11;
const G_MODLFO_VOL = 13;
const G_CHORUS = 15;
const G_REVERB = 16;
const G_PAN = 17;
const G_MODLFO_DELAY = 21;
const G_MODLFO_FREQ = 22;
const G_VIBLFO_DELAY = 23;
const G_VIBLFO_FREQ = 24;
const G_MODENV_DELAY = 25;
const G_VOLENV_DELAY = 33;
const G_ATTEN = 48;
const G_COARSE = 51;
const G_FINE = 52;
const G_SCALE = 56;
const G_EXCL = 57;
const G_ROOT = 58;

interface Env {
  stage: number; // 0 delay, 1 attack, 2 hold, 3 decay, 4 sustain, 5 release, 6 done
  val: number;
  cnt: number;
  dl: number;
  a: number;
  h: number;
  d: number;
  s: number;
  r: number;
}

interface Voice {
  on: boolean;
  ch: number;
  key: number;
  noteId: number;
  age: number;
  held: boolean;
  excl: number;
  // sample window (absolute pool indices)
  pos: number;
  end: number;
  ls: number;
  le: number;
  mode: number;
  ratio: number;
  cents0: number;
  // params
  atten: number;
  pan: number;
  rev: number;
  cho: number;
  modEnvPitch: number;
  modEnvFc: number;
  modLfoPitch: number;
  modLfoFc: number;
  modLfoVol: number;
  vibPitch: number;
  fc: number;
  filt: boolean;
  qLin: number;
  qGain: number;
  lastFc: number;
  b0: number;
  b1: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  vol: Env;
  menv: Env;
  mlDelay: number;
  mlPh: number;
  mlInc: number;
  vlDelay: number;
  vlPh: number;
  vlInc: number;
  g: number;
  first: boolean;
}

interface Chan {
  prog: number;
  bank: number;
  sustain: boolean;
  bend: number; // semitones
  bendRange: number;
  mod: number; // 0..1
  rpn: number;
  cc: Uint8Array;
}

function newEnv(): Env {
  return { stage: 0, val: 0, cnt: 0, dl: 0, a: 1, h: 0, d: 1, s: 0, r: 1 };
}

/** timecents → frames (≥ 1) */
function tcs(tc: number, sr: number): number {
  if (tc <= -12000) return 1;
  const f = sr * Math.pow(2, tc / 1200);
  return f < 1 ? 1 : f;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function concave(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const v = -(400 / 960) * Math.log10(1 - x);
  return v > 1 ? 1 : v;
}

function convex(x: number): number {
  return 1 - concave(1 - x);
}

/** SF2 modulator source curve: direction, polarity, type (linear/concave/convex/switch) */
function curve(src: number, x0: number): number {
  const x = (src >> 8) & 1 ? 1 - x0 : x0;
  const type = src >> 10;
  if (!((src >> 9) & 1)) {
    if (type === 0) return x;
    if (type === 1) return concave(x);
    if (type === 2) return convex(x);
    return x >= 0.5 ? 1 : 0;
  }
  if (type === 0) return 2 * x - 1;
  if (type === 3) return x >= 0.5 ? 1 : -1;
  if (type === 1) return x > 0.5 ? concave(2 * x - 1) : -concave(1 - 2 * x);
  return x > 0.5 ? convex(2 * x - 1) : -convex(1 - 2 * x);
}

/** raw 0..1 value of a modulator source at note-on (−1 = "no controller": constant 1) */
function srcRaw(src: number, ch: Chan, key: number, vel: number): number {
  const idx = src & 127;
  if (src & 128) return ch.cc[idx] / 127;
  switch (idx) {
    case 0:
      return -1;
    case 2:
      return vel / 127;
    case 3:
      return key / 127;
    case 14:
      return 0.5; // the pitch wheel is applied live by the channel
    case 16:
      return ch.bendRange / 127;
    default:
      return 0; // poly / channel pressure, links
  }
}

function srcValue(src: number, ch: Chan, key: number, vel: number): number {
  const r = srcRaw(src, ch, key, vel);
  return r < 0 ? 1 : curve(src, r);
}

function envAdvance(e: Env, n: number) {
  switch (e.stage) {
    case 0:
      e.cnt -= n;
      if (e.cnt <= 0) e.stage = 1;
      break;
    case 1:
      e.val += n / e.a;
      if (e.val >= 1) {
        e.val = 1;
        e.stage = 2;
        e.cnt = e.h;
      }
      break;
    case 2:
      e.cnt -= n;
      if (e.cnt <= 0) e.stage = 3;
      break;
    case 3:
      e.val -= n / e.d;
      if (e.val <= e.s) {
        e.val = e.s;
        e.stage = 4;
      }
      break;
    case 5:
      e.val -= n / e.r;
      if (e.val <= 0) {
        e.val = 0;
        e.stage = 6;
      }
      break;
  }
}

/** volume envelope value → linear amplitude (attack is linear, the rest linear in dB over 100 dB) */
function volAmp(e: Env): number {
  if (e.stage <= 1) return e.val;
  return e.val <= 0 ? 0 : Math.pow(10, (e.val - 1) * 5);
}

function tri(p: number): number {
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
}

/** Render a parsed MIDI through the sample bank to a complete WAV (16-bit stereo PCM) */
export async function renderMidiSampled(
  midi: ParsedMidi,
  bank: SoundBank,
  opts: SampleRenderOptions = {}
): Promise<Uint8Array> {
  const sr = opts.sampleRate || bank.sampleRate;
  const frames = Math.max(sr, Math.ceil(midi.durationSec * sr));
  const out = new Uint8Array(44 + frames * 4);
  writeWavHeader(out, sr, frames);
  const pcm = new Int16Array(out.buffer, 44, frames * 2);
  const pool = bank.pool;
  const piano = opts.piano || null;

  const chans: Chan[] = [];
  for (let c = 0; c < 16; c++) {
    const cc = new Uint8Array(128);
    cc[7] = 100;
    cc[10] = 64;
    cc[11] = 127;
    cc[91] = 40;
    chans.push({ prog: 0, bank: 0, sustain: false, bend: 0, bendRange: 2, mod: 0, rpn: -1, cc });
  }

  const voices: Voice[] = [];
  let ageCounter = 0;
  let noteCounter = 0;
  const gens = new Float64Array(GEN_COUNT);

  const freeVoice = (): Voice => {
    for (let i = 0; i < voices.length; i++) if (!voices[i].on) return voices[i];
    if (voices.length < MAX_VOICES) {
      const v = { on: false, vol: newEnv(), menv: newEnv() } as Voice;
      voices.push(v);
      return v;
    }
    // steal: a released voice first, then the quietest, then the oldest
    let pick = voices[0];
    let best = 1e9;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      const s = (v.vol.stage >= 5 ? 0 : 2) + v.g * 32768 - v.age * 1e-9;
      if (s < best) {
        best = s;
        pick = v;
      }
    }
    return pick;
  };

  const release = (v: Voice, fast: number) => {
    const e = v.vol;
    if (e.stage >= 5) {
      if (fast > 0 && fast < e.r) e.r = fast;
      return;
    }
    if (e.stage <= 1) {
      const amp = e.val;
      e.val = amp > 0.00001 ? 1 + Math.log10(amp) / 5 : 0;
    }
    e.stage = 5;
    if (fast > 0 && fast < e.r) e.r = fast;
    if (v.menv.stage < 5) v.menv.stage = 5;
  };

  const presetFor = (chN: number): number => {
    const ch = chans[chN];
    let idx: number | undefined;
    if (chN === 9) {
      idx = bank.byKey.get(128 * 128 + ch.prog);
      if (idx === undefined) idx = bank.byKey.get(128 * 128);
    } else {
      let b = ch.bank;
      let p = ch.prog;
      if (piano && b === 0 && p === 0) {
        b = piano.bank;
        p = piano.program;
      }
      idx = bank.byKey.get(b * 128 + p);
      if (idx === undefined) idx = bank.byKey.get(ch.prog);
    }
    return idx === undefined ? 0 : idx;
  };

  const startVoice = (chN: number, key: number, vel: number, r: number, noteId: number) => {
    const ch = chans[chN];
    const gb = r * GEN_COUNT;
    for (let k = 0; k < GEN_COUNT; k++) gens[k] = bank.rGen[gb + k];
    const m0 = bank.rModStart[r];
    const m1 = m0 + bank.rModCount[r];
    for (let m = m0; m < m1; m++) {
      const a = srcValue(bank.mSrc[m], ch, key, vel);
      if (a === 0) continue;
      const as = bank.mAmtSrc[m];
      let val = bank.mAmt[m] * a * (as === 0 ? 1 : srcValue(as, ch, key, vel));
      if (bank.mTrans[m] === 2 && val < 0) val = -val;
      gens[bank.mDst[m]] += val;
    }
    const s = bank.rSample[r];
    const base = bank.sOff[s];
    const excl = gens[G_EXCL];
    if (excl > 0)
      for (let i = 0; i < voices.length; i++) {
        const o = voices[i];
        if (o.on && o.ch === chN && o.excl === excl && o.noteId !== noteId) release(o, 0.004 * sr);
      }
    const v = freeVoice();
    v.on = true;
    v.ch = chN;
    v.key = key;
    v.noteId = noteId;
    v.age = ++ageCounter;
    v.held = false;
    v.excl = excl;
    v.pos = base + bank.rPos[r * 4];
    v.end = base + bank.rPos[r * 4 + 1];
    v.ls = base + bank.rPos[r * 4 + 2];
    v.le = base + bank.rPos[r * 4 + 3];
    v.mode = bank.rMode[r];
    if (v.le - v.ls < 2) v.mode = 0;
    v.ratio = bank.sRate[s] / sr;
    v.cents0 = (key - gens[G_ROOT]) * gens[G_SCALE] + gens[G_COARSE] * 100 + gens[G_FINE];
    v.atten = clamp(gens[G_ATTEN], 0, 1440);
    v.pan = clamp(gens[G_PAN] / 500, -1, 1);
    v.rev = clamp(gens[G_REVERB] / 1000, 0, 1);
    v.cho = clamp(gens[G_CHORUS] / 1000, 0, 1);
    v.modEnvPitch = gens[G_MODENV_PITCH];
    v.modEnvFc = gens[G_MODENV_FC];
    v.modLfoPitch = gens[G_MODLFO_PITCH];
    v.modLfoFc = gens[G_MODLFO_FC];
    v.modLfoVol = gens[G_MODLFO_VOL];
    v.vibPitch = gens[G_VIBLFO_PITCH];
    v.fc = gens[G_FC];
    const q = gens[G_Q] > 0 ? gens[G_Q] : 0;
    v.filt = v.fc < 13500 || q > 0 || v.modEnvFc !== 0 || v.modLfoFc !== 0;
    v.qLin = Math.pow(10, (q / 10 - 3.01) / 20);
    v.qGain = q > 0 ? 1 / Math.sqrt(v.qLin) : 1;
    v.lastFc = -1e9;
    v.b0 = 1;
    v.b1 = 0;
    v.a1 = 0;
    v.a2 = 0;
    v.x1 = 0;
    v.x2 = 0;
    v.y1 = 0;
    v.y2 = 0;
    const kd = 60 - key;
    for (let w = 0; w < 2; w++) {
      const e = w === 0 ? v.vol : v.menv;
      const g0 = w === 0 ? G_VOLENV_DELAY : G_MODENV_DELAY;
      e.stage = 0;
      e.val = 0;
      e.dl = gens[g0] <= -12000 ? 0 : tcs(gens[g0], sr);
      e.cnt = e.dl;
      e.a = tcs(gens[g0 + 1], sr);
      e.h = gens[g0 + 2] <= -12000 ? 0 : tcs(gens[g0 + 2] + gens[g0 + 6] * kd, sr);
      e.d = tcs(gens[g0 + 3] + gens[g0 + 7] * kd, sr);
      e.s = clamp(1 - gens[g0 + 4] / 1000, 0, 1);
      e.r = tcs(gens[g0 + 5], sr);
      if (e.dl <= 0) e.stage = 1;
    }
    if (v.vol.r < 0.003 * sr) v.vol.r = 0.003 * sr;
    v.mlDelay = gens[G_MODLFO_DELAY] <= -12000 ? 0 : tcs(gens[G_MODLFO_DELAY], sr);
    v.mlPh = 0;
    v.mlInc = (8.176 * Math.pow(2, gens[G_MODLFO_FREQ] / 1200)) / sr;
    v.vlDelay = gens[G_VIBLFO_DELAY] <= -12000 ? 0 : tcs(gens[G_VIBLFO_DELAY], sr);
    v.vlPh = 0;
    v.vlInc = (8.176 * Math.pow(2, gens[G_VIBLFO_FREQ] / 1200)) / sr;
    v.g = 0;
    v.first = true;
  };

  const noteOn = (chN: number, key: number, vel: number) => {
    if (vel <= 0) {
      noteOff(chN, key);
      return;
    }
    const noteId = ++noteCounter;
    // the same key struck again on this channel: let the old voices go
    for (let i = 0; i < voices.length; i++) {
      const o = voices[i];
      if (o.on && o.ch === chN && o.key === key && o.vol.stage < 5) release(o, 0);
    }
    const p = bank.presets[presetFor(chN)];
    const r1 = p.regionStart + p.regionCount;
    for (let r = p.regionStart; r < r1; r++) {
      const k = r * 4;
      if (key < bank.rKey[k] || key > bank.rKey[k + 1]) continue;
      if (vel < bank.rKey[k + 2] || vel > bank.rKey[k + 3]) continue;
      startVoice(chN, key, vel, r, noteId);
    }
  };

  const noteOff = (chN: number, key: number) => {
    const ch = chans[chN];
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (!v.on || v.ch !== chN || v.key !== key || v.vol.stage >= 5) continue;
      if (ch.sustain) v.held = true;
      else release(v, 0);
    }
  };

  const control = (chN: number, cc: number, val: number) => {
    const ch = chans[chN];
    ch.cc[cc] = val;
    switch (cc) {
      case 0:
        ch.bank = val;
        break;
      case 1:
        ch.mod = val / 127;
        break;
      case 64: {
        const down = val >= 64;
        if (ch.sustain && !down)
          for (let i = 0; i < voices.length; i++) {
            const v = voices[i];
            if (v.on && v.ch === chN && v.held) {
              v.held = false;
              release(v, 0);
            }
          }
        ch.sustain = down;
        break;
      }
      case 101:
        ch.rpn = (ch.rpn & 0x7f) | (val << 7);
        break;
      case 100:
        ch.rpn = (ch.rpn & ~0x7f) | val;
        break;
      case 6:
        if (ch.rpn === 0) ch.bendRange = clamp(val, 0, 24);
        break;
      case 120:
        for (let i = 0; i < voices.length; i++) if (voices[i].ch === chN) voices[i].on = false;
        break;
      case 121:
        ch.mod = 0;
        ch.cc[1] = 0;
        ch.cc[11] = 127;
        ch.bend = 0;
        if (ch.sustain) control(chN, 64, 0);
        break;
      case 123:
        for (let i = 0; i < voices.length; i++) {
          const v = voices[i];
          if (v.on && v.ch === chN) release(v, 0);
        }
        break;
    }
  };

  // effects: Freeverb-style reverb (4 combs, 2 allpasses per side) and a 2-tap stereo chorus
  const scale = sr / 44100;
  const mk = (n: number) => new Float64Array(Math.max(8, Math.round(n * scale)));
  const combs = [1116, 1188, 1277, 1356].map(mk);
  const combIdx = new Int32Array(4);
  const combLp = new Float64Array(4);
  const aps = [556, 441, 579, 464].map(mk);
  const apIdx = new Int32Array(4);
  const fb = 0.84;
  const damp = 0.3;
  let revTail = 0;
  const choLen = 2048;
  const choBuf = new Float64Array(choLen);
  let choW = 0;
  let choPh = 0;
  const choInc = 0.36 / sr;
  const choBase = 0.012 * sr;
  const choDepth = 0.0036 * sr;
  let choTail = 0;

  const L = new Float64Array(SEG);
  const R = new Float64Array(SEG);
  const RV = new Float64Array(SEG);
  const CH = new Float64Array(SEG);
  let limiter = 1;

  const events = midi.events;
  let ei = 0;
  let pos = 0;
  let sliceStart = Date.now();
  const sliceMs = opts.sliceMs ?? 24;
  let lastProgress = 0;

  while (pos < frames) {
    if (opts.signal?.cancelled) throw new Error('cancelled');
    while (ei < events.length && Math.round(events[ei].t * sr) <= pos) {
      const e = events[ei++];
      if (e.kind === Ev.On) noteOn(e.ch, e.a, e.b);
      else if (e.kind === Ev.Off) noteOff(e.ch, e.a);
      else if (e.kind === Ev.CC) control(e.ch, e.a, e.b);
      else if (e.kind === Ev.Prog) chans[e.ch].prog = e.a;
      else if (e.kind === Ev.Bend) chans[e.ch].bend = ((e.a - 8192) / 8192) * chans[e.ch].bendRange;
    }
    const nextEvt = ei < events.length ? Math.round(events[ei].t * sr) : frames;
    const n = Math.max(1, Math.min(SEG, nextEvt - pos, frames - pos));
    for (let i = 0; i < n; i++) {
      L[i] = 0;
      R[i] = 0;
      RV[i] = 0;
      CH[i] = 0;
    }
    let anyRev = false;
    let anyCho = false;

    for (let vi = 0; vi < voices.length; vi++) {
      const v = voices[vi];
      if (!v.on) continue;
      const ch = chans[v.ch];
      envAdvance(v.vol, n);
      envAdvance(v.menv, n);
      // −85 dB below the voice's peak (or a silent sustain): done
      if (v.vol.stage >= 3 && v.vol.val <= 0.15) {
        v.on = false;
        continue;
      }
      let ml = 0;
      if (v.mlDelay > 0) v.mlDelay -= n;
      else {
        v.mlPh += v.mlInc * n;
        v.mlPh -= Math.floor(v.mlPh);
        ml = tri(v.mlPh);
      }
      let vl = 0;
      if (v.vlDelay > 0) v.vlDelay -= n;
      else {
        v.vlPh += v.vlInc * n;
        v.vlPh -= Math.floor(v.vlPh);
        vl = tri(v.vlPh);
      }
      const me = v.menv.val;
      const cents =
        v.cents0 +
        ch.bend * 100 +
        me * v.modEnvPitch +
        ml * v.modLfoPitch +
        vl * (v.vibPitch + ch.mod * 50);
      const inc = v.ratio * Math.pow(2, cents / 1200);

      if (v.filt) {
        const fcC = v.fc + me * v.modEnvFc + ml * v.modLfoFc;
        if (fcC - v.lastFc > 1 || v.lastFc - fcC > 1) {
          v.lastFc = fcC;
          let hz = 8.176 * Math.pow(2, fcC / 1200);
          if (hz > 0.45 * sr) hz = 0.45 * sr;
          if (hz < 5) hz = 5;
          const w = (2 * Math.PI * hz) / sr;
          const cs = Math.cos(w);
          const alpha = Math.sin(w) / (2 * v.qLin);
          const a0 = 1 + alpha;
          v.b1 = ((1 - cs) * v.qGain) / a0;
          v.b0 = v.b1 * 0.5;
          v.a1 = (-2 * cs) / a0;
          v.a2 = (1 - alpha) / a0;
        }
      }

      const cv = ch.cc[7] / 127;
      const ce = ch.cc[11] / 127;
      const target =
        volAmp(v.vol) *
        Math.pow(10, (-v.atten + ml * v.modLfoVol) / 200) *
        (cv * cv * ce * ce) *
        (1 / 32768);
      if (v.first) {
        v.g = target;
        v.first = false;
      }
      let g = v.g;
      const dg = (target - g) / n;
      const pa = (clamp(v.pan + (ch.cc[10] - 64) / 64, -1, 1) + 1) * (Math.PI / 4);
      const pl = Math.cos(pa);
      const pr = Math.sin(pa);
      const rs = v.rev;
      const cso = v.cho;
      if (rs > 0) anyRev = true;
      if (cso > 0) anyCho = true;

      const loopOn = v.mode === 1 || (v.mode === 3 && v.vol.stage < 5);
      const lim = loopOn ? v.le : v.end;
      const loopLen = v.le - v.ls;
      let p = v.pos;
      const filt = v.filt;
      const b0 = v.b0;
      const b1 = v.b1;
      const a1 = v.a1;
      const a2 = v.a2;
      let x1 = v.x1;
      let x2 = v.x2;
      let y1 = v.y1;
      let y2 = v.y2;
      let done = false;
      for (let i = 0; i < n; i++) {
        const ip = p | 0;
        const f = p - ip;
        const xm = pool[ip - 1];
        const x0 = pool[ip];
        const xa = pool[ip + 1];
        const xb = pool[ip + 2];
        let s =
          (((0.5 * (xb - xm) + 1.5 * (x0 - xa)) * f + (xm - 2.5 * x0 + 2 * xa - 0.5 * xb)) * f +
            0.5 * (xa - xm)) *
            f +
          x0;
        if (filt) {
          const y = b0 * s + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
          x2 = x1;
          x1 = s;
          y2 = y1;
          y1 = y;
          s = y;
        }
        const o = s * g;
        g += dg;
        L[i] += o * pl;
        R[i] += o * pr;
        RV[i] += o * rs;
        CH[i] += o * cso;
        p += inc;
        if (p >= lim) {
          if (loopOn) p -= loopLen;
          else {
            done = true;
            break;
          }
        }
      }
      if (y1 < 1e-15 && y1 > -1e-15) y1 = 0;
      if (y2 < 1e-15 && y2 > -1e-15) y2 = 0;
      v.x1 = x1;
      v.x2 = x2;
      v.y1 = y1;
      v.y2 = y2;
      v.pos = p;
      v.g = target;
      if (done) v.on = false;
    }

    if (anyCho) choTail = choLen;
    if (anyRev) revTail = Math.round(sr * 4);
    const doCho = choTail > 0;
    const doRev = revTail > 0;
    if (doCho) choTail -= n;
    if (doRev) revTail -= n;

    for (let i = 0; i < n; i++) {
      let l = L[i];
      let r = R[i];
      if (doCho) {
        choBuf[choW] = CH[i];
        const ph = 2 * Math.PI * choPh;
        const dL = choBase + choDepth * Math.sin(ph);
        const dR = choBase + choDepth * Math.cos(ph);
        choPh += choInc;
        if (choPh >= 1) choPh -= 1;
        let rp = choW - dL;
        if (rp < 0) rp += choLen;
        let i0 = rp | 0;
        let fr = rp - i0;
        let i1 = i0 + 1 >= choLen ? 0 : i0 + 1;
        const tl = choBuf[i0] + (choBuf[i1] - choBuf[i0]) * fr;
        rp = choW - dR;
        if (rp < 0) rp += choLen;
        i0 = rp | 0;
        fr = rp - i0;
        i1 = i0 + 1 >= choLen ? 0 : i0 + 1;
        const tr = choBuf[i0] + (choBuf[i1] - choBuf[i0]) * fr;
        if (++choW >= choLen) choW = 0;
        l += tl * 0.55;
        r += tr * 0.55;
      }
      if (doRev) {
        const x = RV[i] * 0.2;
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const cb = combs[k];
          const ix = combIdx[k];
          const o = cb[ix];
          combLp[k] = o * (1 - damp) + combLp[k] * damp;
          cb[ix] = x + combLp[k] * fb;
          combIdx[k] = ix + 1 >= cb.length ? 0 : ix + 1;
          sum += o;
        }
        let rl = sum;
        let rr = sum;
        for (let k = 0; k < 2; k++) {
          let ap = aps[k];
          let ix = apIdx[k];
          let bo = ap[ix];
          ap[ix] = rl + bo * 0.5;
          rl = bo - rl;
          apIdx[k] = ix + 1 >= ap.length ? 0 : ix + 1;
          ap = aps[k + 2];
          ix = apIdx[k + 2];
          bo = ap[ix];
          ap[ix] = rr + bo * 0.5;
          rr = bo - rr;
          apIdx[k + 2] = ix + 1 >= ap.length ? 0 : ix + 1;
        }
        l += rl * 0.9;
        r += rr * 0.9;
      }
      l *= MASTER;
      r *= MASTER;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      const pk = (al > ar ? al : ar) * limiter;
      if (pk > 0.92) limiter *= 0.92 / pk;
      else if (limiter < 1) limiter = Math.min(1, limiter + 0.00015);
      l *= limiter;
      r *= limiter;
      const o2 = (pos + i) * 2;
      pcm[o2] = l >= 1 ? 32767 : l <= -1 ? -32768 : (l * 32767) | 0;
      pcm[o2 + 1] = r >= 1 ? 32767 : r <= -1 ? -32768 : (r * 32767) | 0;
    }

    pos += n;
    if (Date.now() - sliceStart > sliceMs) {
      const f = pos / frames;
      if (opts.onProgress && f - lastProgress > 0.02) {
        lastProgress = f;
        opts.onProgress(f);
      }
      await new Promise<void>((r) => setTimeout(r, 0));
      sliceStart = Date.now();
    }
  }
  opts.onProgress?.(1);
  return out;
}
