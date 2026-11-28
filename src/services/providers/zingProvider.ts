// Zing MP3 — the biggest Vietnamese catalogue (V-Pop, Bolero, indie, rap Việt), with word-timed
// lyrics for many songs. HolySic plays what zingmp3.vn's own web player plays for free (MP3 128,
// 320 when Zing allows it); songs Zing keeps for VIP accounts are skipped and play elsewhere.
//
//   • every API call is signed like the web app: sha256 of the whitelisted params (sorted
//     key=value, joined) → HMAC-SHA512(secret, path + that hash), plus apiKey / ctime / version
//   • a session cookie comes from the home page first (the cookie jar keeps it); a request that
//     reports a stale session refreshes it once
//   • Zing serves Vietnam only: X-Forwarded-For carries a Vietnamese address, as NodeLink does
// Protocol follows yt-dlp's ZingMp3 extractor and NodeLink's zingmp3 source. Native iOS only
// (zingmp3.vn sends no CORS headers).

import { Platform } from 'react-native';
import { DiagnosticStep, LyricLine, LyricWord, Track } from '../../types/music';
import { hmacSha512Hex, sha256Hex } from '../crypto/sha2';
import { rankCandidates, TrackQueryInput } from '../trackMatcher';

const DOMAIN = 'https://zingmp3.vn';
const API_KEY = 'X5BM3w8N7MKozC0B85o4KMlzLZKhV00y';
const SECRET_KEY = 'acOrvUS15XRW2o9JksiK1KgQ6Vbds8ZW';
const VERSION = '1.22.4';
const VN_IP = '118.69.135.1';
const SIGNED_PARAMS = ['count', 'ctime', 'id', 'page', 'type', 'version'];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
// used when the home page sets no cookie we can see (NodeLink's fallback)
const FALLBACK_COOKIE =
  'zmp3_app_version.1=1224; zmp3_rqid=MHwxMTgdUngNjkdUngMTM1LjF8djEdUngMjIdUngNHwxNzk0MTAzNTmUsIC2MjQw';

/** the probe script (Node, GitHub Actions) runs this file outside the app: it opts in */
const g = globalThis as unknown as { __HS_NODE_PROBE__?: boolean };
const native = () => Platform.OS !== 'web' || !!g.__HS_NODE_PROBE__;

export interface ZingStream {
  url: string;
  qualityLabel: string;
  durationSec?: number;
}

