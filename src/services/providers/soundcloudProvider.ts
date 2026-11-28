// SoundCloud — the largest catalog of remixes, DJ sets, demos and underground releases.
//
// Reads SoundCloud the way its own web player does (api-v2), with no account:
//   • the web player's key (client_id) is read at runtime from soundcloud.com's scripts, cached,
//     and read again once when SoundCloud answers 401/403 — nothing fixed in code
//   • only what SoundCloud streams for free to anyone is played: Go+ 30-second snippets, blocked
//     tracks and encrypted (DRM) streams are skipped, never worked around
//   • progressive MP3 first (seekable, and the EQ / visualizer can tap it), HLS AAC / MP3 after
// Approach follows yt-dlp's SoundCloud extractor (Unlicense). Native iOS only: SoundCloud sends
// no CORS headers to other sites, so the browser preview returns nothing.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { DiagnosticStep, Track } from '../../types/music';
import { rankCandidates, TrackQueryInput } from '../trackMatcher';

const API = 'https://api-v2.soundcloud.com';
const KEY_STORE = '@holysic/soundcloud_client_v1';
const KEY_MAX_AGE = 3 * 24 * 3600 * 1000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export interface SoundCloudStream {
  url: string;
  codec: 'MP3' | 'AAC' | 'HLS';
  qualityLabel: string;
}

let clientId: string | null = null;
let discovering: Promise<string | null> | null = null;

const native = Platform.OS !== 'web';

