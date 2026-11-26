// Stream File Cache — makes Monochrome's lossless FLAC playable on iOS.
//
// tracks.monochrome.st serves FLAC as `application/octet-stream` from an extension-less URL
// (`/track/<id>`, verified by scripts/probe-sources.mjs). Chrome sniffs the bytes and plays it, but
// AVPlayer decides the container from the MIME type / file extension and refuses it. So on iOS the
// FLAC is downloaded once into Paths.cache as `<id>.flac` and played from disk — every later play
// of that song starts instantly from the cache.

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const DIR_NAME = 'holysic-stream-cache';
const MAX_FILES = 40;
const MAX_BYTES = 900 * 1024 * 1024;

const inflight = new Map<string, Promise<string>>();

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileFor(key: string, ext: string): File {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return new File(cacheDir(), `${safe}.${ext}`);
}

/** Removes the oldest cached streams beyond MAX_FILES / MAX_BYTES */
function evict() {
  try {
    const files = cacheDir()
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => ({ f, t: f.modificationTime || 0, s: f.size || 0 }))
      .sort((a, b) => b.t - a.t);
    let total = 0;
    files.forEach((entry, idx) => {
      total += entry.s;
      if (idx >= MAX_FILES || total > MAX_BYTES) {
        try {
          entry.f.delete();
        } catch {
          // ignore
        }
      }
    });
  } catch {
    // ignore
  }
}

export const StreamFileCache = {
  /** True when the URL must be turned into a local file before AVPlayer can open it */
  needsLocalFile(codec: string, url: string): boolean {
    return (
      Platform.OS !== 'web' &&
      /flac/i.test(codec) &&
      /^https?:/i.test(url) &&
      !/\.flac(\?|$)/i.test(url)
    );
  },

  /** Already-downloaded local URI for this key, if any */
  cachedUri(key: string, ext = 'flac'): string | null {
    if (Platform.OS === 'web') return null;
    try {
      const f = fileFor(key, ext);
      return f.exists && (f.size || 0) > 1024 ? f.uri : null;
    } catch {
      return null;
    }
  },

  isLocalUriAlive(uri?: string): boolean {
    if (!uri || Platform.OS === 'web') return false;
    try {
      const f = new File(uri);
      return f.exists && (f.size || 0) > 1024;
    } catch {
      return false;
    }
  },

  /**
   * Downloads `url` to the cache (deduplicated per key). Resolves with the local URI, or rejects
   * after `timeoutMs` — the download itself keeps going in the background so the next play is instant.
   */
  ensureLocal(
    key: string,
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    ext = 'flac'
  ): Promise<string> {
    const cached = this.cachedUri(key, ext);
    if (cached) return Promise.resolve(cached);

    let job = inflight.get(key);
    if (!job) {
      const target = fileFor(key, ext);
      job = File.downloadFileAsync(url, target, {
        idempotent: true,
        ...(headers ? { headers } : {}),
      })
        .then((f) => {
          evict();
          return f.uri;
        })
        .catch((e) => {
          try {
            if (target.exists) target.delete();
          } catch {
            // ignore
          }
          throw e;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, job);
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('download-timeout')), timeoutMs);
      job!.then(
        (uri) => {
          clearTimeout(timer);
          resolve(uri);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  },

  clear() {
    if (Platform.OS === 'web') return;
    try {
      const dir = new Directory(Paths.cache, DIR_NAME);
      if (dir.exists) dir.delete();
    } catch {
      // ignore
    }
  },
};
