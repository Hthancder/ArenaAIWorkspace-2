// Tags: the user's own labels for songs and playlists ("Chill", "Gym", "Nhạc buồn"…).
//
//  • one registry: a tag has an id, a name and a colour — renaming or recolouring it changes it
//    everywhere at once, deleting it removes it from every song and playlist (with undo)
//  • songs are tagged by id and keep a small copy of the song, so a tag page can list and play
//    them even when they are in no playlist (and offline)
//  • playlists are tagged by id; deleting a playlist forgets its tags
//  • follows on-device renames / moves (LocalLibrary remaps) and goes into the library backup
//
// Outside React context on purpose: rows subscribe to just their own song's tags.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Track } from '../../types/music';

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

interface TaggedSong {
  track: Track;
  ids: string[];
  /** when it was first tagged (tag pages list newest first) */
  at: number;
}

export interface TagData {
  v: 1;
  tags: Tag[];
  songs: Record<string, TaggedSong>;
  playlists: Record<string, string[]>;
}

/** what a deleted tag looked like — handed back to restore() for undo */
export interface TagUndo {
  tag: Tag;
  index: number;
  songs: [string, TaggedSong][];
  playlists: [string, string[]][];
}

const KEY = '@holysic/tags_v1';
export const TAG_NAME_MAX = 24;
/** iOS system colours: readable on dark and light */
export const TAG_COLORS = [
  '#FF453A',
  '#FF9F0A',
  '#FFD60A',
  '#30D158',
  '#00C7BE',
  '#64D2FF',
  '#0A84FF',
  '#5E5CE6',
  '#BF5AF2',
  '#FF375F',
  '#AC8E68',
  '#8E8E93',
];

const EMPTY: TagData = { v: 1, tags: [], songs: {}, playlists: {} };
let data: TagData = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
let version = 0;
const subs = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** case, accents and spacing don't make two tags different ("Nhạc buồn" = "nhac buon") */
export function normTag(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** a name as the user typed it, tidied: no leading #, single spaces, length-capped */
export function cleanTagName(s: string): string {
  return s.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, TAG_NAME_MAX);
}

/** the parts of a song worth keeping for a tag page (no stream URLs, they expire) */
function slim(t: Track): Track {
  const { streamUrl: _s, ...rest } = t;
  return rest;
}

function commit(next: TagData) {
  data = next;
  version++;
  subs.forEach((f) => f());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
  }, 250);
}

function sanitize(raw: any): TagData {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const tags: Tag[] = (Array.isArray(raw.tags) ? raw.tags : [])
    .filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string')
    .map((t: any) => ({
      id: t.id,
      name: cleanTagName(t.name) || 'Tag',
      color: typeof t.color === 'string' ? t.color : TAG_COLORS[0],
      createdAt: Number(t.createdAt) || Date.now(),
    }));
  const known = new Set(tags.map((t) => t.id));
  const songs: Record<string, TaggedSong> = {};
  for (const [id, s] of Object.entries<any>(raw.songs || {})) {
    if (!s || !s.track || typeof s.track.id !== 'string') continue;
    const ids = (Array.isArray(s.ids) ? s.ids : []).filter((x: any) => known.has(x));
    if (ids.length) songs[id] = { track: s.track, ids, at: Number(s.at) || Date.now() };
  }
  const playlists: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries<any>(raw.playlists || {})) {
    const ok = (Array.isArray(ids) ? ids : []).filter((x: any) => known.has(x));
    if (ok.length) playlists[id] = ok;
  }
  return { v: 1, tags, songs, playlists };
}

