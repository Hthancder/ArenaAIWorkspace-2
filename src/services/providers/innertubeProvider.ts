// Port of Mochy's YouTube Music InnerTube Provider (YouTubeClient.kt: IPADOS / VISIONOS / WEB_REMIX)
// Direct InnerTube on Native iOS (AVPlayer supports HLS & M4A natively!) + Piped CORS fallback on Web

import { Platform } from 'react-native';
import { DiagnosticStep, Track } from '../../types/music';
import { CatalogCandidate, coreTitle, rankCandidates, TrackQueryInput } from '../trackMatcher';

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
];

async function fetchTimeout(url: string, init: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Direct YouTube InnerTube iOS / visionOS player extraction on Native iOS devices
 * (ported from YouTubeClient.IPADOS & YouTubeClient.VISIONOS in realidkroo/Mochy-Music)
 */
export interface InnerTubeStreamCandidate {
  url: string;
  qualityLabel: string;
  codec: string;
  headers?: Record<string, string>;
}

async function extractInnerTubeIosStreams(videoId: string): Promise<InnerTubeStreamCandidate[]> {
  const out: InnerTubeStreamCandidate[] = [];
  const clients = [
    {
      clientName: 'IOS',
      clientVersion: '21.03.3',
      deviceMake: 'Apple',
      deviceModel: 'iPad7,6',
      osName: 'iPadOS',
      osVersion: '17.7.10.21H450',
      userAgent: 'com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)',
    },
    {
      clientName: 'VISIONOS',
      clientVersion: '1.04',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.6.0.23O770',
      userAgent: 'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; US)',
    },
  ];

  for (const c of clients) {
    try {
      const res = await fetchTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': c.userAgent,
            'X-YouTube-Client-Name': c.clientName === 'IOS' ? '5' : '101',
            'X-YouTube-Client-Version': c.clientVersion,
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: c.clientName,
                clientVersion: c.clientVersion,
                deviceMake: c.deviceMake,
                deviceModel: c.deviceModel,
                osName: c.osName,
                osVersion: c.osVersion,
                hl: 'en',
                gl: 'VN',
              },
            },
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
        5000
      );

      if (!res.ok) continue;
      const data = await res.json();
      const status = data?.playabilityStatus?.status;
      if (status && status !== 'OK') continue;

      // googlevideo validates the User-Agent of the client that requested the stream,
      // so AVPlayer must send the same UA (forwarded through AVURLAssetHTTPHeaderFieldsKey).
      const headers = { 'User-Agent': c.userAgent };
      const adaptive: any[] = data?.streamingData?.adaptiveFormats || [];
      // Prefer audio/mp4 (AAC M4A itag 140/141) — AVPlayer decodes it natively in hardware
      const mp4Audios = adaptive
        .filter((f) => String(f?.mimeType || '').startsWith('audio/mp4') && f?.url)
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

      if (mp4Audios[0]?.url) {
        const kbps = Math.round((Number(mp4Audios[0].bitrate) || 130000) / 1000);
        out.push({
          url: mp4Audios[0].url,
          qualityLabel: `AAC ${kbps} kbps · InnerTube ${c.clientName}`,
          codec: 'AAC',
          headers,
        });
      }

      if (data?.streamingData?.hlsManifestUrl) {
        out.push({
          url: data.streamingData.hlsManifestUrl,
          qualityLabel: `HLS · InnerTube ${c.clientName}`,
          codec: 'HLS/AAC',
          headers,
        });
      }
      if (out.length > 0) return out;
    } catch {
      // try next client
    }
  }
  return out;
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
          },
          body: JSON.stringify({
            query: query.trim(),
            params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', // Songs filter
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20260401.01.00',
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
        const tracks: Track[] = [];
        const walk = (node: any) => {
          if (!node || typeof node !== 'object' || tracks.length >= limit) return;
          const mrlir = node.musicResponsiveListItemRenderer;
          if (mrlir) {
            const vid =
              mrlir?.playlistItemData?.videoId ||
              mrlir?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
                ?.playNavigationEndpoint?.watchEndpoint?.videoId;
            const cols: any[] = mrlir?.flexColumns || [];
            const titleRuns =
              cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            const subRuns =
              cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            const title = titleRuns[0]?.text;
            const artist = subRuns[0]?.text || 'YouTube Music';
            const thumbs: any[] =
              mrlir?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
            const art = thumbs[thumbs.length - 1]?.url || '';
            if (vid && title) {
              tracks.push({
                id: `yt-${vid}`,
                videoId: vid,
                title,
                artist,
                artists: [artist],
                artworkUrl: art.replace(/=w\d+-h\d+/g, '=w600-h600'),
                durationSec: 210,
                source: 'innertube',
                qualityBadge: 'InnerTube AAC',
              });
            }
          }
          for (const k of Object.keys(node)) {
            walk(node[k]);
          }
        };
        walk(root);
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
    const nativeStreams = await extractInnerTubeIosStreams(targetVideoId);
    if (nativeStreams.length > 0) {
      onStep({
        module: 'InnerTube',
        step: 'iOS/visionOS Player stream',
        ok: true,
        detail: nativeStreams.map((n) => n.codec).join(' + '),
        latencyMs: Date.now() - t0,
      });
      candidates.push(...nativeStreams);
    }
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
