// Saved music videos: kept on the device so the picture plays offline (and starts at once).
//
//  • saved on request (the MV button's menu in the player) or together with a download
//    (the "Tải kèm MV" choice) — one at a time, in the order asked
//  • native: Documents/.holysic-mv/<videoId>.mp4 (H.264, the quality chosen in Settings ›
//    Music video, never HLS) · web: Cache Storage, when the video host allows it (CORS)
//  • the player uses a saved copy when offline, or when it is at least the quality asked for
//  • Settings › Storage lists them (size, delete one by one)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Track } from '../../types/music';
import { findMusicVideo, resolveVideoStream } from './videoService';

export interface SavedMv {
  videoId: string;
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  bytes: number;
  height: number;
  label: string;
  savedAt: number;
  /** native: file URI · web: Cache Storage key */
  file: string;
}

export type MvSaveResult = 'saved' | 'exists' | 'none' | 'failed' | 'hls';

const KEY = '@holysic/mv_saved_v1';
export const MV_DIR = '.holysic-mv';
const WEB_CACHE = 'holysic-mv-v1';
const isWeb = Platform.OS === 'web';

let index: Record<string, SavedMv> = {};
let loaded: Promise<void> | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
const persist = () => AsyncStorage.setItem(KEY, JSON.stringify(index)).catch(() => {});

// one save at a time: videos are big, and the music keeps streaming meanwhile
type Job = { track: Track; quality: number; resolve: (r: MvSaveResult) => void };
const queue: Job[] = [];
let active: string | null = null;
let running = false;

// web: object URLs made for saved videos this session (revoked when deleted)
const webUrls = new Map<string, string>();

function safeName(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function saveOne(track: Track, quality: number): Promise<MvSaveResult> {
  const videoId = await findMusicVideo(track).catch(() => null);
  if (!videoId) return 'none';
  if (index[videoId] && (await exists(index[videoId]))) {
    // same video, another song (or the same one): link it instead of a second copy
    if (index[videoId].trackId !== track.id) {
      index[videoId] = { ...index[videoId], trackId: track.id };
      persist();
      emit();
    }
    return 'exists';
  }
  const stream = await resolveVideoStream(videoId, quality).catch(() => null);
  if (!stream) return 'failed';
  if (stream.isHls) return 'hls';
  const base: Omit<SavedMv, 'bytes' | 'file'> = {
    videoId,
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl || '',
    height: stream.height,
    label: stream.label.replace(/ · YouTube.*$/, ''),
    savedAt: Date.now(),
  };
  try {
    if (!isWeb) {
      const dir = new Directory(Paths.document, MV_DIR);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const dest = new File(dir, `${safeName(videoId)}.mp4`);
      const f = await File.downloadFileAsync(stream.url, dest, {
        idempotent: true,
        ...(stream.headers ? { headers: stream.headers } : {}),
      });
      const bytes = f.size || 0;
      // a tiny file is an error page, not a video
      if (bytes < 50_000) {
        try {
          f.delete();
        } catch {
          // ignore
        }
        return 'failed';
      }
      index[videoId] = { ...base, bytes, file: f.uri };
    } else {
      if (typeof window === 'undefined' || !('caches' in window)) return 'failed';
      const res = await fetch(stream.url);
      if (!res.ok) return 'failed';
      const blob = await res.blob();
      if (blob.size < 50_000) return 'failed';
      const cache = await window.caches.open(WEB_CACHE);
      const key = `/__holysic_mv__/${safeName(videoId)}`;
      await cache.put(
        key,
        new Response(blob, { headers: { 'Content-Type': blob.type || 'video/mp4' } })
      );
      index[videoId] = { ...base, bytes: blob.size, file: key };
    }
  } catch {
    return 'failed';
  }
  persist();
  emit();
  return 'saved';
}

async function exists(s: SavedMv): Promise<boolean> {
  if (!isWeb) {
    try {
      return new File(s.file).exists;
    } catch {
      return false;
    }
  }
  try {
    const cache = await window.caches.open(WEB_CACHE);
    return !!(await cache.match(s.file));
  } catch {
    return false;
  }
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    active = job.track.id;
    emit();
    const r = await saveOne(job.track, job.quality).catch(() => 'failed' as MvSaveResult);
    job.resolve(r);
  }
  active = null;
  running = false;
  emit();
}

