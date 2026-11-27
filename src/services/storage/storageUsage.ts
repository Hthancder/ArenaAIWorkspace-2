// Settings › Storage: what HolySic keeps on the device, measured by folder, and the caches that can
// be cleared safely (everything under Caches is re-creatable: FLAC/MIDI renders are made again on
// the next play, cover thumbnails are re-read from the files on the next library scan).
//
// Native: expo-file-system folder sizes + the disk's total / free space. Web: the browser's own
// storage estimate plus what this session holds in memory (MIDI renders, the sample bank).

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { MidiRender } from '../audio/midiRender';
import { STREAM_CACHE_DIR } from '../audio/streamFileCache';
import { soundBankBytes, unloadSoundBank } from '../audio/sf/bankLoader';

export type StorageCat =
  'app' | 'music' | 'offline' | 'flac' | 'copies' | 'midi' | 'art' | 'temp' | 'personal' | 'web';

export interface StorageReport {
  /** bytes per category (missing = not measurable here) */
  bytes: Partial<Record<StorageCat, number>>;
  /** HolySic's total (app + data + caches) */
  total: number;
  /** what the "clear caches" button frees */
  clearable: number;
  device?: { total: number; free: number };
  measuredAt: number;
}

/** Caches folders the app owns (relative to Paths.cache) */
const MIDI_DIR = 'holysic-midi';
const ART_DIR = 'holysic-art';
const COPIES = `${STREAM_CACHE_DIR}/play-copies`;
/** Documents folders that are app data, not the user's music */
const OFFLINE_DIR = 'holysic-offline';
const PERSONAL_DIRS = ['.holysic-backdrops', '.holysic-covers'];

export const CLEARABLE: StorageCat[] = ['flac', 'copies', 'midi', 'art', 'temp'];

let last: StorageReport | null = null;

function dirSize(d: Directory): number {
  try {
    return d.exists ? d.size || 0 : 0;
  } catch {
    return 0;
  }
}

function measureNative(): StorageReport {
  const cache = Paths.cache;
  const doc = Paths.document;
  const cacheAll = dirSize(cache);
  const copies = dirSize(new Directory(cache, COPIES));
  const flac = Math.max(0, dirSize(new Directory(cache, STREAM_CACHE_DIR)) - copies);
  const midi = dirSize(new Directory(cache, MIDI_DIR));
  const art = dirSize(new Directory(cache, ART_DIR));
  const temp = Math.max(0, cacheAll - copies - flac - midi - art);
  const docAll = dirSize(doc);
  const offline = dirSize(new Directory(doc, OFFLINE_DIR));
  const personal = PERSONAL_DIRS.reduce((n, d) => n + dirSize(new Directory(doc, d)), 0);
  const music = Math.max(0, docAll - offline - personal);
  const app = dirSize(Paths.bundle);
  const bytes = { app, music, offline, flac, copies, midi, art, temp, personal };
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
    clearable: flac + copies + midi + art + temp,
    device,
    measuredAt: Date.now(),
  };
}

async function measureWeb(): Promise<StorageReport> {
  const midi = MidiRender.webBytes();
  const bank = soundBankBytes();
  let web = 0;
  let device: StorageReport['device'];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      web = est.usage || 0;
      if (est.quota) device = { total: est.quota, free: Math.max(0, est.quota - web) };
    }
  } catch {
    // not available
  }
  return {
    bytes: { midi, temp: bank, web },
    total: midi + bank + web,
    clearable: midi + bank,
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
  /** last measurement (for the Settings row) — null until the page was opened once */
  get last(): StorageReport | null {
    return last;
  },

  async measure(): Promise<StorageReport> {
    // let the page paint first: folder walks are synchronous on the JS thread
    await new Promise((r) => setTimeout(r, 30));
    last = Platform.OS === 'web' ? await measureWeb() : measureNative();
    return last;
  },

  /** Clear one cache category (only the CLEARABLE ones) */
  clear(cat: StorageCat) {
    if (Platform.OS === 'web') {
      if (cat === 'midi') MidiRender.clear();
      if (cat === 'temp') unloadSoundBank();
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
    }
  },

  clearAll() {
    for (const c of CLEARABLE) StorageUsage.clear(c);
  },
};

export function formatBytes(n: number, vi: boolean): string {
  if (!n || n < 0) return vi ? '0 KB' : '0 KB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  const s = v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${vi ? s.replace('.', ',') : s} ${u[i]}`;
}