async function request(
  url: string,
  timeoutMs = 8000
): Promise<{ status: number; text: string; url: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    return { status: res.status, text: await res.text(), url: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The 32-character key the web player uses, from soundcloud.com's own scripts */
async function discoverClientId(): Promise<string | null> {
  const page = await request('https://soundcloud.com/', 9000);
  if (!page || page.status !== 200) return null;
  const inline = page.text.match(/client_id["']?\s*[:=]\s*["']([0-9a-zA-Z]{32})["']/);
  if (inline) return inline[1];
  // the key lives in one of the app bundles, usually one of the last ones
  const scripts = Array.from(page.text.matchAll(/<script[^>]+src="([^"]+)"/g))
    .map((m) => m[1])
    .filter((s) => /sndcdn\.com/.test(s))
    .reverse()
    .slice(0, 8);
  for (const src of scripts) {
    const js = await request(src, 9000);
    const m =
      js?.text.match(/client_id\s*:\s*"([0-9a-zA-Z]{32})"/) ||
      js?.text.match(/client_id=([0-9a-zA-Z]{32})/);
    if (m) return m[1];
  }
  return null;
}

async function getClientId(refresh = false): Promise<string | null> {
  if (!native) return null;
  if (clientId && !refresh) return clientId;
  if (!refresh) {
    try {
      const raw = await AsyncStorage.getItem(KEY_STORE);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved?.id && Date.now() - Number(saved.at) < KEY_MAX_AGE) {
        clientId = String(saved.id);
        return clientId;
      }
    } catch {
      // read it fresh
    }
  }
  if (!discovering) {
    discovering = discoverClientId()
      .then((id) => {
        if (id) {
          clientId = id;
          AsyncStorage.setItem(KEY_STORE, JSON.stringify({ id, at: Date.now() })).catch(() => {});
        }
        return id;
      })
      .finally(() => {
        discovering = null;
      });
  }
  return discovering;
}

/** api-v2 call with the runtime key; one fresh key on 401/403 */
async function api(pathOrUrl: string, params: Record<string, string | number> = {}): Promise<any> {
  for (const refresh of [false, true]) {
    const id = await getClientId(refresh);
    if (!id) return null;
    const base = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
    const q = Object.entries({ ...params, client_id: id })
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const res = await request(`${base}${base.includes('?') ? '&' : '?'}${q}`);
    if (!res) return null;
    if (res.status === 401 || res.status === 403) {
      if (!refresh) continue;
      return null;
    }
    if (res.status !== 200) return null;
    try {
      return JSON.parse(res.text);
    } catch {
      return null;
    }
  }
  return null;
}

const bigArt = (u?: string | null) =>
  u ? u.replace(/-(large|t67x67|badge|small|tiny|crop)\.(jpg|png)/, '-t500x500.$2') : '';

/** a Go+ track the free player only snips 30 s from */
function isSnipped(t: any): boolean {
  if (t?.policy === 'SNIP') return true;
  const list: any[] = t?.media?.transcodings || [];
  return list.length > 0 && list.every((x) => x?.snipped || /\/preview\//.test(x?.url || ''));
}

function splitTitle(t: any): { title: string; artist: string } {
  const pm = t?.publisher_metadata || {};
  const uploader = String(t?.user?.username || 'SoundCloud').trim();
  let title = String(t?.title || '').trim();
  let artist = String(pm.artist || '').trim();
  if (!artist) {
    // "Artist - Title" is how most people name uploads
    const m = title.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
    if (m) {
      artist = m[1].trim();
      title = m[2].trim();
    } else artist = uploader;
  }
  return { title, artist };
}

export function soundCloudTrack(t: any): Track | null {
  if (!t?.id || !t?.title || (t.kind && t.kind !== 'track')) return null;
  if (t.streamable === false || t.policy === 'BLOCK' || isSnipped(t)) return null;
  const { title, artist } = splitTitle(t);
  const pm = t.publisher_metadata || {};
  const year = Number(String(t.release_date || t.display_date || t.created_at || '').slice(0, 4));
  return {
    id: `sc-${t.id}`,
    title,
    artist,
    artists: [artist],
    album: pm.album_title || undefined,
    artworkUrl: bigArt(t.artwork_url || t.user?.avatar_url),
    durationSec: Math.round(Number(t.full_duration || t.duration || 0) / 1000),
    isrc: pm.isrc || undefined,
    explicit: pm.explicit || undefined,
    source: 'soundcloud',
    qualityBadge: 'SoundCloud',
    genre: t.genre || undefined,
    releaseYear: year > 1900 ? year : undefined,
  };
}

export async function searchSoundCloudTracks(q: string, limit = 20): Promise<Track[]> {
  const query = q.trim();
  if (!query || !native) return [];
  const j = await api('/search/tracks', { q: query, limit: Math.min(50, limit * 2), offset: 0 });
  const list: any[] = j?.collection || [];
  return list
    .map(soundCloudTrack)
    .filter((x): x is Track => !!x)
    .slice(0, limit);
}

/** Free streams of a track object, best first (never snipped previews, never encrypted ones) */
async function streamsOf(t: any): Promise<SoundCloudStream[]> {
  if (!t || t.policy === 'BLOCK' || isSnipped(t)) return [];
  const rank = (x: any): number => {
    const protocol = String(x?.format?.protocol || '');
    const mime = String(x?.format?.mime_type || '');
    const preset = String(x?.preset || '');
    if (protocol === 'progressive' && /mpeg/.test(mime)) return 0;
    if (protocol === 'progressive') return 1;
    if (protocol === 'hls' && /aac|mp4/.test(mime + preset)) return x?.quality === 'hq' ? 2 : 3;
    if (protocol === 'hls' && /mpeg|mp3/.test(mime + preset)) return 4;
    return 99; // opus HLS (AVPlayer can't), anything unknown
  };
  const usable = ((t.media?.transcodings || []) as any[])
    .filter((x) => {
      const protocol = String(x?.format?.protocol || '');
      return (
        x?.url &&
        !x.snipped &&
        !/\/preview\//.test(x.url) &&
        !/^(ctr-|cbc-)|encrypted/.test(protocol) &&
        !String(x.preset || '').startsWith('abr')
      );
    })
    .sort((a, b) => rank(a) - rank(b))
    .filter((x) => rank(x) < 99)
    .slice(0, 2);
  const out: SoundCloudStream[] = [];
  for (const x of usable) {
    const params: Record<string, string> = {};
    if (t.track_authorization) params.track_authorization = t.track_authorization;
    const j = await api(x.url, params);
    const url: string | undefined = j?.url;
    if (!url || /\/(?:preview|playlist)\/0\/30\//.test(url)) continue;
    const protocol = String(x.format?.protocol || '');
    const mime = String(x.format?.mime_type || '');
    const kbps = (String(x.preset || '').match(/(\d+)k/) || [])[1];
    const aac = /aac|mp4/.test(mime + x.preset);
    out.push({
      url,
      codec: protocol === 'hls' ? 'HLS' : aac ? 'AAC' : 'MP3',
      qualityLabel: `${aac ? 'AAC' : 'MP3'} ${kbps || (aac ? '160' : '128')} kbps${protocol === 'hls' ? ' · HLS' : ''}`,
    });
  }
  return out;
}

/** Streams of a SoundCloud catalog track (id from `sc-<id>`) */
export async function soundCloudStreamsById(
  id: string,
  pushStep?: (s: DiagnosticStep) => void
): Promise<SoundCloudStream[]> {
  const t0 = Date.now();
  const t = await api(`/tracks/${encodeURIComponent(id)}`);
  const list = await streamsOf(t);
  pushStep?.({
    module: 'SoundCloud',
    step: 'Track stream',
    ok: list.length > 0,
    detail: list.length
      ? list[0].qualityLabel
      : !native
        ? 'iOS app only (no CORS in the browser)'
        : t
          ? isSnipped(t)
            ? 'Go+ only — free players get a 30 s snippet (skipped)'
            : 'No free stream for this track'
          : 'Track unavailable',
    latencyMs: Date.now() - t0,
  });
  return list;
}

/**
 * Finds the song on SoundCloud for any track (Spotify imports, charts…). Strict: covers, remixes,
 * sped-up and live versions don't count, and the length must agree when both are known.
 */
export async function resolveSoundCloudStream(
  query: TrackQueryInput,
  pushStep: (s: DiagnosticStep) => void
): Promise<SoundCloudStream[]> {
  const t0 = Date.now();
  if (!native) {
    pushStep({
      module: 'SoundCloud',
      step: 'Catalog match',
      ok: null,
      detail: 'iOS app only (no CORS in the browser)',
    });
    return [];
  }
  const q = `${query.artists[0] || ''} ${query.title}`.trim();
  const j = await api('/search/tracks', { q, limit: 12, offset: 0 });
  const raw: any[] = (j?.collection || []).filter(
    (t: any) => t?.id && t.streamable !== false && t.policy !== 'BLOCK' && !isSnipped(t)
  );
  const cands = raw.map((t) => {
    const s = splitTitle(t);
    return {
      id: String(t.id),
      title: s.title,
      // the uploader often is the artist ("Topic"-style label channels)
      artist: `${s.artist} ${t.user?.username || ''}`,
      durationSec: Math.round(Number(t.full_duration || t.duration || 0) / 1000),
      isrc: t.publisher_metadata?.isrc || undefined,
      raw: t,
    };
  });
  const ranked = rankCandidates(query, cands, 0.74).filter(
    ({ track }) =>
      !query.durationSec ||
      !track.durationSec ||
      query.durationSec < 40 ||
      Math.abs(query.durationSec - track.durationSec) <= 6
  );
  const best = ranked[0]?.track;
  const list = best ? await streamsOf(best.raw) : [];
  pushStep({
    module: 'SoundCloud',
    step: 'Catalog match',
    ok: list.length > 0,
    detail: best
      ? list.length
        ? `${best.title} · ${list[0].qualityLabel}`
        : `${best.title} · no free stream`
      : j
        ? 'No matching upload'
        : 'SoundCloud unavailable',
    latencyMs: Date.now() - t0,
  });
  return list;
}

/** A soundcloud.com / on.soundcloud.com link → its track(s): track, playlist / album, artist */
export async function fetchSoundCloudLink(
  url: string
): Promise<{ name: string; coverUrl?: string; tracks: Track[]; single: boolean } | null> {
  if (!native) return null;
  let href = url.trim();
  if (/on\.soundcloud\.com|soundcloud\.app\.goo\.gl/.test(href)) {
    const r = await request(href);
    if (r?.url) href = r.url;
  }
  href = href.replace(/[?#].*$/, '').replace('://m.soundcloud.com', '://soundcloud.com');
  const ent = await api('/resolve', { url: href });
  if (!ent) return null;
  if (ent.kind === 'track') {
    const t = soundCloudTrack(ent);
    return t ? { name: t.title, coverUrl: t.artworkUrl, tracks: [t], single: true } : null;
  }
  if (ent.kind === 'playlist' || ent.kind === 'system-playlist') {
    let items: any[] = ent.tracks || [];
    // long sets list only ids after the first few tracks
    const missing = items.filter((t) => t?.id && !t.title).map((t) => t.id);
    if (missing.length) {
      const full: Record<string, any> = {};
      for (let i = 0; i < missing.length; i += 50) {
        const batch = await api('/tracks', { ids: missing.slice(i, i + 50).join(',') });
        for (const t of Array.isArray(batch) ? batch : []) full[t.id] = t;
      }
      items = items.map((t) => (t?.title ? t : full[t?.id] || t));
    }
    const tracks = items.map(soundCloudTrack).filter((x): x is Track => !!x);
    return {
      name: String(ent.title || 'SoundCloud'),
      coverUrl: bigArt(ent.artwork_url) || tracks[0]?.artworkUrl,
      tracks,
      single: false,
    };
  }
  if (ent.kind === 'user') {
    const j = await api(`/users/${ent.id}/tracks`, { limit: 50, linked_partitioning: 1 });
    const tracks = ((j?.collection || []) as any[])
      .map(soundCloudTrack)
      .filter((x): x is Track => !!x);
    return {
      name: String(ent.username || 'SoundCloud'),
      coverUrl: bigArt(ent.avatar_url),
      tracks,
      single: false,
    };
  }
  return null;
}
