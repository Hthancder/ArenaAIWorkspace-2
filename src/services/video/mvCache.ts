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
import { rebaseDocumentUri } from '../library/libraryTools';
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
      let f: File | null = await File.downloadFileAsync(stream.url, dest, {
        idempotent: true,
        ...(stream.headers ? { headers: stream.headers } : {}),
      }).catch(() => null);
      // YouTube serves big adaptive files in ranges: a one-shot request can be refused or cut
      // short — then fetch it in 8 MB pieces and join them
      const want = stream.bytes || 0;
      const short = !f || (f.size || 0) < 50_000 || (want > 0 && (f.size || 0) < want * 0.98);
      if (short && want > 0 && /googlevideo\.com/.test(stream.url))
        f = await rangedDownload(stream.url, stream.headers, want, dest).catch(() => null);
      if (!f) return 'failed';
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

/** download `url` in byte ranges (YouTube's `range=` parameter) and append them into `dest` */
async function rangedDownload(
  url: string,
  headers: Record<string, string> | undefined,
  total: number,
  dest: File
): Promise<File | null> {
  const CHUNK = 8 * 1024 * 1024;
  const part = new File(Paths.cache, `mv-part-${Date.now().toString(36)}`);
  try {
    if (dest.exists) dest.delete();
    dest.create();
    const out = dest.open();
    try {
      for (let at = 0; at < total; at += CHUNK) {
        const end = Math.min(total, at + CHUNK) - 1;
        const sep = url.includes('?') ? '&' : '?';
        const got = await File.downloadFileAsync(`${url}${sep}range=${at}-${end}`, part, {
          idempotent: true,
          ...(headers ? { headers } : {}),
        });
        const bytes = await got.bytes();
        if (bytes.length !== end - at + 1) throw new Error('short range');
        out.writeBytes(bytes);
      }
    } finally {
      out.close();
    }
    return dest;
  } catch {
    try {
      if (dest.exists) dest.delete();
    } catch {
      // ignore
    }
    return null;
  } finally {
    try {
      if (part.exists) part.delete();
    } catch {
      // ignore
    }
  }
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
                // iOS moves the app's container on every IPA update: re-point the file
                const file = rebaseDocumentUri(m.file);
                if (file !== m.file) index[id] = { ...m, file };
                if (!new File(file).exists) delete index[id];
              } catch {
                delete index[id];
              }
          if (!isWeb && raw && Object.keys(raw).length) persist();
          // …and files no entry points at (a save cut short by the app closing)
          if (!isWeb && !running)
            try {
              const dir = new Directory(Paths.document, MV_DIR);
              if (dir.exists) {
                // by file name: the same file can show up as /var/… or /private/var/…
                const nameOf = (u: string) => decodeURIComponent(u.split('/').pop() || '');
                const keep = new Set(Object.values(index).map((m) => nameOf(m.file)));
                for (const e of dir.list())
                  if (e instanceof File && !keep.has(nameOf(e.uri))) e.delete();
              }
            } catch {
              // ignore
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
