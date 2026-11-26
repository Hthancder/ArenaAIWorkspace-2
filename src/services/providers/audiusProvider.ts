// Audius — a free, open music network where artists upload full-length songs themselves.
// No API key needed; songs stream as MP3 320 kbps. HolySic uses it as an extra catalog for indie,
// electronic, lo-fi and hip-hop, plus its trending charts. Catalog-only: Audius is never used to
// "match" mainstream songs, because uploads there are the artists' own releases.

import { Track } from '../../types/music';

const APP = 'HolySic';
const FALLBACK_HOSTS = ['https://api.audius.co', 'https://discoveryprovider.audius.co'];
let hostCache: { host: string; at: number } | null = null;

async function getJson(url: string, timeoutMs = 7000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Audius publishes a list of healthy discovery nodes at api.audius.co; cached for 30 min. */
async function host(): Promise<string> {
  if (hostCache && Date.now() - hostCache.at < 30 * 60 * 1000) return hostCache.host;
  try {
    const j = await getJson('https://api.audius.co', 5000);
    const list: string[] = Array.isArray(j?.data)
      ? j.data.filter((h: any) => typeof h === 'string')
      : [];
    const pick = list.length
      ? list[Math.floor(Math.random() * Math.min(list.length, 5))]
      : FALLBACK_HOSTS[0];
    hostCache = { host: pick.replace(/\/$/, ''), at: Date.now() };
  } catch {
    hostCache = { host: FALLBACK_HOSTS[0], at: Date.now() };
  }
  return hostCache.host;
}

async function api(path: string): Promise<any[]> {
  const sep = path.includes('?') ? '&' : '?';
  const tried = new Set<string>();
  for (const h of [await host(), ...FALLBACK_HOSTS]) {
    if (tried.has(h)) continue;
    tried.add(h);
    try {
      const j = await getJson(`${h}/v1${path}${sep}app_name=${APP}`);
      if (Array.isArray(j?.data)) {
        if (h !== hostCache?.host) hostCache = { host: h, at: Date.now() };
        return j.data;
      }
    } catch {
      /* next host */
    }
  }
  return [];
}

function toTrack(t: any, h: string): Track | null {
  if (!t?.id || !t?.title || t.is_streamable === false || t.is_delete) return null;
  const art = t.artwork || {};
  return {
    id: `audius-${t.id}`,
    title: String(t.title).trim(),
    artist: String(t.user?.name || t.user?.handle || 'Audius').trim(),
    artists: [String(t.user?.name || t.user?.handle || 'Audius').trim()],
    artworkUrl: art['480x480'] || art['1000x1000'] || art['150x150'] || '',
    durationSec: Number(t.duration) || 0,
    source: 'audius',
    streamUrl: `${h}/v1/tracks/${t.id}/stream?app_name=${APP}`,
    qualityBadge: 'MP3 320 · Audius',
    genre: t.genre || undefined,
    releaseYear: t.release_date ? new Date(t.release_date).getFullYear() || undefined : undefined,
  };
}

export async function searchAudiusTracks(q: string, limit = 20): Promise<Track[]> {
  const query = q.trim();
  if (!query) return [];
  const data = await api(`/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  const h = await host();
  return data
    .map((t) => toTrack(t, h))
    .filter((x): x is Track => !!x)
    .slice(0, limit);
}

export const AUDIUS_GENRES = [
  { id: '', vi: 'Tất cả', en: 'All' },
  { id: 'Electronic', vi: 'Electronic', en: 'Electronic' },
  { id: 'Hip-Hop/Rap', vi: 'Hip-Hop', en: 'Hip-Hop' },
  { id: 'Lo-Fi', vi: 'Lo-Fi', en: 'Lo-Fi' },
  { id: 'Pop', vi: 'Pop', en: 'Pop' },
  { id: 'R&B/Soul', vi: 'R&B', en: 'R&B' },
  { id: 'Ambient', vi: 'Ambient', en: 'Ambient' },
  { id: 'House', vi: 'House', en: 'House' },
] as const;

export async function fetchAudiusTrending(
  genre = '',
  time: 'week' | 'month' | 'allTime' = 'week',
  limit = 25
): Promise<Track[]> {
  const g = genre ? `&genre=${encodeURIComponent(genre)}` : '';
  const data = await api(`/tracks/trending?time=${time}${g}`);
  const h = await host();
  return data
    .map((t) => toTrack(t, h))
    .filter((x): x is Track => !!x)
    .slice(0, limit);
}
