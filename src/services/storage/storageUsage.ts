// Settings › Storage: what HolySic keeps on the device, measured by folder, and what can go.
//
// Three kinds of space:
//  - caches       — always safe to clear, HolySic makes them again when needed (FLAC/MIDI
//                   renders, play copies, cover thumbnails, temp files, unfinished downloads)
//  - user content — removable, item by item: downloaded songs, MIDI instruments, music files
//  - fixed        — shown so the bar adds up, not removable here: the app itself, the user's
//                   backgrounds/covers (in use), browser data, other apps & the system
//
// Native: expo-file-system folder sizes + the disk's total / free space. Web: the browser's
// storage estimate, Cache Storage downloads and what this session holds in memory.

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { MidiRender } from '../audio/midiRender';
import { STREAM_CACHE_DIR } from '../audio/streamFileCache';
import { Instruments } from '../audio/sf/instruments';
import { LocalLibrary } from '../local/localLibrary';

export type StorageCat =
  | 'app'
  | 'offline'
  | 'instruments'
  | 'music'
  | 'personal'
  | 'flac'
  | 'midi'
  | 'copies'
  | 'art'
  | 'temp'
  | 'orphans'
  | 'web';

export interface StorageReport {
  /** bytes per category (missing = not measurable here) */
  bytes: Partial<Record<StorageCat, number>>;
  /** HolySic's total */
  total: number;
  /** what clearing every cache frees */
  clearable: number;
  /** device (native) or browser quota (web) */
  device?: { total: number; free: number };
  measuredAt: number;
}

/** caches: one tap clears them, nothing the user made is lost */
export const CACHES: StorageCat[] = ['flac', 'midi', 'copies', 'art', 'temp', 'orphans'];
/** user content: removable item by item (downloads, instruments, music files) */
export const CONTENT: StorageCat[] = ['offline', 'instruments', 'music'];

const MIDI_DIR = 'holysic-midi';
const ART_DIR = 'holysic-art';
const COPIES = `${STREAM_CACHE_DIR}/play-copies`;
const OFFLINE_DIR = 'holysic-offline';
const INSTRUMENT_DIR = '.holysic-instruments';
const PERSONAL_DIRS = ['.holysic-backdrops', '.holysic-covers'];

const isWeb = Platform.OS === 'web';
let last: StorageReport | null = null;
const subs = new Set<() => void>();

function dirSize(d: Directory): number {
  try {
    return d.exists ? d.size || 0 : 0;
  } catch {
    return 0;
  }
}

