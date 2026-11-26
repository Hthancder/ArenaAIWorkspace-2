// Link & list import — merges three ideas without duplicating them:
//   • OpenSpot Music: "Import music directly from any public Spotify playlist URL"
//   • Musike: "Paste a YouTube link to play it right away" and "Search a list" (comma separated)
//   • Mochy: the existing text playlist import
// Spotify is read from its public embed page (no account, no third-party transfer service);
// YouTube / YouTube Music playlists through the InnerTube browse API.

import { Platform } from 'react-native';
import { Track } from '../../types/music';
import { fetchYouTubeMusicPlaylist } from '../providers/innertubeProvider';

export type ParsedLink =
  | { kind: 'youtube-video'; id: string }
  | { kind: 'youtube-playlist'; id: string }
  | { kind: 'spotify'; type: 'track' | 'playlist' | 'album'; id: string }
  | { kind: 'apple'; type: 'song' | 'album' | 'playlist'; id: string; url: string }
  | { kind: 'deezer' | 'soundcloud' | 'other'; url: string };

export interface TextItem {
  title: string;
  artist: string;
  durationSec?: number;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export function looksLikeLink(text: string): boolean {
  return /^(https?:\/\/|www\.|open\.spotify|music\.youtube|youtu\.be|youtube\.com|spotify:)/i.test(
    text.trim()
  );
}

export function parseMusicLink(raw: string): ParsedLink | null {
  const text = raw.trim();
  const spUri = text.match(/^spotify:(track|playlist|album):([A-Za-z0-9]{22})/);
  if (spUri) return { kind: 'spotify', type: spUri[1] as 'track', id: spUri[2] };
  // React Native's URL polyfill lacks hostname/pathname/searchParams, so parse by hand
  const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const hm = href.match(/^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!hm) return null;
  const host = hm[1].toLowerCase().replace(/^www\.|^m\./, '');
  const pathname = hm[2] || '/';
  const query = hm[3] || '';
  const param = (name: string) => (query.match(new RegExp(`[?&]${name}=([^&]+)`)) || [])[1];

  if (host === 'youtu.be') {
    const id = pathname.slice(1, 12);
    return id.length === 11 ? { kind: 'youtube-video', id } : null;
  }
  if (host.endsWith('youtube.com')) {
    const list = param('list');
    const v =
      (param('v') || '').slice(0, 11) ||
      (pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/) || [])[1];
    if (list && (!v || pathname.startsWith('/playlist')))
      return { kind: 'youtube-playlist', id: list };
    if (v && v.length === 11) return { kind: 'youtube-video', id: v };
    if (list) return { kind: 'youtube-playlist', id: list };
    return null;
  }
  if (host.endsWith('spotify.com')) {
    const m = pathname.match(
      /\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|playlist|album)\/([A-Za-z0-9]{22})/
    );
    return m ? { kind: 'spotify', type: m[1] as 'track', id: m[2] } : null;
  }
  if (host.endsWith('music.apple.com')) {
    const song = param('i');
    const m = pathname.match(/\/(album|playlist|song)\/(?:[^/]*\/)?([a-z0-9.\-]+)\/?$/i);
    if (song) return { kind: 'apple', type: 'song', id: song, url: href };
    if (m) return { kind: 'apple', type: m[1].toLowerCase() as 'album', id: m[2], url: href };
    return null;
  }
  if (host.endsWith('deezer.com')) return { kind: 'deezer', url: href };
  if (host.endsWith('soundcloud.com')) return { kind: 'soundcloud', url: href };
  return { kind: 'other', url: href };
}

