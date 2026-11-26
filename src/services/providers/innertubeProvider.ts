// Port of Mochy's YouTube Music InnerTube Provider (YouTubeClient.kt / YTPlayerUtils.kt: VISIONOS → ANDROID_VR → IPADOS, WEB_REMIX search)
// Direct InnerTube on Native iOS (AVPlayer supports HLS & M4A natively!) + Piped CORS fallback on Web

import { Platform } from 'react-native';
import { DiagnosticStep, Track } from '../../types/music';
import { CatalogCandidate, coreTitle, rankCandidates, TrackQueryInput } from '../trackMatcher';

const PIPED_INSTANCES = ['https://pipedapi.kavin.rocks', 'https://api.piped.private.coffee'];

async function fetchTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Direct YouTube InnerTube player extraction on native iOS, following YTPlayerUtils.kt:
 *
 * - VISIONOS is the MAIN_CLIENT: it is the only client measured upstream to serve a complete
 *   track without a PoToken. It mints its own visitor id (POST /youtubei/v1/visitor_id), speaks
 *   api format 2 with clientScreen WATCH / platform MOBILE, and sends no Origin/Referer.
 * - IOS / IPADOS come last: their links look healthy but googlevideo stops serving them after the
 *   ~786 KB "untokened window" (≈30 s) — that was the "only plays 30 seconds" bug.
 * - Every link is range-probed past that window (last byte, or byte 1 MiB) before it is offered,
 *   exactly like YTPlayerUtils.validateStatus(), so a cut-off link never reaches AVPlayer.
 */
export interface InnerTubeStreamCandidate {
  url: string;
  qualityLabel: string;
  codec: string;
  headers?: Record<string, string>;
  /** -loudnessDb from playerConfig.audioConfig (YouTube's own loudness measurement) */
  gainDb?: number;
}

interface YtClient {
  name: string;
  clientName: string;
  clientVersion: string;
  clientId: string;
  userAgent: string;
  osName?: string;
  osVersion?: string;
  deviceMake?: string;
  deviceModel?: string;
  apiFormatVersion?: string;
  clientScreen?: string;
  platform?: string;
  ownVisitorId?: boolean;
}

const VISIONOS: YtClient = {
  name: 'visionOS',
  clientName: 'VISIONOS',
  clientVersion: '1.04',
  clientId: '101',
  userAgent:
    'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; US)',
  osName: 'visionOS',
  osVersion: '26.6.0.23O770',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  apiFormatVersion: '2',
  clientScreen: 'WATCH',
  platform: 'MOBILE',
  ownVisitorId: true,
};

const ANDROID_VR: YtClient = {
  name: 'Android VR',
  clientName: 'ANDROID_VR',
  clientVersion: '1.61.48',
  clientId: '28',
  userAgent:
    'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
  osName: 'Android',
  osVersion: '12',
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
};

const IPADOS: YtClient = {
  name: 'iPadOS',
  clientName: 'IOS',
  clientVersion: '21.03.3',
  clientId: '5',
  userAgent: 'com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)',
  osName: 'iPadOS',
  osVersion: '17.7.10.21H450',
  deviceMake: 'Apple',
  deviceModel: 'iPad7,6',
};

const STREAM_CLIENTS: YtClient[] = [VISIONOS, ANDROID_VR, IPADOS];

const UNTOKENED_WINDOW_PROBE_BYTE = 1_048_576;
const visitorIds = new Map<string, string>();
/** visionOS rests for a while after two bot checks in a row, like upstream's BOT_CHECK_REST_MS */
let visionRestingUntil = 0;

function clientContext(c: YtClient, visitorData?: string) {
  return {
    client: {
      clientName: c.clientName,
      clientVersion: c.clientVersion,
      ...(c.clientScreen ? { clientScreen: c.clientScreen, utcOffsetMinutes: 0 } : {}),
      ...(c.platform ? { platform: c.platform } : {}),
      ...(c.osName ? { osName: c.osName } : {}),
      ...(c.osVersion ? { osVersion: c.osVersion } : {}),
      ...(c.deviceMake ? { deviceMake: c.deviceMake } : {}),
      ...(c.deviceModel ? { deviceModel: c.deviceModel } : {}),
      hl: 'en',
      gl: 'VN',
      ...(visitorData ? { visitorData } : {}),
    },
  };
}

