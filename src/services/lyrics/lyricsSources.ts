// Lyrics sources, with matching that refuses the wrong song.
//
//   YouLyPlus   word-timed (Apple Music / Musixmatch style), via lyricsService
//   LRCLib      open LRC database — exact lookup first, then a scored search
//   NetEase     NetEase Cloud Music: huge synced catalogue (V-Pop, C/K/J-Pop, US-UK)
//   Kugou       Kugou lyrics: synced, strong for Asian releases
//   Lyrics.ovh  plain lyrics (last resort)
//
// Every candidate is scored against the song (title words, artist words, duration); anything
// below the bar is dropped instead of being shown as "the lyrics". Users can still pick any
// candidate by hand in the lyrics search sheet.

import { LyricsData, Track } from '../../types/music';
import { coreTitle } from '../trackMatcher';
import { decodeText } from '../local/tagReader';
import {
  cleanLyricsArtist,
  cleanLyricsTitle,
  lyricsFromText,
  tryYouLyPlusLyrics,
} from './lyricsService';

export type LyricsSourceId = 'youlyplus' | 'lrclib' | 'netease' | 'kugou' | 'lyricsovh';

export const LYRICS_SOURCES: {
  id: LyricsSourceId;
  name: string;
  vi: string;
  en: string;
}[] = [
  {
    id: 'youlyplus',
    name: 'YouLyPlus',
    vi: 'Theo từng chữ (Apple / Musixmatch)',
    en: 'Word-timed (Apple / Musixmatch)',
  },
  {
    id: 'lrclib',
    name: 'LRCLib',
    vi: 'Kho LRC mở, đồng bộ theo dòng',
    en: 'Open LRC library, line-synced',
  },
  {
    id: 'netease',
    name: 'NetEase',
    vi: 'NetEase Cloud Music · V-Pop, C/K-Pop, US-UK',
    en: 'NetEase Cloud Music · Asian & Western pop',
  },
  {
    id: 'kugou',
    name: 'Kugou',
    vi: 'Kugou · mạnh với nhạc châu Á',
    en: 'Kugou · strong for Asian releases',
  },
  {
    id: 'lyricsovh',
    name: 'Lyrics.ovh',
    vi: 'Lời không đồng bộ (dự phòng)',
    en: 'Plain lyrics (fallback)',
  },
];

export const DEFAULT_LYRICS_SOURCES: Record<LyricsSourceId, boolean> = {
  youlyplus: true,
  lrclib: true,
  netease: true,
  kugou: true,
  lyricsovh: true,
};

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
}

export interface LyricsCandidate {
  key: string;
  source: LyricsSourceId;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  synced: boolean;
  /** 0..1 — how sure we are it is this song */
  score: number;
  /** a few lines to recognise it by */
  preview?: string;
  /** not a search hit: the source is simply asked for this song when opened (no match score) */
  probe?: boolean;
  load: () => Promise<LyricsData | null>;
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function get(
  url: string,
  ms = 5000,
  headers: Record<string, string> = {}
): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { signal: c.signal, headers });
  } finally {
    clearTimeout(t);
  }
}

// ── matching ──

const UNKNOWN_ARTIST = /^(không rõ nghệ sĩ|unknown( artist)?|various artists|<unknown>)$/i;

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** strip what file names / uploads add around a title: "01 - ", "(Official MV)", "[Lyrics]" */
export function lyricsTitle(raw: string): string {
  return cleanLyricsTitle(raw.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')).trim() || raw.trim();
}

/** 0..1, or 0 when it is clearly another song */
export function scoreLyricsMatch(
  q: LyricsQuery,
  c: { title: string; artist: string; durationSec?: number }
): number {
  const qt = words(coreTitle(lyricsTitle(q.title)));
  const ct = new Set(words(coreTitle(lyricsTitle(c.title))));
  if (!qt.length || !ct.size) return 0;
  const tHit = qt.filter((w) => ct.has(w)).length / qt.length;
  const tBack = [...ct].filter((w) => qt.includes(w)).length / ct.size;
  const title = Math.min(tHit, Math.max(tBack, 0.5));
  if (title < 0.6) return 0;

  const knownArtist = !!q.artist.trim() && !UNKNOWN_ARTIST.test(q.artist.trim());
  let artist = 0.5;
  if (knownArtist) {
    const ca = new Set(words(c.artist));
    const parts = q.artist.split(/\s*(?:,|&|feat\.?|ft\.?|x|with|và)\s*/i).filter(Boolean);
    artist = 0;
    for (const p of parts.length ? parts : [q.artist]) {
      const pw = words(p);
      if (pw.length) artist = Math.max(artist, pw.filter((w) => ca.has(w)).length / pw.length);
    }
    if (artist < 0.5) return 0;
  }

  let dur = 0.6;
  if (q.durationSec && c.durationSec && q.durationSec > 30 && c.durationSec > 30) {
    const d = Math.abs(q.durationSec - c.durationSec);
    // unknown artist: only a near-identical length vouches for it
    if (!knownArtist && d > 4) return 0;
    if (d > 20) return 0;
    dur = d <= 2 ? 1 : 1 - (d - 2) / 18;
  }
  const version =
    /\b(remix|live|acoustic|instrumental|karaoke|sped up|slowed|piano|cover|lofi|lo-fi)\b/i;
  const penalty = version.test(q.title) !== version.test(c.title) ? 0.4 : 0;
  return Math.max(0, Math.min(1, 0.5 * title + 0.3 * artist + 0.2 * dur - penalty));
}

const AUTO_MIN = 0.62;

const tag = (d: LyricsData | null, provider: string): LyricsData | null =>
  d && d.lines.length ? { ...d, provider: provider as LyricsData['provider'] } : null;

const previewOf = (text?: string) =>
  (text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\[[^\]]*\])+/, '').trim())
    .filter((l) => l && !/^(作词|作曲|编曲|制作人|词|曲)\s*[:：]/.test(l))
    .slice(0, 3)
    .join(' / ');

