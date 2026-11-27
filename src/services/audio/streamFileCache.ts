// Stream File Cache — makes Monochrome's lossless FLAC playable on iOS.
//
// tracks.monochrome.st serves FLAC as `application/octet-stream` from an extension-less URL
// (`/track/<id>`, verified by scripts/probe-sources.mjs). Chrome sniffs the bytes and plays it, but
// AVPlayer decides the container from the MIME type / file extension and refuses it. So on iOS the
// FLAC is downloaded once into Paths.cache as `<id>.flac` and played from disk — every later play
// of that song starts instantly from the cache.

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { id3Size, SNIFF_BYTES, sniffBytes, SniffResult } from './formatSniff';

const DIR_NAME = 'holysic-stream-cache';
const MAX_FILES = 40;
const MAX_BYTES = 900 * 1024 * 1024;

const inflight = new Map<string, Promise<string>>();

export interface LocalFacts {
  exists: boolean;
  size: number;
  /** extension in the file name (lower-case, no dot) */
  ext: string;
  /** container / codec found in the bytes */
  real?: SniffResult;
}

const extOf = (uri: string) => (uri.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1] || '').toLowerCase();

function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Plain-named copies of device files live apart from the stream cache (own, small budget) */
function copyDir(): Directory {
  const dir = new Directory(Paths.cache, `${DIR_NAME}/play-copies`);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function evictCopies(dir: Directory, keep: string) {
  try {
    const files = dir
      .list()
      .filter((e): e is File => e instanceof File && e.name !== keep)
      .sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
    for (const f of files.slice(29)) f.delete();
  } catch {
    // ignore
  }
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

  /**
   * What a file on the device really is, from its first bytes — songs are often misnamed
   * (an AAC ".mp3", a FLAC with an ID3 block in front), and AVPlayer trusts the extension.
   */
  sniffLocal(uri: string): LocalFacts | null {
    if (Platform.OS === 'web' || !/^file:/i.test(uri)) return null;
    try {
      const f = new File(uri);
      if (!f.exists) return { exists: false, size: 0, ext: extOf(uri) };
      const size = f.size || 0;
      const h = f.open();
      let b: Uint8Array;
      let after: Uint8Array | undefined;
      try {
        b = h.readBytes(Math.min(SNIFF_BYTES, size));
        // a big ID3 block (embedded cover) hides what follows: peek right behind it
        const tag = id3Size(b);
        if (tag && tag + 16 > b.length && tag + 16 <= size) {
          h.offset = tag;
          after = h.readBytes(Math.min(SNIFF_BYTES, size - tag));
        }
      } finally {
        h.close();
      }
      return { exists: true, size, ext: extOf(uri), real: sniffBytes(b, after) };
    } catch {
      return null;
    }
  },

  /**
   * Names AVPlayer / NSURL trip over even when percent-encoded correctly: a literal %, # or ?,
   * emoji and other non-BMP characters, control characters, combining marks left in NFD form,
   * trailing dots/spaces, or an extremely long path. Such files are played from a plain copy
   * straight away instead of after a failed first attempt.
   */
  riskyName(uri: string): boolean {
    let path = uri;
    try {
      path = decodeURIComponent(uri.replace(/^file:\/\//i, ''));
    } catch {
      return true; // undecodable escapes are risky by definition
    }
    const name = path.slice(path.lastIndexOf('/') + 1);
    return (
      /[%#?\u0000-\u001f\u007f]/.test(name) ||
      /[\ud800-\udfff]/.test(name) ||
      name !== name.normalize('NFC') ||
      /[. ]$/.test(name) ||
      encodeURIComponent(path).replace(/%[0-9A-F]{2}/gi, 'x').length > 900
    );
  },

  /**
   * Plays-anywhere copy of a local file: plain ASCII name in Caches with the extension that
   * matches its real container. Fixes misnamed files and odd names / permissions on the original.
   */
  playableCopy(uri: string, ext: string): string | null {
    if (Platform.OS === 'web') return null;
    try {
      const src = new File(uri);
      if (!src.exists) return null;
      const key = `play-${hashOf(uri + (src.size || 0) + (src.modificationTime || 0))}`;
      const dir = copyDir();
      const dst = new File(dir, `${key}.${(ext || 'm4a').replace(/[^a-z0-9]/gi, '')}`);
      if (!dst.exists || (dst.size || 0) !== (src.size || 0)) {
        if (dst.exists) dst.delete();
        // APFS clones the file (copy-on-write): instant and no extra space
        src.copy(dst);
        evictCopies(dir, dst.name);
      }
      return dst.uri;
    } catch {
      return null;
    }
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
