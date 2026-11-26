// Export / import of playlist files (.m3u8) — glue between the M3U format, Local Files and search.

import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { Track } from '../../types/music';
import { isLocalTrack, LocalLibrary, localPathOf, taggedAlbumOf } from '../local/localLibrary';
import { buildM3U, isRemoteLocation, M3UEntry, M3UPlaylist } from './m3u';

/**
 * Save the songs as "Playlists/<name>.m3u8" in the HolySic folder (Files app → HolySic →
 * Playlists) and open the share sheet so it can also go to another app / AirDrop / iCloud Drive.
 * Web: downloads the file. Returns the saved path (library-relative) or undefined.
 */
export async function exportPlaylistM3U(
  name: string,
  tracks: Track[]
): Promise<string | undefined> {
  if (Platform.OS === 'web') {
    const text = buildM3U(
      name,
      tracks,
      (t) => (isLocalTrack(t) ? localPathOf(t) : undefined),
      taggedAlbumOf
    );
    const blob = new Blob([text], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Playlist'}.m3u8`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return LocalLibrary.savePlaylistFile(name, tracks).catch(() => undefined);
  }
  const rel = await LocalLibrary.savePlaylistFile(name, tracks);
  try {
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(LocalLibrary.fileUri(rel), {
        UTI: 'public.m3u-playlist',
        mimeType: 'audio/x-mpegurl',
        dialogTitle: name,
      });
  } catch {
    // the file is saved either way
  }
  return rel;
}

export type ResolvedHow = 'local' | 'holysic' | 'search' | 'none';
export interface ResolvedEntry {
  entry: M3UEntry;
  options: Track[];
  how: ResolvedHow;
}

/**
 * Turn playlist lines into songs: device files first (by path), then HolySic's own saved details,
 * then a search for "Artist - Title". `baseDir`: the playlist's folder inside the library.
 */
export async function resolveM3U(
  pl: M3UPlaylist,
  baseDir: string | undefined,
  search: (q: string) => Promise<Track[]>,
  onProgress?: (done: number, total: number) => void
): Promise<ResolvedEntry[]> {
  const out: ResolvedEntry[] = pl.entries.map((entry) => ({ entry, options: [], how: 'none' }));
  const toSearch: number[] = [];
  out.forEach((r, i) => {
    const e = r.entry;
    if (e.track && !isLocalTrack(e.track)) {
      r.options = [e.track];
      r.how = 'holysic';
      return;
    }
    if (!isRemoteLocation(e.location)) {
      const lf = LocalLibrary.matchLocation(e.location, baseDir || '');
      if (lf) {
        r.options = [lf.track];
        r.how = 'local';
        return;
      }
    }
    toSearch.push(i);
  });
  let done = out.length - toSearch.length;
  onProgress?.(done, out.length);
  let next = 0;
  const worker = async () => {
    while (next < toSearch.length) {
      const i = toSearch[next++];
      const e = out[i].entry;
      const q = `${e.artist ? e.artist + ' ' : ''}${e.title || ''}`.trim();
      if (q.length >= 2) {
        // a song that is on the device under another name/folder
        const local = LocalLibrary.search(q, 1)[0];
        try {
          const found = await search(q);
          out[i].options = [...(local ? [local.track] : []), ...found.slice(0, 6)];
        } catch {
          out[i].options = local ? [local.track] : [];
        }
        out[i].how = out[i].options.length ? (local ? 'local' : 'search') : 'none';
      }
      done++;
      onProgress?.(done, out.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, toSearch.length) }, worker));
  return out;
}
