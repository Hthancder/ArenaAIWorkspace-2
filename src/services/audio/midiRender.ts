// MIDI playback — turns a .mid / .kar / .rmi into a cached WAV that the normal audio engine plays.
//
// The sound: by default a real sample bank (GeneralUser GS — multi-sampled pianos, strings,
// guitars, brass, 13 drum kits; see sf/), or the small procedural synth ("Nhẹ") as a choice and a
// fallback. iOS: the file is parsed in JS (tempo map, karaoke lyrics) and rendered by the native C
// renderers in HolySicDSP. The web preview, and builds without them, use the identical TypeScript
// renderers, which yield to the UI while they work. Results live in Caches/holysic-midi keyed by
// path + size + date + sound settings, so every later play starts instantly.

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { HolySicDSP } from '../../../modules/holysic-dsp';
import { GM_FAMILIES, parseMidi, ParsedMidi, renderMidiToWav } from './midiSynth';
import { loadSoundBank } from './sf/bankLoader';
import { renderMidiSampled } from './sf/sampleSynth';

export type MidiSound = 'sampled' | 'synth';

/** Piano voices offered for GM program 0 — bank:program in the sample bank */
export const MIDI_PIANOS: { id: string; vi: string; en: string }[] = [
  { id: '0:0', vi: 'Grand Piano', en: 'Grand Piano' },
  { id: '0:1', vi: 'Grand sáng (Bright)', en: 'Bright Grand' },
  { id: '0:2', vi: 'Grand điện (CP-80)', en: 'Electric Grand' },
  { id: '0:3', vi: 'Honky-Tonk', en: 'Honky-Tonk' },
  { id: '11:1', vi: 'Piano + dàn dây', en: 'Piano & Strings' },
  { id: '12:0', vi: 'Piano chuông', en: 'Bell Piano' },
  { id: '0:4', vi: 'Rhodes (Tine EP)', en: 'Tine Electric Piano' },
  { id: '8:4', vi: 'Rhodes chorus', en: 'Chorused Tine EP' },
  { id: '0:5', vi: 'FM EP (DX7)', en: 'FM Electric Piano' },
  { id: '11:5', vi: 'Piano + FM EP', en: 'Piano & FM EP' },
  { id: '0:6', vi: 'Harpsichord', en: 'Harpsichord' },
  { id: '0:7', vi: 'Clavinet', en: 'Clavinet' },
];

let sound: MidiSound = 'sampled';
let piano = '0:0';

function pianoArgs(): [number, number] {
  const [b, p] = piano.split(':').map((x) => parseInt(x, 10));
  return piano === '0:0' || !(b >= 0) || !(p >= 0) ? [-1, -1] : [b, p];
}

const DIR = 'holysic-midi';
const VERSION = 'v1'; // procedural synth
const BANK_VERSION = 'b1'; // sample bank
const SAMPLE_RATE = 22050;
const KEEP = 24;

export interface MidiRenderInfo {
  uri: string;
  durationSec: number;
  notes: number;
  /** "Piano, Strings, Drums" */
  instruments: string;
  lyrics?: string;
  title?: string;
  engine: 'native' | 'js' | 'cache';
  /** rendered with the sample bank (GeneralUser GS) */
  bank: boolean;
  ms: number;
}

const inflight = new Map<string, Promise<MidiRenderInfo>>();
const webCache = new Map<string, MidiRenderInfo>();
/** web: blob sizes of the renders held in memory */
const webBytes = new Map<string, number>();

function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function instrumentsOf(m: ParsedMidi): string {
  const fams = [...new Set(m.programs.map((p) => GM_FAMILIES[p >> 3]))];
  const drums = m.events.some((e) => e.kind === 1 && e.ch === 9);
  if (drums) fams.push('Drums');
  return fams.slice(0, 5).join(', ');
}

function cacheDir(): Directory {
  const d = new Directory(Paths.cache, DIR);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function prune(keep: string) {
  try {
    const files = cacheDir()
      .list()
      .filter((e): e is File => e instanceof File && e.name !== keep)
      .sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
    for (const f of files.slice(KEEP - 1)) f.delete();
  } catch {
    // best effort
  }
}

function flatten(m: ParsedMidi): number[] {
  const out = new Array<number>(m.events.length * 5);
  let k = 0;
  for (const e of m.events) {
    out[k++] = e.t;
    out[k++] = e.kind;
    out[k++] = e.ch;
    out[k++] = e.a;
    out[k++] = e.b;
  }
  return out;
}

async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web' || !/^file:/i.test(uri)) {
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer());
  }
  return await new File(uri).bytes();
}

function nativeBank(): boolean {
  try {
    return !!HolySicDSP?.renderMidiBank && !!HolySicDSP.soundBankAvailable?.();
  } catch {
    return false;
  }
}

function settingsKey(): string {
  return sound === 'sampled' ? `${BANK_VERSION}-${piano.replace(':', '.')}` : VERSION;
}

