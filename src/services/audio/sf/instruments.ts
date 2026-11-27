// MIDI instruments on demand.
//
// The sample bank (GeneralUser GS) is not part of the app: it is split into an index and sample
// packs (scripts/soundbank/split_bank.py). A song downloads only the instruments it plays, once —
// they stay on the device and every later song reuses them. Settings › Phát nhạc › Nhạc cụ MIDI
// lets the user pre-download or delete instruments, Settings › Dung lượng shows what they take.
//
// Storage: native — Documents/.holysic-instruments/<version>/ (hidden from the music scanner,
// not purged by iOS like Caches); web — Cache Storage. An instrument ("preset") is ready when the
// index and every pack holding its samples are present (packs are shared between instruments).

import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Ev, ParsedMidi } from '../midiSynth';
import { packSources } from './bankHost';
import { INSTRUMENT_MANIFEST as M } from './instrumentManifest';
import { assembleBank, SoundBank } from './soundBank';

const isWeb = Platform.OS === 'web';
export const INDEX_FILE = 'index.hsi';
const DIR = '.holysic-instruments';
const CACHE_NAME = `holysic-instruments-${M.version}`;
const PARALLEL = 3;

export type GmFamily = { vi: string; en: string; icon: string };
/** GM program families (program >> 3) + drum kits */
export const FAMILIES: GmFamily[] = [
  { vi: 'Piano', en: 'Piano', icon: 'musical-notes' },
  { vi: 'Gõ có cao độ', en: 'Chromatic percussion', icon: 'notifications' },
  { vi: 'Organ', en: 'Organ', icon: 'grid' },
  { vi: 'Guitar', en: 'Guitar', icon: 'musical-note' },
  { vi: 'Bass', en: 'Bass', icon: 'pulse' },
  { vi: 'Dây (solo)', en: 'Strings', icon: 'git-commit' },
  { vi: 'Hoà tấu & hợp xướng', en: 'Ensemble & choir', icon: 'people' },
  { vi: 'Kèn đồng', en: 'Brass', icon: 'megaphone' },
  { vi: 'Kèn lưỡi gà', en: 'Reed', icon: 'mic' },
  { vi: 'Sáo', en: 'Pipe', icon: 'leaf' },
  { vi: 'Synth lead', en: 'Synth lead', icon: 'flash' },
  { vi: 'Synth pad', en: 'Synth pad', icon: 'cloudy' },
  { vi: 'Hiệu ứng synth', en: 'Synth effects', icon: 'sparkles' },
  { vi: 'Dân tộc', en: 'Ethnic', icon: 'globe' },
  { vi: 'Bộ gõ', en: 'Percussive', icon: 'radio-button-on' },
  { vi: 'Hiệu ứng âm thanh', en: 'Sound effects', icon: 'volume-high' },
];
export const DRUM_FAMILY: GmFamily = { vi: 'Bộ trống', en: 'Drum kits', icon: 'disc' };

export interface Instrument {
  /** preset index in the bank */
  i: number;
  bank: number;
  program: number;
  name: string;
  packs: string[];
  /** 0–15 GM family, 16 = drum kit */
  family: number;
  /** a GS variation (bank 1–127) of a GM sound */
  variation: boolean;
  /** bank 120: duplicate drum kits for melodic channels — not listed, downloaded when used */
  hidden: boolean;
}

export const INSTRUMENTS: Instrument[] = M.presets.map(([bank, program, name, packs], i) => ({
  i,
  bank,
  program,
  name,
  packs,
  family: bank === 128 || bank === 120 ? 16 : program >> 3,
  variation: bank !== 0 && bank !== 128,
  hidden: bank === 120,
}));

/** bank * 128 + program → preset index (first match, like the renderers) */
const byKey = new Map<number, number>();
INSTRUMENTS.forEach((p) => {
  const k = p.bank * 128 + p.program;
  if (!byKey.has(k)) byKey.set(k, p.i);
});

export const packFile = (id: string) => `${id}.hsp`;
const fileBytes = (f: string) =>
  f === INDEX_FILE ? M.indexBytes : M.packs[f.replace(/\.hsp$/, '')] || 0;
export const TOTAL_BYTES = M.indexBytes + Object.values(M.packs).reduce((a, b) => a + b, 0);
const packOrder = (a: string, b: string) => {
  const [a1, a2] = a.split('-').map(Number);
  const [b1, b2] = b.split('-').map(Number);
  return a1 - b1 || a2 - b2;
};

// ------------------------------------------------------------------------------- state

let have = new Set<string>();
let scanned = false;
let scanning: Promise<void> | null = null;
const jobs = new Map<string, Promise<boolean>>();
let downloading = { files: 0, done: 0, bytes: 0, doneBytes: 0 };
let version = 0;
let auto = true;
const subs = new Set<() => void>();
const bump = () => {
  version++;
  subs.forEach((f) => f());
};

