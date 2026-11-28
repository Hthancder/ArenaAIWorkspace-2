// Music videos: find the official video for a song and a stream the iPhone can decode.
//
//   findMusicVideo(track)      → YouTube video id (InnerTube search, Piped fallback), cached
//   resolveVideoStream(id, h)  → H.264 MP4 (video-only, hardware decoded) ≤ h, or the HLS master,
//                                range-probed like the audio links; Piped / Invidious as fallbacks
//
// The picture is always played muted next to the audio engine (EQ, lock screen and gapless keep
// working); "Tiếng từ video" makes the audio come from the same video so both stay in sync.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Track } from '../../types/music';
import { coreTitle } from '../trackMatcher';
import {
  fetchInnerTubePlayer,
  fetchTimeout,
  PIPED_INSTANCES,
  probeMediaUrl,
  searchYouTubeVideos,
  YouTubeVideoHit,
} from '../providers/innertubeProvider';
import {
  invidiousAbs,
  invidiousInstances,
  markInvidiousGood,
  servedAt,
} from '../providers/invidiousProvider';

export interface VideoStream {
  url: string;
  headers?: Record<string, string>;
  height: number;
  /** "720p · H.264 · YouTube visionOS" */
  label: string;
  isHls: boolean;
  /** file size when the host says (InnerTube): lets a save fetch it in ranged chunks */
  bytes?: number;
}

const CACHE_KEY = '@holysic/mv_ids_v1';
const NONE_TTL = 3 * 24 * 3600 * 1000;

type CacheEntry = { id: string | null; at: number };
let cache: Record<string, CacheEntry> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) || '{}') || {};
  } catch {
    cache = {};
  }
  return cache!;
}
function saveCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!cache) return;
    // keep it small: newest 600
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 600);
    cache = Object.fromEntries(entries);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => {});
  }, 800);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);

const BAD =
  /\b(lyrics?|lyric video|karaoke|cover|reaction|nightcore|8d|sped up|slowed|tutorial|instrumental|beat|loop|1 hour|fanmade|fan made|vietsub|tiktok)\b/i;
const VERSION = /\b(remix|live|acoustic|unplugged|piano|orchestral)\b/i;
const GOOD = /\b(official|mv|m\/v|music video|video chính thức)\b/i;

/** 0..1: how likely this video is *the* music video of the song */
export function scoreVideo(track: Track, v: YouTubeVideoHit): number {
  const tWords = words(coreTitle(track.title));
  if (!tWords.length) return 0;
  const hay = new Set(words(`${v.title} ${v.channel}`));
  const titleHit = tWords.filter((w) => hay.has(w)).length / tWords.length;
  if (titleHit < 0.6) return 0;
  const artists = track.artists?.length ? track.artists : [track.artist];
  let artistHit = 0;
  for (const a of artists) {
    const aw = words(a);
    if (aw.length) artistHit = Math.max(artistHit, aw.filter((w) => hay.has(w)).length / aw.length);
  }
  if (artistHit < 0.5) return 0;
  let score = 0.45 * titleHit + 0.35 * artistHit;
  if (GOOD.test(v.title)) score += 0.15;
  if (BAD.test(v.title) && !BAD.test(track.title)) score -= 0.45;
  if (VERSION.test(v.title) !== VERSION.test(track.title)) score -= 0.3;
  if (/\b(official )?audio\b/i.test(v.title) && !/video/i.test(v.title)) score -= 0.2; // still image
  if (/visuali[sz]er/i.test(v.title)) score -= 0.1;
  if (track.durationSec > 40 && v.durationSec > 0) {
    const d = v.durationSec - track.durationSec;
    // a video may add an intro / outro, rarely cuts the song
    if (d < -12 || d > 240) score -= 0.35;
    else if (Math.abs(d) <= 6) score += 0.1;
  }
  if (v.views && v.views > 1_000_000) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

/** Known video id for a song, without any network (undefined = not looked up yet) */
export function peekMusicVideo(track: Track): string | null | undefined {
  if (track.mvId) return track.mvId;
  const hit = cache?.[track.id];
  return hit ? hit.id : undefined;
}

/** load the remembered video ids early (so the first song can use them) */
export const warmVideoCache = () => loadCache().then(() => undefined);

/** The video id for a song (null = no music video), cached on the device */
export async function findMusicVideo(track: Track): Promise<string | null> {
  if (track.mvId) return track.mvId;
  if (track.isLive || track.source === 'radio' || track.source === 'synth') return null;
  const c = await loadCache();
  const hit = c[track.id];
  if (hit && (hit.id || Date.now() - hit.at < NONE_TTL)) return hit.id;
  const artist = (track.artists?.[0] || track.artist || '').replace(/Không rõ nghệ sĩ/i, '');
  const q = `${artist} ${coreTitle(track.title) || track.title} official music video`.trim();
  const list = await searchYouTubeVideos(q, 12);
  const ranked = list
    .map((v) => ({ v, s: scoreVideo(track, v) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s);
  const id = ranked[0]?.v.videoId ?? null;
  // a failed search (offline / blocked) is not remembered as "no video"
  if (id || list.length) {
    c[track.id] = { id, at: Date.now() };
    saveCache();
  }
  return id;
}

const streamCache = new Map<string, { s: VideoStream; at: number }>();

/** A stream for the picture, ≤ maxHeight. Links expire after a few hours: cached for 1 h. */
export async function resolveVideoStream(
  videoId: string,
  maxHeight = 720
): Promise<VideoStream | null> {
  const key = `${videoId}@${maxHeight}`;
  const memo = streamCache.get(key);
  if (memo && Date.now() - memo.at < 3600_000) return memo.s;
  const s =
    (await fromInnerTube(videoId, maxHeight)) ||
    (await fromPiped(videoId, maxHeight)) ||
    (await fromInvidious(videoId, maxHeight));
  if (s) streamCache.set(key, { s, at: Date.now() });
  return s;
}

const isAvc = (mime: string) => /video\/mp4/i.test(mime) && /avc1/i.test(mime);

async function fromInnerTube(videoId: string, maxH: number): Promise<VideoStream | null> {
  const res = await fetchInnerTubePlayer(videoId);
  if (!res) return null;
  const headers = { 'User-Agent': res.userAgent, Accept: '*/*' };
  const fmts: any[] = res.data?.streamingData?.adaptiveFormats || [];
  const vids = fmts
    .filter((f) => f?.url && isAvc(String(f.mimeType || '')) && Number(f.height) > 0)
    .filter((f) => Number(f.height) <= maxH)
    .sort((a, b) => Number(b.height) - Number(a.height) || Number(b.fps) - Number(a.fps));
  for (const f of vids.slice(0, 3)) {
    if (await probeMediaUrl(f.url, headers, Number(f.contentLength) || undefined)) {
      return {
        url: f.url,
        headers,
        height: Number(f.height),
        label: `${f.height}p · H.264 · YouTube ${res.client}`,
        isHls: false,
        bytes: Number(f.contentLength) || undefined,
      };
    }
  }
  const hls = res.data?.streamingData?.hlsManifestUrl;
  if (hls)
    return { url: hls, headers, height: maxH, label: `HLS · YouTube ${res.client}`, isHls: true };
  return null;
}

async function fromPiped(videoId: string, maxH: number): Promise<VideoStream | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetchTimeout(`${base}/streams/${videoId}`, {}, 4000);
      if (!res.ok) continue;
      const data = await res.json();
      const list: any[] = data?.videoStreams || [];
      const h = (v: any) =>
        Number(String(v?.quality || '').match(/(\d+)p/)?.[1]) || Number(v?.height) || 0;
      // web plays anything; iOS wants H.264 in MP4
      const ok = list
        .filter((v) => v?.url && h(v) > 0 && h(v) <= maxH)
        .filter((v) =>
          Platform.OS === 'web'
            ? true
            : isAvc(`${v.mimeType} ${v.codec}`) || /mp4/i.test(v.format || '')
        )
        .sort((a, b) => h(b) - h(a));
      const pick = ok[0];
      if (pick)
        return { url: pick.url, height: h(pick), label: `${h(pick)}p · Piped`, isHls: false };
      if (data?.hls) return { url: data.hls, height: maxH, label: 'HLS · Piped', isHls: true };
    } catch {
      // next instance
    }
  }
  return null;
}

