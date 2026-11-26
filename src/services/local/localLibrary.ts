// HolySic Local Files — a Spotify-style "Local Files" library built on the app's own folder.
//
// On iOS the app's Documents folder is shared with the Files app ("On My iPhone › HolySic") and
// Finder (UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace). Whatever the user drops in
// there — loose songs or a whole tree of folders — becomes the library. Folders are the user's own
// groups: create, rename, nest, move songs between them, here or in the Files app; HolySic rescans
// when it comes back to the foreground.
//
// Tracks get stable ids from their RELATIVE path ("lf:Chill/Lofi/song.mp3"), so likes, playlists
// and history survive app updates (iOS moves the container on reinstall) and in-app moves (ids are
// remapped). Tags/cover art are read once and cached by size+mtime.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { AppState, Linking, Platform } from 'react-native';
import { Track } from '../../types/music';
import { ByteReader, readTags, TagMeta } from './tagReader';

export const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|aif|aiff|caf|alac|mp4|m4b)$/i;
const COVER_NAME = /^(cover|folder|front|album|artwork|albumart)\.(jpe?g|png)$/i;
/** Internal app folders that live in Documents but are not the user's music */
const INTERNAL_DIRS = new Set(['holysic-offline', 'holysic-local', '.Trash']);
const META_KEY = '@holysic/local_meta_v1';
const ART_DIR = 'holysic-art';
export const LOCAL_ID_PREFIX = 'lf:';

// ---------- types ----------

export interface LocalFile {
  path: string; // relative, '/'-separated
  name: string;
  dir: string;
  size: number;
  mtime: number;
  meta: CachedMeta;
  track: Track;
}

export interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  files: LocalFile[];
  /** songs in this folder and every subfolder */
  total: number;
  totalSec: number;
  coverUri?: string;
  mtime: number;
}

interface CachedMeta extends Omit<TagMeta, 'picture'> {
  size: number;
  mtime: number;
  art?: string; // file name inside the art cache
  addedAt: number;
}

export interface LocalState {
  backend: 'native' | 'web';
  ready: boolean;
  scanning: boolean;
  progress: { done: number; total: number };
  root: FolderNode;
  files: LocalFile[];
  lastScanAt: number;
  error?: string;
  /** Library screen: null = closed, otherwise the folder path to show first */
  openAt: string | null;
  openNonce: number;
}

interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