/** the signed URL for an API path (exported for the probe) */
export function zingApiUrl(path: string, params: Record<string, string | number>): string {
  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) all[k] = String(v);
  all.ctime = String(Math.floor(Date.now() / 1000));
  all.version = VERSION;
  const signed = Object.keys(all)
    .filter((k) => SIGNED_PARAMS.includes(k) && all[k] !== '')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('');
  all.sig = hmacSha512Hex(SECRET_KEY, path + sha256Hex(signed));
  all.apiKey = API_KEY;
  const qs = Object.entries(all)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${DOMAIN}${path}?${qs}`;
}

async function http(
  url: string,
  headers: Record<string, string>,
  withJar: boolean,
  timeoutMs = 8000
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      // the native cookie jar keeps zingmp3.vn's session cookies between calls
      credentials: withJar ? 'include' : 'omit',
      headers: { 'User-Agent': UA, 'X-Forwarded-For': VN_IP, ...headers },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let session: { cookie: string; at: number } | null = null;
let sessionTask: Promise<void> | null = null;

/** visit the home page once per 30 min: it sets the cookies the API expects */
function ensureSession(force = false): Promise<void> {
  if (!force && session && Date.now() - session.at < 30 * 60_000) return Promise.resolve();
  if (!sessionTask) {
    sessionTask = (async () => {
      const res = await http(DOMAIN, { Accept: 'text/html' }, true);
      // iOS hands Set-Cookie to the jar; when the header is visible too (Node), keep a copy
      const raw = res?.headers.get('set-cookie') || '';
      const cookie = raw
        .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
      session = { cookie, at: Date.now() };
    })().finally(() => {
      sessionTask = null;
    });
  }
  return sessionTask;
}

export interface ZingResponse<T = any> {
  err: number;
  msg?: string;
  data?: T;
}

/** a signed API call; `err` 0 is success (Zing answers HTTP 200 with an error code otherwise) */
export async function zingCall<T = any>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<ZingResponse<T> | null> {
  if (!native()) return null;
  await ensureSession();
  const once = async (manualCookie: string): Promise<ZingResponse<T> | null> => {
    const res = await http(
      zingApiUrl(path, params),
      {
        Accept: 'application/json',
        Referer: `${DOMAIN}/`,
        ...(manualCookie ? { Cookie: manualCookie } : {}),
      },
      !manualCookie
    );
    if (!res || !res.ok) return null;
    try {
      return (await res.json()) as ZingResponse<T>;
    } catch {
      return null;
    }
  };
  let body = await once(session?.cookie || '');
  // stale session / blocked request: a fresh session, then the known-good cookie
  if (!body || body.err === -201 || body.err === -403 || body.err === -102) {
    await ensureSession(true);
    body = (await once(session?.cookie || '')) || body;
    if (!body || body.err === -201 || body.err === -403 || body.err === -102)
      body = (await once(FALLBACK_COOKIE)) || body;
  }
  return body;
}

// ── catalogue ──

interface ZingSong {
  encodeId: string;
  title: string;
  artistsNames?: string;
  artists?: { name?: string }[];
  thumbnail?: string;
  thumbnailM?: string;
  duration?: number;
  album?: { title?: string };
  /** 1 = free, 2 = VIP only */
  streamingStatus?: number;
  releaseDate?: number;
}

/** Zing's covers come resized ("w94_r1x1_jpeg"): ask for 600 px */
const bigCover = (u?: string) =>
  u ? u.replace(/\/w\d+_r1x1_(jpeg|webp|jpg)\//, '/w600_r1x1_jpeg/') : '';

const toTrack = (s: ZingSong): Track => {
  const artists = (s.artists || []).map((a) => String(a?.name || '').trim()).filter(Boolean);
  const artist = artists.length ? artists.join(', ') : String(s.artistsNames || 'Zing MP3');
  return {
    id: `zing-${s.encodeId}`,
    title: String(s.title).trim(),
    artist,
    artists: artists.length ? artists : [artist],
    album: s.album?.title || undefined,
    artworkUrl: bigCover(s.thumbnailM || s.thumbnail),
    durationSec: Number(s.duration) || 0,
    source: 'zing',
    qualityBadge: 'MP3 · Zing MP3',
    releaseYear: s.releaseDate ? new Date(s.releaseDate * 1000).getFullYear() : undefined,
  };
};

const playable = (s: ZingSong) => !!s?.encodeId && !!s?.title && s.streamingStatus !== 2;

async function searchSongs(q: string, count: number): Promise<ZingSong[]> {
  const r = await zingCall<{ items?: ZingSong[] }>('/api/v2/search', {
    q,
    type: 'song',
    page: 1,
    count: Math.min(30, Math.max(5, count)),
  });
  let items = r?.err === 0 && Array.isArray(r.data?.items) ? r.data!.items! : [];
  if (!items.length) {
    const m = await zingCall<{ songs?: ZingSong[] }>('/api/v2/search/multi', { q });
    items = m?.err === 0 && Array.isArray(m.data?.songs) ? m.data!.songs! : [];
  }
  return items.filter(playable);
}

export async function searchZingTracks(q: string, limit = 20): Promise<Track[]> {
  const query = q.trim();
  if (!query || !native()) return [];
  const songs = await searchSongs(query, limit).catch(() => [] as ZingSong[]);
  return songs.slice(0, limit).map(toTrack);
}

/** "zing-<encodeId>" → encodeId */
export const zingId = (trackId: string): string | null =>
  /^zing-[A-Z0-9]{6,12}$/i.test(trackId) ? trackId.slice(5) : null;

/** the free stream Zing's player gets for this song, or null (VIP only / not in this region) */
export async function zingStream(
  id: string
): Promise<{ s: ZingStream | null; err?: number; msg?: string }> {
  const r = await zingCall<Record<string, string>>('/api/v2/song/get/streaming', { id });
  if (!r) return { s: null, msg: 'No answer from zingmp3.vn' };
  if (r.err !== 0 || !r.data) return { s: null, err: r.err, msg: r.msg };
  const ok = (u?: string) => typeof u === 'string' && /^https?:\/\//.test(u);
  const u320 = r.data['320'];
  const u128 = r.data['128'];
  if (ok(u320)) return { s: { url: u320, qualityLabel: 'MP3 320 kbps' } };
  if (ok(u128)) return { s: { url: u128, qualityLabel: 'MP3 128 kbps' } };
  return { s: null, err: r.err, msg: 'VIP only' };
}

const why = (err?: number, msg?: string) =>
  err === -1150 || msg === 'VIP only'
    ? 'Zing keeps this song for VIP accounts'
    : err === -1110 || /quốc gia|country|region/i.test(msg || '')
      ? 'Not available in this region (Zing serves Vietnam)'
      : msg || (err != null ? `Zing error ${err}` : 'No stream');

export async function zingStreamById(
  trackId: string,
  pushStep?: (s: DiagnosticStep) => void
): Promise<ZingStream[]> {
  const t0 = Date.now();
  const id = zingId(trackId);
  const r = id && native() ? await zingStream(id) : { s: null as ZingStream | null };
  pushStep?.({
    module: 'Zing MP3',
    step: 'Song stream',
    ok: !!r.s,
    detail: r.s
      ? r.s.qualityLabel
      : native()
        ? why((r as any).err, (r as any).msg)
        : 'iOS app only (no CORS in the browser)',
    latencyMs: Date.now() - t0,
  });
  return r.s ? [r.s] : [];
}

/** Finds any song on Zing MP3: title and artist must agree, and the length when both know it */
export async function resolveZingStream(
  query: TrackQueryInput,
  pushStep: (s: DiagnosticStep) => void
): Promise<ZingStream[]> {
  const t0 = Date.now();
  if (!native()) {
    pushStep({ module: 'Zing MP3', step: 'Catalog match', ok: null, detail: 'iOS app only' });
    return [];
  }
  const songs = await searchSongs(`${query.title} ${query.artists[0] || ''}`.trim(), 10).catch(
    () => [] as ZingSong[]
  );
  const ranked = rankCandidates(
    query,
    songs.map((s) => ({
      id: s.encodeId,
      title: s.title,
      artist: s.artistsNames || (s.artists || []).map((a) => a?.name).join(', '),
      durationSec: Number(s.duration) || undefined,
      song: s,
    })),
    0.72
  );
  let found: { s: ZingStream; title: string } | null = null;
  let last: { err?: number; msg?: string } = {};
  for (const { track } of ranked.slice(0, 2)) {
    if (
      query.durationSec &&
      track.durationSec &&
      query.durationSec > 40 &&
      Math.abs(query.durationSec - track.durationSec) > 6
    )
      continue;
    const r = await zingStream(track.id);
    if (r.s) {
      found = { s: { ...r.s, durationSec: track.durationSec }, title: track.title };
      break;
    }
    last = r;
  }
  pushStep({
    module: 'Zing MP3',
    step: 'Catalog match',
    ok: !!found,
    detail: found
      ? `${found.title} · ${found.s.qualityLabel}`
      : ranked.length
        ? why(last.err, last.msg)
        : songs.length
          ? 'No matching song (title / artist / length)'
          : 'No result',
    latencyMs: Date.now() - t0,
  });
  return found ? [found.s] : [];
}

// ── links ──

/** zingmp3.vn/bai-hat/…/<id>.html, /album/…, /playlist/… → its songs */
export async function fetchZingLink(
  url: string
): Promise<{ name: string; coverUrl?: string; tracks: Track[]; single: boolean } | null> {
  if (!native()) return null;
  const m = url.match(
    /zing(?:mp3)?\.vn\/(bai-hat|album|playlist|embed\/song)\/(?:[^/?#]+\/)?([A-Z0-9]{6,12})(?:\.html)?/i
  );
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const id = m[2];
  if (kind === 'bai-hat' || kind === 'embed/song') {
    const r = await zingCall<ZingSong>('/api/v2/page/get/song', { id });
    const s = r?.err === 0 ? r.data : null;
    if (!s?.encodeId || !s.title) return null;
    const t = toTrack(s);
    return { name: t.title, coverUrl: t.artworkUrl, tracks: [t], single: true };
  }
  const r = await zingCall<{ title?: string; thumbnailM?: string; song?: { items?: ZingSong[] } }>(
    '/api/v2/page/get/playlist',
    { id }
  );
  const p = r?.err === 0 ? r.data : null;
  const items = (p?.song?.items || []).filter((s) => s?.encodeId && s.title);
  if (!p || !items.length) return null;
  return {
    name: p.title || 'Zing MP3',
    coverUrl: bigCover(p.thumbnailM),
    // VIP-only songs stay in the list: they play through the other sources
    tracks: items.map(toTrack),
    single: false,
  };
}

// ── lyrics (word-timed when Zing has them) ──

interface ZingLyric {
  sentences?: { words?: { startTime?: number; endTime?: number; data?: string }[] }[];
  /** an LRC file */
  file?: string;
}

export async function zingLyricsById(
  id: string
): Promise<{ lines: LyricLine[]; wordSynced: boolean; lrc?: string } | null> {
  const r = await zingCall<ZingLyric>('/api/v2/lyric/get/lyric', { id });
  if (!r || r.err !== 0 || !r.data) return null;
  const sentences = Array.isArray(r.data.sentences) ? r.data.sentences : [];
  const lines: LyricLine[] = [];
  sentences.forEach((sen, i) => {
    const words: LyricWord[] = (sen.words || [])
      .filter((w) => typeof w?.data === 'string' && w.data.trim() && Number.isFinite(w.startTime))
      .map((w) => ({
        text: String(w.data).trim(),
        startSec: Number(w.startTime) / 1000,
        endSec: Math.max(Number(w.startTime), Number(w.endTime) || 0) / 1000,
      }));
    if (!words.length) return;
    lines.push({
      id: `zing-${i}`,
      startSec: words[0].startSec,
      endSec: words[words.length - 1].endSec,
      text: words.map((w) => w.text).join(' '),
      words,
    });
  });
  if (lines.length) return { lines, wordSynced: true };
  if (typeof r.data.file === 'string' && /^https?:/.test(r.data.file)) {
    const res = await http(r.data.file, {}, false).catch(() => null);
    const lrc = res && res.ok ? await res.text() : '';
    if (lrc.trim()) return { lines: [], wordSynced: false, lrc };
  }
  return null;
}

/** songs to look lyrics up by (title / artist / length), for the lyrics sources */
export async function searchZingSongs(
  q: string,
  count = 8
): Promise<{ id: string; title: string; artist: string; durationSec?: number; album?: string }[]> {
  if (!native()) return [];
  const r = await zingCall<{ items?: ZingSong[] }>('/api/v2/search', {
    q,
    type: 'song',
    page: 1,
    count,
  });
  const items = r?.err === 0 && Array.isArray(r.data?.items) ? r.data!.items! : [];
  return items
    .filter((s) => s?.encodeId && s.title)
    .map((s) => ({
      id: s.encodeId,
      title: s.title,
      artist: s.artistsNames || (s.artists || []).map((a) => a?.name).join(', '),
      durationSec: Number(s.duration) || undefined,
      album: s.album?.title,
    }));
}