async function fromInvidious(videoId: string, maxH: number): Promise<VideoStream | null> {
  for (const base of await invidiousInstances()) {
    try {
      const res = await fetchTimeout(`${base}/api/v1/videos/${videoId}?local=true`, {}, 4000);
      if (!res.ok) continue;
      const data = await res.json();
      const h = (v: any) =>
        Number(String(v?.resolution || v?.qualityLabel || '').match(/(\d+)p/)?.[1]) || 0;
      const abs = (u: string) => invidiousAbs(base, u);
      const adaptive = ((data?.adaptiveFormats || []) as any[])
        .filter((v) => v?.url && isAvc(String(v.type || '')) && h(v) > 0 && h(v) <= maxH)
        .sort((a, b) => h(b) - h(a));
      const muxed = ((data?.formatStreams || []) as any[]).filter((v) => v?.url);
      // the player route first (reaches invidious-companion), then the API's proxied link
      for (const pick of [adaptive[0], muxed[muxed.length - 1]].filter(Boolean)) {
        const tries = [
          ...(pick.itag
            ? [`${base}/latest_version?id=${videoId}&itag=${pick.itag}&local=true`]
            : []),
          abs(pick.url),
        ];
        for (const u of tries) {
          const url = await servedAt(u, Number(pick.clen) || undefined);
          if (!url) continue;
          markInvidiousGood(base);
          return {
            url,
            height: h(pick) || 360,
            label: `${h(pick) || 360}p · Invidious`,
            isHls: false,
          };
        }
      }
    } catch {
      // next instance
    }
  }
  return null;
}

/** Turn a video search hit into a playable song: audio + picture come from the same video */
export function videoHitToTrack(v: YouTubeVideoHit): Track {
  // "Artist - Title (Official MV)" → artist / title
  const m = v.title.match(/^\s*(.+?)\s+[-–|]\s+(.+)$/);
  const clean = (s: string) =>
    s
      .replace(/[([|【][^)\]】]*(official|mv|m\/v|video|audio|lyric|4k|hd)[^)\]】]*[)\]】]?/gi, '')
      .replace(/\|.*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  const title = clean(m ? m[2] : v.title) || v.title;
  const artist = (m ? m[1].trim() : '') || v.channel || 'YouTube';
  return {
    id: `ytv-${v.videoId}`,
    videoId: v.videoId,
    mvId: v.videoId,
    title,
    artist,
    artists: [artist],
    artworkUrl: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    durationSec: v.durationSec || 210,
    source: 'innertube',
    qualityBadge: 'MV · YouTube',
  };
}
