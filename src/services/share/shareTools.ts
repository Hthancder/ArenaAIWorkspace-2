// Share a song (OpenSpot) and save a downloaded song to the Files app with a readable
// "Artist - Title" name (Spotube-style named downloads; iOS keeps the audio untouched).

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { DownloadedTrackMeta, Track } from '../../types/music';

export function trackShareUrl(track: Track): string {
  const vid = track.videoId || (track.source === 'innertube' ? track.id : '');
  if (vid && /^[\w-]{11}$/.test(vid)) return `https://music.youtube.com/watch?v=${vid}`;
  return `https://music.youtube.com/search?q=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
}

export async function shareTrack(track: Track): Promise<void> {
  const url = trackShareUrl(track);
  const message = `${track.title} — ${track.artist}`;
  if (Platform.OS === 'web') {
    const nav = (globalThis as any).navigator;
    if (nav?.share) {
      await nav.share({ title: message, text: message, url }).catch(() => undefined);
      return;
    }
    await nav?.clipboard?.writeText(`${message}\n${url}`).catch(() => undefined);
    return;
  }
  // iOS shows the URL as a rich link when passed separately
  await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` });
}

function safeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function extFor(meta: DownloadedTrackMeta): string {
  const m = meta.localUri.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (m) return m[1].toLowerCase();
  const q = meta.qualityLabel.toLowerCase();
  return q.includes('flac') ? 'flac' : 'm4a';
}

/** Returns false when there is nothing to export (web blob downloads, missing files). */
export async function exportDownloadToFiles(meta: DownloadedTrackMeta): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const src = new File(meta.localUri);
  if (!src.exists) return false;
  const name = `${safeName(meta.track.artist)} - ${safeName(meta.track.title)}.${extFor(meta)}`;
  const out = new File(Paths.cache, name);
  if (out.exists) out.delete();
  src.copy(out);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(out.uri, { dialogTitle: name });
  return true;
}