async function render(uri: string, onProgress?: (f: number) => void): Promise<MidiRenderInfo> {
  const t0 = Date.now();
  const native = Platform.OS !== 'web' && /^file:/i.test(uri);
  const wantBank = sound === 'sampled';
  let dst: File | null = null;
  let srcKey = '';
  if (native) {
    const src = new File(uri);
    srcKey = hashOf(`${uri}|${src.size || 0}|${src.modificationTime || 0}`);
    // the bank result when the bank can be used here, else the synth's
    const key = `${srcKey}-${wantBank && nativeBank() ? settingsKey() : VERSION}`;
    dst = new File(cacheDir(), `${key}.wav`);
    if (dst.exists && (dst.size || 0) > 44) {
      // parse again for the lyrics / facts (cheap: milliseconds)
      const m = parseMidi(await readBytes(uri));
      return {
        uri: dst.uri,
        durationSec: m.durationSec,
        notes: m.notes,
        instruments: instrumentsOf(m),
        lyrics: m.lyrics,
        title: m.title,
        engine: 'cache',
        bank: !key.endsWith(VERSION),
        ms: Date.now() - t0,
      };
    }
  }
  const midi = parseMidi(await readBytes(uri));
  if (!midi.notes) throw new Error('MIDI has no notes');
  const base = {
    durationSec: midi.durationSec,
    notes: midi.notes,
    instruments: instrumentsOf(midi),
    lyrics: midi.lyrics,
    title: midi.title,
  };

  if (dst && HolySicDSP) {
    const events = flatten(midi);
    if (wantBank && nativeBank()) {
      try {
        const [pb, pp] = pianoArgs();
        const ok = await HolySicDSP.renderMidiBank!(
          events,
          midi.durationSec,
          SAMPLE_RATE,
          dst.uri,
          pb,
          pp
        );
        if (ok && dst.exists && (dst.size || 0) > 44) {
          prune(dst.name);
          return { ...base, uri: dst.uri, engine: 'native', bank: true, ms: Date.now() - t0 };
        }
      } catch {
        // fall through to the synth
      }
      dst = new File(cacheDir(), `${srcKey}-${VERSION}.wav`);
    }
    if (HolySicDSP.renderMidi) {
      try {
        const ok = await HolySicDSP.renderMidi(events, midi.durationSec, SAMPLE_RATE, dst.uri);
        if (ok && dst.exists && (dst.size || 0) > 44) {
          prune(dst.name);
          return { ...base, uri: dst.uri, engine: 'native', bank: false, ms: Date.now() - t0 };
        }
      } catch {
        // fall back to the JS synth
      }
    }
  }

  // TypeScript renderers: the sample bank where it can be loaded (web), else the synth
  const bank = wantBank && !native ? await loadSoundBank() : null;
  const [pb, pp] = pianoArgs();
  const wav = bank
    ? await renderMidiSampled(midi, bank, {
        sampleRate: SAMPLE_RATE,
        onProgress,
        piano: pb >= 0 ? { bank: pb, program: pp } : null,
      })
    : await renderMidiToWav(midi, { sampleRate: SAMPLE_RATE, onProgress });
  if (dst) {
    if (dst.exists) dst.delete();
    dst.create();
    dst.write(wav);
    prune(dst.name);
    return { ...base, uri: dst.uri, engine: 'js', bank: !!bank, ms: Date.now() - t0 };
  }
  const blobUrl = URL.createObjectURL(
    new Blob([wav as unknown as BlobPart], { type: 'audio/wav' })
  );
  webBytes.set(blobUrl, wav.length);
  return { ...base, uri: blobUrl, engine: 'js', bank: !!bank, ms: Date.now() - t0 };
}

export const MidiRender = {
  /** Playable WAV for a MIDI file (rendered once, then cached) */
  wavFor(uri: string, onProgress?: (f: number) => void): Promise<MidiRenderInfo> {
    const k = `${settingsKey()}|${uri}`;
    const memo = webCache.get(k);
    if (memo) return Promise.resolve({ ...memo, engine: 'cache', ms: 0 });
    let p = inflight.get(k);
    if (!p) {
      p = render(uri, onProgress)
        .then((info) => {
          if (Platform.OS === 'web') webCache.set(k, info);
          return info;
        })
        .finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    return p;
  },

  /** Sound settings (Settings › Phát nhạc › MIDI); later renders use them, old ones stay cached */
  configure(o: { sound?: MidiSound; piano?: string }) {
    if (o.sound) sound = o.sound;
    if (o.piano) piano = o.piano;
  },

  /** true when the real-instrument sound can be used on this device / build */
  bankSupported(): boolean {
    return Platform.OS === 'web' || nativeBank();
  },

  /** Warm the cache in the background (after an import) — never throws */
  prewarm(uris: string[]) {
    let chain = Promise.resolve();
    for (const u of uris)
      chain = chain.then(() =>
        MidiRender.wavFor(u).then(
          () => undefined,
          () => undefined
        )
      );
  },

  /** true when the bytes say MIDI (SMF or RIFF RMID) */
  isMidiHead(b: Uint8Array): boolean {
    const s = (o: number, t: string) => [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
    return s(0, 'MThd') || (s(0, 'RIFF') && s(8, 'RMID'));
  },

  /** web: bytes of the renders this session keeps in memory */
  webBytes(): number {
    let n = 0;
    webBytes.forEach((b) => (n += b));
    return n;
  },

  clear() {
    webCache.forEach((i) => {
      if (i.uri.startsWith('blob:')) URL.revokeObjectURL(i.uri);
    });
    webCache.clear();
    webBytes.clear();
    if (Platform.OS === 'web') return;
    try {
      const d = new Directory(Paths.cache, DIR);
      if (d.exists) d.delete();
    } catch {
      // ignore
    }
  },
};