interface Backend {
  kind: 'native' | 'web';
  list(rel: string): Promise<Entry[]>;
  reader(rel: string): Promise<ByteReader & { close(): void }>;
  uri(rel: string): string;
  exists(rel: string): boolean;
  mkdir(rel: string): void;
  move(rel: string, toDir: string, newName: string): void;
  remove(rel: string, isDir: boolean): void;
  importAsset(asset: DocumentPicker.DocumentPickerAsset, toRel: string): Promise<void>;
  writeArt(name: string, data: Uint8Array): void;
  artUri(name: string): string | undefined;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const parts = (rel: string) => rel.split('/').filter(Boolean);

// ---------- native backend (iOS/Android Documents) ----------

/**
 * iOS hands back percent-encoded file URLs (`URL.absoluteString`) from `list()`, and on iOS 15
 * `URL(string:)` rejects raw spaces/diacritics. So: always build fully-encoded URIs per segment,
 * and decode names coming back — "Sơn Tùng #1 (100%).mp3" round-trips exactly.
 */
const decodeName = (n: string) => {
  try {
    return decodeURIComponent(n);
  } catch {
    return n;
  }
};
const encodedPath = (rel: string) => parts(rel).map(encodeURIComponent).join('/');

function nativeBackend(): Backend {
  const docBase = () => Paths.document.uri.replace(/\/?$/, '/');
  const dirFor = (rel: string): Directory =>
    rel ? new Directory(docBase() + encodedPath(rel)) : Paths.document;
  const fileFor = (rel: string): File => new File(docBase() + encodedPath(rel));
  const artDir = () => {
    const d = new Directory(Paths.cache, ART_DIR);
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  };
  return {
    kind: 'native',
    async list(rel) {
      const d = dirFor(rel);
      if (!d.exists) return [];
      return d.list().map((it) => {
        if (it instanceof Directory)
          return { name: decodeName(it.name), isDir: true, size: 0, mtime: 0 };
        const f = it as File;
        return {
          name: decodeName(f.name),
          isDir: false,
          size: f.size || 0,
          mtime: f.modificationTime || 0,
        };
      });
    },
    async reader(rel) {
      const f = fileFor(rel);
      const h = f.open();
      const size = h.size ?? f.size ?? 0;
      return {
        size,
        async read(offset, length) {
          const len = Math.max(0, Math.min(length, size - offset));
          if (len === 0) return new Uint8Array(0);
          h.offset = offset;
          return h.readBytes(len);
        },
        close: () => h.close(),
      };
    },
    uri: (rel) => fileFor(rel).uri,
    exists: (rel) => {
      try {
        return fileFor(rel).exists;
      } catch {
        return false;
      }
    },
    mkdir: (rel) => dirFor(rel).create({ intermediates: true, idempotent: false }),
    move(rel, toDir, newName) {
      const isDir = dirFor(rel).exists && !fileFor(rel).exists;
      const src = isDir ? dirFor(rel) : fileFor(rel);
      const target = join(toDir, newName);
      if (dirOf(rel) === toDir) src.rename(newName);
      else if (baseOf(rel) === newName) src.move(dirFor(toDir));
      else src.move(isDir ? dirFor(target) : fileFor(target));
    },
    remove: (rel, isDir) => (isDir ? dirFor(rel) : fileFor(rel)).delete(),
    async importAsset(asset, toRel) {
      // the picker already copied it into the cache: move it (no duplicate left behind)
      const src = new File(asset.uri);
      try {
        src.move(fileFor(toRel));
      } catch {
        new File(asset.uri).copy(fileFor(toRel));
      }
    },
    writeArt(name, data) {
      new File(artDir(), name).write(data);
    },
    artUri(name) {
      const f = new File(Paths.cache, ART_DIR, name);
      return f.exists ? f.uri : undefined;
    },
  };
}

// ---------- web backend (in-memory; lets the preview exercise the whole feature) ----------

function webBackend(): Backend {
  type Node = { isDir: boolean; blob?: Blob; url?: string; mtime: number };
  const fs = new Map<string, Node>([['', { isDir: true, mtime: Date.now() }]]);
  const art = new Map<string, string>();
  const children = (rel: string) =>
    [...fs.keys()].filter((k) => k !== '' && dirOf(k) === rel && k !== rel);
  const need = (rel: string) => {
    const n = fs.get(rel);
    if (!n) throw new Error('Not found: ' + rel);
    return n;
  };
  return {
    kind: 'web',
    async list(rel) {
      return children(rel).map((k) => {
        const n = fs.get(k)!;
        return { name: baseOf(k), isDir: n.isDir, size: n.blob?.size || 0, mtime: n.mtime };
      });
    },
    async reader(rel) {
      const blob = need(rel).blob!;
      return {
        size: blob.size,
        read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()),
        close: () => undefined,
      };
    },
    uri(rel) {
      const n = need(rel);
      if (!n.url && n.blob) n.url = URL.createObjectURL(n.blob);
      return n.url || '';
    },
    exists: (rel) => fs.has(rel) && !fs.get(rel)!.isDir,
    mkdir(rel) {
      if (fs.has(rel)) throw new Error('exists');
      let acc = '';
      for (const p of parts(rel)) {
        acc = join(acc, p);
        if (!fs.has(acc)) fs.set(acc, { isDir: true, mtime: Date.now() });
      }
    },
    move(rel, toDir, newName) {
      const target = join(toDir, newName);
      const keys = [...fs.keys()].filter((k) => k === rel || k.startsWith(rel + '/'));
      for (const k of keys) {
        const n = fs.get(k)!;
        fs.delete(k);
        fs.set(target + k.slice(rel.length), n);
      }
    },
    remove(rel) {
      for (const k of [...fs.keys()])
        if (k === rel || k.startsWith(rel + '/')) {
          const n = fs.get(k);
          if (n?.url) URL.revokeObjectURL(n.url);
          fs.delete(k);
        }
    },
    async importAsset(asset, toRel) {
      const blob: Blob = asset.file || (await (await fetch(asset.uri)).blob());
      fs.set(toRel, { isDir: false, blob, mtime: Date.now() });
    },
    writeArt(name, data) {
      const mime = data[0] === 0x89 ? 'image/png' : 'image/jpeg';
      const old = art.get(name);
      if (old) URL.revokeObjectURL(old);
      art.set(name, URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: mime })));
    },
    artUri: (name) => art.get(name),
  };
}