function clientHeaders(c: YtClient, visitorData?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': c.userAgent,
    'X-YouTube-Client-Name': c.clientId,
    'X-YouTube-Client-Version': c.clientVersion,
    'X-Goog-Api-Format-Version': c.apiFormatVersion || '1',
    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
  };
}

async function mintVisitorId(c: YtClient, force = false): Promise<string | undefined> {
  if (!force && visitorIds.has(c.clientName)) return visitorIds.get(c.clientName);
  try {
    const res = await fetchTimeout(
      'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false',
      {
        method: 'POST',
        headers: clientHeaders(c),
        body: JSON.stringify({ context: clientContext(c) }),
      },
      3500
    );
    if (!res.ok) return undefined;
    const j = await res.json();
    const v = j?.responseContext?.visitorData;
    if (typeof v === 'string' && v) {
      visitorIds.set(c.clientName, v);
      return v;
    }
  } catch {
    // request goes out without one
  }
  return undefined;
}

async function playerRequest(c: YtClient, videoId: string, visitorData?: string): Promise<any> {
  const res = await fetchTimeout(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: clientHeaders(c, visitorData),
      body: JSON.stringify({
        context: clientContext(c, visitorData),
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
    5000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isBotCheck = (data: any) =>
  data?.playabilityStatus?.status === 'LOGIN_REQUIRED' &&
  /bot/i.test(String(data?.playabilityStatus?.reason || ''));

/** Range-probes past the untokened window; 206/200 = served, 403 = cut off */
async function validateStream(
  url: string,
  headers: Record<string, string>,
  contentLength?: number
): Promise<boolean> {
  const offset =
    contentLength && contentLength > 1 ? contentLength - 1 : UNTOKENED_WINDOW_PROBE_BYTE;
  try {
    const res = await fetchTimeout(
      url,
      { headers: { ...headers, Range: `bytes=${offset}-${offset}` } },
      4000
    );
    return res.ok || res.status === 206 || (res.status === 416 && !contentLength);
  } catch {
    return false;
  }
}

/** HLS: checks the last segment of the first audio rendition is still served */
async function validateHls(master: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const m = await fetchTimeout(master, { headers }, 4000);
    if (!m.ok) return false;
    const text = await m.text();
    const media =
      (text.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"]+)"/) || [])[1] ||
      text.split('\n').find((l) => l.startsWith('http'));
    if (!media) return false;
    const pl = await fetchTimeout(media, { headers }, 4000);
    if (!pl.ok) return false;
    const segs = (await pl.text()).split('\n').filter((l) => l && !l.startsWith('#'));
    const last = segs[segs.length - 1];
    if (!last) return false;
    const segUrl = last.startsWith('http') ? last : media.replace(/[^/]*$/, '') + last;
    const r = await fetchTimeout(segUrl, { headers: { ...headers, Range: 'bytes=0-1' } }, 4000);
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

async function extractInnerTubeIosStreams(
  videoId: string,
  onStep: (step: DiagnosticStep) => void
): Promise<InnerTubeStreamCandidate[]> {
  for (const c of STREAM_CLIENTS) {
    if (c === VISIONOS && Date.now() < visionRestingUntil) {
      onStep({
        module: 'InnerTube',
        step: 'visionOS',
        ok: false,
        detail: 'Resting after bot checks',
      });
      continue;
    }
    const t0 = Date.now();
    try {
      let visitor = c.ownVisitorId ? await mintVisitorId(c) : undefined;
      let data = await playerRequest(c, videoId, visitor);
      if (c.ownVisitorId && isBotCheck(data)) {
        // a burned visitor id gets "confirm you're not a bot": mint a fresh one and ask once more
        visitor = await mintVisitorId(c, true);
        data = await playerRequest(c, videoId, visitor);
        if (isBotCheck(data) && c === VISIONOS) visionRestingUntil = Date.now() + 30 * 60 * 1000;
      }

      const status = data?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        onStep({
          module: 'InnerTube',
          step: `${c.name} player`,
          ok: false,
          detail: `${status}${data?.playabilityStatus?.reason ? ' · ' + String(data.playabilityStatus.reason).slice(0, 60) : ''}`,
          latencyMs: Date.now() - t0,
        });
        continue;
      }

      // googlevideo checks the UA against the client named in the url's own `c=` parameter,
      // so AVPlayer sends the same UA (forwarded through AVURLAssetHTTPHeaderFieldsKey).
      const headers = { 'User-Agent': c.userAgent, Accept: '*/*' };
      const adaptive: any[] = data?.streamingData?.adaptiveFormats || [];
      const loud = Number(data?.playerConfig?.audioConfig?.loudnessDb);
      const gainDb = Number.isFinite(loud) ? -loud : undefined;
      // AVPlayer decodes AAC in MP4 natively (itag 140/139); WebM/Opus is not playable on iOS 15
      const mp4Audios = adaptive
        .filter((f) => String(f?.mimeType || '').startsWith('audio/mp4') && f?.url)
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

      const out: InnerTubeStreamCandidate[] = [];
      for (const f of mp4Audios.slice(0, 2)) {
        const ok = await validateStream(f.url, headers, Number(f.contentLength) || undefined);
        if (!ok) continue;
        const kbps = Math.round((Number(f.bitrate) || 130000) / 1000);
        out.push({
          url: f.url,
          qualityLabel: `AAC ${kbps} kbps · YouTube ${c.name}`,
          codec: 'AAC',
          headers,
          gainDb,
        });
        break;
      }

      const hls = data?.streamingData?.hlsManifestUrl;
      if (out.length === 0 && hls && (await validateHls(hls, headers))) {
        out.push({
          url: hls,
          qualityLabel: `HLS · YouTube ${c.name}`,
          codec: 'HLS/AAC',
          headers,
          gainDb,
        });
      }

      onStep({
        module: 'InnerTube',
        step: `${c.name} player`,
        ok: out.length > 0,
        detail:
          out.length > 0
            ? out.map((o) => o.qualityLabel).join(' + ')
            : `${mp4Audios.length} AAC link(s) cut off before the full track (no PoToken)`,
        latencyMs: Date.now() - t0,
      });
      if (out.length > 0) return out;
    } catch (e: any) {
      onStep({
        module: 'InnerTube',
        step: `${c.name} player`,
        ok: false,
        detail: String(e?.message || 'network error').slice(0, 60),
        latencyMs: Date.now() - t0,
      });
    }
  }
  return [];
}

/** Walks any YouTube Music response (search, playlist, album) for song rows */
export function parseMusicListItems(root: any, limit = 200): Track[] {
  const tracks: Track[] = [];
  const seen = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || tracks.length >= limit) return;
    const mrlir = node.musicResponsiveListItemRenderer;
    if (mrlir) {
      const vid =
        mrlir?.playlistItemData?.videoId ||
        mrlir?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchEndpoint?.videoId;
      const cols: any[] = mrlir?.flexColumns || [];
      const titleRuns = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const subRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const title = titleRuns[0]?.text;
      const artist = subRuns[0]?.text || 'YouTube Music';
      const thumbs: any[] = mrlir?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const art = thumbs[thumbs.length - 1]?.url || '';
      const durText: string =
        mrlir?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]
          ?.text || '';
      const durParts = durText.split(':').map((x) => Number(x));
      const dur =
        durParts.every((n) => Number.isFinite(n)) && durParts.length >= 2
          ? durParts.reduce((acc, n) => acc * 60 + n, 0)
          : 210;
      if (vid && title && !seen.has(vid)) {
        seen.add(vid);
        tracks.push({
          id: `yt-${vid}`,
          videoId: vid,
          title,
          artist,
          artists: [artist],
          artworkUrl: art.replace(/=w\d+-h\d+/g, '=w600-h600'),
          durationSec: dur || 210,
          source: 'innertube',
          qualityBadge: 'InnerTube AAC',
        });
      }
    }
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(root);
  return tracks;
}

/** A public YouTube / YouTube Music playlist (native iOS — the browse API has no CORS) */
export async function fetchYouTubeMusicPlaylist(
  playlistId: string
): Promise<{ name: string; tracks: Track[] } | null> {
  try {
    const res = await fetchTimeout(
      'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
        },
        body: JSON.stringify({
          browseId: playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`,
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20260707.12.00',
              hl: 'vi',
              gl: 'VN',
            },
          },
        }),
      },
      9000
    );
    if (!res.ok) return null;
    const root = await res.json();
    const name =
      root?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text ||
      root?.header?.musicResponsiveHeaderRenderer?.title?.runs?.[0]?.text ||
      root?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer?.title?.runs?.[0]
        ?.text ||
      'YouTube Music playlist';
    return { name, tracks: parseMusicListItems(root, 300) };
  } catch {
    return null;
  }
}

/**
 * Remote client list (Musike's streaming.json idea): when YouTube changes which clients serve full
 * tracks, the order can be updated from the repository without shipping a new IPA.
 */
const REMOTE_CLIENTS_URLS = [
  'https://raw.githubusercontent.com/Hthancder/ArenaAIWorkspace-2/main/config/streaming.json',
  'https://raw.githubusercontent.com/Hthancder/ArenaAIWorkspace-2/refs/heads/arena/af5aae1b-arenaaiworkspace-2/config/streaming.json',
];
let remoteClientsLoaded = false;
export async function refreshRemoteStreamClients(): Promise<string[] | null> {
  if (remoteClientsLoaded) return null;
  remoteClientsLoaded = true;
  for (const url of REMOTE_CLIENTS_URLS) {
    try {
      const res = await fetchTimeout(url, {}, 5000);
      if (!res.ok) continue;
      const j = await res.json();
      const list: unknown = j?.ios;
      if (Array.isArray(list) && list.every((x) => typeof x === 'string')) {
        const byName: Record<string, YtClient> = { VISIONOS, ANDROID_VR, IPADOS, IOS: IPADOS };
        const next = (list as string[]).map((n) => byName[n]).filter(Boolean) as YtClient[];
        if (next.length > 0) {
          STREAM_CLIENTS.splice(0, STREAM_CLIENTS.length, ...Array.from(new Set(next)));
          return list as string[];
        }
      }
    } catch {
      // keep the built-in order
    }
  }
  return null;
}

export async function searchInnerTubeTracks(query: string, limit = 12): Promise<Track[]> {
  if (!query.trim()) return [];

  // Native iOS: Direct WEB_REMIX search to music.youtube.com
  if (Platform.OS !== 'web') {
    try {
      const res = await fetchTimeout(
        'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://music.youtube.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
          },
          body: JSON.stringify({
            query: query.trim(),
            params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', // Songs filter
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20260707.12.00',
                hl: 'vi',
                gl: 'VN',
              },
            },
          }),
        },
        4800
      );

      if (res.ok) {
        const root = await res.json();
        const tracks = parseMusicListItems(root, limit);
        if (tracks.length > 0) return tracks;
      }
    } catch {
      // fallback below
    }
  }

  // Web & Fallback: CORS-friendly Piped music search
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetchTimeout(
        `${base}/search?q=${encodeURIComponent(query.trim())}&filter=music_songs`,
        {},
        3600
      );
      if (!res.ok) continue;
      const data = await res.json();
      const items: any[] = data?.items || [];
      const tracks: Track[] = [];
      for (const item of items.slice(0, limit)) {
        const match = String(item?.url || '').match(/v=([a-zA-Z0-9_-]{11})/);
        const vid = match?.[1];
        if (!vid || !item?.title) continue;
        tracks.push({
          id: `yt-${vid}`,
          videoId: vid,
          title: String(item.title),
          artist: String(item.uploaderName || 'YouTube Music').replace(/ - Topic$/i, ''),
          artists: [String(item.uploaderName || 'YouTube Music').replace(/ - Topic$/i, '')],
          artworkUrl: String(item.thumbnail || ''),
          durationSec: Number(item.duration) || 200,
          source: 'innertube',
          qualityBadge: 'InnerTube M4A',
        });
      }
      if (tracks.length > 0) return tracks;
    } catch {
      // try next instance
    }
  }

  return [];
}

export async function resolveInnerTubeStream(
  query: TrackQueryInput,
  onStep: (step: DiagnosticStep) => void
): Promise<InnerTubeStreamCandidate[]> {
  const t0 = Date.now();
  let targetVideoId = query.videoId;

  if (!targetVideoId) {
    const q = `${query.artists[0] || ''} ${coreTitle(query.title)}`.trim();
    const results = await searchInnerTubeTracks(q, 6);
    const candidates: (CatalogCandidate & { vid?: string })[] = results.map((t) => ({
      id: t.id,
      vid: t.videoId,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
    }));
    const best = rankCandidates(query, candidates, 0.6)[0];
    targetVideoId = best?.track.vid;
  }

  if (!targetVideoId) {
    onStep({
      module: 'InnerTube',
      step: 'YouTube Music lookup',
      ok: false,
      detail: Platform.OS === 'web' ? 'Skipped on browser CORS' : 'No matching videoId',
      latencyMs: Date.now() - t0,
    });
    return [];
  }

  const candidates: InnerTubeStreamCandidate[] = [];
  if (Platform.OS !== 'web') {
    const nativeStreams = await extractInnerTubeIosStreams(targetVideoId, onStep);
    candidates.push(...nativeStreams);
  }

  // Piped stream endpoint (Web, or iOS when direct InnerTube extraction returned nothing)
  for (const base of candidates.length > 0 ? [] : PIPED_INSTANCES) {
    try {
      const res = await fetchTimeout(`${base}/streams/${targetVideoId}`, {}, 3600);
      if (!res.ok) continue;
      const data = await res.json();
      const audioStreams: any[] = data?.audioStreams || [];
      const m4a = audioStreams
        .filter((s) => String(s?.mimeType || '').includes('mp4') && s?.url)
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      // AVPlayer cannot decode WebM/Opus, so only accept M4A on native iOS
      const picked = m4a[0] || (Platform.OS === 'web' ? audioStreams[0] : undefined);
      if (picked?.url) {
        const kbps = Math.round((Number(picked.bitrate) || 128000) / 1000);
        onStep({
          module: 'InnerTube',
          step: 'Audio stream',
          ok: true,
          detail: `AAC ${kbps} kbps`,
          latencyMs: Date.now() - t0,
        });
        candidates.push({
          url: picked.url,
          qualityLabel: `AAC ${kbps} kbps · Piped`,
          codec: 'AAC',
        });
        break;
      }
    } catch {
      // next instance
    }
  }

  if (candidates.length === 0) {
    onStep({
      module: 'InnerTube',
      step: 'Stream extraction',
      ok: false,
      detail: 'All InnerTube/Piped relays unavailable',
      latencyMs: Date.now() - t0,
    });
  }
  return candidates;
}

/** Search-as-you-type suggestions from YouTube Music (Musike); native only — no CORS on web */
export async function fetchInnerTubeSuggestions(input: string): Promise<string[]> {
  if (Platform.OS === 'web' || input.trim().length < 2) return [];
  try {
    const res = await fetchTimeout(
      'https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
        },
        body: JSON.stringify({
          input,
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20260707.12.00',
              hl: 'vi',
              gl: 'VN',
            },
          },
        }),
      },
      2500
    );
    if (!res.ok) return [];
    const root = await res.json();
    const out: string[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object' || out.length >= 8) return;
      const runs = n.searchSuggestionRenderer?.suggestion?.runs;
      if (Array.isArray(runs)) {
        out.push(runs.map((r: any) => r?.text || '').join(''));
        return;
      }
      for (const k of Object.keys(n)) walk(n[k]);
    };
    walk(root);
    return out.filter(Boolean);
  } catch {
    return [];
  }
}
