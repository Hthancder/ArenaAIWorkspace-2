// Lyrics the user owns: choices that stick and copies kept for offline listening.
//
//   override  the user picked other lyrics, wrote / pasted their own, or said "no lyrics"
//   saved     an offline copy (kept automatically for downloaded / on-device songs, or on request)
//
// Order when a song plays: override → built-in → the file's own .lrc / tags → saved → online.
// Entries are keyed by track id, with a fingerprint (title · artist · length) as a fallback so a
// choice survives when a download is moved to "On this iPhone" and its id changes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { BUILTIN_LYRICS_MAP } from '../../data/curatedCatalog';
import { LyricsData, Track } from '../../types/music';
import { isLocalTrack, LocalLibrary } from '../local/localLibrary';
import { lyricsFromText } from './lyricsService';
import { fetchOnlineLyrics, LyricsSourceId, queryOf } from './lyricsSources';

const INDEX_KEY = '@holysic/lyrics_index_v1';
const DATA_KEY = (id: string) => `@holysic/lyrics_v1/${id}`;

export type StoredKind = 'override' | 'saved' | 'none';

export interface StoredLyricsInfo {
  kind: StoredKind;
  provider: LyricsData['provider'];
  /** the provider the lyrics came from when the user picked a candidate */
  from?: string;
  synced: boolean;
  lines: number;
  fp: string;
  savedAt: number;
}

let index: Record<string, StoredLyricsInfo> = {};
let loaded: Promise<void> | null = null;
let version = 0;
const subs = new Set<() => void>();
const memory = new Map<string, LyricsData>();

const emit = () => {
  version++;
  subs.forEach((f) => f());
};

function ensure(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(INDEX_KEY)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') index = parsed;
      })
      .catch(() => {})
      .then(() => emit());
  }
  return loaded;
}

const persistIndex = () => AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => {});

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '');

export const fingerprint = (t: Track) =>
  `${norm(t.title)}|${norm(t.artist || '')}|${Math.round((t.durationSec || 0) / 4)}`;

function keyFor(t: Track): string | null {
  if (index[t.id]) return t.id;
  const fp = fingerprint(t);
  for (const id in index) if (index[id].fp === fp) return id;
  return null;
}

/** re-renders when stored lyrics change */
export function useStoredLyrics(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      ensure();
      return () => subs.delete(f);
    },
    () => version,
    () => version
  );
}

export function storedLyricsInfo(t: Track | null | undefined): StoredLyricsInfo | null {
  if (!t) return null;
  const k = keyFor(t);
  return k ? index[k] : null;
}

export const storedLyricsCount = () => {
  let saved = 0;
  let overrides = 0;
  for (const id in index) {
    if (index[id].kind === 'saved') saved++;
    else overrides++;
  }
  return { saved, overrides };
};

