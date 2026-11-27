// Library tools:
//   • Backup / restore to a file with merge-or-replace and a preview before applying (Musike)
//   • Import songs from the iOS Files app and play them offline (Cog's "play files in place")
//   • Blacklist for artists & songs (Spotube's blacklist module)

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { extForMime, MIDI_EXT, PLAYABLE_EXT, UNPLAYABLE_EXT } from '../audio/formatSniff';
import { HolySicPreferences } from '../../constants/preferences';
import {
  AudioLabSettings,
  DownloadedTrackMeta,
  ListeningEvent,
  Playlist,
  Track,
} from '../../types/music';

export const BACKUP_FORMAT = 'holysic-backup';
/** Backups exported before the app was renamed still import */
const ACCEPTED_FORMATS = [BACKUP_FORMAT, 'mochy-music-backup'];

export interface LibraryBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  app: string;
  likedTracks: Track[];
  playlists: Playlist[];
  history: ListeningEvent[];
  searchHistory: string[];
  prefs?: Partial<HolySicPreferences>;
  audioLab?: AudioLabSettings;
}

export interface BackupPreview {
  likedTracks: number;
  playlists: number;
  playlistTracks: number;
  history: number;
  searchHistory: number;
  hasSettings: boolean;
  exportedAt: string;
  newLiked: number;
  newPlaylists: number;
}

export function buildBackup(
  data: Omit<LibraryBackup, 'format' | 'version' | 'exportedAt' | 'app'>
): LibraryBackup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'HolySic iOS',
    ...data,
  };
}

const isTrack = (t: any): t is Track =>
  t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.artist === 'string';

export function parseBackup(text: string): LibraryBackup {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON hợp lệ');
  }
  if (!ACCEPTED_FORMATS.includes(j?.format)) throw new Error('Không phải file sao lưu HolySic');
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: String(j.exportedAt || ''),
    app: String(j.app || ''),
    likedTracks: Array.isArray(j.likedTracks) ? j.likedTracks.filter(isTrack) : [],
    playlists: Array.isArray(j.playlists)
      ? j.playlists
          .filter((p: any) => p && typeof p.id === 'string' && typeof p.name === 'string')
          .map((p: any) => {
            const tracks = Array.isArray(p.tracks) ? p.tracks.filter(isTrack) : [];
            return { ...p, tracks, trackIds: tracks.map((t: Track) => t.id) };
          })
      : [],
    history: Array.isArray(j.history) ? j.history.filter((h: any) => h && isTrack(h.track)) : [],
    searchHistory: Array.isArray(j.searchHistory)
      ? j.searchHistory.filter((s: any) => typeof s === 'string')
      : [],
    prefs: j.prefs && typeof j.prefs === 'object' ? j.prefs : undefined,
    audioLab: j.audioLab && typeof j.audioLab === 'object' ? j.audioLab : undefined,
  };
}

export function previewBackup(
  b: LibraryBackup,
  current: { likedTracks: Track[]; playlists: Playlist[] }
): BackupPreview {
  const liked = new Set(current.likedTracks.map((t) => t.id));
  const pls = new Set(current.playlists.map((p) => p.id));
  return {
    likedTracks: b.likedTracks.length,
    playlists: b.playlists.length,
    playlistTracks: b.playlists.reduce((n, p) => n + p.tracks.length, 0),
    history: b.history.length,
    searchHistory: b.searchHistory.length,
    hasSettings: !!b.prefs,
    exportedAt: b.exportedAt,
    newLiked: b.likedTracks.filter((t) => !liked.has(t.id)).length,
    newPlaylists: b.playlists.filter((p) => !pls.has(p.id)).length,
  };
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge keeps everything from both sides; same playlist id → union of their songs */
export function mergeLibrary(
  current: {
    likedTracks: Track[];
    playlists: Playlist[];
    history: ListeningEvent[];
    searchHistory: string[];
  },
  incoming: LibraryBackup,
  mode: 'merge' | 'replace'
) {
  if (mode === 'replace') {
    return {
      likedTracks: incoming.likedTracks,
      playlists: incoming.playlists,
      history: incoming.history.slice(0, 600),
      searchHistory: incoming.searchHistory.slice(0, 15),
    };
  }
  const byId = new Map(current.playlists.map((p) => [p.id, p]));
  for (const p of incoming.playlists) {
    const mine = byId.get(p.id);
    if (!mine) {
      byId.set(p.id, p);
    } else {
      const tracks = uniqueBy([...mine.tracks, ...p.tracks], (t) => t.id);
      byId.set(p.id, { ...mine, tracks, trackIds: tracks.map((t) => t.id), updatedAt: Date.now() });
    }
  }
  return {
    likedTracks: uniqueBy([...current.likedTracks, ...incoming.likedTracks], (t) => t.id),
    playlists: Array.from(byId.values()),
    history: uniqueBy(
      [...current.history, ...incoming.history],
      (h) => `${h.track.id}-${h.playedAt}`
    )
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, 600),
    searchHistory: uniqueBy([...current.searchHistory, ...incoming.searchHistory], (s) =>
      s.toLowerCase()
    ).slice(0, 15),
  };
}