export const MvCache = {
  ready(): Promise<void> {
    if (!loaded)
      loaded = AsyncStorage.getItem(KEY)
        .then((s) => {
          const raw = s ? JSON.parse(s) : {};
          if (raw && typeof raw === 'object') index = { ...raw, ...index };
          // native: forget entries whose file went away (deleted from Files, restored backup…)
          if (!isWeb)
            for (const [id, m] of Object.entries(index))
              try {
                if (!new File(m.file).exists) delete index[id];
              } catch {
                delete index[id];
              }
        })
        .catch(() => {})
        .finally(emit);
    return loaded;
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  version: () => version,

  list: (): SavedMv[] => Object.values(index).sort((a, b) => b.savedAt - a.savedAt),
  byVideo: (videoId: string | null | undefined): SavedMv | undefined =>
    videoId ? index[videoId] : undefined,
  byTrack: (trackId: string): SavedMv | undefined =>
    Object.values(index).find((m) => m.trackId === trackId),
  totalBytes: () => Object.values(index).reduce((n, m) => n + (m.bytes || 0), 0),
  count: () => Object.keys(index).length,

  /** being saved right now, or waiting its turn */
  isSaving: (trackId: string) => active === trackId || queue.some((j) => j.track.id === trackId),
  pending: () => queue.length + (active ? 1 : 0),

  /** save a song's music video (queued; resolves when done) */
  save(track: Track, quality: number): Promise<MvSaveResult> {
    if (track.isLive || track.source === 'radio' || track.source === 'synth')
      return Promise.resolve('none');
    const had = MvCache.byTrack(track.id);
    if (had) return Promise.resolve('exists');
    if (MvCache.isSaving(track.id)) return Promise.resolve('exists');
    return new Promise<MvSaveResult>((resolve) => {
      queue.push({ track, quality, resolve });
      emit();
      pump();
    });
  },

  /** a URI the video player can open, or null if the copy is gone */
  async playableUri(m: SavedMv): Promise<string | null> {
    if (!isWeb) return (await exists(m)) ? m.file : null;
    const memo = webUrls.get(m.videoId);
    if (memo) return memo;
    try {
      const cache = await window.caches.open(WEB_CACHE);
      const res = await cache.match(m.file);
      if (!res) return null;
      const url = URL.createObjectURL(await res.blob());
      webUrls.set(m.videoId, url);
      return url;
    } catch {
      return null;
    }
  },

  async remove(videoIds: string[]): Promise<void> {
    for (const id of videoIds) {
      const m = index[id];
      if (!m) continue;
      delete index[id];
      if (!isWeb) {
        try {
          const f = new File(m.file);
          if (f.exists) f.delete();
        } catch {
          // in use / gone
        }
      } else {
        try {
          const cache = await window.caches.open(WEB_CACHE);
          await cache.delete(m.file);
        } catch {
          // ignore
        }
        const u = webUrls.get(id);
        if (u) URL.revokeObjectURL(u);
        webUrls.delete(id);
      }
    }
    persist();
    emit();
  },
  removeForTracks(trackIds: string[]): Promise<void> {
    const ids = Object.values(index)
      .filter((m) => trackIds.includes(m.trackId))
      .map((m) => m.videoId);
    return ids.length ? MvCache.remove(ids) : Promise.resolve();
  },
};

/** re-renders when saved videos or the save queue change */
export function useMvCache(): number {
  return useSyncExternalStore(MvCache.subscribe, MvCache.version, MvCache.version);
}