async function readData(id: string): Promise<LyricsData | null> {
  try {
    const raw = await AsyncStorage.getItem(DATA_KEY(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as LyricsData;
    return Array.isArray(d?.lines) ? d : null;
  } catch {
    return null;
  }
}

async function write(t: Track, kind: StoredKind, data: LyricsData | null, from?: string) {
  await ensure();
  const old = keyFor(t);
  if (old && old !== t.id) {
    delete index[old];
    AsyncStorage.removeItem(DATA_KEY(old)).catch(() => {});
  }
  const lines = data?.lines.length ?? 0;
  index[t.id] = {
    kind,
    provider: data?.provider ?? 'None',
    from,
    synced: !!data?.synced,
    lines,
    fp: fingerprint(t),
    savedAt: Date.now(),
  };
  if (data && lines) {
    const slim: LyricsData = { ...data, trackId: t.id, origin: undefined };
    await AsyncStorage.setItem(DATA_KEY(t.id), JSON.stringify(slim)).catch(() => {});
  } else {
    await AsyncStorage.removeItem(DATA_KEY(t.id)).catch(() => {});
  }
  memory.delete(t.id);
  await persistIndex();
  emit();
}

/** the user's lyrics for this song from now on (a picked candidate or their own text) */
export function setLyricsOverride(t: Track, data: LyricsData, from?: string) {
  return write(t, 'override', { ...data, provider: data.provider }, from);
}

/** "this song has no lyrics" (instrumentals, wrong matches you just want gone) */
export function markNoLyrics(t: Track) {
  return write(t, 'none', null);
}

/** forget the user's choice / offline copy → automatic lyrics again */
export async function clearStoredLyrics(t: Track) {
  await ensure();
  const k = keyFor(t);
  if (!k) return;
  delete index[k];
  memory.delete(t.id);
  await AsyncStorage.removeItem(DATA_KEY(k)).catch(() => {});
  await persistIndex();
  emit();
}

/** drop offline copies (not the user's own choices) */
export async function clearSavedLyrics(ids?: string[]) {
  await ensure();
  const drop = Object.keys(index).filter(
    (id) => index[id].kind === 'saved' && (!ids || ids.includes(id))
  );
  if (!drop.length) return 0;
  drop.forEach((id) => {
    delete index[id];
    memory.delete(id);
  });
  await AsyncStorage.multiRemove(drop.map(DATA_KEY)).catch(() => {});
  await persistIndex();
  emit();
  return drop.length;
}

/** keep an offline copy unless the user already chose something for this song */
export async function saveLyricsOffline(t: Track, data: LyricsData) {
  await ensure();
  const k = keyFor(t);
  if (k && index[k].kind !== 'saved') return;
  if (!data.lines.length || data.provider === 'Built-in' || data.provider === 'Local') return;
  await write(t, 'saved', data);
}

const NONE = (id: string, origin?: LyricsData['origin']): LyricsData => ({
  trackId: id,
  provider: 'None',
  synced: false,
  wordSynced: false,
  lines: [],
  origin,
});

/** the song's own lyrics: built-in catalogue, or the .lrc / tags of an on-device file */
export async function ownLyrics(t: Track): Promise<LyricsData | null> {
  if (BUILTIN_LYRICS_MAP[t.id]) {
    return {
      trackId: t.id,
      provider: 'Built-in',
      synced: true,
      wordSynced: true,
      lines: BUILTIN_LYRICS_MAP[t.id],
    };
  }
  if (isLocalTrack(t)) {
    const own = await LocalLibrary.lyricsFor(t).catch(() => null);
    const d = own ? lyricsFromText(own.text, t.durationSec) : null;
    if (d) return { ...d, trackId: t.id };
  }
  return null;
}

export interface LoadOptions {
  /** skip the in-memory cache and ask the sources again (still honours overrides) */
  refresh?: boolean;
  /** keep what the sources return as an offline copy */
  keepOffline?: boolean;
  sources?: Partial<Record<LyricsSourceId, boolean>>;
}

/** Lyrics for a song, honouring the user's choices and offline copies. Never throws. */
export async function loadLyrics(t: Track, opts: LoadOptions = {}): Promise<LyricsData> {
  await ensure();
  const k = keyFor(t);
  const info = k ? index[k] : null;

  if (info?.kind === 'none') return NONE(t.id, 'override');
  if (info?.kind === 'override' && k) {
    const d = await readData(k);
    if (d) return { ...d, trackId: t.id, origin: 'override' };
  }

  const own = await ownLyrics(t);
  if (own) return own;

  if (info?.kind === 'saved' && k && !opts.refresh) {
    const d = await readData(k);
    if (d) return { ...d, trackId: t.id, origin: 'saved' };
  }

  if (!opts.refresh) {
    const m = memory.get(t.id);
    if (m) {
      if (opts.keepOffline && m.lines.length && !info) saveLyricsOffline(t, m);
      return m;
    }
  }

  const online = await fetchOnlineLyrics(queryOf(t), opts.sources).catch(() => null);
  if (online && online.lines.length) {
    const d = { ...online, trackId: t.id };
    memory.set(t.id, d);
    if (opts.keepOffline) {
      saveLyricsOffline(t, d);
      return { ...d, origin: 'saved' };
    }
    return d;
  }
  // offline with an old copy that a refresh could not replace
  if (info?.kind === 'saved' && k) {
    const d = await readData(k);
    if (d) return { ...d, trackId: t.id, origin: 'saved' };
  }
  return NONE(t.id);
}

/**
 * Download lyrics for many songs (offline listening). Songs that already have lyrics of their
 * own, a user choice or an offline copy are skipped. Resolves with how many were saved.
 */
export async function downloadLyricsFor(
  tracks: Track[],
  opts: {
    sources?: Partial<Record<LyricsSourceId, boolean>>;
    onProgress?: (done: number, total: number, saved: number) => void;
    isCancelled?: () => boolean;
  } = {}
): Promise<{ saved: number; skipped: number; missing: number }> {
  await ensure();
  const todo = tracks.filter((t) => !t.isLive && !keyFor(t) && !BUILTIN_LYRICS_MAP[t.id]);
  let saved = 0;
  let missing = 0;
  let done = 0;
  const skipped = tracks.length - todo.length;
  opts.onProgress?.(0, todo.length, 0);
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !opts.isCancelled?.()) {
      const t = queue.shift()!;
      try {
        if (await ownLyrics(t)) {
          // the file carries its own lyrics: nothing to download
        } else {
          const d = await fetchOnlineLyrics(queryOf(t), opts.sources);
          if (d && d.lines.length) {
            await write(t, 'saved', { ...d, trackId: t.id });
            memory.set(t.id, { ...d, trackId: t.id });
            saved++;
          } else missing++;
        }
      } catch {
        missing++;
      }
      done++;
      opts.onProgress?.(done, todo.length, saved);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { saved, skipped, missing };
}

/** export as LRC text (for the editor) */
export function lyricsToLrc(d: LyricsData): string {
  const ts = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  };
  if (!d.synced) return d.lines.map((l) => l.text).join('\n');
  return d.lines.map((l) => `[${ts(Math.max(0, l.startSec))}]${l.text}`).join('\n');
}

// ── background "download lyrics for my offline songs" (survives closing the screen) ──

export interface LyricsJob {
  running: boolean;
  done: number;
  total: number;
  saved: number;
  missing: number;
  skipped: number;
  finishedAt?: number;
}

let job: LyricsJob = { running: false, done: 0, total: 0, saved: 0, missing: 0, skipped: 0 };
let jobCancel = false;
const jobSubs = new Set<() => void>();
const setJob = (j: LyricsJob) => {
  job = j;
  jobSubs.forEach((f) => f());
};

export function useLyricsJob(): LyricsJob {
  return useSyncExternalStore(
    (f) => {
      jobSubs.add(f);
      return () => jobSubs.delete(f);
    },
    () => job,
    () => job
  );
}

export function cancelLyricsJob() {
  jobCancel = true;
}

export async function startLyricsJob(
  tracks: Track[],
  sources?: Partial<Record<LyricsSourceId, boolean>>
): Promise<LyricsJob> {
  if (job.running) return job;
  jobCancel = false;
  setJob({ running: true, done: 0, total: 0, saved: 0, missing: 0, skipped: 0 });
  const r = await downloadLyricsFor(tracks, {
    sources,
    isCancelled: () => jobCancel,
    onProgress: (done, total, saved) => setJob({ ...job, done, total, saved }),
  }).catch(() => ({ saved: job.saved, skipped: 0, missing: 0 }));
  setJob({ ...job, running: false, ...r, finishedAt: Date.now() });
  return job;
}
