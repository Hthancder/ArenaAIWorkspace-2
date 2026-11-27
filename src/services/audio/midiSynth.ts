// MIDI → WAV — a small General MIDI synthesizer in plain TypeScript.
//
// AVPlayer cannot play Standard MIDI Files, so the app renders them once into a 16-bit stereo WAV
// (cached on disk) and plays that through the normal audio engine — lock screen, EQ, lyrics,
// crossfade and progress all keep working. Supports SMF format 0/1/2, RIFF RMID and karaoke .kar
// (whose syllable lyrics become timed LRC lines).
//
// The synth is built for speed on Hermes (an interpreter on iOS): band-limited wavetables picked
// per octave, Karplus–Strong strings for guitars/basses/harps, 2-operator FM for bells and
// electric pianos, pre-baked drum samples, per-segment envelopes and a light stereo reverb.

/** Meta text: UTF-8 when it is valid UTF-8, else Latin-1 (old .kar files) */
function decodeText(b: Uint8Array): string {
  let s = '';
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  let ok = true;
  while (i < b.length) {
    const c = b[i];
    let cp = c;
    let need = 0;
    if (c >= 0xf0 && c < 0xf8) ((cp = c & 7), (need = 3));
    else if (c >= 0xe0) ((cp = c & 15), (need = 2));
    else if (c >= 0xc0) ((cp = c & 31), (need = 1));
    else if (c >= 0x80) {
      ok = false;
      break;
    }
    if (i + need >= b.length && need) {
      ok = false;
      break;
    }
    for (let k = 1; k <= need; k++) {
      const d = b[i + k];
      if ((d & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (d & 63);
    }
    if (!ok) break;
    s += String.fromCodePoint(cp);
    i += need + 1;
  }
  if (ok) return s.replace(/\u0000+$/, '');
  let l = '';
  for (let j = 0; j < b.length; j++) if (b[j]) l += String.fromCharCode(b[j]);
  return l;
}

// ---------------------------------------------------------------------------------------------
// Parsing

export const Ev = { Off: 0, On: 1, CC: 2, Prog: 3, Bend: 4 } as const;
export type Ev = (typeof Ev)[keyof typeof Ev];

export interface MidiEvent {
  /** seconds from the start */
  t: number;
  kind: Ev;
  ch: number;
  a: number;
  b: number;
}

export interface ParsedMidi {
  format: number;
  tracks: number;
  events: MidiEvent[];
  /** seconds, including a short release tail */
  durationSec: number;
  title?: string;
  artist?: string;
  /** LRC text built from lyric / karaoke syllable events */
  lyrics?: string;
  /** distinct GM programs used (for diagnostics) */
  programs: number[];
  notes: number;
}

interface RawEv {
  tick: number;
  seq: number;
  kind: number; // Ev, or 10 tempo, 11 text
  ch: number;
  a: number;
  b: number;
  text?: string;
  meta?: number;
  track: number;
}

/** Pull the SMF out of a RIFF RMID wrapper */
function unwrap(b: Uint8Array): Uint8Array {
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    let p = 12;
    while (p + 8 <= b.length) {
      const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      const len = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
      if (id === 'data') return b.subarray(p + 8, Math.min(b.length, p + 8 + len));
      if (len < 0) break;
      p += 8 + len + (len & 1);
    }
  }
  // some files carry junk before the header
  for (let i = 0; i < Math.min(b.length - 4, 512); i++)
    if (b[i] === 0x4d && b[i + 1] === 0x54 && b[i + 2] === 0x68 && b[i + 3] === 0x64)
      return i ? b.subarray(i) : b;
  return b;
}

export function isMidiBytes(b: Uint8Array): boolean {
  const s = unwrap(b);
  return s.length > 14 && s[0] === 0x4d && s[1] === 0x54 && s[2] === 0x68 && s[3] === 0x64;
}

export function parseMidi(input: Uint8Array): ParsedMidi {
  const b = unwrap(input);
  if (!isMidiBytes(b)) throw new Error('Not a MIDI file');
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const hdrLen = u32(4);
  const format = u16(8);
  const ntrks = u16(10);
  const division = u16(12);
  const smpte = (division & 0x8000) !== 0;
  const tpq = smpte ? 0 : division || 480;
  const secPerTickSmpte = smpte ? 1 / ((256 - (division >> 8)) * (division & 0xff) || 1) : 0;

  const raw: RawEv[] = [];
  let seq = 0;
  let p = 8 + hdrLen;
  let trackNo = 0;
  let formatTwoOffset = 0;
  while (p + 8 <= b.length && trackNo < Math.max(ntrks, 1) + 64) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const len = u32(p + 4);
    const start = p + 8;
    const end = Math.min(b.length, start + len);
    p = end;
    if (id !== 'MTrk') continue;
    let q = start;
    let tick = format === 2 ? formatTwoOffset : 0;
    let running = 0;
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4 && q < end; i++) {
        const c = b[q++];
        v = (v << 7) | (c & 0x7f);
        if (!(c & 0x80)) break;
      }
      return v;
    };
    while (q < end) {
      tick += vlq();
      if (q >= end) break;
      let st = b[q];
      if (st & 0x80) q++;
      else if (running) st = running;
      else {
        q++;
        continue;
      }
      if (st === 0xff) {
        const type = b[q++];
        const l = vlq();
        const d = b.subarray(q, Math.min(end, q + l));
        q += l;
        if (type === 0x2f) break;
        if (type === 0x51 && d.length >= 3)
          raw.push({
            tick,
            seq: seq++,
            kind: 10,
            ch: 0,
            a: (d[0] << 16) | (d[1] << 8) | d[2],
            b: 0,
            track: trackNo,
          });
        else if (type >= 1 && type <= 7)
          raw.push({
            tick,
            seq: seq++,
            kind: 11,
            ch: 0,
            a: 0,
            b: 0,
            text: decodeText(d),
            meta: type,
            track: trackNo,
          });
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        const l = vlq();
        q += l;
        continue;
      }
      if (st >= 0xf8) continue;
      if (st >= 0xf1) {
        // system common without running status: skip data bytes
        q += st === 0xf2 ? 2 : st === 0xf3 || st === 0xf1 ? 1 : 0;
        continue;
      }
      running = st;
      const hi = st & 0xf0;
      const ch = st & 0x0f;
      const d1 = b[q++] & 0x7f;
      const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : b[q++] & 0x7f;
      if (hi === 0x90 && d2 > 0)
        raw.push({ tick, seq: seq++, kind: Ev.On, ch, a: d1, b: d2, track: trackNo });
      else if (hi === 0x80 || hi === 0x90)
        raw.push({ tick, seq: seq++, kind: Ev.Off, ch, a: d1, b: 0, track: trackNo });
      else if (hi === 0xb0)
        raw.push({ tick, seq: seq++, kind: Ev.CC, ch, a: d1, b: d2, track: trackNo });
      else if (hi === 0xc0)
        raw.push({ tick, seq: seq++, kind: Ev.Prog, ch, a: d1, b: 0, track: trackNo });
      else if (hi === 0xe0)
        raw.push({ tick, seq: seq++, kind: Ev.Bend, ch, a: (d2 << 7) | d1, b: 0, track: trackNo });
    }
    if (format === 2) formatTwoOffset = tick;
    trackNo++;
  }

  // note-offs before note-ons at the same tick, so a re-struck note is not cut immediately
  raw.sort(
    (x, y) =>
      x.tick - y.tick || (x.kind === Ev.Off ? 0 : 1) - (y.kind === Ev.Off ? 0 : 1) || x.seq - y.seq
  );

  // ticks → seconds through the tempo map
  let usPerQ = 500000;
  let lastTick = 0;
  let lastSec = 0;
  const secOf = (tick: number) =>
    smpte ? tick * secPerTickSmpte : lastSec + ((tick - lastTick) * usPerQ) / 1e6 / tpq;
  const events: MidiEvent[] = [];
  const texts: { t: number; text: string; meta: number; track: number }[] = [];
  const programs = new Set<number>();
  let notes = 0;
  let lastNoteEnd = 0;
  for (const e of raw) {
    const t = secOf(e.tick);
    if (e.kind === 10) {
      lastSec = t;
      lastTick = e.tick;
      usPerQ = Math.max(20000, e.a);
      continue;
    }
    if (e.kind === 11) {
      texts.push({ t, text: e.text || '', meta: e.meta || 1, track: e.track });
      continue;
    }
    if (e.kind === Ev.On) {
      notes++;
      if (e.ch !== 9) programs.add(-1);
    }
    if (e.kind === Ev.Prog && e.ch !== 9) programs.add(e.a);
    if (e.kind === Ev.On || e.kind === Ev.Off) lastNoteEnd = Math.max(lastNoteEnd, t);
    events.push({ t, kind: e.kind as Ev, ch: e.ch, a: e.a, b: e.b });
  }
  if (programs.has(-1)) {
    programs.delete(-1);
    if (!programs.size) programs.add(0);
  }
  const durationSec = Math.min(MAX_SECONDS, lastNoteEnd + 2.5);
  const { title, artist, lyrics } = textInfo(texts);
  return {
    format,
    tracks: trackNo,
    events,
    durationSec,
    title,
    artist,
    lyrics,
    programs: [...programs].sort((x, y) => x - y),
    notes,
  };
}

