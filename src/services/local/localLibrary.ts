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
import { buildM3U, locationParts } from '../import/m3u';
import { bestMatch, MetaCandidate } from './metadataLookup';
import { ByteReader, decodeText, readTags, TagMeta } from './tagReader';
import { extForMime, MIDI_EXT, PLAYABLE_EXT, UNPLAYABLE_EXT } from '../audio/formatSniff';
import { MidiRender } from '../audio/midiRender';

/** Everything iOS (or the app's MIDI synth) can play — see formatSniff.ts */
export const AUDIO_EXT = PLAYABLE_EXT;
const COVER_NAME = /^(cover|folder|front|album|artwork|albumart)\.(jpe?g|png)$/i;
/** Internal app folders that live in Documents but are not the user's music */
const INTERNAL_DIRS = new Set(['holysic-offline', 'holysic-local', '.Trash']);
const META_KEY = '@holysic/local_meta_v1';
const EDITS_KEY = '@holysic/local_edits_v1';
const SETTINGS_KEY = '@holysic/local_settings_v1';

/** "Sửa thông tin": the user's own (or fetched) details, kept in the app — files are untouched */
export interface LocalEdit {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  genre?: string;
  trackNo?: number;
  /** cover image in the art cache */
  art?: string;
  /** where auto-fill found it ("Apple Music" / "Deezer") */
  fetchedFrom?: string;
  /** last automatic lookup (also when nothing matched, so it isn't retried every scan) */
  lookedUpAt?: number;
}
const ART_DIR = 'holysic-art';
const KEPT_ART_DIR = '.holysic-covers';
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
  /** the folder's own cover file (cover.jpg, folder.png…), if it has one */
  coverPath?: string;
  /** .m3u / .m3u8 playlists in this folder */
  playlists: string[];
  mtime: number;
}

interface CachedMeta extends Omit<TagMeta, 'picture' | 'lyrics'> {
  /** lyrics are embedded (read on demand, not cached) */
  hasLyrics?: boolean;
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
  /** auto-fill progress (finding missing details & covers online) */
  fetching: { done: number; total: number; matched: number } | null;
  /** look up missing details & covers automatically after each scan */
  autoFetch: boolean;
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
  /** display URI for a folder cover that changes whenever the file changes (image caches) */
  coverUri(rel: string, e: Entry): string | undefined;
  /** copy an image (picker/cache URI) to a file in the library */
  writeFromUri(uri: string, toRel: string): Promise<void>;
  /** download (http) or copy (file/blob) an image into the art cache */
  saveArt(uri: string, name: string): Promise<void>;
  removeArt?(name: string): void;
  writeText(rel: string, text: string): void;
}

const KEPT_REF = 'kept:';
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
/** file-name key: case- and Unicode-form-insensitive (Files / AirDrop / Finder may hand over
 *  decomposed "ơ" while the playlist saved the composed one — APFS treats them as one name) */
const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
/** lower-case, no diacritics (đ → d) — for accent-insensitive search */
export const foldText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
const stripExt = (rel: string) => rel.replace(/\.[^./]+$/, '');
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
  // covers the user chose / auto-fill found are not re-creatable from the files, so they live
  // outside Caches (which iOS may purge) — in a hidden Documents folder the scanner skips
  const keptDir = () => {
    const d = new Directory(Paths.document, KEPT_ART_DIR);
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  };
  const isKept = (name: string) => /^(ed|af)-/.test(name);
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
      const f = isKept(name)
        ? new File(Paths.document, KEPT_ART_DIR, name)
        : new File(Paths.cache, ART_DIR, name);
      return f.exists ? f.uri : undefined;
    },
    writeText(rel, text) {
      const d = dirOf(rel);
      if (d && !dirFor(d).exists) dirFor(d).create({ intermediates: true, idempotent: true });
      const f = fileFor(rel);
      if (!f.exists) f.create();
      f.write(text);
    },
    removeArt(name) {
      try {
        const f = new File(isKept(name) ? keptDir() : artDir(), name);
        if (f.exists) f.delete();
      } catch {
        // ignore
      }
    },
    coverUri(rel, e) {
      // a cache copy named after size+mtime: a replaced cover.jpg gets a new URI, so it shows at once
      const ext = rel.match(/\.(png|jpe?g)$/i)?.[1].toLowerCase() || 'jpg';
      const name = `fc-${hash(rel + e.size + e.mtime)}.${ext}`;
      try {
        const cached = new File(artDir(), name);
        if (!cached.exists) fileFor(rel).copy(cached);
        return cached.uri;
      } catch {
        return fileFor(rel).uri;
      }
    },
    async writeFromUri(uri, toRel) {
      const dst = fileFor(toRel);
      if (dst.exists) dst.delete();
      new File(uri).copy(dst);
    },
    async saveArt(uri, name) {
      const dst = new File(isKept(name) ? keptDir() : artDir(), name);
      if (/^https?:/i.test(uri)) await File.downloadFileAsync(uri, dst, { idempotent: true });
      else {
        if (dst.exists) dst.delete();
        new File(uri).copy(dst);
      }
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
    coverUri(rel) {
      return fs.has(rel) ? this.uri(rel) : undefined;
    },
    writeText(rel, text) {
      let acc = '';
      for (const p of parts(dirOf(rel))) {
        acc = join(acc, p);
        if (!fs.has(acc)) fs.set(acc, { isDir: true, mtime: Date.now() });
      }
      const old = fs.get(rel);
      if (old?.url) URL.revokeObjectURL(old.url);
      fs.set(rel, {
        isDir: false,
        blob: new Blob([text], { type: 'audio/x-mpegurl' }),
        mtime: Date.now(),
      });
    },
    async saveArt(uri, name) {
      const blob = await (await fetch(uri)).blob();
      const old = art.get(name);
      if (old) URL.revokeObjectURL(old);
      art.set(name, URL.createObjectURL(blob));
    },
    async writeFromUri(uri, toRel) {
      const blob = await (await fetch(uri)).blob();
      const old = fs.get(toRel);
      if (old?.url) URL.revokeObjectURL(old.url);
      fs.set(toRel, { isDir: false, blob, mtime: Date.now() });
    },
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

/** Downscale an image to fit `max` px (JPEG). Returns undefined if it is already small enough. */
async function shrinkImage(uri: string, max: number): Promise<string | undefined> {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const probe = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = probe;
  if (Math.max(width, height) <= max && !/\.(heic|heif|webp)($|\?)/i.test(uri)) {
    probe.release?.();
    return undefined;
  }
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > max) ctx.resize(width >= height ? { width: max } : { height: max });
  const img = await ctx.renderAsync();
  const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.86 });
  probe.release?.();
  img.release?.();
  return saved.uri;
}

