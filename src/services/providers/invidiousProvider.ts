// Invidious — open-source YouTube front-ends run by volunteers. A second road to YouTube's audio
// (and music videos) when the direct InnerTube clients and Piped don't answer.
//
//   • instances: a few known ones, then the public directory (api.invidious.io), refreshed daily;
//     the last instance that worked is asked first
//   • streams: proxied through the instance (`local=true` — a plain googlevideo link is tied to the
//     instance's IP and would refuse the phone): the player route /latest_version first (it
//     reaches invidious-companion), then the /api/v1/videos link; M4A/AAC only on iOS (AVPlayer
//     can't decode WebM/Opus); range-probed (must really be audio) before it is offered
//   • search: /api/v1/search?type=video
// Instances send CORS headers, so this also works in the browser build.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { DiagnosticStep } from '../../types/music';
import { CatalogCandidate, coreTitle, rankCandidates, TrackQueryInput } from '../trackMatcher';

export const INVIDIOUS_FALLBACK = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.f5.si',
];
const DIRECTORY = 'https://api.invidious.io/instances.json?sort_by=health';
const CACHE_KEY = '@holysic/invidious_instances_v1';
const DAY = 24 * 3600 * 1000;

let custom: string | null = null;
let discovered: string[] | null = null;
let discoveredAt = 0;
let lastGood: string | null = null;
let loading: Promise<void> | null = null;

async function getJson(url: string, ms = 5000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** healthy https instances with the API on, from the public directory */
function parseDirectory(list: any): string[] {
  if (!Array.isArray(list)) return [];
  return (
    list
      .map((row) => (Array.isArray(row) ? row[1] : null))
      .filter((i) => i && i.type === 'https' && i.api !== false && typeof i.uri === 'string')
      .filter((i) => Platform.OS !== 'web' || i.cors !== false)
      .map((i) => String(i.uri).replace(/\/+$/, ''))
      // overlay-network hosts (Yggdrasil, Tor, I2P) are unreachable from a normal connection
      .filter((u) => /^https:\/\//.test(u) && !/\.(ygg|onion|i2p)(:\d+)?$/i.test(u))
      .slice(0, 8)
  );
}

function loadDirectory(): Promise<void> {
  if (discovered && Date.now() - discoveredAt < DAY) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        if (!discovered) {
          const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
          const saved = raw ? JSON.parse(raw) : null;
          if (saved?.list?.length) {
            discovered = saved.list;
            discoveredAt = saved.at || 0;
            lastGood = saved.lastGood || null;
          }
        }
        if (!discovered || Date.now() - discoveredAt > DAY) {
          const list = parseDirectory(await getJson(DIRECTORY, 6000));
          if (list.length) {
            discovered = list;
            discoveredAt = Date.now();
            save();
          }
        }
      } catch {
        // the known instances still work
      }
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

function save() {
  AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ list: discovered || [], at: discoveredAt, lastGood })
  ).catch(() => {});
}

/** "inv.example.org" / "https://inv.example.org/" → "https://inv.example.org"; '' → null */
export function normalizeInstance(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return null;
  const u = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(u) ? u : null;
}

/** Settings › Sources: the user's own instance, asked first */
export function setCustomInvidious(raw: string) {
  custom = normalizeInstance(raw || '');
}

/** instances to try, best first (exported for the music-video fallback) */
export async function invidiousInstances(): Promise<string[]> {
  // never wait long for the directory: the known instances go first anyway
  await Promise.race([loadDirectory(), new Promise((r) => setTimeout(r, 1500))]);
  const all = [
    ...(custom ? [custom] : []),
    ...(lastGood ? [lastGood] : []),
    ...INVIDIOUS_FALLBACK,
    ...(discovered || []),
  ];
  return [...new Set(all)].slice(0, custom ? 8 : 7);
}

/** remember the instance that answered (it is asked first next time) */
export function markInvidiousGood(base: string) {
  if (lastGood === base) return;
  lastGood = base;
  save();
}

export const invidiousAbs = (base: string, u: string) => (u.startsWith('http') ? u : base + u);

// ── search ──

export interface InvidiousVideo {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnail?: string;
}