/** Writes the backup to a file and opens the share sheet (Save to Files, AirDrop…); web downloads it */
export async function exportBackupFile(backup: LibraryBackup): Promise<string> {
  const json = JSON.stringify(backup, null, 1);
  const name = `holysic-backup-${backup.exportedAt.slice(0, 10)}.json`;
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return name;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: name,
    });
  }
  return name;
}

export async function pickBackupFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  if (Platform.OS === 'web') {
    if (asset.file) return await asset.file.text();
    return await (await fetch(asset.uri)).text();
  }
  return await new File(asset.uri).text();
}

// ---------- Files app import (Cog) ----------

const AUDIO_EXT = PLAYABLE_EXT;
export const LOCAL_DIR = 'holysic-local';

function titleFromFileName(name: string): { title: string; artist: string } {
  // MIDI songs keep their file name as the title
  if (MIDI_EXT.test(name))
    return { title: name.replace(/\.[^.]+$/, '').trim() || name, artist: 'MIDI' };
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/^\d{1,3}[\s.\-]+/, '')
    .trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m
    ? { artist: m[1].trim(), title: m[2].trim() }
    : { artist: 'Tệp trên máy', title: base || name };
}

/**
 * Lets the user pick audio files from Files / iCloud Drive, copies them into the app's Documents
 * folder (so they survive), and returns offline entries that play like downloads.
 */
export async function importLocalAudioFiles(): Promise<DownloadedTrackMeta[]> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['audio/*', 'public.audio'],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (res.canceled || !res.assets?.length) return [];
  const out: DownloadedTrackMeta[] = [];
  let dir: Directory | null = null;
  if (Platform.OS !== 'web') {
    dir = new Directory(Paths.document, LOCAL_DIR);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  }
  for (const a of res.assets) {
    const mimeExt = extForMime(a.mimeType);
    const playable =
      AUDIO_EXT.test(a.name) ||
      (!UNPLAYABLE_EXT.test(a.name) && !!mimeExt && AUDIO_EXT.test(`.${mimeExt}`));
    if (!playable) continue;
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let uri = a.uri;
    if (dir) {
      const ext = AUDIO_EXT.test(a.name)
        ? a.name.slice(a.name.lastIndexOf('.')).toLowerCase()
        : `.${mimeExt || 'm4a'}`;
      const target = new File(dir, `${id}${ext}`);
      new File(a.uri).copy(target);
      uri = target.uri;
    }
    const { title, artist } = titleFromFileName(a.name);
    const ext = (a.name.match(/\.([^.]+)$/) || [, 'audio'])[1]!.toUpperCase();
    out.push({
      track: {
        id,
        title,
        artist,
        artists: [artist],
        artworkUrl: '',
        durationSec: 0,
        source: 'local',
        qualityBadge: `${ext} · Files`,
      },
      localUri: uri,
      sizeBytes: a.size || 0,
      downloadedAt: Date.now(),
      qualityLabel: `${ext} · Tệp trên máy`,
    });
  }
  return out;
}

/**
 * iOS moves the app container (new UUID) on every reinstall/update of the IPA, which breaks
 * absolute file:// paths saved earlier. Re-point them at the current Documents folder.
 */
export function rebaseDocumentUri(uri: string): string {
  if (Platform.OS === 'web' || !uri.startsWith('file://')) return uri;
  const m = uri.match(/\/Documents\/(.+)$/);
  if (!m) return uri;
  const docs = Paths.document.uri.replace(/\/?$/, '/');
  return docs + m[1];
}

// ---------- Blacklist (Spotube) ----------

export interface Blacklist {
  artists: string[];
  tracks: { id: string; title: string; artist: string }[];
}

export const EMPTY_BLACKLIST: Blacklist = { artists: [], tracks: [] };

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
const normKey = (t: { title: string; artist: string }) =>
  `${normName(t.title).replace(/\s*[([].*$/, '')}|${normName(t.artist.split(/,|&| x | feat/i)[0] || '')}`;

export function isBlacklisted(track: Track, bl: Blacklist | undefined): boolean {
  if (!bl || (bl.artists.length === 0 && bl.tracks.length === 0)) return false;
  if (bl.tracks.some((b) => b.id === track.id)) return true;
  const key = normKey(track);
  if (bl.tracks.some((b) => normKey(b) === key)) return true;
  const names = [track.artist, ...(track.artists || [])]
    .join(',')
    .split(/,|&| x | feat\.?|ft\./i)
    .map(normName);
  const blocked = bl.artists.map(normName);
  return names.some((n) => n && blocked.includes(n));
}

export function filterBlacklisted<T extends Track>(tracks: T[], bl: Blacklist | undefined): T[] {
  if (!bl || (bl.artists.length === 0 && bl.tracks.length === 0)) return tracks;
  return tracks.filter((t) => !isBlacklisted(t, bl));
}
