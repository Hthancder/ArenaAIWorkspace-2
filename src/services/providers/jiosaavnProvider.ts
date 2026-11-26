// Direct TypeScript Port of JioSaavnModule.kt from realidkroo/Mochy-Music
// Full-length AAC streams up to 320 kbps with DES-ECB ("38346591") decryption + CORS API mirrors

import { Platform } from 'react-native';
import { JioSaavnQuality } from '../../constants/preferences';
import { DiagnosticStep, Track } from '../../types/music';
import { decryptJioSaavnUrl } from '../des';
import { CatalogCandidate, coreTitle, rankCandidates, TrackQueryInput } from '../trackMatcher';

// jiosaavn-api-privatecvc2.vercel.app answered 402 in the CI probe (scripts/probe-sources.mjs) — removed
const SAAVN_CORS_MIRRORS = ['https://saavn.sumit.co/api/search/songs'];

// JioSaavnModule.kt: browser UA + explicit cookie so uncensored versions show up next to clean ones
const SAAVN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const SAAVN_API_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': SAAVN_UA,
  Cookie: 'explicit_content=1',
};

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

async function fetchTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4200
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function selectRenditionUrl(
  downloadUrls: { quality: string; url: string }[],
  preferred: JioSaavnQuality
): { url: string; kbps: string } | null {
  if (!downloadUrls || downloadUrls.length === 0) return null;
  const target = `${preferred}kbps`;
  const exact = downloadUrls.find((d) => d.quality.toLowerCase().includes(target));
  if (exact?.url) return { url: exact.url, kbps: preferred };
  const sorted = [...downloadUrls].sort((a, b) => {
    const qa = parseInt(a.quality, 10) || 0;
    const qb = parseInt(b.quality, 10) || 0;
    return qb - qa;
  });
  const top = sorted[0];
  if (!top?.url) return null;
  const parsed = parseInt(top.quality, 10);
  return { url: top.url, kbps: parsed ? String(parsed) : preferred };
}