function nativeDir(): Directory {
  const d = new Directory(Paths.document, DIR, M.version);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function scanNow(): Promise<void> {
  if (scanned) return Promise.resolve();
  if (scanning) return scanning;
  scanning = (async () => {
    const next = new Set<string>();
    try {
      if (isWeb) {
        if (typeof caches !== 'undefined') {
          const c = await caches.open(CACHE_NAME);
          for (const req of await c.keys()) {
            const name = decodeURIComponent(new URL(req.url).pathname.split('/').pop() || '');
            if (name) next.add(name);
          }
        }
      } else {
        for (const it of nativeDir().list()) {
          if (it instanceof File && (it.size || 0) === fileBytes(it.name)) next.add(it.name);
        }
      }
    } catch {
      // nothing downloaded yet / storage unavailable
    }
    have = next;
    scanned = true;
    scanning = null;
    bump();
  })();
  return scanning;
}

// native: the folder listing is synchronous and cheap — know the state at once
if (!isWeb) {
  try {
    scanNow();
  } catch {
    // ignore
  }
}

async function fetchOne(file: string): Promise<boolean> {
  const want = fileBytes(file);
  for (const base of packSources(M.version, isWeb)) {
    try {
      if (isWeb) {
        const res = await fetch(base + file);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== want) continue;
        const c = await caches.open(CACHE_NAME);
        await c.put(
          new Request(`/__holysic_instruments__/${M.version}/${file}`),
          new Response(buf, {
            headers: { 'content-type': 'application/octet-stream', 'content-length': `${want}` },
          })
        );
        return true;
      }
      const dst = new File(nativeDir(), file);
      if (dst.exists) dst.delete();
      const got = await File.downloadFileAsync(base + file, dst, { idempotent: true });
      if ((got.size || 0) === want) return true;
      try {
        got.delete();
      } catch {
        // ignore
      }
    } catch {
      // next mirror
    }
  }
  return false;
}

function download(file: string): Promise<boolean> {
  let job = jobs.get(file);
  if (job) return job;
  job = fetchOne(file).then((ok) => {
    jobs.delete(file);
    if (ok) have.add(file);
    downloading.done++;
    downloading.doneBytes += fileBytes(file);
    if (jobs.size === 0) downloading = { files: 0, done: 0, bytes: 0, doneBytes: 0 };
    bump();
    return ok;
  });
  jobs.set(file, job);
  downloading.files++;
  downloading.bytes += fileBytes(file);
  bump();
  return job;
}

// ------------------------------------------------------------------------------- public

export interface InstrumentSnapshot {
  version: number;
  ready: boolean;
  /** downloads running now (0 when idle) */
  files: number;
  done: number;
  bytes: number;
  doneBytes: number;
}

let snap: InstrumentSnapshot | null = null;
function snapshot(): InstrumentSnapshot {
  if (!snap || snap.version !== version) snap = { version, ready: scanned, ...downloading };
  return snap;
}

