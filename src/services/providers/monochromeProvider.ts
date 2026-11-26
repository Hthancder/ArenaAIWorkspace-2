// Direct TypeScript Port of MonochromeModule.kt from realidkroo/Mochy-Music
// Lossless FLAC stream resolution + STREAMINFO bit-depth / sample-rate header inspection

import { DiagnosticStep, ModuleServerConfig, Track } from '../../types/music';
import { CatalogCandidate, coreTitle, rankCandidates, TrackQueryInput } from '../trackMatcher';

export const DEFAULT_MONOCHROME_SERVER: ModuleServerConfig = {
  url: 'https://tracks.monochrome.st',
  name: 'tracks.monochrome.st',
  builtIn: true,
  kind: 'streamer',
  lastStatus: 'unknown',
};

const UNREACHABLE_RETRY_MS = 10 * 60 * 1000;
const downServers = new Map<string, { reason: string; at: number }>();

export interface FlacStreamInfo {
  bitsPerSample: number;
  sampleRate: number;
  hiRes: boolean;
  shortLabel: string;
  label: string;
}

/**
 * Exact port of MonochromeModule.flacInfo(bytes) — inspects 'fLaC' magic header + STREAMINFO block:
 * 20 bits sampleRate, 3 bits channels-1, 5 bits bitsPerSample-1
 */
export function parseFlacStreamInfo(bytes: Uint8Array): FlacStreamInfo | null {
  if (bytes.length < 4) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'fLaC') return null;

  let sampleRate = 44100;
  let bits = 16;

  if (bytes.length >= 26) {
    const b18 = bytes[18];
    const b19 = bytes[19];
    const b20 = bytes[20];
    const b21 = bytes[21];
    const parsedRate = (b18 << 12) | (b19 << 4) | (b20 >> 4);
    const parsedBits = (((b20 & 0x01) << 4) | (b21 >> 4)) + 1;
    if (parsedRate >= 8000 && parsedRate <= 768000 && parsedBits >= 8 && parsedBits <= 32) {
      sampleRate = parsedRate;
      bits = parsedBits;
    }
  }

  const hiRes = bits > 16 || sampleRate > 48000;
  const shortLabel = hiRes ? 'Hi-Res FLAC' : 'FLAC';
  const rateKhz =
    sampleRate % 1000 === 0 ? `${sampleRate / 1000}` : (sampleRate / 1000).toFixed(1);
  return {
    bitsPerSample: bits,
    sampleRate,
    hiRes,
    shortLabel,
    label: `${shortLabel} · ${bits}-bit / ${rateKhz} kHz`,
  };
}

async function fetchTimeout(url: string, init: RequestInit = {}, timeoutMs = 4200): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseStreamerTracks(json: any): CatalogCandidate[] {
  const arr = Array.isArray(json?.tracks) ? json.tracks : [];
  const out: CatalogCandidate[] = [];
  for (const t of arr) {
    if (t?.playable === false) continue;
    const id = String(t?.trackId ?? t?.id ?? '');
    const title = String(t?.title ?? '').trim();
    const artists = Array.isArray(t?.artistNames)
      ? t.artistNames.join(', ')
      : String(t?.artist ?? '');
    if (!id || !title || !artists) continue;
    const rawDur = Number(t?.duration ?? 0);
    const durationSec = rawDur > 2000 ? Math.round(rawDur / 1000) : rawDur > 0 ? rawDur : undefined;
    out.push({
      id,
      title,
      artist: artists,
      album: t?.albumTitle || t?.album || undefined,
      durationSec,
      isrc: t?.isrc || undefined,
      artworkUrl: resolveCoverUrl(t?.coverUrl || t?.albumCover || t?.cover || t?.album?.cover),
    });
  }
  return out;
}

/** Accepts full URLs or bare TIDAL-style cover UUIDs and returns a loadable https URL. */
function resolveCoverUrl(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return `https://resources.tidal.com/images/${v.replace(/-/g, '/')}/640x640.jpg`;
  }
  return undefined;
}

function parseRelayTracks(json: any): CatalogCandidate[] {
  const arr = Array.isArray(json?.data) ? json.data : [];
  const out: CatalogCandidate[] = [];
  for (const t of arr) {
    const id = String(t?.id ?? '');
    const title = String(t?.title ?? '').trim();
    const artist = String(t?.artist ?? '').replace(/(?<! )&(?! )/g, ', ');
    if (!id || !title || !artist) continue;
    const rawDur = Number(t?.duration ?? 0);
    out.push({
      id,
      title,
      artist,
      album: t?.album || undefined,
      durationSec: rawDur > 2000 ? Math.round(rawDur / 1000) : rawDur > 0 ? rawDur : undefined,
      artworkUrl: resolveCoverUrl(t?.cover || t?.coverUrl || t?.albumCover || t?.artwork),
    });
  }
  return out;
}

export async function verifyMonochromeServer(
  server: ModuleServerConfig
): Promise<{ ok: boolean; message: string }> {
  const base = server.url.replace(/\/+$/, '');
  try {
    const searchUrl =
      server.kind === 'relay'
        ? `${base}/search?q=test&n=1`
        : `${base}/search/tracks?q=test&limit=1`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (server.kind === 'relay') headers['X-Relay-Client'] = 'relay/2';

    const res = await fetchTimeout(searchUrl, { headers }, 4500);
    if (res.ok) {
      downServers.delete(base);
      return { ok: true, message: `${server.name} · Online (FLAC ready)` };
    }
    return { ok: false, message: `${server.name} answered HTTP ${res.status}` };
  } catch {
    return { ok: false, message: `${server.name} unreachable or blocked by browser CORS` };
  }
}