function adjustDirectRendition(givenUrl: string, preferred: JioSaavnQuality): string {
  return givenUrl.replace(/_(12|48|96|160|320)\.(mp4|m4a|aac|mp3)(?=[?#]|$)/i, `_${preferred}.$2`);
}

export async function searchJioSaavnTracks(
  query: string,
  preferredQuality: JioSaavnQuality = '320',
  limit = 15
): Promise<Track[]> {
  if (!query.trim()) return [];
  const encoded = encodeURIComponent(query.trim());

  const viaMirrors = async (): Promise<Track[]> => {
    // 1. Try CORS-enabled Saavn API mirrors (work seamlessly on both Web Preview & iOS)
    for (const mirror of SAAVN_CORS_MIRRORS) {
      try {
        const sep = mirror.includes('?') ? '&' : '?';
        const res = await fetchTimeout(`${mirror}${sep}query=${encoded}&limit=${limit}`, {}, 4000);
        if (!res.ok) continue;
        const body = await res.json();
        const rawResults: any[] = body?.data?.results || body?.results || [];
        if (rawResults.length === 0) continue;

        const tracks: Track[] = [];
        for (const item of rawResults) {
          const title = unescapeHtml(String(item?.name || item?.title || ''));
          const artistList: string[] = Array.isArray(item?.artists?.primary)
            ? item.artists.primary.map((a: any) => unescapeHtml(String(a?.name || '')))
            : String(item?.primaryArtists || '')
                .split(',')
                .map((s) => unescapeHtml(s))
                .filter(Boolean);
          const artist = artistList.join(', ') || 'Unknown Artist';
          const images: any[] = Array.isArray(item?.image) ? item.image : [];
          const bestImg = images[images.length - 1]?.url || images[images.length - 1]?.link || '';
          const downloads: { quality: string; url: string }[] = (item?.downloadUrl || []).map(
            (d: any) => ({
              quality: String(d?.quality || ''),
              url: String(d?.url || d?.link || ''),
            })
          );
          const picked = selectRenditionUrl(downloads, preferredQuality);
          if (!title || !picked?.url) continue;

          tracks.push({
            id: `saavn-${item.id}`,
            title,
            artist,
            artists: artistList,
            album: item?.album?.name ? unescapeHtml(String(item.album.name)) : undefined,
            artworkUrl: bestImg,
            durationSec: Number(item?.duration) || 200,
            explicit: Boolean(item?.explicitContent),
            streamUrl: picked.url,
            source: 'jiosaavn',
            qualityBadge: `AAC ${picked.kbps} kbps`,
            releaseYear: item?.year ? Number(item.year) : undefined,
          });
        }
        if (tracks.length > 0) return tracks;
      } catch {
        // try next mirror
      }
    }

    return [];
  };

  // 2. Direct JioSaavn API with DES-ECB ("38346591") decryption on Native iOS
  const viaDirectApi = async (): Promise<Track[]> => {
    if (Platform.OS !== 'web') {
      try {
        const api = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=android&p=1&n=${limit}&q=${encoded}`;
        const res = await fetchTimeout(api, {
          headers: SAAVN_API_HEADERS,
        });
        if (res.ok) {
          const root = await res.json();
          const results: any[] = root?.results || [];
          const tracks: Track[] = [];
          for (const song of results) {
            const more = song?.more_info;
            const encrypted = more?.encrypted_media_url;
            if (!encrypted) continue;
            const decrypted = decryptJioSaavnUrl(encrypted);
            if (!decrypted) continue;
            const targetQ: JioSaavnQuality =
              preferredQuality === '320' && String(more?.['320kbps']) !== 'true'
                ? '160'
                : preferredQuality;
            const streamUrl = adjustDirectRendition(decrypted, targetQ);
            const primaryArtists: string[] = (more?.artistMap?.primary_artists || []).map(
              (a: any) => unescapeHtml(String(a?.name || ''))
            );
            tracks.push({
              id: `saavn-${song.id}`,
              title: unescapeHtml(String(song.title || '')),
              artist: primaryArtists.join(', ') || 'Unknown Artist',
              artists: primaryArtists,
              album: more?.album ? unescapeHtml(String(more.album)) : undefined,
              artworkUrl: String(song?.image || '').replace(/150x150/g, '500x500'),
              durationSec: Number(more?.duration) || 200,
              streamUrl,
              source: 'jiosaavn',
              qualityBadge: `AAC ${targetQ} kbps`,
            });
          }
          return tracks;
        }
      } catch {
        // ignore
      }
    }

    return [];
  };

  // Native iOS: the official API answers in ~350 ms (probe) and needs no third-party mirror;
  // the browser preview can only use the CORS mirror.
  const strategies = Platform.OS === 'web' ? [viaMirrors] : [viaDirectApi, viaMirrors];
  for (const run of strategies) {
    try {
      const found = await run();
      if (found.length > 0) return found;
    } catch {
      // next strategy
    }
  }
  return [];
}

export async function resolveJioSaavnStream(
  query: TrackQueryInput,
  preferredQuality: JioSaavnQuality,
  onStep: (step: DiagnosticStep) => void
): Promise<{ url: string; qualityLabel: string } | null> {
  const t0 = Date.now();
  const q = `${coreTitle(query.title)} ${query.artists[0] || ''}`.trim();
  const found = await searchJioSaavnTracks(q, preferredQuality, 10);
  if (found.length === 0) {
    onStep({
      module: 'JioSaavn',
      step: 'Catalog search',
      ok: false,
      detail: 'No results or mirror offline',
      latencyMs: Date.now() - t0,
    });
    return null;
  }

  const candidates: (CatalogCandidate & { fullTrack: Track })[] = found.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationSec: t.durationSec,
    streamUrl: t.streamUrl,
    fullTrack: t,
  }));

  const best = rankCandidates(query, candidates, 0.64)[0];
  if (!best || !best.track.streamUrl) {
    onStep({
      module: 'JioSaavn',
      step: 'TrackMatcher',
      ok: false,
      detail: `No close match for "${query.title}"`,
      latencyMs: Date.now() - t0,
    });
    return null;
  }

  const label = best.track.fullTrack.qualityBadge || `AAC ${preferredQuality} kbps`;
  onStep({
    module: 'JioSaavn',
    step: 'Full AAC stream',
    ok: true,
    detail: `${label} (${Math.round(best.score * 100)}% match)`,
    latencyMs: Date.now() - t0,
  });
  return {
    url: best.track.streamUrl,
    qualityLabel: label,
  };
}