export const Instruments = {
  configure(o: { auto?: boolean }) {
    if (o.auto !== undefined) auto = o.auto;
  },
  get autoDownload() {
    return auto;
  },

  /** make sure the download state is known (web reads Cache Storage asynchronously) */
  ready: scanNow,

  subscribe(f: () => void) {
    subs.add(f);
    scanNow();
    return () => {
      subs.delete(f);
    };
  },

  has: (file: string) => have.has(file),
  isDownloading: (file: string) => jobs.has(file),

  /** every file an instrument needs, index first */
  filesFor(presets: number[]): string[] {
    const packs = new Set<string>();
    for (const i of presets) for (const p of INSTRUMENTS[i]?.packs || []) packs.add(p);
    return [INDEX_FILE, ...[...packs].sort(packOrder).map(packFile)];
  },

  readyFor(presets: number[]): boolean {
    return Instruments.filesFor(presets).every((f) => have.has(f));
  },

  /** bytes still to download for these files */
  missingBytes(files: string[]): number {
    return files.reduce((n, f) => n + (have.has(f) ? 0 : fileBytes(f)), 0);
  },

  /** bytes on the device (index + packs) */
  storedBytes(): number {
    let n = 0;
    have.forEach((f) => (n += fileBytes(f)));
    return n;
  },

  /** download what's missing; true when everything is there afterwards */
  async ensure(files: string[]): Promise<boolean> {
    await scanNow();
    const missing = files.filter((f) => !have.has(f));
    if (!missing.length) return true;
    let ok = true;
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const f = missing[next++];
        if (!(await download(f))) ok = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, missing.length) }, worker));
    return ok && files.every((f) => have.has(f));
  },

  /**
   * Other downloaded instruments that share samples with these — deleting these makes them
   * download again when used (the UI names them before deleting).
   */
  sharedWith(presets: number[]): Instrument[] {
    const drop = new Set(presets);
    const files = new Set(Instruments.filesFor(presets).slice(1));
    return INSTRUMENTS.filter(
      (p) =>
        !drop.has(p.i) &&
        !p.hidden &&
        Instruments.readyFor([p.i]) &&
        p.packs.some((id) => files.has(packFile(id)))
    );
  },

  /**
   * Delete instruments: every sample pack they use goes (instruments sharing one need it again
   * later — see sharedWith). The index goes with the last pack. Returns the bytes freed.
   */
  async remove(presets: number[]): Promise<number> {
    await scanNow();
    const files = Instruments.filesFor(presets).filter((f) => f !== INDEX_FILE && have.has(f));
    let freed = 0;
    for (const f of files) {
      if (await deleteFile(f)) freed += fileBytes(f);
    }
    // nothing playable left: the index can go too
    const anyPack = [...have].some((f) => f !== INDEX_FILE);
    if (!anyPack && have.has(INDEX_FILE) && (await deleteFile(INDEX_FILE)))
      freed += fileBytes(INDEX_FILE);
    webBank = null;
    bump();
    return freed;
  },

  async removeAll(): Promise<number> {
    await scanNow();
    const freed = Instruments.storedBytes();
    try {
      if (isWeb) await caches.delete(CACHE_NAME);
      else {
        const d = new Directory(Paths.document, DIR);
        if (d.exists) d.delete();
      }
    } catch {
      // ignore
    }
    have = new Set();
    webBank = null;
    bump();
    return freed;
  },

  /** native: file:// URIs to hand to the C renderer */
  uriOf(file: string): string {
    return new File(nativeDir(), file).uri;
  },

  /** web: the bank assembled from the downloaded files (memoised per file set) */
  async webBankFor(files: string[]): Promise<SoundBank | null> {
    const key = files.join('|');
    if (webBank?.key === key) return webBank.bank;
    try {
      const c = await caches.open(CACHE_NAME);
      const bufs: ArrayBuffer[] = [];
      for (const f of files) {
        const res = await c.match(`/__holysic_instruments__/${M.version}/${f}`);
        if (!res) return null;
        bufs.push(await res.arrayBuffer());
      }
      const bank = assembleBank(bufs[0], bufs.slice(1));
      webBank = { key, bank, bytes: bufs.reduce((n, b) => n + b.byteLength, 0) };
      return bank;
    } catch {
      return null;
    }
  },

  /** web: bytes of the assembled bank held in memory */
  webMemoryBytes: () => webBank?.bytes || 0,
  dropWebMemory() {
    webBank = null;
  },

  /** the preset each note of the song plays (mirrors presetFor in sampleSynth.ts / HSSampleSynth.m) */
  presetsOf(midi: ParsedMidi, piano: { bank: number; program: number } | null): number[] {
    const prog = new Array<number>(16).fill(0);
    const bank = new Array<number>(16).fill(0);
    const used = new Set<number>();
    for (const e of midi.events) {
      if (e.kind === Ev.Prog) prog[e.ch] = e.a;
      else if (e.kind === Ev.CC && e.a === 0) bank[e.ch] = e.b;
      else if (e.kind === Ev.On && e.b > 0) {
        let idx: number | undefined;
        if (e.ch === 9) {
          idx = byKey.get(128 * 128 + prog[9]);
          if (idx === undefined) idx = byKey.get(128 * 128);
        } else {
          let b = bank[e.ch];
          let p = prog[e.ch];
          if (piano && b === 0 && p === 0) {
            b = piano.bank;
            p = piano.program;
          }
          idx = byKey.get(b * 128 + p);
          if (idx === undefined) idx = byKey.get(prog[e.ch]);
        }
        used.add(idx === undefined ? 0 : idx);
      }
    }
    return [...used].sort((a, b) => a - b);
  },

  presetOf(bank: number, program: number): number | undefined {
    return byKey.get(bank * 128 + program);
  },
};

let webBank: { key: string; bank: SoundBank; bytes: number } | null = null;

async function deleteFile(f: string): Promise<boolean> {
  try {
    if (isWeb) {
      const c = await caches.open(CACHE_NAME);
      await c.delete(`/__holysic_instruments__/${M.version}/${f}`);
    } else {
      const file = new File(nativeDir(), f);
      if (file.exists) file.delete();
    }
    have.delete(f);
    return true;
  } catch {
    return false;
  }
}

/** live download state for the settings UI */
export function useInstruments(): InstrumentSnapshot {
  return useSyncExternalStore(Instruments.subscribe, snapshot, snapshot);
}
