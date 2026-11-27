// MIDI playback — turns a .mid / .kar / .rmi into a cached WAV that the normal audio engine plays.
//
// iOS: the file is parsed in JS (tempo map, karaoke lyrics) and rendered by the native C synth in
// HolySicDSP (a 4-minute song in well under a second). Builds without it, and the web preview,
// use the identical TypeScript synth, which yields to the UI while it works. Results live in
// Caches/holysic-midi keyed by path + size + date, so every later play starts instantly.

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { HolySicDSP } from '../../../modules/holysic-dsp';
import { GM_FAMILIES, parseMidi, ParsedMidi, renderMidiToWav } from './midiSynth';

const DIR = 'holysic-midi';
const VERSION = 'v1';
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
  ms: number;
}

const inflight = new Map<string, Promise<MidiRenderInfo>>();
const webCache = new Map<string, MidiRenderInfo>();

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

async function render(uri: string, onProgress?: (f: number) => void): Promise<MidiRenderInfo> {
  const t0 = Date.now();
  const native = Platform.OS !== 'web' && /^file:/i.test(uri);
  let dst: File | null = null;
  if (native) {
    const src = new File(uri);
    const key = `${hashOf(`${uri}|${src.size || 0}|${src.modificationTime || 0}`)}-${VERSION}`;
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

  if (dst && HolySicDSP?.renderMidi) {
    try {
      const ok = await HolySicDSP.renderMidi(flatten(midi), midi.durationSec, SAMPLE_RATE, dst.uri);
      if (ok && dst.exists && (dst.size || 0) > 44) {
        prune(dst.name);
        return { ...base, uri: dst.uri, engine: 'native', ms: Date.now() - t0 };
      }
    } catch {
      // fall back to the JS synth
    }
  }

  const wav = await renderMidiToWav(midi, { sampleRate: SAMPLE_RATE, onProgress });
  if (dst) {
    if (dst.exists) dst.delete();
    dst.create();
    dst.write(wav);
    prune(dst.name);
    return { ...base, uri: dst.uri, engine: 'js', ms: Date.now() - t0 };
  }
  const blobUrl = URL.createObjectURL(
    new Blob([wav as unknown as BlobPart], { type: 'audio/wav' })
  );
  return { ...base, uri: blobUrl, engine: 'js', ms: Date.now() - t0 };
}

export const MidiRender = {
  /** Playable WAV for a MIDI file (rendered once, then cached) */
  wavFor(uri: string, onProgress?: (f: number) => void): Promise<MidiRenderInfo> {
    const memo = webCache.get(uri);
    if (memo) return Promise.resolve({ ...memo, engine: 'cache', ms: 0 });
    let p = inflight.get(uri);
    if (!p) {
      p = render(uri, onProgress)
        .then((info) => {
          if (Platform.OS === 'web') webCache.set(uri, info);
          return info;
        })
        .finally(() => inflight.delete(uri));
      inflight.set(uri, p);
    }
    return p;
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

  clear() {
    webCache.forEach((i) => {
      if (i.uri.startsWith('blob:')) URL.revokeObjectURL(i.uri);
    });
    webCache.clear();
    if (Platform.OS === 'web') return;
    try {
      const d = new Directory(Paths.cache, DIR);
      if (d.exists) d.delete();
    } catch {
      // ignore
    }
  },
};
