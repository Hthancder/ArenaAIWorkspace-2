// Source Memory — remembers which source actually played each track (and how each module is doing
// overall) so the next play goes straight to a source that works instead of waiting on every module.
//
// Inspired by Mochy Music's per-module "resting" logic (YTPlayerUtils.kt / MonochromeModule.kt keep
// failed servers & clients aside for a while and remember matches), persisted with AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MusicSourceId, ResolvedStream, Track } from '../../types/music';
import { ModuleId } from '../../constants/preferences';

export type { ModuleId };

const STORAGE_KEY = '@holysic/source_memory_v1';
const MAX_TRACKS = 400;
/** A module that failed this many times in a row is tried last for a while */
const FAIL_STREAK_DEMOTE = 2;
const DEMOTE_MS = 20 * 60 * 1000;

export interface RememberedStream {
  module: MusicSourceId;
  sourceLabel: string;
  qualityLabel: string;
  codec: string;
  /** Direct URL that played (only reused while it is still valid) */
  url?: string;
  headers?: Record<string, string>;
  /** epoch ms after which `url` must not be reused (YouTube links expire after ~6 h) */
  expiresAt?: number;
  /** Local cached file (e.g. Monochrome FLAC downloaded for AVPlayer) */
  localUri?: string;
  cacheKey?: string;
  sampleRateHz?: number;
  at: number;
}

interface ModuleStats {
  ok: number;
  fail: number;
  failStreak: number;
  lastOkAt?: number;
  lastFailAt?: number;
  /** exponential moving average of time-to-audio, ms */
  avgStartMs?: number;
}

interface MemoryShape {
  tracks: Record<string, RememberedStream>;
  modules: Partial<Record<string, ModuleStats>>;
}

let memory: MemoryShape = { tracks: {}, modules: {} };
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const keys = Object.keys(memory.tracks);
    if (keys.length > MAX_TRACKS) {
      keys
        .sort((a, b) => memory.tracks[a].at - memory.tracks[b].at)
        .slice(0, keys.length - MAX_TRACKS)
        .forEach((k) => delete memory.tracks[k]);
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memory)).catch(() => {});
  }, 400);
}

function norm(s: string | undefined): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same song from different catalogs (search result vs. chart item) maps to one key */
export function trackMemoryKey(track: Pick<Track, 'title' | 'artist' | 'artists'>): string {
  const artist = track.artists?.[0] || track.artist;
  return `${norm(track.title)}|${norm(artist)}`;
}

/** googlevideo links (also through Invidious) carry `expire=<epoch seconds>`; SoundCloud /
 *  Bandcamp / Zing MP3 stream links are short-lived signed tokens, so they are never reused (the
 *  module asks again, which is quick) */
function expiryFromUrl(url: string): number | undefined {
  const m = url.match(/[?&]expire=(\d{9,11})/);
  if (m) return Number(m[1]) * 1000;
  if (
    /sndcdn\.com|soundcloud\.cloud|bcbits\.com|bandcamp\.com\/stream_redirect|zmdcdn\.me/.test(url)
  )
    return Date.now();
  return undefined;
}

export const SourceMemory = {
  load(): Promise<void> {
    if (!loaded) {
      loaded = AsyncStorage.getItem(STORAGE_KEY)
        .then((raw) => {
          if (!raw) return;
          const parsed = JSON.parse(raw);
          memory = {
            tracks: parsed?.tracks && typeof parsed.tracks === 'object' ? parsed.tracks : {},
            modules: parsed?.modules && typeof parsed.modules === 'object' ? parsed.modules : {},
          };
        })
        .catch(() => {});
    }
    return loaded;
  },

  get(track: Track): RememberedStream | undefined {
    return memory.tracks[track.id] || memory.tracks[trackMemoryKey(track)];
  },

  /** A remembered URL that can be played immediately without asking any module again */
  reusableUrl(track: Track): RememberedStream | undefined {
    const r = this.get(track);
    if (!r?.url) return undefined;
    if (r.expiresAt && r.expiresAt - Date.now() < 10 * 60 * 1000) return undefined;
    return r;
  },

  rememberSuccess(track: Track, stream: ResolvedStream, startMs: number, localUri?: string) {
    if (stream.isPreview || stream.source === 'synth' || stream.source === 'offline') return;
    const entry: RememberedStream = {
      module: stream.source,
      sourceLabel: stream.sourceLabel,
      qualityLabel: stream.qualityLabel,
      codec: stream.codec,
      url: stream.url.startsWith('http') ? stream.url : undefined,
      headers: stream.headers,
      expiresAt: stream.url.startsWith('http') ? expiryFromUrl(stream.url) : undefined,
      localUri: localUri || (stream.url.startsWith('file:') ? stream.url : undefined),
      cacheKey: stream.cacheKey,
      sampleRateHz: stream.sampleRateHz,
      at: Date.now(),
    };
    memory.tracks[track.id] = entry;
    memory.tracks[trackMemoryKey(track)] = entry;

    const st: ModuleStats = memory.modules[stream.source] || { ok: 0, fail: 0, failStreak: 0 };
    st.ok += 1;
    st.failStreak = 0;
    st.lastOkAt = Date.now();
    st.avgStartMs = st.avgStartMs ? Math.round(st.avgStartMs * 0.7 + startMs * 0.3) : startMs;
    memory.modules[stream.source] = st;
    scheduleSave();
  },

  rememberFailure(track: Track, stream: Pick<ResolvedStream, 'source' | 'url' | 'isPreview'>) {
    if (stream.isPreview || stream.source === 'synth' || stream.source === 'offline') return;
    const st: ModuleStats = memory.modules[stream.source] || { ok: 0, fail: 0, failStreak: 0 };
    st.fail += 1;
    st.failStreak += 1;
    st.lastFailAt = Date.now();
    memory.modules[stream.source] = st;

    // Forget a remembered URL / file that no longer plays
    for (const key of [track.id, trackMemoryKey(track)]) {
      const r = memory.tracks[key];
      if (r && (r.url === stream.url || r.localUri === stream.url)) delete memory.tracks[key];
    }
    scheduleSave();
  },

  /**
   * Adaptive module order: the module that played this exact track before goes first, modules
   * on a recent failure streak go last, the rest keep the user's priority order.
   */
  rankModules(order: ModuleId[], track: Track): ModuleId[] {
    const remembered = this.get(track)?.module;
    const now = Date.now();
    const demoted = (m: ModuleId) => {
      const st = memory.modules[m];
      return (
        !!st &&
        st.failStreak >= FAIL_STREAK_DEMOTE &&
        !!st.lastFailAt &&
        now - st.lastFailAt < DEMOTE_MS
      );
    };
    const score = (m: ModuleId, idx: number) =>
      (m === remembered ? -1000 : 0) + (demoted(m) ? 1000 : 0) + idx;
    return order
      .map((m, idx) => ({ m, s: score(m, idx) }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.m);
  },

  stats(): { tracks: number; modules: Partial<Record<string, ModuleStats>> } {
    const unique = new Set(Object.values(memory.tracks));
    return { tracks: unique.size, modules: memory.modules };
  },

  clear() {
    memory = { tracks: {}, modules: {} };
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
};
