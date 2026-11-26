// M3U / M3U8 playlists — import and export.
//
// Export writes a standard extended M3U (UTF-8) that other players understand: songs on the device
// as paths relative to the playlist file, streamed songs as a web link. Each streamed song also
// carries an `#EXTHOLYSIC:` comment with the song's HolySic details, so re-importing it into
// HolySic restores the exact same source (other players simply ignore the line).
//
// Import accepts .m3u/.m3u8 from anywhere (HolySic, VLC, foobar2000, Winamp, iTunes, Poweramp…):
// paths are matched to songs on the device (exact, then by folder/file name), the rest is
// searched by "Artist - Title".

import { Track } from '../../types/music';
import { trackShareUrl } from '../share/shareTools';

export interface M3UEntry {
  /** the location line as written (path or URL) */
  location: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  /** HolySic's own details for the song (from #EXTHOLYSIC) */
  track?: Track;
}

export interface M3UPlaylist {
  name?: string;
  entries: M3UEntry[];
}

const LOCAL_PREFIX = 'lf:';

/** Keep the details needed to play/show the song again; drop runtime-only and bulky fields. */
function compactTrack(t: Track): Partial<Track> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'streamUrl' || k === 'lyrics' || k === 'localUri') continue;
    if (typeof v === 'string' && v.startsWith('blob:')) continue;
    out[k] = v;
  }
  return out as Partial<Track>;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/**
 * Build the playlist text.
 * `localPathFor(track)`: location for a song on the device, relative to where the .m3u8 is saved
 * (or undefined when it isn't a local song).
 */
export function buildM3U(
  name: string,
  tracks: Track[],
  localPathFor: (t: Track) => string | undefined
): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${oneLine(name)}`, '#EXTENC:UTF-8'];
  for (const t of tracks) {
    const dur = Math.round(t.durationSec || 0) || -1;
    lines.push(`#EXTINF:${dur},${oneLine(t.artist || '')} - ${oneLine(t.title || '')}`);
    if (t.album) lines.push(`#EXTALB:${oneLine(t.album)}`);
    if (t.artworkUrl && /^https?:/i.test(t.artworkUrl)) lines.push(`#EXTIMG:${t.artworkUrl}`);
    const local = localPathFor(t);
    if (local) {
      lines.push(local);
    } else {
      lines.push(`#EXTHOLYSIC:${JSON.stringify(compactTrack(t))}`);
      lines.push(trackShareUrl(t));
    }
  }
  return lines.join('\n') + '\n';
}

/** "Artist - Title" (the usual EXTINF form); a bare title when there is no separator. */
function splitDisplay(s: string): { artist?: string; title: string } {
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: s.trim() };
}

const fileTitle = (loc: string) => {
  const base = decodeLoc(loc).replace(/[?#].*$/, '');
  return base
    .slice(Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')) + 1)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/_/g, ' ')
    .trim();
};

function decodeLoc(loc: string): string {
  try {
    return /%[0-9a-f]{2}/i.test(loc) ? decodeURIComponent(loc) : loc;
  } catch {
    return loc;
  }
}

export function parseM3U(text: string): M3UPlaylist {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out: M3UPlaylist = { entries: [] };
  let pending: Partial<M3UEntry> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/^#([A-Z0-9-]+):?(.*)$/i);
      const tag = m?.[1].toUpperCase();
      const val = (m?.[2] || '').trim();
      if (tag === 'PLAYLIST' && val) out.name = val;
      else if (tag === 'EXTINF') {
        // #EXTINF:123 tvg-id="…" group-title="…",Artist - Title
        const comma = val.indexOf(',');
        const dur = parseFloat(comma >= 0 ? val.slice(0, comma) : val);
        const disp = comma >= 0 ? val.slice(comma + 1).trim() : '';
        const { artist, title } = splitDisplay(disp);
        pending.durationSec = dur > 0 ? Math.round(dur) : undefined;
        if (title) pending.title = title;
        if (artist) pending.artist = artist;
      } else if (tag === 'EXTART' && val) pending.artist = val;
      else if (tag === 'EXTHOLYSIC' && val) {
        try {
          const t = JSON.parse(val);
          if (t && typeof t.id === 'string' && typeof t.title === 'string') pending.track = t;
        } catch {
          // ignore a damaged line
        }
      }
      continue;
    }
    const entry: M3UEntry = { ...pending, location: line };
    if (!entry.title && !entry.track) {
      const g = splitDisplay(fileTitle(line));
      entry.title = g.title;
      entry.artist = entry.artist || g.artist;
    }
    out.entries.push(entry);
    pending = {};
  }
  return out;
}

/** Path parts of a location, normalised (file:// URLs, Windows separators, ./ and ../). */
export function locationParts(loc: string): string[] {
  let s = decodeLoc(loc.trim());
  s = s.replace(/^file:\/\/(localhost)?/i, '').replace(/\\/g, '/');
  s = s.replace(/^[a-z]:\//i, '/'); // C:/Music/…
  const out: string[] = [];
  for (const p of s.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out;
}

export const isRemoteLocation = (loc: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(loc) && !/^file:/i.test(loc);

export const isLocalTrackId = (id: string) => id.startsWith(LOCAL_PREFIX);