const sameFile = (a: string, b: string) => {
  const norm = (u: string) => {
    try {
      return decodeURIComponent(u.replace(/^file:\/\//, '')).replace(/\/+$/, '');
    } catch {
      return u.replace(/^file:\/\//, '');
    }
  };
  return norm(a) === norm(b);
};

/** files in Documents/holysic-offline that no download points at (failed / interrupted) */
function orphanFiles(downloadUris: string[]): File[] {
  try {
    const d = new Directory(Paths.document, OFFLINE_DIR);
    if (!d.exists) return [];
    return d
      .list()
      .filter(
        (it): it is File => it instanceof File && !downloadUris.some((u) => sameFile(u, it.uri))
      );
  } catch {
    return [];
  }
}

function measureNative(downloadUris: string[]): StorageReport {
  const cache = Paths.cache;
  const doc = Paths.document;
  const cacheAll = dirSize(cache);
  const copies = dirSize(new Directory(cache, COPIES));
  const flac = Math.max(0, dirSize(new Directory(cache, STREAM_CACHE_DIR)) - copies);
  const midi = dirSize(new Directory(cache, MIDI_DIR));
  const art = dirSize(new Directory(cache, ART_DIR));
  const temp = Math.max(0, cacheAll - copies - flac - midi - art);
  const docAll = dirSize(doc);
  const orphans = orphanFiles(downloadUris).reduce((n, f) => n + (f.size || 0), 0);
  const offline = Math.max(0, dirSize(new Directory(doc, OFFLINE_DIR)) - orphans);
  const instruments = dirSize(new Directory(doc, INSTRUMENT_DIR));
  const personal = PERSONAL_DIRS.reduce((n, d) => n + dirSize(new Directory(doc, d)), 0);
  const music = Math.max(0, docAll - offline - orphans - instruments - personal);
  const app = dirSize(Paths.bundle);
  const bytes = {
    app,
    offline,
    instruments,
    music,
    personal,
    flac,
    midi,
    copies,
    art,
    temp,
    orphans,
  };
  let device: StorageReport['device'];
  try {
    const total = Paths.totalDiskSpace;
    const free = Paths.availableDiskSpace;
    if (total > 0) device = { total, free };
  } catch {
    // unknown
  }
  return {
    bytes,
    total: app + docAll + cacheAll,
    clearable: flac + copies + midi + art + temp + orphans,
    device,
    measuredAt: Date.now(),
  };
}

async function measureWeb(downloadBytes: number): Promise<StorageReport> {
  await Instruments.ready();
  const midi = MidiRender.webBytes();
  const temp = Instruments.webMemoryBytes();
  const instruments = Instruments.storedBytes();
  const music = LocalLibrary.state.files.reduce((n, f) => n + (f.size || 0), 0);
  let usage = 0;
  let device: StorageReport['device'];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      usage = est.usage || 0;
      if (est.quota) device = { total: est.quota, free: Math.max(0, est.quota - usage) };
    }
  } catch {
    // not available
  }
  // what the browser stores beyond the parts measured on their own (settings, library, …)
  const web = Math.max(0, usage - instruments - downloadBytes - music);
  const bytes = { offline: downloadBytes, instruments, music, midi, temp, web };
  return {
    bytes,
    total: midi + temp + Math.max(usage, instruments + downloadBytes + music),
    clearable: midi + temp,
    device,
    measuredAt: Date.now(),
  };
}

function deleteQuietly(it: File | Directory) {
  try {
    if (it.exists) it.delete();
  } catch {
    // in use / already gone
  }
}

export const StorageUsage = {
  /** last measurement — null until the page was opened once */
  get last(): StorageReport | null {
    return last;
  },

  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },

  /**
   * Measure everything. `downloads`: the download records (to tell finished files from orphans
   * and, on the web, to size the Cache Storage copies).
   */
  async measure(downloads: { localUri: string; sizeBytes: number }[]): Promise<StorageReport> {
    // let the page paint first: folder walks are synchronous on the JS thread
    await new Promise((r) => setTimeout(r, 30));
    last = isWeb
      ? await measureWeb(downloads.reduce((n, d) => n + (d.sizeBytes || 0), 0))
      : measureNative(downloads.map((d) => d.localUri));
    subs.forEach((f) => f());
    return last;
  },

  /** Clear one cache category (CACHES only — user content goes item by item) */
  clear(cat: StorageCat, downloadUris: string[] = []) {
    if (isWeb) {
      if (cat === 'midi') MidiRender.clear();
      if (cat === 'temp') Instruments.dropWebMemory();
      return;
    }
    const cache = Paths.cache;
    switch (cat) {
      case 'flac': {
        const d = new Directory(cache, STREAM_CACHE_DIR);
        if (!d.exists) break;
        for (const it of d.list())
          if (!(it instanceof Directory && it.name === 'play-copies')) deleteQuietly(it);
        break;
      }
      case 'copies':
        deleteQuietly(new Directory(cache, COPIES));
        break;
      case 'midi':
        MidiRender.clear();
        break;
      case 'art':
        deleteQuietly(new Directory(cache, ART_DIR));
        LocalLibrary.scan();
        break;
      case 'temp': {
        // everything else in Caches: image cache, picker / share / widget leftovers, demo renders
        const own = new Set([STREAM_CACHE_DIR, MIDI_DIR, ART_DIR]);
        try {
          for (const it of cache.list()) if (!own.has(it.name)) deleteQuietly(it);
        } catch {
          // ignore
        }
        break;
      }
      case 'orphans':
        orphanFiles(downloadUris).forEach(deleteQuietly);
        break;
    }
  },
};

export function formatBytes(n: number, vi: boolean): string {
  if (!n || n < 0) return '0 KB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  if (i === 0) {
    v = Math.max(1, v / 1000);
    i = 1;
  }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${vi ? s.replace('.', ',') : s} ${u[i]}`;
}