/** NetEase / Kugou credit lines ("作词 : …") at the top of the LRC */
function dropCredits(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .filter(
      (l) =>
        !/^\s*\[[\d:.]+\]\s*(作词|作曲|编曲|制作人|词|曲|Lyricist|Composer|Arranger)\s*[:：]/i.test(
          l
        )
    )
    .join('\n');
}

function fromLrc(text: string, durationSec: number, provider: string): LyricsData | null {
  const d = lyricsFromText(dropCredits(text), durationSec);
  return tag(d, provider);
}

// ── LRCLib ──

function lrclibData(item: any, durationSec: number): LyricsData | null {
  if (typeof item?.syncedLyrics === 'string' && item.syncedLyrics.trim())
    return fromLrc(item.syncedLyrics, durationSec, 'LRCLib');
  if (typeof item?.plainLyrics === 'string' && item.plainLyrics.trim()) {
    const d = lyricsFromText(item.plainLyrics, durationSec);
    return d ? { ...d, provider: 'LRCLib', synced: false } : null;
  }
  return null;
}

function lrclibCandidate(item: any, q: LyricsQuery): LyricsCandidate | null {
  if (item?.instrumental) return null;
  const synced = typeof item?.syncedLyrics === 'string' && !!item.syncedLyrics.trim();
  if (!synced && !(typeof item?.plainLyrics === 'string' && item.plainLyrics.trim())) return null;
  const c = {
    title: String(item.trackName || item.name || ''),
    artist: String(item.artistName || ''),
    durationSec: Number(item.duration) || undefined,
  };
  return {
    key: `lrclib-${item.id}`,
    source: 'lrclib',
    ...c,
    album: item.albumName || undefined,
    synced,
    score: scoreLyricsMatch(q, c),
    preview: previewOf(item.plainLyrics || item.syncedLyrics),
    load: async () => lrclibData(item, q.durationSec || c.durationSec || 200),
  };
}

async function lrclibSearch(q: LyricsQuery, free?: string): Promise<LyricsCandidate[]> {
  const title = lyricsTitle(q.title);
  const artist = cleanLyricsArtist(q.artist);
  const queries: URLSearchParams[] = free
    ? [new URLSearchParams({ q: free })]
    : [
        new URLSearchParams({
          track_name: title,
          ...(artist && !UNKNOWN_ARTIST.test(artist) ? { artist_name: artist } : {}),
        }),
        new URLSearchParams({ q: `${UNKNOWN_ARTIST.test(artist) ? '' : artist} ${title}`.trim() }),
      ];
  const out: LyricsCandidate[] = [];
  const seen = new Set<string>();
  for (const p of queries) {
    try {
      const res = await get(`https://lrclib.net/api/search?${p.toString()}`, 5000);
      if (!res.ok) continue;
      const list: any[] = await res.json();
      for (const item of Array.isArray(list) ? list.slice(0, 20) : []) {
        const c = lrclibCandidate(item, q);
        if (c && !seen.has(c.key)) {
          seen.add(c.key);
          out.push(c);
        }
      }
      if (!free && out.some((c) => c.score >= AUTO_MIN && c.synced)) break;
    } catch {
      // next query
    }
  }
  return out;
}