export async function searchInvidiousVideos(q: string, limit = 12): Promise<InvidiousVideo[]> {
  const query = q.trim();
  if (!query) return [];
  for (const base of await invidiousInstances()) {
    const list = await getJson(
      `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
      5000
    );
    if (!Array.isArray(list)) continue;
    markInvidiousGood(base);
    return list
      .filter((v) => v?.type === 'video' && v.videoId && v.title)
      .slice(0, limit)
      .map((v) => {
        const thumbs: any[] = Array.isArray(v.videoThumbnails) ? v.videoThumbnails : [];
        const th =
          thumbs.find((x) => x?.quality === 'high') ||
          thumbs.find((x) => x?.quality === 'medium') ||
          thumbs[0];
        return {
          videoId: String(v.videoId),
          title: String(v.title),
          author: String(v.author || ''),
          lengthSeconds: Number(v.lengthSeconds) || 0,
          thumbnail: th?.url ? invidiousAbs(base, String(th.url)) : undefined,
        };
      });
  }
  return [];
}

// ── streams ──

export interface InvidiousStream {
  url: string;
  qualityLabel: string;
  codec: string;
  instance: string;
}

/**
 * range-probe: the instance really serves audio there (some disable proxying, or answer with an
 * HTML error page). Returns the final link after redirects (latest_version → the companion).
 */
export async function servedAt(url: string, clen?: number): Promise<string | null> {
  const at = clen && clen > 1 ? Math.min(clen - 1, 1_048_576) : 1_048_576;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Range: `bytes=${at}-${at}` },
    });
    const type = res.headers.get('content-type') || '';
    if (!(res.status === 206 || res.ok) || !/^(audio|video)\/|octet-stream/.test(type)) return null;
    return res.url || url;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The audio of one YouTube video through an Invidious instance. Tried per instance:
 *   1. /latest_version?itag=…&local=true — the player's own route; on instances with
 *      invidious-companion it redirects to the companion that streams it (the API's
 *      /videoplayback links are refused there)
 *   2. the proxied link from /api/v1/videos
 * Instances that switched the API off still often answer (1) for itag 140 (AAC 128k).
 */
export async function invidiousAudio(videoId: string): Promise<InvidiousStream | null> {
  for (const base of await invidiousInstances()) {
    const data = await getJson(`${base}/api/v1/videos/${videoId}?local=true`, 6000);
    const fmts: any[] = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [];
    const audio = fmts
      .filter((f) => f?.url && /^audio\//.test(String(f.type || '')))
      .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    const m4a = audio.filter((f) => /audio\/mp4/.test(String(f.type)));
    // AVPlayer: AAC in MP4 only; the browser also plays Opus
    const picks = (Platform.OS === 'web' ? [...m4a, ...audio] : m4a).slice(0, 2);
    const tries: { url: string; clen?: number; kbps: number; aac: boolean }[] = [];
    for (const f of picks) {
      const kbps = Math.round((Number(f.bitrate) || 128000) / 1000);
      const aac = /mp4/.test(String(f.type));
      if (f.itag)
        tries.push({
          url: `${base}/latest_version?id=${videoId}&itag=${f.itag}&local=true`,
          clen: Number(f.clen) || undefined,
          kbps,
          aac,
        });
      tries.push({
        url: invidiousAbs(base, String(f.url)),
        clen: Number(f.clen) || undefined,
        kbps,
        aac,
      });
    }
    // no format list (API off): the standard AAC 128k
    if (!picks.length)
      tries.push({
        url: `${base}/latest_version?id=${videoId}&itag=140&local=true`,
        kbps: 128,
        aac: true,
      });
    for (const x of tries) {
      const url = await servedAt(x.url, x.clen);
      if (!url) continue;
      markInvidiousGood(base);
      return {
        url,
        qualityLabel: `${x.aac ? 'AAC' : 'Opus'} ${x.kbps} kbps · Invidious`,
        codec: x.aac ? 'AAC' : 'Opus',
        instance: base.replace(/^https?:\/\//, ''),
      };
    }
  }
  return null;
}

const cleanAuthor = (a: string) =>
  a
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*(VEVO|Official( Channel)?)$/i, '')
    .trim();

/**
 * A video title as song candidates: "Ed Sheeran - Shape of You (Official Music Video)" or
 * "SƠN TÙNG M-TP | CHÚNG TA CỦA HIỆN TẠI | OFFICIAL MUSIC VIDEO" — every part is tried as the
 * title, the channel plus the other parts as the artist (the matcher keeps the best).
 */
export function videoCandidates(h: InvidiousVideo): (CatalogCandidate & { vid: string })[] {
  const author = cleanAuthor(h.author);
  const parts = h.title
    .split(/\s+[-–—]\s+|\s*[|｜]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const titles = parts.length > 1 ? [h.title, ...parts] : [h.title];
  return titles.map((title, i) => ({
    id: `${h.videoId}#${i}`,
    vid: h.videoId,
    title,
    artist: [author, ...parts.filter((p) => p !== title)].join(' '),
    durationSec: h.lengthSeconds || undefined,
  }));
}

/** Finds a song on YouTube through Invidious (or uses the video it already has) */
export async function resolveInvidiousStream(
  query: TrackQueryInput,
  pushStep: (s: DiagnosticStep) => void
): Promise<InvidiousStream[]> {
  const t0 = Date.now();
  let videoId = query.videoId;
  if (!videoId) {
    const hits = await searchInvidiousVideos(
      `${query.artists[0] || ''} ${coreTitle(query.title)} audio`.trim(),
      8
    );
    const ranked = rankCandidates(query, hits.flatMap(videoCandidates), 0.6);
    videoId = ranked[0]?.track.vid;
    if (!videoId) {
      pushStep({
        module: 'Invidious',
        step: 'YouTube lookup',
        ok: false,
        detail: hits.length ? 'No matching video' : 'No instance answered',
        latencyMs: Date.now() - t0,
      });
      return [];
    }
  }
  const s = await invidiousAudio(videoId).catch(() => null);
  pushStep({
    module: 'Invidious',
    step: 'Audio stream',
    ok: !!s,
    detail: s ? `${s.qualityLabel} · ${s.instance}` : 'No instance served the audio',
    latencyMs: Date.now() - t0,
  });
  return s ? [s] : [];
}