/** MIDI songs are named exactly like their file (minus the extension) */
export function midiTitle(name: string): { title: string; artist?: string; trackNo?: number } {
  return { title: name.replace(/\.[^.]+$/, '').trim() || name };
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
  private edits: Record<string, LocalEdit> = {};
  private fetchRun = 0;
  private metaLoaded = false;
  private listeners = new Set<() => void>();
  private remapListeners = new Set<(map: Record<string, Track>) => void>();
  private scanPromise: Promise<void> | null = null;
  private rescanQueued = false;
  private byName = new Map<string, string>();
  /** "dir/song" (lower-case, no extension) → "dir/Song.lrc" */
  private lrcByBase = new Map<string, string>();
  private appStateHooked = false;

  state: LocalState = {
    backend: this.backend.kind,
    ready: false,
    scanning: false,
    progress: { done: 0, total: 0 },
    root: {
      path: '',
      name: '',
      folders: [],
      files: [],
      playlists: [],
      total: 0,
      totalSec: 0,
      mtime: 0,
    },
    files: [],
    lastScanAt: 0,
    openAt: null,
    openNonce: 0,
    fetching: null,
    autoFetch: false,
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
    const moved = this.byName.get(nameKey(baseOf(rel)));
    if (moved && this.backend.exists(moved)) return this.backend.uri(moved);
    return undefined;
  }

  /**
   * Finds a local song for playback and says how (or why not) — shown in Stream Diagnostics.
   * Order: the saved path → the same path in the other Unicode form → the file name anywhere in
   * the library index → a quick name-only walk of the folders (before the first scan finished, or
   * after a move in the Files app).
   */
  async locate(
    track: Track
  ): Promise<{ uri?: string; rel: string; how: 'path' | 'moved' | 'missing'; detail: string }> {
    const rel = track.id.startsWith(LOCAL_ID_PREFIX) ? track.id.slice(LOCAL_ID_PREFIX.length) : '';
    if (!rel) return { rel, how: 'missing', detail: 'Not a local song' };
    const ok = (r?: string) => (r && this.backend.exists(r) ? r : undefined);
    const hit = ok(rel) || ok(rel.normalize('NFC')) || ok(rel.normalize('NFD'));
    if (hit) return { uri: this.backend.uri(hit), rel: hit, how: 'path', detail: hit };
    let moved = ok(this.byName.get(nameKey(baseOf(rel))));
    if (!moved) moved = await this.findByName(baseOf(rel));
    if (moved) {
      this.byName.set(nameKey(baseOf(moved)), moved);
      return {
        uri: this.backend.uri(moved),
        rel: moved,
        how: 'moved',
        detail: `${rel} → ${moved}`,
      };
    }
    return { rel, how: 'missing', detail: rel };
  }

  /** Name-only search of the folder tree (no tag reading — fast even on big libraries) */
  private async findByName(name: string): Promise<string | undefined> {
    const want = nameKey(name);
    const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }];
    let visited = 0;
    while (queue.length && visited < 400) {
      const { rel, depth } = queue.shift()!;
      visited++;
      let entries: Entry[] = [];
      try {
        entries = await this.backend.list(rel);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const child = join(rel, e.name);
        if (!e.isDir && nameKey(e.name) === want) return child;
        if (e.isDir && depth < 6) queue.push({ rel: child, depth: depth + 1 });
      }
    }
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
      const [raw, ed, st] = await Promise.all([
        AsyncStorage.getItem(META_KEY),
        AsyncStorage.getItem(EDITS_KEY),
        AsyncStorage.getItem(SETTINGS_KEY),
      ]);
      if (raw) this.metaCache = JSON.parse(raw) || {};
      if (ed) this.edits = JSON.parse(ed) || {};
      if (st) this.set({ autoFetch: !!JSON.parse(st)?.autoFetch });
    } catch {
      this.metaCache = {};
    }
  }
  private saveEdits() {
    AsyncStorage.setItem(EDITS_KEY, JSON.stringify(this.edits)).catch(() => undefined);
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
    type RawDir = {
      path: string;
      files: Entry[];
      dirs: RawDir[];
      cover?: string;
      coverEntry?: Entry;
      lrcs: string[];
      m3us: string[];
      mtime: number;
    };
    const walk = async (rel: string, depth: number): Promise<RawDir> => {
      const entries = await this.backend.list(rel);
      const node: RawDir = { path: rel, files: [], dirs: [], lrcs: [], m3us: [], mtime: 0 };
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDir) {
          if (depth === 0 && INTERNAL_DIRS.has(e.name)) continue;
          if (depth < 12) node.dirs.push(await walk(join(rel, e.name), depth + 1));
        } else if (AUDIO_EXT.test(e.name)) node.files.push(e);
        else if (/\.lrc$/i.test(e.name)) node.lrcs.push(join(rel, e.name));
        else if (/\.m3u8?$/i.test(e.name)) node.m3us.push(join(rel, e.name));
        else if (COVER_NAME.test(e.name) && !node.cover) {
          node.cover = join(rel, e.name);
          node.coverEntry = e;
        }
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
        !c ||
        c.size !== e.size ||
        c.mtime !== e.mtime ||
        (c.art && !this.backend.artUri(c.art)) ||
        // read before the app understood MIDI: no length / title / karaoke lyrics yet
        (MIDI_EXT.test(rel) && !c.durationSec)
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
      const { picture, lyrics, ...rest } = meta;
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
        hasLyrics: !!lyrics || undefined,
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
    this.lrcByBase.clear();
    const addLrcs = (d: RawDir) => {
      d.lrcs.forEach((l) => this.lrcByBase.set(stripExt(l).toLowerCase(), l));
      d.dirs.forEach(addLrcs);
    };
    addLrcs(raw);
    const files: LocalFile[] = [];
    const build = (d: RawDir, parentCover?: string): FolderNode => {
      const coverUri =
        d.cover && d.coverEntry ? this.backend.coverUri(d.cover, d.coverEntry) : undefined;
      const node: FolderNode = {
        path: d.path,
        name: baseOf(d.path),
        folders: [],
        files: [],
        total: 0,
        totalSec: 0,
        coverUri,
        coverPath: d.cover,
        playlists: [...d.m3us].sort(compareNames),
        mtime: 0,
      };
      for (const e of d.files) {
        const rel = join(d.path, e.name);
        const lf = this.toLocalFile(rel, e, coverUri || parentCover);
        node.files.push(lf);
        files.push(lf);
        this.byName.set(nameKey(e.name), rel);
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
    if (this.state.autoFetch && !this.state.fetching) {
      // background, one song at a time, only songs never looked up before
      setTimeout(() => this.autoFill('', { onlyNew: true }), 1500);
    }
  }

  private toLocalFile(rel: string, e: Entry, folderCover?: string): LocalFile {
    const meta = this.metaCache[rel] || { size: e.size, mtime: e.mtime, addedAt: e.mtime };
    const dir = dirOf(rel);
    // MIDI: the file name is the title, as is (embedded track names are usually "Piano 1" etc.)
    const isMidi = MIDI_EXT.test(e.name);
    const guess = isMidi ? midiTitle(e.name) : titleFromFileName(e.name);
    const dirParts = parts(dir);
    const ext = (e.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
    const ed = this.edits[rel] || {};
    const artist =
      ed.artist ||
      meta.artist ||
      guess.artist ||
      ed.albumArtist ||
      meta.albumArtist ||
      UNKNOWN_ARTIST;
    const album = ed.album || meta.album || dirParts[dirParts.length - 1] || undefined;
    const art =
      (ed.art && this.backend.artUri(ed.art)) ||
      (meta.art ? this.backend.artUri(meta.art) : undefined);
    const khz = meta.sampleRateHz
      ? ` · ${(meta.sampleRateHz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`
      : '';
    const codec = meta.codec || ext;
    const track: Track = {
      id: LOCAL_ID_PREFIX + rel,
      title: ed.title || (isMidi ? guess.title : meta.title || guess.title),
      artist,
      artists: artist.split(/\s*(?:,|&|feat\.?|ft\.?|x)\s+/i).filter(Boolean),
      album,
      artworkUrl: art || folderCover || '',
      durationSec: meta.durationSec || 0,
      source: 'local',
      qualityBadge: `${codec}${khz} · ${Platform.OS === 'web' ? 'Local' : 'Trên máy'}`,
      genre: ed.genre || meta.genre,
      releaseYear: ed.year || meta.year,
      replayGainDb: meta.replayGainDb,
      replayPeak: meta.replayPeak,
    };
    if (!meta.trackNo && guess.trackNo) meta.trackNo = guess.trackNo;
    const shown =
      ed.trackNo || ed.albumArtist || ed.album
        ? {
            ...meta,
            album: ed.album || meta.album,
            trackNo: ed.trackNo || meta.trackNo,
            albumArtist: ed.albumArtist || meta.albumArtist,
          }
        : meta;
    return { path: rel, name: e.name, dir, size: e.size, mtime: e.mtime, meta: shown, track };
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
      this.carrySidecar(rel, toDir, name);
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
    if (isFile) this.carrySidecar(rel, dir, finalName);
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
      const isDir = !!rel && !!this.folder(rel) && !this.state.files.some((f) => f.path === rel);
      try {
        this.backend.remove(rel, isDir);
        n++;
        const lrc = !isDir && this.lrcByBase.get(stripExt(rel).toLowerCase());
        if (lrc) this.backend.remove(lrc, false);
        for (const k of Object.keys(this.edits))
          if (k === rel || k.startsWith(rel + '/')) delete this.edits[k];
        this.saveEdits();
      } catch {
        // already gone
      }
    }
    await this.scan();
    return n;
  }

  /** Files the last import skipped, with the reason (formats iOS can't decode) */
  lastSkipped: { name: string; reason: string }[] = [];

  /**
   * Name a picked file keeps in the library: its own extension when it has a known one; else one
   * from the MIME type (a MIDI stays .mid — it is never renamed to .m4a); else .m4a as before.
   */
  private importName(name: string, mime?: string | null): string {
    const clean = sanitizeName(name);
    if (clean && (PLAYABLE_EXT.test(clean) || UNPLAYABLE_EXT.test(clean))) return clean;
    const ext = extForMime(mime) || 'm4a';
    return `${clean || `audio-${Date.now()}`}.${ext}`;
  }

  /** Copy songs picked in the Files app / iCloud Drive into a library folder (original names). */
  async importFromPicker(toDir = ''): Promise<number> {
    const res = await DocumentPicker.getDocumentAsync({
      type:
        Platform.OS === 'web'
          ? ['audio/*', '.mid', '.midi', '.kar', '.rmi', 'audio/midi', 'audio/x-midi']
          : ['public.audio', 'public.midi-audio', 'audio/*'],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (res.canceled || !res.assets?.length) return 0;
    if (toDir && !this.folder(toDir)) this.backend.mkdir(toDir);
    const taken = new Set(this.namesIn(toDir));
    this.lastSkipped = [];
    const midis: string[] = [];
    let n = 0;
    for (const a of res.assets) {
      // lyrics picked together with their song, or playlists
      const isLrc = /\.(lrc|m3u8?)$/i.test(a.name);
      const mime = a.mimeType || '';
      const isAudio =
        PLAYABLE_EXT.test(a.name) ||
        UNPLAYABLE_EXT.test(a.name) ||
        mime.startsWith('audio/') ||
        !!extForMime(mime);
      if (!isAudio && !isLrc) continue;
      let name = isLrc
        ? sanitizeName(a.name) || `lyrics-${Date.now()}.lrc`
        : this.importName(a.name, mime);
      if (!isLrc && UNPLAYABLE_EXT.test(name)) {
        const ext = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
        this.lastSkipped.push({ name: a.name, reason: ext });
        continue;
      }
      name = this.uniqueName(toDir, name, taken);
      taken.add(name.toLowerCase());
      await this.backend.importAsset(a, join(toDir, name));
      if (!isLrc) n++;
      if (MIDI_EXT.test(name)) midis.push(join(toDir, name));
    }
    await this.scan();
    // MIDI: synthesize in the background now so the first play starts instantly
    if (midis.length)
      MidiRender.prewarm(
        midis.filter((r) => this.backend.exists(r)).map((r) => this.backend.uri(r))
      );
    return n;
  }

  /**
   * Bring outside audio files (e.g. HolySic's own downloads) into the library: each file is moved
   * into `toDir` under a readable name, and its details / cover are kept as a "Sửa thông tin"
   * edit (the file itself is untouched). Returns the new tracks (null where a move failed).
   */
  async adopt(
    items: { uri: string; name: string; edit?: LocalEdit; cover?: string }[],
    toDir: string
  ): Promise<(Track | null)[]> {
    if (toDir && !this.folder(toDir)) this.backend.mkdir(toDir);
    const taken = new Set(this.namesIn(toDir));
    const rels: (string | null)[] = [];
    for (const it of items) {
      let name = this.importName(it.name || `song-${Date.now()}`);
      // iOS can't decode it: don't move a file the library would only list as broken
      if (UNPLAYABLE_EXT.test(name)) {
        rels.push(null);
        continue;
      }
      name = this.uniqueName(toDir, name, taken);
      taken.add(name.toLowerCase());
      const rel = join(toDir, name);
      try {
        await this.backend.importAsset(
          { uri: it.uri, name } as unknown as DocumentPicker.DocumentPickerAsset,
          rel
        );
      } catch {
        rels.push(null);
        continue;
      }
      const edit: LocalEdit = { ...(it.edit || {}), lookedUpAt: Date.now() };
      if (it.cover) {
        try {
          const art = `ed-${hash(rel + it.cover)}.jpg`;
          await this.backend.saveArt(it.cover, art);
          edit.art = art;
        } catch {
          // no cover: the song still moves
        }
      }
      for (const k of Object.keys(edit) as (keyof LocalEdit)[])
        if (edit[k] === undefined || edit[k] === '') delete edit[k];
      this.edits[rel] = edit;
      rels.push(rel);
    }
    this.saveEdits();
    await this.scan();
    const midis = rels.filter((r): r is string => !!r && MIDI_EXT.test(r));
    if (midis.length)
      MidiRender.prewarm(
        midis.filter((r) => this.backend.exists(r)).map((r) => this.backend.uri(r))
      );
    return rels.map((r) =>
      r ? (this.state.files.find((f) => f.path === r)?.track ?? null) : null
    );
  }

  /**
   * Keep an image for good (playlist covers): shrunk and stored with the kept covers. Returns a
   * "kept:<name>" reference (an app update moves the data folder, so no absolute path is stored);
   * show it with `resolveImageRef`. On the web the picked data: URI is kept as is.
   */
  async keepImage(uri: string, key: string, max = 900): Promise<string | undefined> {
    if (this.backend.kind === 'web') return /^(data:|https?:)/i.test(uri) ? uri : undefined;
    const name = `ed-pl-${hash(key + uri + Date.now())}.jpg`;
    let src = uri;
    if (!/^https?:/i.test(uri)) src = (await shrinkImage(uri, max).catch(() => undefined)) || uri;
    try {
      await this.backend.saveArt(src, name);
    } catch {
      return undefined;
    }
    return KEPT_REF + name;
  }

  /** Drop an image kept by `keepImage` */
  forgetImage(ref?: string) {
    if (ref?.startsWith(KEPT_REF)) this.backend.removeArt?.(ref.slice(KEPT_REF.length));
  }

  /** Display URI for an image reference (kept:<name> → the file; anything else unchanged) */
  resolveImageRef(ref?: string): string | undefined {
    if (!ref?.startsWith(KEPT_REF)) return ref;
    return this.backend.artUri(ref.slice(KEPT_REF.length));
  }

  /** Every folder, depth-first, for "move to folder" pickers */
  allFolders(): { path: string; name: string; depth: number; total: number }[] {
    const out: { path: string; name: string; depth: number; total: number }[] = [];
    const walk = (n: FolderNode, depth: number) => {
      for (const f of n.folders) {
        if (f.path === 'Playlists') continue;
        out.push({ path: f.path, name: f.name, depth, total: f.total });
        walk(f, depth + 1);
      }
    };
    walk(this.state.root, 0);
    return out;
  }

  /** Keep "Song.lrc" with "Song.mp3" when the song is moved or renamed in the app */
  private carrySidecar(rel: string, toDir: string, newName: string) {
    const lrc = this.lrcByBase.get(stripExt(rel).toLowerCase());
    if (!lrc || !AUDIO_EXT.test(rel)) return;
    try {
      this.backend.move(lrc, toDir, stripExt(newName) + (lrc.match(/\.[^.]+$/)?.[0] || '.lrc'));
    } catch {
      // a same-named .lrc already there: leave it
    }
  }

  /** Search every local song (title, artist, album, file name — accents optional). */
  search(q: string, max = 50): LocalFile[] {
    const words = foldText(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out: LocalFile[] = [];
    for (const f of this.state.files) {
      const hay = foldText(`${f.track.title} ${f.track.artist} ${f.track.album || ''} ${f.name}`);
      if (words.every((w) => hay.includes(w))) {
        out.push(f);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  // ---- playlists (.m3u / .m3u8) ----

  async readText(rel: string): Promise<string> {
    const r = await this.backend.reader(rel);
    try {
      return decodeText(await r.read(0, Math.min(r.size, 4 * 1024 * 1024)));
    } finally {
      r.close();
    }
  }

  /**
   * Find the song a playlist line points to. `baseDir`: folder of the .m3u inside the library
   * (relative lines are resolved from there). Falls back to the longest matching tail of the path
   * — so playlists made on a computer ("D:/Music/Album/01 Song.flac") still find "Album/01 Song.flac".
   */
  matchLocation(location: string, baseDir = ''): LocalFile | undefined {
    const ps = locationParts(location);
    if (!ps.length) return undefined;
    const byPath = new Map<string, LocalFile>();
    for (const f of this.state.files) byPath.set(f.path.toLowerCase(), f);
    const abs = /^(\/|[a-z]:[\\/]|file:)/i.test(location.trim());
    if (!abs) {
      const rel = locationParts((baseDir ? baseDir + '/' : '') + location.trim()).join('/');
      const hit = byPath.get(rel.toLowerCase());
      if (hit) return hit;
    }
    const docs = ps.findIndex((p) => p === 'Documents');
    if (docs >= 0) {
      const hit = byPath.get(
        ps
          .slice(docs + 1)
          .join('/')
          .toLowerCase()
      );
      if (hit) return hit;
    }
    for (let k = Math.min(ps.length, 6); k >= 1; k--) {
      const tail = ps.slice(-k).join('/').toLowerCase();
      const hits = this.state.files.filter((f) => {
        const p = f.path.toLowerCase();
        return p === tail || p.endsWith('/' + tail);
      });
      if (hits.length) return hits[0];
    }
    // same song, other format/extension (e.g. the playlist says .mp3, the device has .m4a)
    const stem = stripExt(ps[ps.length - 1]).toLowerCase();
    return this.state.files.find((f) => stripExt(f.name).toLowerCase() === stem);
  }

  /**
   * Save a playlist as "Playlists/<name>.m3u8" inside the HolySic folder (visible in Files, and
   * readable by other players). Returns the file's path in the library.
   */
  async savePlaylistFile(name: string, tracks: Track[]): Promise<string> {
    const dir = 'Playlists';
    const fileName = (sanitizeName(name) || 'Playlist') + '.m3u8';
    const rel = join(dir, fileName);
    const text = buildM3U(
      name,
      tracks,
      (t) => (isLocalTrack(t) ? '../' + localPathOf(t) : undefined),
      taggedAlbumOf
    );
    this.backend.writeText(rel, text);
    await this.scan();
    return rel;
  }

  /** Native URI of a library file (for the share sheet). */
  fileUri(rel: string): string {
    return this.backend.uri(rel);
  }

  // ---- "Sửa thông tin" (edits) & online auto-fill ----

  getEdit(rel: string): LocalEdit | undefined {
    return this.edits[rel];
  }

  /** The song's own embedded cover (ignoring edits) */
  fileArtUri(rel: string): string | undefined {
    const a = this.metaCache[rel]?.art;
    return a ? this.backend.artUri(a) : undefined;
  }

  /** What the file itself says (tags / file name), to show under the edit fields */
  fileDetails(rel: string): {
    title: string;
    artist?: string;
    album?: string;
    year?: number;
    genre?: string;
    trackNo?: number;
  } {
    const m = this.metaCache[rel] || ({} as CachedMeta);
    const isMidi = MIDI_EXT.test(rel);
    const g = isMidi ? midiTitle(baseOf(rel)) : titleFromFileName(baseOf(rel));
    return {
      title: isMidi ? g.title : m.title || g.title,
      artist: m.artist || g.artist,
      album: m.album,
      year: m.year,
      genre: m.genre,
      trackNo: m.trackNo || g.trackNo,
    };
  }

  /**
   * Save the user's details for a song (replaces the previous edit). `cover`: a picked image /
   * downloaded cover URL to use, `null` to drop an edited cover, undefined to keep it. Fields left
   * out fall back to the file's own tags.
   */
  async saveEdit(rel: string, edit: LocalEdit, cover?: string | null): Promise<void> {
    const prev = this.edits[rel] || {};
    const next: LocalEdit = { lookedUpAt: prev.lookedUpAt, art: prev.art, ...edit };
    for (const k of Object.keys(next) as (keyof LocalEdit)[]) {
      const v = next[k];
      if (v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v)))
        delete next[k];
    }
    if (cover === null) {
      if (next.art) this.backend.removeArt?.(next.art);
      delete next.art;
    } else if (cover) {
      const name = `ed-${hash(rel + cover + Date.now())}.jpg`;
      let src = cover;
      if (!/^https?:/i.test(cover)) {
        // a photo from the library can be huge: keep ≤1000 px like the downloaded covers
        src = (await shrinkImage(cover, 1000).catch(() => undefined)) || cover;
      }
      await this.backend.saveArt(src, name);
      if (prev.art && prev.art !== name) this.backend.removeArt?.(prev.art);
      next.art = name;
    }
    if (Object.keys(next).length) this.edits[rel] = next;
    else delete this.edits[rel];
    this.saveEdits();
    await this.scan();
    this.emitRemap({ [LOCAL_ID_PREFIX + rel]: { id: LOCAL_ID_PREFIX + rel } as Track });
  }

  /** Back to exactly what the file's tags say */
  async resetEdit(rel: string): Promise<void> {
    const art = this.edits[rel]?.art;
    if (art) this.backend.removeArt?.(art);
    // remember it was looked at, so automatic fill doesn't put the details straight back
    this.edits[rel] = { lookedUpAt: Date.now() };
    this.saveEdits();
    await this.scan();
    this.emitRemap({ [LOCAL_ID_PREFIX + rel]: { id: LOCAL_ID_PREFIX + rel } as Track });
  }

  setAutoFetch(on: boolean) {
    this.set({ autoFetch: on });
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoFetch: on })).catch(() => undefined);
    if (on && !this.state.fetching) this.autoFill('', { onlyNew: true });
  }

  /** Songs that are missing something worth looking up */
  private needsLookup(f: LocalFile): boolean {
    const ed = this.edits[f.path] || {};
    const m = this.metaCache[f.path] || ({} as CachedMeta);
    const hasArt = !!(ed.art || m.art);
    const hasArtist = !!(ed.artist || m.artist);
    const hasAlbum = !!(ed.album || m.album);
    return !hasArt || !hasArtist || !hasAlbum;
  }

  /**
   * Find missing details & covers online for every song under `dir` (or the given paths).
   * Only fills what is missing, never overwrites the file's own tags or the user's edits, and only
   * applies confident matches. Returns how many songs were updated.
   */
  async autoFill(
    dir: string | string[],
    opts: { onlyNew?: boolean } = {}
  ): Promise<{ checked: number; matched: number }> {
    if (this.state.fetching) return { checked: 0, matched: 0 };
    const run = ++this.fetchRun;
    const prefix = typeof dir === 'string' && dir ? dir + '/' : '';
    const pool = Array.isArray(dir)
      ? this.state.files.filter((f) => dir.includes(f.path))
      : this.state.files.filter((f) => !prefix || f.path.startsWith(prefix));
    const todo = pool.filter(
      (f) => this.needsLookup(f) && !(opts.onlyNew && this.edits[f.path]?.lookedUpAt)
    );
    if (!todo.length) return { checked: 0, matched: 0 };
    let matched = 0;
    this.set({ fetching: { done: 0, total: todo.length, matched: 0 } });
    try {
      for (let i = 0; i < todo.length; i++) {
        if (run !== this.fetchRun) break;
        const f = todo[i];
        const details = this.fileDetails(f.path);
        let hit: MetaCandidate | null = null;
        try {
          hit = await bestMatch({
            title: details.title,
            artist: details.artist,
            album: details.album,
            durationSec: f.track.durationSec || undefined,
          });
        } catch {
          hit = null;
        }
        const ed: LocalEdit = { ...(this.edits[f.path] || {}), lookedUpAt: Date.now() };
        const m = this.metaCache[f.path] || ({} as CachedMeta);
        if (hit) {
          // fill only the gaps
          if (!m.title && !ed.title) ed.title = hit.title;
          if (!m.artist && !ed.artist) ed.artist = hit.artist;
          if (!m.album && !ed.album && hit.album) ed.album = hit.album;
          if (!m.year && !ed.year && hit.year) ed.year = hit.year;
          if (!m.genre && !ed.genre && hit.genre) ed.genre = hit.genre;
          if (!m.trackNo && !ed.trackNo && hit.trackNo) ed.trackNo = hit.trackNo;
          if (!m.art && !ed.art && hit.coverUrl) {
            const name = `af-${hash(f.path + hit.coverUrl)}.jpg`;
            try {
              await this.backend.saveArt(hit.coverUrl, name);
              ed.art = name;
            } catch {
              // cover download failed: keep the text details
            }
          }
          ed.fetchedFrom = hit.source;
          matched++;
        }
        this.edits[f.path] = ed;
        this.set({ fetching: { done: i + 1, total: todo.length, matched } });
      }
    } finally {
      this.saveEdits();
      this.set({ fetching: null });
    }
    if (matched) {
      await this.scan();
      const remap: Record<string, Track> = {};
      todo.forEach((f) => (remap[f.track.id] = { id: f.track.id } as Track));
      this.emitRemap(remap);
    }
    return { checked: todo.length, matched };
  }

  cancelAutoFill() {
    this.fetchRun++;
  }

  // ---- lyrics ----

  /**
   * Lyrics that come with a local song: a sidecar "Song.lrc" next to "Song.mp3" (synced or plain),
   * otherwise lyrics embedded in its tags. Null when there are none (→ online lyrics).
   */
  async lyricsFor(track: Track): Promise<{ text: string; from: 'lrc' | 'tags' } | null> {
    if (!isLocalTrack(track)) return null;
    let rel = localPathOf(track);
    if (!this.backend.exists(rel)) rel = this.byName.get(nameKey(baseOf(rel))) || rel;
    const lrc = this.lrcByBase.get(stripExt(rel).toLowerCase());
    if (lrc) {
      try {
        const r = await this.backend.reader(lrc);
        try {
          const text = decodeText(await r.read(0, Math.min(r.size, 512 * 1024))).trim();
          if (text) return { text, from: 'lrc' };
        } finally {
          r.close();
        }
      } catch {
        // unreadable sidecar → try the tags
      }
    }
    if (this.metaCache[rel]?.hasLyrics) {
      try {
        const r = await this.backend.reader(rel);
        try {
          const meta = await readTags(r, baseOf(rel));
          if (meta.lyrics) return { text: meta.lyrics, from: 'tags' };
        } finally {
          r.close();
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  // ---- folder covers ----

  /** Every cover-named image directly inside `dir` (cover.jpg, Folder.png, …). */
  private async coverFilesIn(dir: string): Promise<string[]> {
    const entries = await this.backend.list(dir);
    return entries.filter((e) => !e.isDir && COVER_NAME.test(e.name)).map((e) => join(dir, e.name));
  }

  /**
   * Make an image the folder's cover: saved as `cover.jpg` inside the folder (so it also shows in
   * other players / Finder), downscaled to ≤1000 px. Songs without embedded art use it too.
   */
  async setFolderCover(dir: string, imageUri: string, opts: { resize?: boolean } = {}) {
    if (!dir) throw new Error('root');
    let src = imageUri;
    let ext =
      /\.png($|\?)/i.test(imageUri) || imageUri.startsWith('data:image/png') ? 'png' : 'jpg';
    if (opts.resize !== false) {
      try {
        const out = await shrinkImage(imageUri, 1000);
        if (out) {
          src = out;
          ext = 'jpg';
        }
      } catch {
        // keep the original image
      }
    }
    for (const rel of await this.coverFilesIn(dir)) {
      try {
        this.backend.remove(rel, false);
      } catch {
        // ignore
      }
    }
    await this.backend.writeFromUri(src, join(dir, `cover.${ext}`));
    await this.scan();
  }

  async removeFolderCover(dir: string): Promise<number> {
    const covers = await this.coverFilesIn(dir);
    for (const rel of covers) this.backend.remove(rel, false);
    await this.scan();
    return covers.length;
  }

  /** Distinct embedded covers of the songs in a folder's subtree (to reuse one as the folder cover). */
  embeddedCoversIn(dir: string, max = 24): { uri: string; title: string }[] {
    const seen = new Set<string>();
    const out: { uri: string; title: string }[] = [];
    const prefix = dir ? dir + '/' : '';
    for (const f of this.state.files) {
      if (prefix && !f.path.startsWith(prefix)) continue;
      const art = this.metaCache[f.path]?.art;
      const uri = art ? this.backend.artUri(art) : undefined;
      if (!uri || seen.has(art!)) continue;
      seen.add(art!);
      out.push({ uri, title: f.track.album || f.track.title });
      if (out.length >= max) break;
    }
    return out;
  }

  private applyRenames(pairs: [string, string][], remap: Record<string, Track>) {
    let editsMoved = false;
    for (const [from, to] of pairs) {
      for (const k of Object.keys(this.edits)) {
        if (k === from || k.startsWith(from + '/')) {
          this.edits[to + k.slice(from.length)] = this.edits[k];
          delete this.edits[k];
          editsMoved = true;
        }
      }
      for (const k of Object.keys(this.metaCache)) {
        if (k === from || k.startsWith(from + '/')) {
          const nk = to + k.slice(from.length);
          this.metaCache[nk] = this.metaCache[k];
          delete this.metaCache[k];
          remap[LOCAL_ID_PREFIX + k] = { id: LOCAL_ID_PREFIX + nk } as Track;
        }
      }
    }
    if (editsMoved) this.saveEdits();
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
/** the cover a playlist shows: its own (kept or a link), else its first song's */
export const playlistCoverOf = (pl?: { coverUrl?: string; tracks: Track[] }): string =>
  (pl && (LocalLibrary.resolveImageRef(pl.coverUrl) || pl.tracks[0]?.artworkUrl)) || '';
export const isLocalTrack = (t?: Track | null) => !!t && t.id.startsWith(LOCAL_ID_PREFIX);
export const localPathOf = (t: Track) => t.id.slice(LOCAL_ID_PREFIX.length);
export const localDirOf = (t: Track) => dirOf(localPathOf(t));

/**
 * The album as tagged / edited — never the folder name the library shows as a stand-in.
 * Streamed songs return their own album.
 */
export function taggedAlbumOf(t: Track): string | undefined {
  if (!isLocalTrack(t)) return t.album || undefined;
  const rel = localPathOf(t);
  const f = LocalLibrary.getState().files.find((x) => x.path === rel);
  return LocalLibrary.getEdit(rel)?.album || f?.meta.album || undefined;
}