/** exact lookup (title + artist + album + duration ±2 s) — the most reliable LRCLib call */
async function lrclibExact(q: LyricsQuery): Promise<LyricsData | null> {
  const artist = cleanLyricsArtist(q.artist);
  if (!artist || UNKNOWN_ARTIST.test(artist) || !q.durationSec) return null;
  try {
    const p = new URLSearchParams({
      track_name: lyricsTitle(q.title),
      artist_name: artist,
      duration: String(Math.round(q.durationSec)),
      ...(q.album ? { album_name: q.album } : {}),
    });
    const res = await get(`https://lrclib.net/api/get?${p.toString()}`, 4500);
    if (!res.ok) return null;
    const item = await res.json();
    if (item?.instrumental) return null;
    return lrclibData(item, q.durationSec);
  } catch {
    return null;
  }
}

// ── NetEase Cloud Music ──

async function neteaseSearch(q: LyricsQuery, free?: string): Promise<LyricsCandidate[]> {
  const s =
    free ||
    `${UNKNOWN_ARTIST.test(q.artist) ? '' : cleanLyricsArtist(q.artist)} ${lyricsTitle(q.title)}`.trim();
  try {
    const res = await get(
      `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(s)}&type=1&offset=0&total=true&limit=12`,
      5000,
      { Referer: 'https://music.163.com/', 'User-Agent': UA }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const songs: any[] = data?.result?.songs || [];
    return songs.map((song) => {
      const c = {
        title: String(song?.name || ''),
        artist: ((song?.artists || song?.ar || []) as any[])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(', '),
        durationSec: (Number(song?.duration || song?.dt) || 0) / 1000 || undefined,
      };
      return {
        key: `netease-${song.id}`,
        source: 'netease' as const,
        ...c,
        album: song?.album?.name || song?.al?.name || undefined,
        synced: true, // unknown until loaded; most entries are
        score: scoreLyricsMatch(q, c),
        load: () => neteaseLyrics(song.id, q.durationSec || c.durationSec || 200),
      };
    });
  } catch {
    return [];
  }
}

async function neteaseLyrics(id: number | string, durationSec: number): Promise<LyricsData | null> {
  try {
    const res = await get(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, 5000, {
      Referer: 'https://music.163.com/',
      'User-Agent': UA,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.nolyric || data?.uncollected) return null;
    const lrc = String(data?.lrc?.lyric || '');
    if (!lrc.trim()) return null;
    return fromLrc(lrc, durationSec, 'NetEase');
  } catch {
    return null;
  }
}

// ── Kugou ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2] || 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] || 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && clean[i + 2]) out[o++] = (n >> 8) & 255;
    if (o < out.length && clean[i + 3]) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

async function kugouSearch(q: LyricsQuery, free?: string): Promise<LyricsCandidate[]> {
  const keyword =
    free ||
    `${UNKNOWN_ARTIST.test(q.artist) ? '' : cleanLyricsArtist(q.artist)} - ${lyricsTitle(q.title)}`.replace(
      /^ - /,
      ''
    );
  try {
    const p = new URLSearchParams({
      ver: '1',
      man: 'yes',
      client: 'pc',
      keyword,
      ...(q.durationSec && !free ? { duration: String(Math.round(q.durationSec * 1000)) } : {}),
      hash: '',
    });
    const res = await get(`http://lyrics.kugou.com/search?${p.toString()}`, 5000, {
      'User-Agent': UA,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list: any[] = data?.candidates || [];
    return list.slice(0, 10).map((it) => {
      const c = {
        title: String(it?.song || ''),
        artist: String(it?.singer || ''),
        durationSec: (Number(it?.duration) || 0) / 1000 || undefined,
      };
      return {
        key: `kugou-${it.id}`,
        source: 'kugou' as const,
        ...c,
        synced: true,
        // Kugou's own search already filters by length: trust it a little more
        score: Math.min(1, scoreLyricsMatch(q, c) + (Number(it?.score) >= 60 ? 0.04 : 0)),
        load: () => kugouLyrics(it.id, it.accesskey, q.durationSec || c.durationSec || 200),
      };
    });
  } catch {
    return [];
  }
}

async function kugouLyrics(
  id: string,
  accesskey: string,
  durationSec: number
): Promise<LyricsData | null> {
  try {
    const p = new URLSearchParams({
      ver: '1',
      client: 'pc',
      id: String(id),
      accesskey: String(accesskey),
      fmt: 'lrc',
      charset: 'utf8',
    });
    const res = await get(`http://lyrics.kugou.com/download?${p.toString()}`, 5000, {
      'User-Agent': UA,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.content) return null;
    const text = decodeText(base64Bytes(String(data.content)));
    return fromLrc(text, durationSec, 'Kugou');
  } catch {
    return null;
  }
}

// ── Lyrics.ovh (plain) ──

async function lyricsOvh(q: LyricsQuery): Promise<LyricsData | null> {
  const artist = cleanLyricsArtist(q.artist);
  if (!artist || UNKNOWN_ARTIST.test(artist)) return null;
  try {
    const res = await get(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(lyricsTitle(q.title))}`,
      5000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = String(data?.lyrics || '')
      .replace(/^Paroles de la chanson.*$/im, '')
      .trim();
    if (!text) return null;
    const d = lyricsFromText(text, q.durationSec || 200);
    return d ? { ...d, provider: 'Lyrics.ovh' as LyricsData['provider'], synced: false } : null;
  } catch {
    return null;
  }
}

// ── public ──

export const queryOf = (t: Track): LyricsQuery => ({
  title: t.title,
  artist: t.artists?.length ? t.artists.join(', ') : t.artist,
  album: t.album,
  durationSec: t.durationSec,
});

/**
 * Automatic lyrics for a song, best first: word-timed → synced → plain. Only matches that clear
 * the bar are used; null when nothing trustworthy was found.
 */
export async function fetchOnlineLyrics(
  q: LyricsQuery,
  enabled: Partial<Record<LyricsSourceId, boolean>> = DEFAULT_LYRICS_SOURCES
): Promise<LyricsData | null> {
  const on = (id: LyricsSourceId) => enabled[id] !== false;
  const dur = q.durationSec || 200;
  const artist = cleanLyricsArtist(q.artist);
  const title = lyricsTitle(q.title);

  // round 1: word-timed + exact LRCLib, in parallel
  const [ylp, exact] = await Promise.all([
    on('youlyplus') && artist && !UNKNOWN_ARTIST.test(artist)
      ? tryYouLyPlusLyrics(title, artist, dur, q.album).catch(() => null)
      : Promise.resolve(null),
    on('lrclib') ? lrclibExact(q) : Promise.resolve(null),
  ]);
  if (ylp && ylp.lines.length) return ylp;
  if (exact?.synced) return exact;

  // round 2: scored searches across the synced catalogues, in parallel
  const lists = await Promise.all([
    on('lrclib') ? lrclibSearch(q) : Promise.resolve([] as LyricsCandidate[]),
    on('netease') ? neteaseSearch(q) : Promise.resolve([] as LyricsCandidate[]),
    on('kugou') ? kugouSearch(q) : Promise.resolve([] as LyricsCandidate[]),
  ]);
  const ranked = lists
    .flat()
    .filter((c) => c.score >= AUTO_MIN)
    .sort((a, b) => Number(b.synced) - Number(a.synced) || b.score - a.score);
  let plain: LyricsData | null = exact && !exact.synced ? exact : null;
  for (const c of ranked.slice(0, 4)) {
    const d = await c.load().catch(() => null);
    if (!d) continue;
    if (d.synced) return d;
    plain = plain || d;
  }
  if (plain) return plain;
  return on('lyricsovh') ? lyricsOvh(q) : null;
}

/**
 * Everything the sources have for a search (for "choose other lyrics"), best match first. `free`
 * searches the given text instead of the song's title / artist.
 */
export async function searchLyricsCandidates(
  q: LyricsQuery,
  free?: string,
  enabled: Partial<Record<LyricsSourceId, boolean>> = DEFAULT_LYRICS_SOURCES
): Promise<LyricsCandidate[]> {
  const on = (id: LyricsSourceId) => enabled[id] !== false;
  const lists = await Promise.all([
    on('lrclib') ? lrclibSearch(q, free) : Promise.resolve([] as LyricsCandidate[]),
    on('netease') ? neteaseSearch(q, free) : Promise.resolve([] as LyricsCandidate[]),
    on('kugou') ? kugouSearch(q, free) : Promise.resolve([] as LyricsCandidate[]),
  ]);
  const extra: LyricsCandidate[] = [];
  if (!free && on('youlyplus')) {
    extra.push({
      key: 'youlyplus',
      source: 'youlyplus',
      probe: true,
      title: q.title,
      artist: q.artist,
      durationSec: q.durationSec,
      synced: true,
      score: 0.7,
      load: () =>
        tryYouLyPlusLyrics(
          lyricsTitle(q.title),
          cleanLyricsArtist(q.artist),
          q.durationSec || 200,
          q.album
        ),
    });
  }
  if (!free && on('lyricsovh')) {
    extra.push({
      key: 'lyricsovh',
      source: 'lyricsovh',
      probe: true,
      title: q.title,
      artist: q.artist,
      synced: false,
      score: 0.5,
      load: () => lyricsOvh(q),
    });
  }
  const seen = new Set<string>();
  return [...lists.flat(), ...extra]
    .filter((c) => {
      const k = `${c.source}|${c.title.toLowerCase()}|${c.artist.toLowerCase()}|${Math.round((c.durationSec || 0) / 3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(
      (a, b) =>
        // real search hits first (best match on top), then the sources that are only asked
        Number(!!a.probe) - Number(!!b.probe) ||
        (free ? 0 : b.score - a.score) ||
        Number(b.synced) - Number(a.synced)
    );
}
