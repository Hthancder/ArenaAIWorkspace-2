// Bandcamp — independent artists and labels selling their own music, many of whom let anyone
// stream full tracks (MP3 128). HolySic only plays what Bandcamp's own player plays for free:
// a track the artist made buy-only has no stream and is skipped.
//
//   • search: the JSON API bandcamp.com's own search box calls (the HTML search page is now
//     behind a bot challenge), with the mobile-app autocomplete as a fallback
//   • streams: the mobile app's tralbum_details API, asked at play time (the links expire)
//   • links: a track / album page's own data-tralbum
// Approach follows Parachord's and NodeLink's Bandcamp sources. Native iOS only (no CORS).

import { Platform } from 'react-native';
import { DiagnosticStep, Track } from '../../types/music';
import { rankCandidates, TrackQueryInput } from '../trackMatcher';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const native = Platform.OS !== 'web';

export interface BandcampStream {
  url: string;
  qualityLabel: string;
  durationSec?: number;
}

async function http(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<{ status: number; text: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, ...((init.headers as Record<string, string>) || {}) },
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function json(url: string, init: RequestInit = {}): Promise<any> {
  const r = await http(url, init);
  if (!r || r.status !== 200) return null;
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

/** a<art_id>_10 is the 1200 px cover (the search API's own img field 404s) */
const artUrl = (artId?: number | string | null, img?: string) =>
  artId
    ? `https://f4.bcbits.com/img/a${artId}_10.jpg`
    : img
      ? img.replace(/_\d+\.jpg$/, '_10.jpg')
      : '';

/** app_autocomplete doubles its urls ("https://x.bandcamp.comhttps://x.bandcamp.com/track/y") */
const cleanUrl = (u?: string) => {
  if (!u) return '';
  const i = u.lastIndexOf('https://');
  return i > 0 ? u.slice(i) : u;
};

interface Hit {
  trackId: string;
  bandId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl: string;
  url: string;
}

async function searchHits(q: string): Promise<Hit[]> {
  let items: any[] = [];
  const j = await json('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_text: q, search_filter: 't', full_page: false, fan_id: null }),
  });
  items = j?.auto?.results || [];
  if (!items.length) {
    const j2 = await json(
      `https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=${encodeURIComponent(q)}`
    );
    items = (j2?.results || []).filter((x: any) => x?.type === 't');
  }
  return items
    .filter((r) => r?.name && r?.id && r?.band_id && (!r.type || r.type === 't'))
    .map((r) => ({
      trackId: String(r.id),
      bandId: String(r.band_id),
      title: String(r.name).trim(),
      artist: String(r.band_name || 'Bandcamp').trim(),
      album: r.album_name || undefined,
      artworkUrl: artUrl(r.art_id, r.img),
      url: cleanUrl(r.item_url_path || r.url),
    }));
}

const toTrack = (h: Hit, durationSec = 0): Track => ({
  id: `bc-${h.bandId}-${h.trackId}`,
  title: h.title,
  artist: h.artist,
  artists: [h.artist],
  album: h.album,
  artworkUrl: h.artworkUrl,
  durationSec,
  source: 'bandcamp',
  qualityBadge: 'MP3 128 · Bandcamp',
});

export async function searchBandcampTracks(q: string, limit = 20): Promise<Track[]> {
  const query = q.trim();
  if (!query || !native) return [];
  const hits = await searchHits(query).catch(() => [] as Hit[]);
  return hits.slice(0, limit).map((h) => toTrack(h));
}

/** "bc-<band>-<track>" → ids */
export function bandcampIds(trackId: string): { bandId: string; trackId: string } | null {
  const m = trackId.match(/^bc-(\d+)-(\d+)$/);
  return m ? { bandId: m[1], trackId: m[2] } : null;
}

/** The stream Bandcamp's own player plays for this track, or null when it's buy-only */
export async function bandcampStream(
  bandId: string,
  trackId: string
): Promise<BandcampStream | null> {
  if (!native) return null;
  const d = await json(
    `https://bandcamp.com/api/mobile/24/tralbum_details?band_id=${encodeURIComponent(bandId)}&tralbum_type=t&tralbum_id=${encodeURIComponent(trackId)}`
  );
  const tracks: any[] = Array.isArray(d?.tracks) ? d.tracks : [];
  const t = tracks.find((x) => String(x?.track_id) === trackId) || tracks[0];
  const su = t?.streaming_url;
  const url: string | undefined = su?.['mp3-128'] || (su && Object.values(su)[0]);
  if (!url || typeof url !== 'string') return null;
  return {
    url,
    qualityLabel: 'MP3 128 kbps',
    durationSec: Number(t.duration) > 0 ? Math.round(Number(t.duration)) : undefined,
  };
}

export async function bandcampStreamById(
  id: string,
  pushStep?: (s: DiagnosticStep) => void
): Promise<BandcampStream[]> {
  const t0 = Date.now();
  const ids = bandcampIds(id);
  const s = ids ? await bandcampStream(ids.bandId, ids.trackId) : null;
  pushStep?.({
    module: 'Bandcamp',
    step: 'Artist stream',
    ok: !!s,
    detail: s
      ? s.qualityLabel
      : native
        ? 'The artist sells this track without free streaming'
        : 'iOS app only (no CORS in the browser)',
    latencyMs: Date.now() - t0,
  });
  return s ? [s] : [];
}

/**
 * Finds a song on Bandcamp for any track. Strict (indie catalog, many covers): title and artist
 * must agree, and the length too once Bandcamp tells it.
 */
export async function resolveBandcampStream(
  query: TrackQueryInput,
  pushStep: (s: DiagnosticStep) => void
): Promise<BandcampStream[]> {
  const t0 = Date.now();
  if (!native) {
    pushStep({ module: 'Bandcamp', step: 'Catalog match', ok: null, detail: 'iOS app only' });
    return [];
  }
  const hits = await searchHits(`${query.artists[0] || ''} ${query.title}`.trim()).catch(
    () => [] as Hit[]
  );
  const ranked = rankCandidates(
    query,
    hits.map((h) => ({ ...h, id: h.trackId })),
    0.78
  );
  let found: { hit: Hit; s: BandcampStream } | null = null;
  for (const { track } of ranked.slice(0, 2)) {
    const s = await bandcampStream(track.bandId, track.trackId);
    if (!s) continue;
    if (
      query.durationSec &&
      s.durationSec &&
      query.durationSec > 40 &&
      Math.abs(query.durationSec - s.durationSec) > 6
    )
      continue;
    found = { hit: track, s };
    break;
  }
  pushStep({
    module: 'Bandcamp',
    step: 'Catalog match',
    ok: !!found,
    detail: found
      ? `${found.hit.title} · ${found.s.qualityLabel}`
      : ranked.length
        ? 'Match is buy-only or a different length'
        : 'No matching release',
    latencyMs: Date.now() - t0,
  });
  return found ? [found.s] : [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function attrJson(page: string, name: string): any {
  const m = page.match(new RegExp(`data-${name}="([^"]*)"`));
  if (!m) return null;
  try {
    return JSON.parse(decodeEntities(m[1]));
  } catch {
    return null;
  }
}

/** A *.bandcamp.com track or album link → its tracks (streams are asked for at play time) */
export async function fetchBandcampLink(
  url: string
): Promise<{ name: string; coverUrl?: string; tracks: Track[]; single: boolean } | null> {
  if (!native) return null;
  const href = url.trim().replace(/[?#].*$/, '');
  if (!/\/(track|album)\//.test(href)) return null;
  const page = await http(href, { headers: { Accept: 'text/html' } }, 10000);
  if (!page || page.status !== 200) return null;
  const tralbum = attrJson(page.text, 'tralbum');
  const band = attrJson(page.text, 'band');
  const embed = attrJson(page.text, 'embed');
  if (!tralbum?.trackinfo?.length) return null;
  const bandId = String(
    tralbum.current?.band_id ||
      band?.id ||
      embed?.tralbum_param?.band_id ||
      // anywhere else on the page (meta / other data attributes)
      (page.text.match(/band_id(?:&quot;|")\s*:\s*(\d+)/) || [])[1] ||
      ''
  );
  if (!bandId) return null;
  const artist = String(tralbum.artist || band?.name || 'Bandcamp').trim();
  const album = tralbum.item_type === 'album' ? String(tralbum.current?.title || '') : undefined;
  const cover = artUrl(tralbum.art_id);
  const tracks: Track[] = (tralbum.trackinfo as any[])
    .filter((ti) => ti && (ti.track_id || ti.id) && ti.title)
    .map((ti) =>
      toTrack(
        {
          trackId: String(ti.track_id || ti.id),
          bandId,
          title: String(ti.title).trim(),
          artist: String(ti.artist || artist).trim(),
          album,
          artworkUrl: cover,
          url: href,
        },
        Math.round(Number(ti.duration) || 0)
      )
    );
  if (!tracks.length) return null;
  return {
    name: album || tracks[0].title,
    coverUrl: cover,
    tracks,
    single: tralbum.item_type === 'track',
  };
}