// ---------- helpers ----------

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

export function titleFromFileName(name: string): {
  title: string;
  artist?: string;
  trackNo?: number;
} {
  const noExt = name
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .trim();
  const tn = noExt.match(/^(\d{1,3})[\s.\-)]+/);
  const base = noExt.replace(/^\d{1,3}[\s.\-)]+/, '').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return {
    title: (m ? m[2] : base).trim() || noExt || name,
    artist: m ? m[1].trim() : undefined,
    trackNo: tn ? parseInt(tn[1], 10) : undefined,
  };
}

const collator =
  typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })
    : null;
export const compareNames = (a: string, b: string) =>
  collator ? collator.compare(a, b) : a.localeCompare(b);

/** Safe file/folder name (no path separators or characters Files/Finder reject) */
export function sanitizeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120)
  );
}

const UNKNOWN_ARTIST = 'Không rõ nghệ sĩ';

// ---------- the library ----------

class LocalLibraryStore {
  private backend: Backend = Platform.OS === 'web' ? webBackend() : nativeBackend();
  private metaCache: Record<string, CachedMeta> = {};
  private metaLoaded = false;
  private listeners = new Set<() => void>();
  private remapListeners = new Set<(map: Record<string, Track>) => void>();
  private scanPromise: Promise<void> | null = null;
  private rescanQueued = false;
  private byName = new Map<string, string>();
  private appStateHooked = false;