async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 9000
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Spotify embed pages carry the whole entity in __NEXT_DATA__ (native iOS only — no CORS) */
export async function fetchSpotifyEntity(
  type: 'track' | 'playlist' | 'album',
  id: string
): Promise<{ name: string; coverUrl?: string; items: TextItem[] } | null> {
  if (Platform.OS !== 'web') {
    const html = await fetchText(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const m = html?.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (m) {
      try {
        const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
        if (entity) {
          const cover =
            entity?.coverArt?.sources?.slice(-1)?.[0]?.url ||
            entity?.visualIdentity?.image?.slice(-1)?.[0]?.url;
          if (type === 'track') {
            const artist =
              (entity.artists || [])
                .map((a: any) => a?.name)
                .filter(Boolean)
                .join(', ') ||
              entity.subtitle ||
              '';
            return {
              name: entity.name || entity.title,
              coverUrl: cover,
              items: [
                {
                  title: entity.name || entity.title,
                  artist,
                  durationSec: Math.round((entity.duration || 0) / 1000) || undefined,
                },
              ],
            };
          }
          const list: any[] = entity.trackList || [];
          return {
            name: entity.name || entity.title || 'Spotify',
            coverUrl: cover,
            items: list
              .map((t) => ({
                title: String(t?.title || '').trim(),
                artist: String(t?.subtitle || '')
                  .replace(/\u00a0/g, ' ')
                  .trim(),
                durationSec: t?.duration ? Math.round(Number(t.duration) / 1000) : undefined,
              }))
              .filter((t) => t.title),
          };
        }
      } catch {
        // fall through to oEmbed
      }
    }
  }
  // Browser preview / fallback: oEmbed (CORS-enabled) only knows the title
  const o = await fetchText(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${type}/${id}`)}`
  );
  if (!o) return null;
  try {
    const j = JSON.parse(o);
    const title = String(j?.title || '');
    if (!title) return null;
    return {
      name: title,
      coverUrl: j?.thumbnail_url,
      items: type === 'track' ? [{ title, artist: '' }] : [],
    };
  } catch {
    return null;
  }
}

/** YouTube video → a playable Track (oEmbed gives title + channel; CORS-enabled) */
export async function youtubeVideoTrack(videoId: string): Promise<Track> {
  let title = `YouTube · ${videoId}`;
  let artist = 'YouTube';
  const o = await fetchText(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
  );
  if (o) {
    try {
      const j = JSON.parse(o);
      title = String(j?.title || title);
      artist = String(j?.author_name || artist).replace(/ - Topic$/i, '');
    } catch {
      // keep defaults
    }
  }
  // "Artist - Title (Official Video)" → split for better lyrics / matching
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && artist !== 'YouTube' && !/topic/i.test(artist)) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }
  title = title
    .replace(/\s*[([](official|lyric|mv|m\/v|audio|video|visualizer)[^)\]]*[)\]]/gi, '')
    .trim();
  return {
    id: `yt-${videoId}`,
    videoId,
    title,
    artist,
    artists: [artist],
    artworkUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSec: 210,
    source: 'innertube',
    qualityBadge: 'YouTube link',
  };
}

export async function fetchYouTubePlaylist(
  id: string
): Promise<{ name: string; tracks: Track[] } | null> {
  if (Platform.OS === 'web') return null;
  return fetchYouTubeMusicPlaylist(id);
}

/** "Search a list": one song per line, or several separated by commas / semicolons */
export function parseTextList(raw: string): TextItem[] {
  const parts = raw
    .split(/\r?\n|;|,(?![^()]*\))/)
    .map((l) =>
      l
        .replace(/^\s*\d+[.)\s-]+/, '')
        .replace(/^[-•*]\s*/, '')
        .trim()
    )
    .filter((l) => l.length >= 2 && !l.startsWith('#'));
  return parts.slice(0, 200).map((line) => {
    const m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    // "Artist - Title" is the common copy/paste format; keep the whole line as title otherwise
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: line, artist: '' };
  });
}

/**
 * Matches text items to catalog tracks with the given search function (multi-source), a few at a
 * time so a 100-song playlist doesn't take minutes.
 */
export async function matchTextItems(
  items: TextItem[],
  search: (q: string) => Promise<Track[]>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 4
): Promise<Track[]> {
  const out: (Track | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      const q = `${it.artist ? it.artist.split(',')[0] + ' ' : ''}${it.title}`.trim();
      try {
        const hits = await search(q);
        const wantTitle = norm(it.title).split(' ').slice(0, 3).join(' ');
        const best = hits.find((h) => norm(h.title).includes(wantTitle)) || hits[0];
        if (best) {
          out[i] =
            it.durationSec && (!best.durationSec || best.durationSec === 210)
              ? { ...best, durationSec: it.durationSec }
              : best;
        }
      } catch {
        // skip this one
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  const seen = new Set<string>();
  return out.filter((t): t is Track => !!t && !seen.has(t.id) && !!seen.add(t.id));
}