const newId = () => `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const TagStore = {
  /** load once (safe to call many times) */
  ready(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loading)
      loading = AsyncStorage.getItem(KEY)
        .then((s) => {
          // something tagged before the load finished wins over an empty start
          const fromDisk = sanitize(s ? JSON.parse(s) : null);
          if (data === EMPTY) {
            data = fromDisk;
            version++;
          }
        })
        .catch(() => {})
        .finally(() => {
          loaded = true;
          subs.forEach((f) => f());
        });
    return loading;
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  get: () => data,
  version: () => version,

  // ── the registry ──
  list: (): Tag[] => data.tags,
  byId: (id: string): Tag | undefined => data.tags.find((t) => t.id === id),
  findByName(name: string): Tag | undefined {
    const n = normTag(name);
    return n ? data.tags.find((t) => normTag(t.name) === n) : undefined;
  },
  /** tags whose name contains the query (accent-insensitive), best matches first */
  search(q: string): Tag[] {
    const n = normTag(q);
    if (!n) return [];
    return data.tags
      .map((t) => ({ t, n: normTag(t.name) }))
      .filter((x) => x.n.includes(n))
      .sort(
        (a, b) => Number(b.n.startsWith(n)) - Number(a.n.startsWith(n)) || a.n.length - b.n.length
      )
      .map((x) => x.t);
  },
  nextColor(): string {
    const used = new Map<string, number>();
    data.tags.forEach((t) => used.set(t.color, (used.get(t.color) || 0) + 1));
    return [...TAG_COLORS].sort((a, b) => (used.get(a) || 0) - (used.get(b) || 0))[0];
  },
  /** create a tag (or return the existing one with the same name) */
  create(name: string, color?: string): Tag | null {
    const clean = cleanTagName(name);
    if (!clean) return null;
    const existing = TagStore.findByName(clean);
    if (existing) return existing;
    const tag: Tag = {
      id: newId(),
      name: clean,
      color: color || TagStore.nextColor(),
      createdAt: Date.now(),
    };
    commit({ ...data, tags: [...data.tags, tag] });
    return tag;
  },
  /**
   * Rename. If another tag already has that name the two become one (its songs and playlists
   * move over) — returns the id that remains.
   */
  rename(id: string, name: string): string | null {
    const clean = cleanTagName(name);
    const tag = TagStore.byId(id);
    if (!clean || !tag) return null;
    const other = TagStore.findByName(clean);
    if (other && other.id !== id) {
      TagStore.merge(id, other.id);
      return other.id;
    }
    commit({ ...data, tags: data.tags.map((t) => (t.id === id ? { ...t, name: clean } : t)) });
    return id;
  },
  recolor(id: string, color: string) {
    commit({ ...data, tags: data.tags.map((t) => (t.id === id ? { ...t, color } : t)) });
  },
  /** move a tag one place up / down in the list (the order chips and the Library show) */
  move(id: string, by: -1 | 1) {
    const i = data.tags.findIndex((t) => t.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= data.tags.length) return;
    const tags = [...data.tags];
    [tags[i], tags[j]] = [tags[j], tags[i]];
    commit({ ...data, tags });
  },
  /** fold `fromId` into `intoId` */
  merge(fromId: string, intoId: string) {
    if (fromId === intoId) return;
    const swap = (ids: string[]) => {
      const out = ids.map((x) => (x === fromId ? intoId : x));
      return out.filter((x, i) => out.indexOf(x) === i);
    };
    const songs: Record<string, TaggedSong> = {};
    for (const [k, s] of Object.entries(data.songs)) songs[k] = { ...s, ids: swap(s.ids) };
    const playlists: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(data.playlists)) playlists[k] = swap(ids);
    commit({ v: 1, tags: data.tags.filter((t) => t.id !== fromId), songs, playlists });
  },
  /** delete a tag everywhere; returns what restore() needs to undo it */
  remove(id: string): TagUndo | null {
    const index = data.tags.findIndex((t) => t.id === id);
    if (index < 0) return null;
    const undo: TagUndo = { tag: data.tags[index], index, songs: [], playlists: [] };
    const songs: Record<string, TaggedSong> = {};
    for (const [k, s] of Object.entries(data.songs)) {
      if (s.ids.includes(id)) undo.songs.push([k, s]);
      const ids = s.ids.filter((x) => x !== id);
      if (ids.length) songs[k] = { ...s, ids };
    }
    const playlists: Record<string, string[]> = {};
    for (const [k, ids] of Object.entries(data.playlists)) {
      if (ids.includes(id)) undo.playlists.push([k, ids]);
      const rest = ids.filter((x) => x !== id);
      if (rest.length) playlists[k] = rest;
    }
    commit({ v: 1, tags: data.tags.filter((t) => t.id !== id), songs, playlists });
    return undo;
  },
  restore(u: TagUndo) {
    if (TagStore.byId(u.tag.id)) return;
    const tags = [...data.tags];
    tags.splice(Math.min(u.index, tags.length), 0, u.tag);
    const songs = { ...data.songs };
    for (const [k, s] of u.songs) {
      const cur = songs[k];
      songs[k] = cur ? { ...cur, ids: Array.from(new Set([...cur.ids, u.tag.id])) } : s;
    }
    const playlists = { ...data.playlists };
    for (const [k, ids] of u.playlists)
      playlists[k] = Array.from(new Set([...(playlists[k] || []), ...ids]));
    commit({ v: 1, tags, songs, playlists });
  },

  // ── songs ──
  idsOfTrack: (trackId: string): string[] => data.songs[trackId]?.ids || [],
  tagsOfTrack(trackId: string): Tag[] {
    const ids = data.songs[trackId]?.ids;
    if (!ids) return [];
    return data.tags.filter((t) => ids.includes(t.id));
  },
  /** set exactly these tags on one song */
  setTrackTags(track: Track, ids: string[]) {
    const songs = { ...data.songs };
    const known = ids.filter((x) => TagStore.byId(x));
    if (!known.length) delete songs[track.id];
    else
      songs[track.id] = { track: slim(track), ids: known, at: songs[track.id]?.at || Date.now() };
    commit({ ...data, songs });
  },
  /** add (on) or take off (off) one tag on many songs at once */
  applyToTracks(tracks: Track[], tagId: string, on: boolean) {
    if (!TagStore.byId(tagId)) return;
    const songs = { ...data.songs };
    const now = Date.now();
    tracks.forEach((t, i) => {
      const cur = songs[t.id];
      const ids = cur?.ids || [];
      if (on) {
        if (ids.includes(tagId)) return;
        songs[t.id] = { track: slim(t), ids: [...ids, tagId], at: cur?.at || now - i };
      } else if (cur) {
        const rest = ids.filter((x) => x !== tagId);
        if (rest.length) songs[t.id] = { ...cur, ids: rest };
        else delete songs[t.id];
      }
    });
    commit({ ...data, songs });
  },
  /** songs carrying a tag, newest tagged first */
  tracksWith(tagId: string): Track[] {
    return Object.values(data.songs)
      .filter((s) => s.ids.includes(tagId))
      .sort((a, b) => b.at - a.at)
      .map((s) => s.track);
  },
  /** songs carrying any of these tags (search) */
  tracksWithAny(tagIds: string[]): Track[] {
    return Object.values(data.songs)
      .filter((s) => s.ids.some((x) => tagIds.includes(x)))
      .sort((a, b) => b.at - a.at)
      .map((s) => s.track);
  },
  /** keep the stored copy of a tagged song up to date (edited title, new cover…) */
  refreshTrack(track: Track) {
    const cur = data.songs[track.id];
    if (!cur) return;
    const next = slim(track);
    if (JSON.stringify(next) === JSON.stringify(cur.track)) return;
    commit({ ...data, songs: { ...data.songs, [track.id]: { ...cur, track: next } } });
  },
  /** many at once (after a rescan of on-device music): one save, only songs that changed */
  refreshTracks(tracks: Track[]) {
    let songs: TagData['songs'] | null = null;
    for (const t of tracks) {
      const cur = data.songs[t.id];
      if (!cur) continue;
      const next = slim(t);
      if (JSON.stringify(next) === JSON.stringify(cur.track)) continue;
      if (!songs) songs = { ...data.songs };
      songs[t.id] = { ...cur, track: next };
    }
    if (songs) commit({ ...data, songs });
  },
  /** on-device moves / renames change song ids: tags follow (old id → new song) */
  remap(map: Record<string, Track>) {
    const hit = Object.keys(map).filter((k) => data.songs[k]);
    if (!hit.length) return;
    const songs = { ...data.songs };
    for (const oldId of hit) {
      const s = songs[oldId];
      const t = map[oldId];
      delete songs[oldId];
      const prev = songs[t.id];
      songs[t.id] = {
        track: slim(t),
        ids: Array.from(new Set([...(prev?.ids || []), ...s.ids])),
        at: Math.min(prev?.at || s.at, s.at),
      };
    }
    commit({ ...data, songs });
  },

  // ── playlists ──
  idsOfPlaylist: (plId: string): string[] => data.playlists[plId] || [],
  tagsOfPlaylist(plId: string): Tag[] {
    const ids = data.playlists[plId];
    if (!ids) return [];
    return data.tags.filter((t) => ids.includes(t.id));
  },
  setPlaylistTags(plId: string, ids: string[]) {
    const playlists = { ...data.playlists };
    const known = ids.filter((x) => TagStore.byId(x));
    if (known.length) playlists[plId] = known;
    else delete playlists[plId];
    commit({ ...data, playlists });
  },
  playlistsWith(tagId: string): string[] {
    return Object.entries(data.playlists)
      .filter(([, ids]) => ids.includes(tagId))
      .map(([id]) => id);
  },
  forgetPlaylist(plId: string) {
    if (!data.playlists[plId]) return;
    const playlists = { ...data.playlists };
    delete playlists[plId];
    commit({ ...data, playlists });
  },

  /** how many songs / playlists carry each tag */
  counts(): Record<string, { songs: number; playlists: number }> {
    const out: Record<string, { songs: number; playlists: number }> = {};
    data.tags.forEach((t) => (out[t.id] = { songs: 0, playlists: 0 }));
    Object.values(data.songs).forEach((s) => s.ids.forEach((x) => out[x] && out[x].songs++));
    Object.values(data.playlists).forEach((ids) =>
      ids.forEach((x) => out[x] && out[x].playlists++)
    );
    return out;
  },

  // ── backup ──
  exportData: (): TagData => data,
  /** bring tags in from a backup: replace, or merge (same names become one tag) */
  importData(raw: unknown, mode: 'merge' | 'replace') {
    const inc = sanitize(raw);
    if (mode === 'replace') {
      commit(inc);
      return;
    }
    const idMap = new Map<string, string>();
    const tags = [...data.tags];
    for (const t of inc.tags) {
      const same =
        tags.find((x) => x.id === t.id) || tags.find((x) => normTag(x.name) === normTag(t.name));
      if (same) idMap.set(t.id, same.id);
      else {
        tags.push(t);
        idMap.set(t.id, t.id);
      }
    }
    const map = (ids: string[]) => Array.from(new Set(ids.map((x) => idMap.get(x) || x)));
    const songs = { ...data.songs };
    for (const [k, s] of Object.entries(inc.songs)) {
      const cur = songs[k];
      songs[k] = cur
        ? { ...cur, ids: Array.from(new Set([...cur.ids, ...map(s.ids)])) }
        : { ...s, ids: map(s.ids) };
    }
    const playlists = { ...data.playlists };
    for (const [k, ids] of Object.entries(inc.playlists))
      playlists[k] = Array.from(new Set([...(playlists[k] || []), ...map(ids)]));
    commit({ v: 1, tags, songs, playlists });
  },
  count: () => data.tags.length,
};

// ── hooks ──

/** re-renders on any tag change; returns the store's version (read with TagStore.*) */
export function useTags(): number {
  return useSyncExternalStore(TagStore.subscribe, TagStore.version, TagStore.version);
}

/** the colours of one song's tags, joined ("#FF453A,#30D158") — a stable string for rows */
export function useTrackTagColors(trackId: string): string {
  const get = () => {
    const ids = data.songs[trackId]?.ids;
    if (!ids) return '';
    return data.tags
      .filter((t) => ids.includes(t.id))
      .map((t) => t.color)
      .join(',');
  };
  return useSyncExternalStore(TagStore.subscribe, get, get);
}
