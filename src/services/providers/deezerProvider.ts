// Deezer — used as a catalog only. Its full streams are encrypted for subscribers (HolySic never
// touches them); its open API (no key, no account) gives the whole catalog: search, albums,
// playlists, artists' top songs, the ISRC of a song, exact lengths and big covers. Songs found
// here play through HolySic's own sources (Lossless FLAC / JioSaavn / YouTube Music / SoundCloud…),
// matched by ISRC when known, else by title + artist + length.
// Native iOS only: api.deezer.com sends no CORS headers.

import { Platform } from 'react-native';
import { Track } from '../../types/music';

const API = 'https://api.deezer.com';
const native = Platform.OS !== 'web';

async function getJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    // Deezer answers 200 with { error: {...} } for missing / private items
    return j && !j.error ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function deezerTrack(t: any, album?: any): Track | null {
  if (!t?.id || !t?.title || t.readable === false) return null;
  const al = t.album || album || {};
  const artist = String(t.artist?.name || 'Deezer').trim();
  const contributors: string[] = Array.isArray(t.contributors)
    ? t.contributors.map((c: any) => String(c?.name || '')).filter(Boolean)
    : [];
  const year = Number(String(t.release_date || al.release_date || '').slice(0, 4));
  return {
    id: `dz-${t.id}`,
    title: String(t.title).trim(),
    artist: contributors.length > 1 ? contributors.join(', ') : artist,
    artists: contributors.length > 1 ? contributors : [artist],
    album: al.title || undefined,
    artworkUrl: al.cover_xl || al.cover_big || al.cover_medium || '',
    durationSec: Number(t.duration) || 0,
    explicit: !!t.explicit_lyrics || undefined,
    isrc: t.isrc || undefined,
    source: 'deezer',
    qualityBadge: 'Deezer',
    releaseYear: year > 1900 ? year : undefined,
  };
}

export async function searchDeezerTracks(q: string, limit = 20): Promise<Track[]> {
  const query = q.trim();
  if (!query || !native) return [];
  const j = await getJson(`${API}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return ((j?.data || []) as any[]).map((t) => deezerTrack(t)).filter((x): x is Track => !!x);
}

/** all pages of a Deezer list endpoint (playlists can hold thousands of songs) */
async function allPages(first: string, max = 2000): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = first;
  while (url && out.length < max) {
    const j = await getJson(url);
    if (!j) break;
    out.push(...(j.data || []));
    url = typeof j.next === 'string' ? j.next : null;
  }
  return out;
}

/** Short share links (link.deezer.com/s/…, deezer.page.link/…) → the real deezer.com URL */
async function expand(url: string): Promise<string> {
  if (!/link\.deezer\.com|deezer\.page\.link|dzr\.page\.link/.test(url)) return url;
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (res.url && /deezer\.com\//.test(res.url) && !/link\.deezer\.com/.test(res.url))
      return res.url;
    // some short links answer with a page that names the target
    const html = await res.text();
    const m = html.match(/https?:\/\/www\.deezer\.com\/[a-z/-]*(track|album|playlist|artist)\/\d+/);
    return m ? m[0] : url;
  } catch {
    return url;
  }
}

/** A Deezer link (track / album / playlist / artist) → its songs, as catalog tracks */
export async function fetchDeezerLink(
  url: string
): Promise<{ name: string; coverUrl?: string; tracks: Track[]; single: boolean } | null> {
  if (!native) return null;
  const href = await expand(url.trim());
  const m = href.match(/\/(track|album|playlist|artist)\/(\d+)/);
  if (!m) return null;
  const [, type, id] = m;
  if (type === 'track') {
    const t = deezerTrack(await getJson(`${API}/track/${id}`));
    return t ? { name: t.title, coverUrl: t.artworkUrl, tracks: [t], single: true } : null;
  }
  if (type === 'album') {
    const al = await getJson(`${API}/album/${id}`);
    if (!al) return null;
    const items = await allPages(`${API}/album/${id}/tracks?limit=200`);
    const tracks = items.map((t) => deezerTrack(t, al)).filter((x): x is Track => !!x);
    return { name: String(al.title || 'Deezer'), coverUrl: al.cover_xl, tracks, single: false };
  }
  if (type === 'playlist') {
    const pl = await getJson(`${API}/playlist/${id}`);
    if (!pl) return null;
    const items = await allPages(`${API}/playlist/${id}/tracks?limit=400`);
    const tracks = items.map((t) => deezerTrack(t)).filter((x): x is Track => !!x);
    return {
      name: String(pl.title || 'Deezer'),
      coverUrl: pl.picture_xl || tracks[0]?.artworkUrl,
      tracks,
      single: false,
    };
  }
  const ar = await getJson(`${API}/artist/${id}`);
  const top = await getJson(`${API}/artist/${id}/top?limit=50`);
  const tracks = ((top?.data || []) as any[])
    .map((t) => deezerTrack(t))
    .filter((x): x is Track => !!x);
  return {
    name: String(ar?.name || 'Deezer'),
    coverUrl: ar?.picture_xl,
    tracks,
    single: false,
  };
}