export async function searchMonochromeCatalog(
  query: string,
  servers: ModuleServerConfig[],
  limit = 12
): Promise<Track[]> {
  const usable = servers.length > 0 ? servers : [DEFAULT_MONOCHROME_SERVER];
  for (const srv of usable) {
    const base = srv.url.replace(/\/+$/, '');
    const down = downServers.get(base);
    if (down && Date.now() - down.at < UNREACHABLE_RETRY_MS) continue;

    try {
      const encoded = encodeURIComponent(query.trim());
      const url =
        srv.kind === 'relay'
          ? `${base}/search?q=${encoded}&n=${limit}`
          : `${base}/search/tracks?q=${encoded}&limit=${limit}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (srv.kind === 'relay') headers['X-Relay-Client'] = 'relay/2';

      const res = await fetchTimeout(url, { headers }, 3800);
      if (!res.ok) continue;
      const data = await res.json();
      const candidates =
        srv.kind === 'relay' ? parseRelayTracks(data) : parseStreamerTracks(data);
      if (candidates.length > 0) {
        return candidates.map((c) => ({
          id: `mono-${c.id}`,
          title: c.title,
          artist: c.artist,
          artists: c.artist.split(/,\s*/),
          album: c.album,
          artworkUrl: c.artworkUrl || '',
          durationSec: c.durationSec || 210,
          isrc: c.isrc,
          streamUrl: srv.kind === 'streamer' ? `${base}/track/${c.id}` : undefined,
          source: 'monochrome',
          qualityBadge: 'FLAC Lossless',
        }));
      }
    } catch {
      downServers.set(base, { reason: 'timeout', at: Date.now() });
    }
  }
  return [];
}

export async function resolveMonochromeStream(
  query: TrackQueryInput,
  servers: ModuleServerConfig[],
  onStep: (step: DiagnosticStep) => void
): Promise<{
  url: string;
  qualityLabel: string;
  sampleRateHz: number;
} | null> {
  const list = servers.length > 0 ? servers : [DEFAULT_MONOCHROME_SERVER];
  for (const srv of list) {
    const base = srv.url.replace(/\/+$/, '');
    const down = downServers.get(base);
    if (down && Date.now() - down.at < UNREACHABLE_RETRY_MS) {
      onStep({
        module: 'Monochrome',
        step: `Skip ${srv.name}`,
        ok: false,
        detail: `Cooling down (${down.reason})`,
      });
      continue;
    }

    const t0 = Date.now();
    const q = `${query.artists[0] || ''} ${coreTitle(query.title)}`.trim();
    const searchUrl =
      srv.kind === 'relay'
        ? `${base}/search?q=${encodeURIComponent(q)}&n=8`
        : `${base}/search/tracks?q=${encodeURIComponent(q)}&limit=8`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (srv.kind === 'relay') headers['X-Relay-Client'] = 'relay/2';

    try {
      const res = await fetchTimeout(searchUrl, { headers }, 3600);
      if (!res.ok) {
        onStep({
          module: 'Monochrome',
          step: 'Catalog search',
          ok: false,
          detail: `${srv.name} HTTP ${res.status}`,
          latencyMs: Date.now() - t0,
        });
        continue;
      }
      const data = await res.json();
      const candidates =
        srv.kind === 'relay' ? parseRelayTracks(data) : parseStreamerTracks(data);
      const best = rankCandidates(query, candidates)[0];
      if (!best) {
        onStep({
          module: 'Monochrome',
          step: 'TrackMatcher',
          ok: false,
          detail: `No match >= 0.66 on ${srv.name}`,
          latencyMs: Date.now() - t0,
        });
        continue;
      }

      if (srv.kind === 'streamer') {
        const trackUrl = `${base}/track/${best.track.id}`;
        const headRes = await fetchTimeout(
          trackUrl,
          { headers: { Range: 'bytes=0-41' } },
          3500
        );
        if (!headRes.ok) continue;
        const buf = new Uint8Array(await headRes.arrayBuffer());
        const flac = parseFlacStreamInfo(buf);
        if (!flac) {
          onStep({
            module: 'Monochrome',
            step: 'Verify FLAC header',
            ok: false,
            detail: 'Response did not start with fLaC STREAMINFO',
          });
          continue;
        }
        onStep({
          module: 'Monochrome',
          step: 'Stream ready',
          ok: true,
          detail: `${flac.label} (${Math.round(best.score * 100)}% match)`,
          latencyMs: Date.now() - t0,
        });
        return {
          url: trackUrl,
          qualityLabel: flac.label,
          sampleRateHz: flac.sampleRate,
        };
      } else {
        const relayOpen = await fetchTimeout(
          `${base}/s/${encodeURIComponent(best.track.id)}?q=flac`,
          { headers: { ...headers, Range: 'bytes=0-41' } },
          3500
        );
        const streamHeader = relayOpen.headers.get('x-relay-stream');
        if (relayOpen.ok && streamHeader) {
          const buf = new Uint8Array(await relayOpen.arrayBuffer());
          const flac = parseFlacStreamInfo(buf);
          onStep({
            module: 'Monochrome',
            step: 'Relay stream ready',
            ok: true,
            detail: flac?.label || 'FLAC Lossless',
            latencyMs: Date.now() - t0,
          });
          return {
            url: streamHeader,
            qualityLabel: flac?.label || 'FLAC · 16-bit / 44.1 kHz',
            sampleRateHz: flac?.sampleRate || 44100,
          };
        }
      }
    } catch {
      downServers.set(base, { reason: 'unreachable', at: Date.now() });
      onStep({
        module: 'Monochrome',
        step: `Connect ${srv.name}`,
        ok: false,
        detail: 'Server offline or unreachable',
        latencyMs: Date.now() - t0,
      });
    }
  }
  return null;
}
