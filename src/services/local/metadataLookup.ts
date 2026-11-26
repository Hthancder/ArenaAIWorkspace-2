// Online metadata lookup for Local Files ("Sửa thông tin" + auto-fill).
// Sources: Apple Music catalogue (iTunes Search API, 1000 px covers) and Deezer (cover_xl).
// Every candidate gets a confidence score from title / artist similarity and duration, so the
// automatic fill only applies matches it is sure about.

import { Platform } from 'react-native';

export interface MetaCandidate {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  genre?: string;
  trackNo?: number;
  discNo?: number;
  durationSec?: number;
  coverUrl?: string;
  source: 'Apple Music' | 'Deezer';
  /** Deezer track id (details like track number / release date are fetched on demand) */
  deezerId?: number;
  /** 0..1 confidence against the query */
  score: number;
}

export interface MetaQuery {
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\((feat|ft|with)[^)]*\)|\[(feat|ft)[^\]]*\]/g, ' ')
    .replace(/\b(official|audio|video|lyrics?|mv|hd|remaster(ed)?|\d{4} remaster)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokens = (s: string) => new Set(fold(s).split(' ').filter(Boolean));

/** Token overlap (Dice) with a bonus when one string contains the other */
export function similarity(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  let common = 0;
  ta.forEach((t) => {
    if (tb.has(t)) common++;
  });
  const dice = (2 * common) / (ta.size + tb.size);
  const contains = fa.includes(fb) || fb.includes(fa) ? 0.85 : 0;
  return Math.max(dice, contains);
}

export function scoreCandidate(q: MetaQuery, c: Omit<MetaCandidate, 'score'>): number {
  const t = similarity(q.title, c.title);
  const a = q.artist
    ? Math.max(similarity(q.artist, c.artist), similarity(q.artist, c.albumArtist || ''))
    : 0.6;
  let s = t * 0.62 + a * 0.38;
  if (q.durationSec && c.durationSec) {
    const d = Math.abs(q.durationSec - c.durationSec);
    if (d <= 3) s += 0.08;
    else if (d > 20) s -= 0.25;
    else if (d > 8) s -= 0.1;
  }
  if (q.album && c.album && similarity(q.album, c.album) > 0.8) s += 0.05;
  return Math.max(0, Math.min(1, s));
}

// polite pacing: the iTunes Search API allows roughly 20 calls a minute
const lastCall: Record<string, number> = {};
async function paced(host: string, gapMs: number) {
  const wait = (lastCall[host] || 0) + gapMs - Date.now();
  lastCall[host] = Math.max(Date.now(), (lastCall[host] || 0) + gapMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson(url: string, timeoutMs = 7000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchApple(q: MetaQuery, limit: number): Promise<Omit<MetaCandidate, 'score'>[]> {
  const term = encodeURIComponent(`${q.artist || ''} ${q.title}`.trim());
  const out: Omit<MetaCandidate, 'score'>[] = [];
  for (const country of ['VN', 'US']) {
    await paced('itunes', 3100);
    const data = await getJson(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=${limit}&country=${country}`
    );
    for (const r of data?.results || []) {
      if (!r?.trackName) continue;
      out.push({
        title: r.trackName,
        artist: r.artistName || '',
        album: r.collectionName || undefined,
        albumArtist: r.collectionArtistName || undefined,
        year: r.releaseDate ? new Date(r.releaseDate).getFullYear() || undefined : undefined,
        genre: r.primaryGenreName || undefined,
        trackNo: r.trackNumber || undefined,
        discNo: r.discNumber || undefined,
        durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
        coverUrl: r.artworkUrl100
          ? String(r.artworkUrl100).replace(/\/\d+x\d+bb\.(jpg|png)/i, '/1000x1000bb.jpg')
          : undefined,
        source: 'Apple Music',
      });
    }
    if (out.length) break;
  }
  return out;
}

async function searchDeezer(q: MetaQuery, limit: number): Promise<Omit<MetaCandidate, 'score'>[]> {
  // Deezer sends no CORS headers: native only
  if (Platform.OS === 'web') return [];
  await paced('deezer', 150);
  const strict = q.artist ? `artist:"${q.artist}" track:"${q.title}"` : q.title;
  let data = await getJson(
    `https://api.deezer.com/search?q=${encodeURIComponent(strict)}&limit=${limit}`
  );
  if (!data?.data?.length && q.artist)
    data = await getJson(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${q.artist} ${q.title}`)}&limit=${limit}`
    );
  return (data?.data || [])
    .filter((r: any) => r?.title)
    .map((r: any) => ({
      title: r.title,
      artist: r.artist?.name || '',
      album: r.album?.title || undefined,
      durationSec: r.duration || undefined,
      coverUrl: r.album?.cover_xl || r.album?.cover_big || undefined,
      deezerId: typeof r.id === 'number' ? r.id : undefined,
      source: 'Deezer' as const,
    }));
}

/** Candidates from every source, best first (duplicates merged, Apple's richer data preferred). */
export async function lookupCandidates(q: MetaQuery, limit = 8): Promise<MetaCandidate[]> {
  const [apple, deezer] = await Promise.all([
    searchApple(q, limit).catch(() => []),
    searchDeezer(q, limit).catch(() => []),
  ]);
  const seen = new Map<string, MetaCandidate>();
  for (const c of [...apple, ...deezer]) {
    const key = `${fold(c.title)}|${fold(c.artist)}|${fold(c.album || '')}`;
    const scored = { ...c, score: scoreCandidate(q, c) };
    const prev = seen.get(key);
    if (!prev) seen.set(key, scored);
    else if (!prev.coverUrl && scored.coverUrl) prev.coverUrl = scored.coverUrl;
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The single match the auto-fill may apply on its own, or null when unsure.
 * Deezer first in batches (generous rate limit), Apple when Deezer has nothing confident.
 */
export async function bestMatch(q: MetaQuery): Promise<MetaCandidate | null> {
  const ok = (c?: MetaCandidate): c is MetaCandidate => {
    if (!c || c.score < 0.78) return false;
    const dd = q.durationSec && c.durationSec ? Math.abs(q.durationSec - c.durationSec) : undefined;
    if (dd !== undefined && dd > 7) return false;
    // no artist to compare (bare file name): only an exact title with a matching length
    if (!q.artist) return similarity(q.title, c.title) >= 0.95 && dd !== undefined && dd <= 3;
    return true;
  };
  const pick = (list: Omit<MetaCandidate, 'score'>[]) =>
    list.map((c) => ({ ...c, score: scoreCandidate(q, c) })).sort((a, b) => b.score - a.score)[0];
  const dz = pick(await searchDeezer(q, 6).catch(() => []));
  if (ok(dz) && dz.coverUrl) return enrich(dz);
  const ap = pick(await searchApple(q, 6).catch(() => []));
  if (ok(ap)) return ap;
  return ok(dz) ? enrich(dz) : null;
}

/** Fill in what a search result leaves out (Deezer: track number, disc, release year). */
export async function enrich(c: MetaCandidate): Promise<MetaCandidate> {
  if (c.source !== 'Deezer' || !c.deezerId || Platform.OS === 'web') return c;
  try {
    await paced('deezer', 150);
    const d = await getJson(`https://api.deezer.com/track/${c.deezerId}`, 5000);
    const year = d?.release_date ? parseInt(String(d.release_date).slice(0, 4), 10) : NaN;
    return {
      ...c,
      trackNo: c.trackNo || d?.track_position || undefined,
      discNo: c.discNo || d?.disk_number || undefined,
      year: c.year || (Number.isFinite(year) && year > 1900 ? year : undefined),
    };
  } catch {
    return c;
  }
}