  state: LocalState = {
    backend: this.backend.kind,
    ready: false,
    scanning: false,
    progress: { done: 0, total: 0 },
    root: { path: '', name: '', folders: [], files: [], total: 0, totalSec: 0, mtime: 0 },
    files: [],
    lastScanAt: 0,
    openAt: null,
    openNonce: 0,
  };

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<LocalState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }
  /** Fired when in-app moves/renames change track ids: old id → new track */
  onRemap(cb: (map: Record<string, Track>) => void) {
    this.remapListeners.add(cb);
    return () => {
      this.remapListeners.delete(cb);
    };
  }

  open(path = '') {
    this.set({ openAt: path, openNonce: this.state.openNonce + 1 });
    if (!this.state.ready && !this.state.scanning) this.scan();
  }
  close() {
    this.set({ openAt: null });
  }

  /** Start watching: first scan + rescan whenever the app returns to the foreground. */
  init() {
    if (this.appStateHooked) return;
    this.appStateHooked = true;
    setTimeout(() => this.scan(), 2500);
    AppState.addEventListener('change', (s) => {
      if (s === 'active') setTimeout(() => this.scan(), 600);
    });
  }

  folder(path: string): FolderNode | null {
    let node: FolderNode | undefined = this.state.root;
    for (const p of parts(path)) {
      node = node?.folders.find((f) => f.name === p);
      if (!node) return null;
    }
    return node || null;
  }

  /** All songs in a folder and its subfolders, in folder order */
  tracksIn(path: string): Track[] {
    const node = this.folder(path);
    if (!node) return [];
    const out: Track[] = [];
    const walk = (n: FolderNode) => {
      n.files.forEach((f) => out.push(f.track));
      n.folders.forEach(walk);
    };
    walk(node);
    return out;
  }

  /** Playable URI for a local track (follows the file by name if it was moved in the Files app) */
  resolveUri(track: Track): string | undefined {
    if (!track.id.startsWith(LOCAL_ID_PREFIX)) return undefined;
    const rel = track.id.slice(LOCAL_ID_PREFIX.length);
    if (this.backend.exists(rel)) return this.backend.uri(rel);
    const moved = this.byName.get(baseOf(rel).toLowerCase());
    if (moved && this.backend.exists(moved)) return this.backend.uri(moved);
    return undefined;
  }

  async openInFilesApp(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    const path = Paths.document.uri.replace(/^file:\/\//, '');
    try {
      await Linking.openURL('shareddocuments://' + path);
      return true;
    } catch {
      return false;
    }
  }

  // ---- scanning ----

  private async loadMeta() {
    if (this.metaLoaded) return;
    this.metaLoaded = true;
    try {
      const raw = await AsyncStorage.getItem(META_KEY);
      if (raw) this.metaCache = JSON.parse(raw) || {};
    } catch {
      this.metaCache = {};
    }
  }
  private saveMeta() {
    AsyncStorage.setItem(META_KEY, JSON.stringify(this.metaCache)).catch(() => undefined);
  }

  scan(): Promise<void> {
    if (this.scanPromise) {
      this.rescanQueued = true;
      return this.scanPromise;
    }
    this.scanPromise = this.doScan()
      .catch((e) => this.set({ error: String(e?.message || e) }))
      .finally(() => {
        this.scanPromise = null;
        if (this.rescanQueued) {
          this.rescanQueued = false;
          this.scan();
        }
      });
    return this.scanPromise;
  }

  private async doScan() {
    await this.loadMeta();
    this.set({ scanning: true, error: undefined });
    // 1) walk the tree
    type RawDir = { path: string; files: Entry[]; dirs: RawDir[]; cover?: string; mtime: number };
    const walk = async (rel: string, depth: number): Promise<RawDir> => {
      const entries = await this.backend.list(rel);
      const node: RawDir = { path: rel, files: [], dirs: [], mtime: 0 };
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDir) {
          if (depth === 0 && INTERNAL_DIRS.has(e.name)) continue;
          if (depth < 12) node.dirs.push(await walk(join(rel, e.name), depth + 1));
        } else if (AUDIO_EXT.test(e.name)) node.files.push(e);
        else if (COVER_NAME.test(e.name) && !node.cover) node.cover = join(rel, e.name);
      }
      return node;
    };
    const raw = await walk('', 0);
    const all: { rel: string; e: Entry }[] = [];
    const collect = (d: RawDir) => {
      d.files.forEach((e) => all.push({ rel: join(d.path, e.name), e }));
      d.dirs.forEach(collect);
    };
    collect(raw);

    // 2) tags (cached by size + mtime)
    const todo = all.filter(({ rel, e }) => {
      const c = this.metaCache[rel];
      return (
        !c || c.size !== e.size || c.mtime !== e.mtime || (c.art && !this.backend.artUri(c.art))
      );
    });
    this.set({ progress: { done: 0, total: todo.length } });
    let done = 0;
    for (const { rel, e } of todo) {
      let meta: TagMeta = {};
      try {
        const r = await this.backend.reader(rel);
        try {
          meta = await readTags(r, e.name);
        } finally {
          r.close();
        }
      } catch {
        // unreadable file: still listed, named from the file name
      }
      const { picture, ...rest } = meta;
      let artName: string | undefined;
      if (picture && picture.data.length > 64) {
        artName = `${hash(rel + e.size + e.mtime)}.${picture.mime === 'image/png' ? 'png' : 'jpg'}`;
        try {
          this.backend.writeArt(artName, picture.data);
        } catch {
          artName = undefined;
        }
      }
      this.metaCache[rel] = {
        ...rest,
        size: e.size,
        mtime: e.mtime,
        art: artName,
        addedAt: this.metaCache[rel]?.addedAt || e.mtime || Date.now(),
      };
      done++;
      if (done % 6 === 0) {
        this.set({ progress: { done, total: todo.length } });
        await new Promise((res) => setTimeout(res, 0)); // keep the UI responsive
      }
    }
    // prune entries for files that are gone
    const seen = new Set(all.map((a) => a.rel));
    for (const k of Object.keys(this.metaCache)) if (!seen.has(k)) delete this.metaCache[k];
    this.saveMeta();

    // 3) build the tree
    this.byName.clear();
    const files: LocalFile[] = [];
    const build = (d: RawDir, parentCover?: string): FolderNode => {
      const coverUri = d.cover ? this.backend.uri(d.cover) : undefined;
      const node: FolderNode = {
        path: d.path,
        name: baseOf(d.path),
        folders: [],
        files: [],
        total: 0,
        totalSec: 0,
        coverUri,
        mtime: 0,
      };
      for (const e of d.files) {
        const rel = join(d.path, e.name);
        const lf = this.toLocalFile(rel, e, coverUri || parentCover);
        node.files.push(lf);
        files.push(lf);
        this.byName.set(e.name.toLowerCase(), rel);
        node.totalSec += lf.track.durationSec || 0;
        node.mtime = Math.max(node.mtime, lf.meta.addedAt);
      }
      node.files.sort(
        (a, b) =>
          (a.meta.discNo || 0) - (b.meta.discNo || 0) ||
          (a.meta.trackNo || 999) - (b.meta.trackNo || 999) ||
          compareNames(a.name, b.name)
      );
      node.folders = d.dirs.map((sub) => build(sub, coverUri || parentCover));
      node.folders.sort((a, b) => compareNames(a.name, b.name));
      node.total = node.files.length + node.folders.reduce((s, f) => s + f.total, 0);
      node.totalSec += node.folders.reduce((s, f) => s + f.totalSec, 0);
      node.mtime = Math.max(node.mtime, ...node.folders.map((f) => f.mtime), 0);
      if (!node.coverUri)
        node.coverUri =
          node.files.find((f) => f.track.artworkUrl)?.track.artworkUrl ||
          node.folders.find((f) => f.coverUri)?.coverUri;
      return node;
    };
    const root = build(raw);
    this.set({
      root,
      files,
      ready: true,
      scanning: false,
      lastScanAt: Date.now(),
      progress: { done: todo.length, total: todo.length },
    });
  }

  private toLocalFile(rel: string, e: Entry, folderCover?: string): LocalFile {
    const meta = this.metaCache[rel] || { size: e.size, mtime: e.mtime, addedAt: e.mtime };
    const dir = dirOf(rel);
    const guess = titleFromFileName(e.name);
    const dirParts = parts(dir);
    const ext = (e.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
    const artist = meta.artist || guess.artist || meta.albumArtist || UNKNOWN_ARTIST;
    const album = meta.album || dirParts[dirParts.length - 1] || undefined;
    const art = meta.art ? this.backend.artUri(meta.art) : undefined;
    const khz = meta.sampleRateHz
      ? ` · ${(meta.sampleRateHz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`
      : '';
    const codec = meta.codec || ext;
    const track: Track = {
      id: LOCAL_ID_PREFIX + rel,
      title: meta.title || guess.title,
      artist,
      artists: artist.split(/\s*(?:,|&|feat\.?|ft\.?|x)\s+/i).filter(Boolean),
      album,
      artworkUrl: art || folderCover || '',
      durationSec: meta.durationSec || 0,
      source: 'local',
      qualityBadge: `${codec}${khz} · ${Platform.OS === 'web' ? 'Local' : 'Trên máy'}`,
      genre: meta.genre,
      releaseYear: meta.year,
    };
    if (!meta.trackNo && guess.trackNo) meta.trackNo = guess.trackNo;
    return { path: rel, name: e.name, dir, size: e.size, mtime: e.mtime, meta, track };
  }

  // ---- folder operations ----

  private uniqueName(dir: string, name: string, taken?: Set<string>): string {
    const existing = taken || new Set(this.namesIn(dir));
    if (!existing.has(name.toLowerCase())) return name;
    const m = name.match(/^(.*?)(\.[^.]+)?$/)!;
    for (let i = 2; i < 999; i++) {
      const n = `${m[1]} (${i})${m[2] || ''}`;
      if (!existing.has(n.toLowerCase())) return n;
    }
    return `${Date.now()}-${name}`;
  }
  private namesIn(dir: string): string[] {
    const node = this.folder(dir);
    if (!node) return [];
    return [...node.folders.map((f) => f.name), ...node.files.map((f) => f.name)].map((n) =>
      n.toLowerCase()
    );
  }

  async createFolder(parent: string, name: string): Promise<string> {
    const clean = sanitizeName(name);
    if (!clean) throw new Error('empty');
    const finalName = this.uniqueName(parent, clean);
    const rel = join(parent, finalName);
    this.backend.mkdir(rel);
    await this.scan();
    return rel;
  }

  /** Move files/folders into `toDir`. Returns how many were moved. */
  async move(paths: string[], toDir: string): Promise<number> {
    const remap: Record<string, Track> = {};
    const renamedMeta: [string, string][] = [];
    const taken = new Set(this.namesIn(toDir));
    let n = 0;
    for (const rel of paths) {
      if (dirOf(rel) === toDir) continue;
      if (toDir === rel || toDir.startsWith(rel + '/')) continue; // can't move into itself
      const name = this.uniqueName(toDir, baseOf(rel), taken);
      taken.add(name.toLowerCase());
      this.backend.move(rel, toDir, name);
      renamedMeta.push([rel, join(toDir, name)]);
      n++;
    }
    this.applyRenames(renamedMeta, remap);
    await this.scan();
    this.emitRemap(remap);
    return n;
  }

  async rename(rel: string, newName: string): Promise<string> {
    const clean = sanitizeName(newName);
    if (!clean) throw new Error('empty');
    const isFile = AUDIO_EXT.test(rel) && this.backend.exists(rel);
    // keep the extension of songs
    const ext = isFile ? rel.match(/\.[^.]+$/)?.[0] || '' : '';
    const target = isFile && !AUDIO_EXT.test(clean) ? clean + ext : clean;
    if (target === baseOf(rel)) return rel;
    const dir = dirOf(rel);
    const others = new Set(this.namesIn(dir).filter((x) => x !== baseOf(rel).toLowerCase()));
    const finalName = this.uniqueName(dir, target, others);
    this.backend.move(rel, dir, finalName);
    const remap: Record<string, Track> = {};
    const to = join(dir, finalName);
    this.applyRenames([[rel, to]], remap);
    await this.scan();
    this.emitRemap(remap);
    return to;
  }

  async remove(paths: string[]): Promise<number> {
    let n = 0;
    for (const rel of paths) {
      const isDir = !this.state.files.some((f) => f.path === rel);
      try {
        this.backend.remove(rel, isDir);
        n++;
      } catch {
        // already gone
      }
    }
    await this.scan();
    return n;
  }

  /** Copy songs picked in the Files app / iCloud Drive into a library folder (original names). */
  async importFromPicker(toDir = ''): Promise<number> {
    const res = await DocumentPicker.getDocumentAsync({
      type: Platform.OS === 'web' ? ['audio/*'] : ['public.audio', 'audio/*'],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (res.canceled || !res.assets?.length) return 0;
    if (toDir && !this.folder(toDir)) this.backend.mkdir(toDir);
    const taken = new Set(this.namesIn(toDir));
    let n = 0;
    for (const a of res.assets) {
      const isAudio = AUDIO_EXT.test(a.name) || (a.mimeType || '').startsWith('audio/');
      if (!isAudio) continue;
      let name = sanitizeName(a.name) || `audio-${Date.now()}.m4a`;
      if (!AUDIO_EXT.test(name)) name += '.m4a';
      name = this.uniqueName(toDir, name, taken);
      taken.add(name.toLowerCase());
      await this.backend.importAsset(a, join(toDir, name));
      n++;
    }
    await this.scan();
    return n;
  }

  private applyRenames(pairs: [string, string][], remap: Record<string, Track>) {
    for (const [from, to] of pairs) {
      for (const k of Object.keys(this.metaCache)) {
        if (k === from || k.startsWith(from + '/')) {
          const nk = to + k.slice(from.length);
          this.metaCache[nk] = this.metaCache[k];
          delete this.metaCache[k];
          remap[LOCAL_ID_PREFIX + k] = { id: LOCAL_ID_PREFIX + nk } as Track;
        }
      }
    }
  }

  private emitRemap(remap: Record<string, Track>) {
    if (!Object.keys(remap).length) return;
    const byId = new Map(this.state.files.map((f) => [f.track.id, f.track]));
    const full: Record<string, Track> = {};
    for (const [oldId, stub] of Object.entries(remap)) {
      const t = byId.get(stub.id);
      if (t) full[oldId] = t;
    }
    this.remapListeners.forEach((cb) => cb(full));
  }
}

export const LocalLibrary = new LocalLibraryStore();
export const isLocalTrack = (t?: Track | null) => !!t && t.id.startsWith(LOCAL_ID_PREFIX);
export const localPathOf = (t: Track) => t.id.slice(LOCAL_ID_PREFIX.length);
export const localDirOf = (t: Track) => dirOf(localPathOf(t));