const MAX_SECONDS = 30 * 60;

const lrcTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
};

/** Title / artist / LRC lyrics from meta text events (karaoke .kar conventions included) */
function textInfo(texts: { t: number; text: string; meta: number; track: number }[]) {
  let title: string | undefined;
  let artist: string | undefined;
  const kTitles = texts.filter((x) => /^@T/.test(x.text)).map((x) => x.text.slice(2).trim());
  if (kTitles[0]) title = kTitles[0];
  if (kTitles[1]) artist = kTitles[1];
  if (!title) {
    const name = texts.find(
      (x) =>
        x.meta === 3 &&
        x.track === 0 &&
        x.text.trim().length > 1 &&
        !/^(untitled|track|sequence|midi|staff|unnamed|copyright|\d+)\b/i.test(x.text.trim())
    );
    if (name) title = name.text.trim();
  }

  // syllables: real lyric events (FF 05) if there are enough, else karaoke text events (FF 01)
  let syl = texts.filter((x) => x.meta === 5 && x.text.length);
  if (syl.length < 8) {
    const byTrack = new Map<number, number>();
    for (const x of texts)
      if (x.meta === 1 && !/^@/.test(x.text)) byTrack.set(x.track, (byTrack.get(x.track) || 0) + 1);
    let best = -1;
    let bestN = 7;
    byTrack.forEach((n, tr) => {
      if (n > bestN) {
        best = tr;
        bestN = n;
      }
    });
    syl =
      best >= 0 ? texts.filter((x) => x.meta === 1 && x.track === best && !/^@/.test(x.text)) : [];
  }
  if (syl.length < 8) return { title, artist, lyrics: undefined };

  const lines: { t: number; text: string }[] = [];
  let cur: { t: number; text: string } | null = null;
  let breakNext = true;
  for (const s of syl) {
    let txt = s.text;
    let brk = breakNext;
    if (/^[\\/]/.test(txt)) {
      brk = true;
      txt = txt.slice(1);
    }
    breakNext = /[\r\n]$/.test(txt);
    txt = txt.replace(/[\r\n]+/g, ' ');
    if (brk || !cur) {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = { t: s.t, text: '' };
    }
    cur.text += txt;
  }
  if (cur && cur.text.trim()) lines.push(cur);
  const clean = lines
    .map((l) => ({ t: l.t, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text);
  if (clean.length < 3) return { title, artist, lyrics: undefined };
  return { title, artist, lyrics: clean.map((l) => `${lrcTime(l.t)}${l.text}`).join('\n') };
}

// ---------------------------------------------------------------------------------------------
// Instruments

const SR_DEFAULT = 22050;
const TABLE = 2048;
const TMASK = TABLE - 1;

type Shape =
  | 'sine'
  | 'saw'
  | 'square'
  | 'tri'
  | 'organ'
  | 'piano'
  | 'brass'
  | 'reed'
  | 'choir'
  | 'string'
  | 'flute';

/** harmonic amplitude n (1-based) for a shape */
function harm(shape: Shape, n: number): number {
  switch (shape) {
    case 'sine':
      return n === 1 ? 1 : 0;
    case 'saw':
      return 1 / n;
    case 'square':
      return n % 2 ? 1 / n : 0;
    case 'tri':
      return n % 2 ? (((n - 1) / 2) % 2 ? -1 : 1) / (n * n) : 0;
    case 'organ':
      return (
        ({ 1: 1, 2: 0.75, 3: 0.55, 4: 0.45, 6: 0.3, 8: 0.25 } as Record<number, number>)[n] || 0
      );
    case 'piano':
      return (n === 7 ? 0.3 : 1) / Math.pow(n, 1.45);
    case 'brass':
      return 1 / Math.pow(n, 0.75);
    case 'reed':
      return (n % 2 ? 1 : 0.35) / Math.pow(n, 0.9);
    case 'choir':
      return [1, 0.6, 0.45, 0.25, 0.18, 0.08, 0.05, 0.03][n - 1] || 0;
    case 'string':
      return 1 / Math.pow(n, 0.95);
    case 'flute':
      return [1, 0.25, 0.08, 0.03][n - 1] || 0;
  }
}

const tables = new Map<string, Float32Array>();
/** band-limited table: harmonics up to `maxH` (a power of two bucket) */
function table(shape: Shape, maxH: number): Float32Array {
  const key = shape + maxH;
  let t = tables.get(key);
  if (t) return t;
  t = new Float32Array(TABLE + 1);
  let peak = 0;
  for (let i = 0; i < TABLE; i++) {
    let v = 0;
    for (let n = 1; n <= maxH; n++) {
      const a = harm(shape, n);
      if (a) v += a * Math.sin((2 * Math.PI * n * i) / TABLE);
    }
    t[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < TABLE; i++) t[i] /= peak;
  t[TABLE] = t[0];
  tables.set(key, t);
  return t;
}

const Kind = { Table: 0, Pluck: 1, FM: 2 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

interface Patch {
  kind: Kind;
  shape: Shape;
  /** attack seconds, decay time-constant seconds, sustain level 0..1, release time-constant */
  a: number;
  d: number;
  s: number;
  r: number;
  /** decay shortens this much per octave above middle C (0 = none) */
  keyTrack: number;
  /** low-pass cutoff as a multiple of the note frequency, plus how much the envelope opens it */
  lp: number;
  lpEnv: number;
  gain: number;
  vib?: number;
  fmRatio?: number;
  fmIndex?: number;
  /** pluck damping 0..1 (higher = longer ring) */
  damp?: number;
}

const P = (
  kind: Kind,
  shape: Shape,
  a: number,
  d: number,
  s: number,
  r: number,
  extra: Partial<Patch> = {}
): Patch => ({ kind, shape, a, d, s, r, keyTrack: 0, lp: 8, lpEnv: 6, gain: 1, ...extra });

/** one patch per General MIDI program */
function patchFor(prog: number): Patch {
  const fam = prog >> 3;
  switch (fam) {
    case 0: // pianos
      if (prog === 4 || prog === 5)
        return P(Kind.FM, 'sine', 0.002, 1.6, 0, 0.35, {
          fmRatio: 1,
          fmIndex: 1.8,
          keyTrack: 0.35,
          gain: 0.75,
        });
      if (prog === 6)
        return P(Kind.Table, 'saw', 0.001, 0.9, 0, 0.12, {
          keyTrack: 0.3,
          lp: 10,
          lpEnv: 10,
          gain: 0.7,
        });
      if (prog === 7)
        return P(Kind.Table, 'square', 0.001, 0.8, 0, 0.12, {
          keyTrack: 0.3,
          lp: 6,
          lpEnv: 8,
          gain: 0.7,
        });
      return P(Kind.Table, 'piano', 0.002, 2.2, 0, 0.3, {
        keyTrack: 0.45,
        lp: 3,
        lpEnv: 9,
        gain: 0.75,
      });
    case 1: // chromatic percussion
      if (prog === 12 || prog === 13)
        return P(Kind.FM, 'sine', 0.001, 0.35, 0, 0.1, {
          fmRatio: 4,
          fmIndex: 1.2,
          keyTrack: 0.3,
          gain: 0.8,
        });
      if (prog === 11)
        return P(Kind.FM, 'sine', 0.002, 1.8, 0, 0.6, {
          fmRatio: 4,
          fmIndex: 0.6,
          gain: 0.9,
          vib: 0.004,
        });
      if (prog === 15) return P(Kind.Pluck, 'saw', 0.001, 2, 0, 0.3, { damp: 0.996, gain: 0.9 });
      return P(Kind.FM, 'sine', 0.001, 1.4, 0, 0.5, {
        fmRatio: 3.5,
        fmIndex: 1.5,
        keyTrack: 0.25,
        gain: 0.8,
      });
    case 2: // organs
      if (prog === 21 || prog === 22 || prog === 23)
        return P(Kind.Table, 'reed', 0.04, 1, 1, 0.1, { lp: 6, lpEnv: 0, gain: 0.55, vib: 0.003 });
      return P(Kind.Table, 'organ', 0.008, 1, 1, 0.06, { lp: 20, lpEnv: 0, gain: 0.5 });
    case 3: // guitars
      if (prog === 29 || prog === 30)
        return P(Kind.Table, 'saw', 0.004, 4, 0.75, 0.15, { lp: 7, lpEnv: 3, gain: 0.55 });
      if (prog === 28) return P(Kind.Pluck, 'saw', 0.001, 0.25, 0, 0.05, { damp: 0.95, gain: 1 });
      if (prog === 31)
        return P(Kind.FM, 'sine', 0.001, 0.8, 0, 0.2, { fmRatio: 2, fmIndex: 0.5, gain: 0.8 });
      return P(Kind.Pluck, 'saw', 0.001, 3, 0, 0.12, {
        damp: prog === 24 ? 0.993 : 0.996,
        gain: 1.05,
      });
    case 4: // basses
      if (prog === 38 || prog === 39)
        return P(Kind.Table, 'saw', 0.003, 0.6, 0.55, 0.08, { lp: 3, lpEnv: 9, gain: 0.8 });
      if (prog === 37 || prog === 36)
        return P(Kind.Table, 'square', 0.002, 0.5, 0.3, 0.06, { lp: 4, lpEnv: 6, gain: 0.8 });
      return P(Kind.Pluck, 'saw', 0.001, 2, 0, 0.08, {
        damp: prog === 32 ? 0.994 : 0.997,
        gain: 1.3,
      });
    case 5: // strings
      if (prog === 45) return P(Kind.Pluck, 'saw', 0.001, 0.4, 0, 0.1, { damp: 0.985, gain: 1 });
      if (prog === 46) return P(Kind.Pluck, 'saw', 0.001, 3, 0, 0.4, { damp: 0.998, gain: 1 });
      if (prog === 47) return P(Kind.Table, 'sine', 0.002, 0.7, 0, 0.3, { gain: 0.8 });
      return P(Kind.Table, 'string', 0.08, 1, 1, 0.25, { lp: 4, lpEnv: 1, gain: 0.45, vib: 0.004 });
    case 6: // ensembles, choir
      if (prog >= 52 && prog <= 54)
        return P(Kind.Table, 'choir', 0.15, 1, 1, 0.35, { lp: 6, lpEnv: 0, gain: 0.5, vib: 0.005 });
      if (prog === 55)
        return P(Kind.Table, 'brass', 0.004, 0.4, 0, 0.2, { lp: 6, lpEnv: 6, gain: 0.7 });
      return P(Kind.Table, 'string', 0.18, 1, 1, 0.4, {
        lp: 3.5,
        lpEnv: 0.5,
        gain: 0.4,
        vib: 0.003,
      });
    case 7: // brass
      return P(Kind.Table, 'brass', 0.03, 0.6, 0.8, 0.1, {
        lp: 3,
        lpEnv: 6,
        gain: 0.45,
        vib: 0.003,
      });
    case 8: // reeds
      return P(Kind.Table, 'reed', 0.03, 1, 0.9, 0.08, { lp: 4, lpEnv: 3, gain: 0.5, vib: 0.004 });
    case 9: // pipes
      return P(Kind.Table, 'flute', 0.05, 1, 0.9, 0.12, {
        lp: 8,
        lpEnv: 0,
        gain: 0.65,
        vib: 0.005,
      });
    case 10: // synth lead
      return P(
        Kind.Table,
        prog === 80 ? 'square' : prog === 82 ? 'flute' : 'saw',
        0.005,
        1,
        0.85,
        0.1,
        { lp: 6, lpEnv: 4, gain: 0.45, vib: 0.003 }
      );
    case 11: // synth pad
      return P(Kind.Table, prog === 89 ? 'tri' : 'string', 0.3, 1, 1, 0.6, {
        lp: 3,
        lpEnv: 0.5,
        gain: 0.38,
        vib: 0.002,
      });
    case 12: // synth fx
      return P(Kind.Table, 'tri', 0.2, 2, 0.6, 0.8, { lp: 4, lpEnv: 2, gain: 0.35 });
    case 13: // ethnic
      if (prog === 109 || prog === 111)
        return P(Kind.Table, 'reed', 0.03, 1, 0.9, 0.1, { lp: 5, lpEnv: 2, gain: 0.45 });
      if (prog === 110)
        return P(Kind.Table, 'string', 0.06, 1, 1, 0.2, {
          lp: 4,
          lpEnv: 1,
          gain: 0.45,
          vib: 0.005,
        });
      if (prog === 108)
        return P(Kind.FM, 'sine', 0.001, 0.9, 0, 0.3, { fmRatio: 3, fmIndex: 1, gain: 0.9 });
      return P(Kind.Pluck, 'saw', 0.001, 2, 0, 0.2, { damp: 0.995, gain: 1 });
    case 14: // percussive
      if (prog === 116 || prog === 117 || prog === 118)
        return P(Kind.Table, 'sine', 0.001, 0.35, 0, 0.15, { gain: 0.8 });
      if (prog === 115)
        return P(Kind.FM, 'sine', 0.001, 0.08, 0, 0.04, { fmRatio: 2.4, fmIndex: 2, gain: 0.8 });
      return P(Kind.FM, 'sine', 0.001, 1.2, 0, 0.4, { fmRatio: 1.41, fmIndex: 2, gain: 0.7 });
    default: // sound effects: keep them soft
      return P(Kind.Table, 'tri', 0.05, 1, 0.5, 0.4, { lp: 3, lpEnv: 1, gain: 0.15 });
  }
}

// ---------------------------------------------------------------------------------------------
// Drums (channel 10) — baked once per sample rate

type DrumId =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hatC'
  | 'hatO'
  | 'hatP'
  | 'crash'
  | 'ride'
  | 'tomL'
  | 'tomM'
  | 'tomH'
  | 'rim'
  | 'cowbell'
  | 'tamb'
  | 'shaker'
  | 'block'
  | 'conga'
  | 'bell';

function noiseGen(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function bakeDrum(id: DrumId, sr: number): Float32Array {
  const rnd = noiseGen(id.length * 7919 + id.charCodeAt(0));
  const len = (sec: number) => Math.max(1, Math.round(sec * sr));
  const twoPi = 2 * Math.PI;
  let out: Float32Array;
  const hp = (x: Float32Array, fc: number) => {
    const a = Math.exp((-twoPi * fc) / sr);
    let px = 0;
    let py = 0;
    for (let i = 0; i < x.length; i++) {
      const y = a * (py + x[i] - px);
      px = x[i];
      x[i] = py = y;
    }
  };
  const tone = (sec: number, f0: number, f1: number, drop: number, decay: number, noise = 0) => {
    const o = new Float32Array(len(sec));
    let ph = 0;
    for (let i = 0; i < o.length; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / drop);
      ph += (twoPi * f) / sr;
      o[i] = (Math.sin(ph) + noise * rnd()) * Math.exp(-t / decay);
    }
    return o;
  };
  const metal = (sec: number, decay: number, fc: number, gain = 1) => {
    const o = new Float32Array(len(sec));
    for (let i = 0; i < o.length; i++) o[i] = rnd() * Math.exp(-i / sr / decay) * gain;
    hp(o, fc);
    return o;
  };
  switch (id) {
    case 'kick':
      out = tone(0.45, 160, 48, 0.035, 0.16);
      for (let i = 0; i < Math.min(out.length, len(0.004)); i++)
        out[i] += rnd() * 0.4 * (1 - i / len(0.004));
      break;
    case 'snare': {
      out = tone(0.28, 260, 180, 0.02, 0.07);
      const n = metal(0.28, 0.08, 1200, 0.9);
      for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.55 + n[i];
      break;
    }
    case 'clap': {
      out = new Float32Array(len(0.3));
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const burst = t < 0.03 ? Math.exp(-((t * 1000) % 10) / 2.5) : Math.exp(-(t - 0.03) / 0.07);
        out[i] = rnd() * burst;
      }
      hp(out, 900);
      break;
    }
    case 'hatC':
      out = metal(0.08, 0.018, 7000, 0.8);
      break;
    case 'hatP':
      out = metal(0.1, 0.03, 6500, 0.6);
      break;
    case 'hatO':
      out = metal(0.5, 0.15, 6500, 0.7);
      break;
    case 'crash':
      out = metal(1.8, 0.55, 4500, 0.75);
      break;
    case 'ride': {
      out = metal(1.4, 0.45, 6000, 0.45);
      const b = tone(1.4, 2600, 2600, 1, 0.4);
      for (let i = 0; i < out.length; i++) out[i] += b[i] * 0.12;
      break;
    }
    case 'tomL':
      out = tone(0.5, 140, 90, 0.06, 0.18, 0.05);
      break;
    case 'tomM':
      out = tone(0.45, 200, 130, 0.05, 0.15, 0.05);
      break;
    case 'tomH':
      out = tone(0.4, 280, 190, 0.04, 0.13, 0.05);
      break;
    case 'rim':
      out = tone(0.05, 1700, 1700, 1, 0.008, 0.6);
      break;
    case 'block':
      out = tone(0.08, 1100, 900, 0.01, 0.02);
      break;
    case 'conga':
      out = tone(0.3, 330, 260, 0.02, 0.09);
      break;
    case 'cowbell': {
      out = new Float32Array(len(0.35));
      let a = 0;
      let c = 0;
      for (let i = 0; i < out.length; i++) {
        a += 540 / sr;
        c += 800 / sr;
        out[i] = ((a % 1 < 0.5 ? 1 : -1) + (c % 1 < 0.5 ? 1 : -1)) * 0.3 * Math.exp(-i / sr / 0.09);
      }
      break;
    }
    case 'bell':
      out = tone(1, 2200, 2200, 1, 0.35);
      break;
    case 'tamb':
      out = metal(0.25, 0.06, 5000, 0.7);
      break;
    case 'shaker':
      out = metal(0.12, 0.035, 5500, 0.5);
      break;
  }
  return out!;
}

/** GM percussion key map: note → [sample, gain, pitch ratio] */
function drumFor(note: number): [DrumId, number, number] | null {
  if (note === 35 || note === 36) return ['kick', 1.15, 1];
  if (note === 37) return ['rim', 0.6, 1];
  if (note === 38 || note === 40) return ['snare', note === 40 ? 1 : 0.95, note === 40 ? 1.08 : 1];
  if (note === 39) return ['clap', 0.8, 1];
  if (note === 42) return ['hatC', 0.5, 1];
  if (note === 44) return ['hatP', 0.45, 1];
  if (note === 46) return ['hatO', 0.5, 1];
  if (note === 41 || note === 43) return ['tomL', 0.9, note === 43 ? 1.12 : 1];
  if (note === 45 || note === 47) return ['tomM', 0.9, note === 47 ? 1.12 : 1];
  if (note === 48 || note === 50) return ['tomH', 0.9, note === 50 ? 1.12 : 1];
  if (note === 49 || note === 57 || note === 52 || note === 55)
    return ['crash', note === 55 ? 0.45 : 0.6, note === 55 ? 1.2 : 1];
  if (note === 51 || note === 59 || note === 53) return ['ride', 0.55, note === 53 ? 1.1 : 1];
  if (note === 54) return ['tamb', 0.5, 1];
  if (note === 56) return ['cowbell', 0.5, 1];
  if (note >= 60 && note <= 64) return ['conga', 0.7, 1 + (note - 60) * 0.12];
  if (note === 65 || note === 66) return ['tomH', 0.6, 1.3 + (note - 65) * 0.1];
  if (note === 69 || note === 70 || note === 82) return ['shaker', 0.45, 1];
  if (note === 75 || note === 76 || note === 77) return ['block', 0.6, 1 + (note - 75) * 0.15];
  if (note === 80 || note === 81) return ['bell', 0.3, note === 81 ? 1 : 1.2];
  if (note >= 67 && note <= 74) return ['block', 0.45, 0.8 + (note - 67) * 0.06];
  if (note >= 27 && note <= 34) return ['rim', 0.4, 1];
  return null;
}

// ---------------------------------------------------------------------------------------------
// Voices

interface Voice {
  on: boolean;
  ch: number;
  note: number;
  patch: Patch;
  kind: Kind;
  tbl: Float32Array;
  ph: number;
  inc: number;
  baseHz: number;
  mph: number;
  minc: number;
  fmIdx: number;
  level: number;
  stage: number; // 0 attack, 1 decay/sustain, 2 release
  aStep: number;
  dMul: number;
  rMul: number;
  sus: number;
  vel: number;
  held: boolean; // note-off came while the sustain pedal is down
  lpY: number;
  lpA: number;
  age: number;
  // pluck
  buf: Float32Array | null;
  bi: number;
  bLen: number;
  damp: number;
  apC: number;
  apX: number;
  apY: number;
  // drums
  drum: Float32Array | null;
  dpos: number;
  dinc: number;
  vibPh: number;
}

interface Channel {
  prog: number;
  vol: number;
  expr: number;
  pan: number;
  sustain: boolean;
  bend: number; // semitones
  bendRange: number;
  mod: number;
  rev: number;
  rpn: number;
  buf: Float32Array;
}

export interface RenderOptions {
  sampleRate?: number;
  /** 0..1 */
  onProgress?: (f: number) => void;
  /** yield to the UI this often (ms of work) — keeps the app responsive on Hermes */
  sliceMs?: number;
  signal?: { cancelled?: boolean };
}

const MAX_VOICES = 40;
const SEG = 128;

/** Render a parsed MIDI to a complete WAV file (16-bit stereo PCM) */
export async function renderMidiToWav(
  midi: ParsedMidi,
  opts: RenderOptions = {}
): Promise<Uint8Array> {
  const sr = opts.sampleRate || SR_DEFAULT;
  const frames = Math.max(sr, Math.ceil(midi.durationSec * sr));
  const out = new Uint8Array(44 + frames * 4);
  writeWavHeader(out, sr, frames);
  const pcm = new Int16Array(out.buffer, 44, frames * 2);

  const nyq = sr / 2;
  const chans: Channel[] = [];
  for (let c = 0; c < 16; c++)
    chans.push({
      prog: 0,
      vol: 100 / 127,
      expr: 1,
      pan: 0.5,
      sustain: false,
      bend: 0,
      bendRange: 2,
      mod: 0,
      rev: 40 / 127,
      rpn: -1,
      buf: new Float32Array(SEG),
    });
  const patches = new Map<number, Patch>();
  const patchOf = (p: number) => {
    let x = patches.get(p);
    if (!x) patches.set(p, (x = patchFor(p)));
    return x;
  };
  const drums = new Map<DrumId, Float32Array>();
  const drumSample = (id: DrumId) => {
    let d = drums.get(id);
    if (!d) drums.set(id, (d = bakeDrum(id, sr)));
    return d;
  };
  const sine = table('sine', 1);

  const voices: Voice[] = [];
  let ageCounter = 0;
  const freeVoice = (): Voice => {
    for (const v of voices) if (!v.on) return v;
    if (voices.length < MAX_VOICES) {
      const v = { on: false } as Voice;
      voices.push(v);
      return v;
    }
    // steal: the quietest released voice, else the oldest
    const score = (v: Voice) => (v.stage === 2 ? 0 : 2) + v.level - (ageCounter - v.age) * 1e-6;
    let pick = voices[0];
    let best = score(pick);
    for (const v of voices) {
      const s = score(v);
      if (s < best) {
        pick = v;
        best = s;
      }
    }
    return pick;
  };

  const noteHz = (note: number, ch: Channel) => 440 * Math.pow(2, (note - 69 + ch.bend) / 12);

  const noteOn = (chN: number, note: number, vel: number) => {
    const ch = chans[chN];
    const v = freeVoice();
    v.on = true;
    v.ch = chN;
    v.note = note;
    v.age = ++ageCounter;
    v.held = false;
    v.vel = Math.pow(vel / 127, 1.5);
    v.lpY = 0;
    v.vibPh = 0;
    v.level = 0;
    v.stage = 0;
    v.buf = null;
    v.drum = null;
    if (chN === 9) {
      const d = drumFor(note);
      if (!d) {
        v.on = false;
        return;
      }
      v.drum = drumSample(d[0]);
      v.dpos = 0;
      v.dinc = d[2];
      v.vel *= d[1];
      v.kind = Kind.Table;
      v.patch = DRUM_PATCH;
      v.level = 1;
      v.stage = 1;
      return;
    }
    // the same note re-struck on the channel: release the old one quickly
    for (const o of voices)
      if (o !== v && o.on && o.ch === chN && o.note === note && o.stage !== 2) {
        o.stage = 2;
        o.rMul = Math.exp(-1 / (0.03 * sr));
      }
    const p = patchOf(ch.prog);
    v.patch = p;
    v.kind = p.kind;
    const hz = noteHz(note, ch);
    v.baseHz = 440 * Math.pow(2, (note - 69) / 12);
    const oct = (note - 60) / 12;
    const dSec = Math.max(0.05, p.d * Math.pow(2, -oct * p.keyTrack * 2));
    v.aStep = 1 / Math.max(1, p.a * sr);
    v.dMul = Math.exp(-1 / (dSec * sr));
    v.rMul = Math.exp(-1 / (Math.max(0.01, p.r) * sr));
    v.sus = p.s;
    if (p.kind === Kind.Pluck) {
      const period = sr / hz - 0.5;
      const n = Math.max(2, Math.floor(period));
      const frac = period - n;
      v.bLen = n;
      v.buf = new Float32Array(n + 1);
      // excitation: noise, low-passed more for soft notes
      const rnd = noiseGen(note * 131 + ageCounter);
      let lp = 0;
      const k = 0.25 + 0.7 * v.vel;
      for (let i = 0; i < n; i++) {
        lp += k * (rnd() - lp);
        v.buf[i] = lp;
      }
      v.bi = 0;
      // longer ring for low notes, decay control from the patch
      v.damp = Math.min(0.9995, (p.damp || 0.995) + (60 - note) * 0.00004);
      v.apC = (1 - frac) / (1 + frac);
      v.apX = 0;
      v.apY = 0;
      v.level = 1;
      v.stage = 1;
      v.sus = 0;
      v.dMul = Math.exp(-1 / (Math.max(0.2, p.d * Math.pow(2, -oct)) * sr));
    } else {
      const maxH = Math.max(1, Math.floor((nyq * 0.92) / hz));
      let h = 1;
      while (h * 2 <= maxH && h < 64) h *= 2;
      v.tbl = table(p.shape, h);
      v.ph = 0;
      v.inc = (hz * TABLE) / sr;
      if (p.kind === Kind.FM) {
        v.mph = 0;
        v.minc = v.inc * (p.fmRatio || 1);
        v.fmIdx = (p.fmIndex || 1) * (0.5 + v.vel) * TABLE * 0.159;
        if (v.minc * 2 > TABLE * 0.45) v.fmIdx *= 0.3; // high notes: tame aliasing
      }
    }
  };

  const noteOff = (chN: number, note: number) => {
    const ch = chans[chN];
    for (const v of voices) {
      if (!v.on || v.ch !== chN || v.note !== note || v.stage === 2) continue;
      if (chN === 9) continue; // drums ring out
      if (ch.sustain) v.held = true;
      else v.stage = 2;
    }
  };

  const allOff = (chN: number, hard: boolean) => {
    for (const v of voices)
      if (v.on && v.ch === chN) {
        if (hard) v.on = false;
        else v.stage = 2;
      }
  };

  const control = (chN: number, cc: number, val: number) => {
    const ch = chans[chN];
    switch (cc) {
      case 1:
        ch.mod = val / 127;
        break;
      case 7:
        ch.vol = val / 127;
        break;
      case 10:
        ch.pan = val / 127;
        break;
      case 11:
        ch.expr = val / 127;
        break;
      case 64: {
        const down = val >= 64;
        if (ch.sustain && !down)
          for (const v of voices)
            if (v.on && v.ch === chN && v.held) ((v.held = false), (v.stage = 2));
        ch.sustain = down;
        break;
      }
      case 91:
        ch.rev = val / 127;
        break;
      case 101:
        ch.rpn = (ch.rpn & 0x7f) | (val << 7);
        break;
      case 100:
        ch.rpn = (ch.rpn & ~0x7f) | val;
        break;
      case 6:
        if (ch.rpn === 0) ch.bendRange = Math.min(24, Math.max(0, val));
        break;
      case 120:
        allOff(chN, true);
        break;
      case 121:
        ch.mod = 0;
        ch.expr = 1;
        ch.bend = 0;
        ch.sustain = false;
        break;
      case 123:
        allOff(chN, false);
        break;
    }
  };

  const retune = (chN: number) => {
    const ch = chans[chN];
    for (const v of voices) {
      if (!v.on || v.ch !== chN || v.kind === Kind.Pluck || v.drum) continue;
      const hz = v.baseHz * Math.pow(2, ch.bend / 12);
      v.inc = (hz * TABLE) / sr;
      if (v.kind === Kind.FM) v.minc = v.inc * (v.patch.fmRatio || 1);
    }
  };

  // light stereo reverb: 4 combs + 2 allpasses per side (Freeverb-ish, sized for 22 kHz)
  const scale = sr / 44100;
  const mk = (n: number) => new Float32Array(Math.max(8, Math.round(n * scale)));
  const [c0, c1, c2, c3] = [1116, 1188, 1277, 1356].map(mk);
  const apL = [556, 441].map(mk);
  const apR = [579, 464].map(mk);
  let i0 = 0;
  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  let lp0 = 0;
  let lp1 = 0;
  let lp2 = 0;
  let lp3 = 0;
  const apIdx = new Int32Array(4);
  let revTail = 0; // samples left before the reverb is silent and can be skipped
  const fb = 0.8;
  const damp = 0.3;
  const undamp = 1 - damp;
  const revIn = new Float32Array(SEG);
  const mixL = new Float32Array(SEG);
  const mixR = new Float32Array(SEG);
  const live = new Uint8Array(16).fill(1);

  let limiter = 1;
  const masterGain = 0.32;

  const events = midi.events;
  let ei = 0;
  let pos = 0;
  let sliceStart = Date.now();
  const sliceMs = opts.sliceMs ?? 24;
  let lastProgress = 0;

  while (pos < frames) {
    if (opts.signal?.cancelled) throw new Error('cancelled');
    // apply events due now
    while (ei < events.length && Math.round(events[ei].t * sr) <= pos) {
      const e = events[ei++];
      if (e.kind === Ev.On) noteOn(e.ch, e.a, e.b);
      else if (e.kind === Ev.Off) noteOff(e.ch, e.a);
      else if (e.kind === Ev.CC) control(e.ch, e.a, e.b);
      else if (e.kind === Ev.Prog) chans[e.ch].prog = e.a;
      else if (e.kind === Ev.Bend) {
        chans[e.ch].bend = ((e.a - 8192) / 8192) * chans[e.ch].bendRange;
        retune(e.ch);
      }
    }
    const nextEvt = ei < events.length ? Math.round(events[ei].t * sr) : frames;
    const n = Math.max(1, Math.min(SEG, nextEvt - pos, frames - pos));

    for (let c = 0; c < 16; c++) {
      if (live[c]) chans[c].buf.fill(0, 0, n);
      live[c] = 0;
    }

    for (let vi = 0; vi < voices.length; vi++) {
      const v = voices[vi];
      if (!v.on) continue;
      const ch = chans[v.ch];
      const buf = ch.buf;
      const g = v.vel * v.patch.gain;
      live[v.ch] = 1;

      if (v.drum) {
        const d = v.drum;
        let p = v.dpos;
        const inc = v.dinc;
        const dl = d.length - 1;
        for (let i = 0; i < n; i++) {
          if (p >= dl) {
            v.on = false;
            break;
          }
          buf[i] += d[p | 0] * g;
          p += inc;
        }
        v.dpos = p;
        continue;
      }

      // envelope at the segment end, linear ramp across the segment
      const l0 = v.level;
      let l1 = l0;
      if (v.stage === 0) {
        l1 = l0 + v.aStep * n;
        if (l1 >= 1) {
          l1 = 1;
          v.stage = 1;
        }
      } else if (v.stage === 1) {
        l1 = v.sus + (l0 - v.sus) * Math.pow(v.dMul, n);
      } else {
        l1 = l0 * Math.pow(v.rMul, n);
      }
      v.level = l1;
      if ((v.stage === 2 || v.sus === 0) && l1 < 0.0004 && v.stage !== 0) {
        v.on = false;
        continue;
      }
      const dl = (l1 - l0) / n;
      let lvl = l0 * g;
      const dlg = dl * g;

      if (v.kind === Kind.Pluck) {
        const b = v.buf!;
        const len = v.bLen;
        let bi = v.bi;
        const dmp = v.damp * 0.5;
        const C = v.apC;
        let ax = v.apX;
        let ay = v.apY;
        for (let i = 0; i < n; i++) {
          const cur = b[bi];
          const nx = bi + 1 < len ? bi + 1 : 0;
          const avg = (cur + b[nx]) * dmp;
          // fractional-delay allpass keeps the pitch in tune
          const y = C * avg + ax - C * ay;
          ax = avg;
          ay = y;
          b[bi] = y;
          bi = nx;
          buf[i] += cur * lvl * 1.6;
          lvl += dlg;
        }
        v.bi = bi;
        v.apX = ax;
        v.apY = ay;
        continue;
      }

      // vibrato (patch + mod wheel), updated per segment
      let inc = v.inc;
      const vib = (v.patch.vib || 0) + ch.mod * 0.012;
      if (vib > 0) {
        v.vibPh += (5.6 * n) / sr;
        const ramp = Math.min(1, v.vibPh / 2);
        inc *= 1 + vib * ramp * Math.sin(2 * Math.PI * v.vibPh);
      }

      // one-pole low-pass that opens with the envelope (brightness follows loudness)
      const p = v.patch;
      const fc = Math.min(nyq * 0.95, v.baseHz * (p.lp + p.lpEnv * l1) * (0.6 + 0.6 * v.vel));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      let y = v.lpY;
      let ph = v.ph;
      const t = v.tbl;

      if (v.kind === Kind.FM) {
        let mph = v.mph;
        const minc = v.minc * (inc / v.inc);
        const idx = v.fmIdx;
        for (let i = 0; i < n; i++) {
          const m = sine[(mph | 0) & TMASK] * idx * (0.3 + 0.7 * (lvl / (g || 1)));
          const s = sine[((ph + m) | 0) & TMASK];
          y += a * (s - y);
          buf[i] += y * lvl;
          ph += inc;
          mph += minc;
          lvl += dlg;
        }
        v.mph = mph % TABLE;
      } else {
        for (let i = 0; i < n; i++) {
          y += a * (t[(ph | 0) & TMASK] - y);
          buf[i] += y * lvl;
          ph += inc;
          lvl += dlg;
        }
      }
      v.ph = ph % TABLE;
      v.lpY = y;
    }

    // channel mix → stereo, plus the reverb send
    mixL.fill(0, 0, n);
    mixR.fill(0, 0, n);
    revIn.fill(0, 0, n);
    for (let c = 0; c < 16; c++) {
      if (!live[c]) continue;
      const ch = chans[c];
      const gain = ch.vol * ch.vol * ch.expr; // CC7 is roughly a squared-amplitude control
      if (gain <= 0) continue;
      const pa = ch.pan * Math.PI * 0.5;
      const gl = Math.cos(pa) * gain * 1.41;
      const gr = Math.sin(pa) * gain * 1.41;
      const send = ch.rev * 0.5 * gain;
      const b = ch.buf;
      for (let i = 0; i < n; i++) {
        const s = b[i];
        mixL[i] += s * gl;
        mixR[i] += s * gr;
        revIn[i] += s * send;
      }
    }

    let anyRev = false;
    for (let i = 0; i < n; i++) if (revIn[i] !== 0) anyRev = true;
    if (anyRev) revTail = Math.round(sr * 4);
    const doRev = revTail > 0;
    if (doRev) revTail -= n;
    for (let i = 0; i < n; i++) {
      let L = mixL[i];
      let R = mixR[i];
      if (doRev) {
        // mono comb bank, then a different allpass chain per side for width
        const x = revIn[i] * 0.2;
        let o = c0[i0];
        lp0 = o * undamp + lp0 * damp;
        c0[i0] = x + lp0 * fb;
        if (++i0 >= c0.length) i0 = 0;
        let sum = o;
        o = c1[i1];
        lp1 = o * undamp + lp1 * damp;
        c1[i1] = x + lp1 * fb;
        if (++i1 >= c1.length) i1 = 0;
        sum += o;
        o = c2[i2];
        lp2 = o * undamp + lp2 * damp;
        c2[i2] = x + lp2 * fb;
        if (++i2 >= c2.length) i2 = 0;
        sum += o;
        o = c3[i3];
        lp3 = o * undamp + lp3 * damp;
        c3[i3] = x + lp3 * fb;
        if (++i3 >= c3.length) i3 = 0;
        sum += o;
        let rl = sum;
        let rr = sum;
        for (let k = 0; k < 2; k++) {
          const al = apL[k];
          let ix = apIdx[k];
          const bo = al[ix];
          al[ix] = rl + bo * 0.5;
          rl = bo - rl;
          apIdx[k] = ++ix >= al.length ? 0 : ix;
          const ar = apR[k];
          ix = apIdx[k + 2];
          const bo2 = ar[ix];
          ar[ix] = rr + bo2 * 0.5;
          rr = bo2 - rr;
          apIdx[k + 2] = ++ix >= ar.length ? 0 : ix;
        }
        L += rl * 1.4;
        R += rr * 1.4;
      }
      L *= masterGain;
      R *= masterGain;
      // peak limiter: instant attack, ~0.3 s release
      const pk =
        (L < 0
          ? R < 0
            ? Math.max(-L, -R)
            : Math.max(-L, R)
          : R < 0
            ? Math.max(L, -R)
            : Math.max(L, R)) * limiter;
      if (pk > 0.92) limiter *= 0.92 / pk;
      else if (limiter < 1) limiter = Math.min(1, limiter + 0.00015);
      L *= limiter;
      R *= limiter;
      const o2 = (pos + i) * 2;
      pcm[o2] = L >= 1 ? 32767 : L <= -1 ? -32768 : (L * 32767) | 0;
      pcm[o2 + 1] = R >= 1 ? 32767 : R <= -1 ? -32768 : (R * 32767) | 0;
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

const DRUM_PATCH: Patch = P(Kind.Table, 'sine', 0, 1, 1, 1);

export function writeWavHeader(out: Uint8Array, sr: number, frames: number) {
  const dv = new DataView(out.buffer, out.byteOffset, 44);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  const dataSize = frames * 4;
  w(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, dataSize, true);
}

/** GM program family names for diagnostics */
export const GM_FAMILIES = [
  'Piano',
  'Chromatic perc.',
  'Organ',
  'Guitar',
  'Bass',
  'Strings',
  'Ensemble',
  'Brass',
  'Reed',
  'Pipe',
  'Synth lead',
  'Synth pad',
  'Synth FX',
  'Ethnic',
  'Percussive',
  'Sound FX',
];
