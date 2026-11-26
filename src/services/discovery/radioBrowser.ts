// Live internet radio from Radio Browser (radio-browser.info) — a free, community-run directory of
// 50,000+ stations worldwide, with no API key. HolySic turns stations into live "tracks".

import { Platform } from 'react-native';
import { Track } from '../../types/music';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
];
let preferred = 0;

export interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  codec: string;
  bitrate: number;
  hls: number;
  clickcount: number;
  lastcheckok: number;
}

async function get(path: string): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Radio Browser asks apps to identify themselves (browsers don't allow setting User-Agent)
  if (Platform.OS !== 'web') headers['User-Agent'] = 'HolySic/1.0';
  for (let i = 0; i < MIRRORS.length; i++) {
    const idx = (preferred + i) % MIRRORS.length;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const res = await fetch(`${MIRRORS[idx]}${path}`, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      preferred = idx;
      return await res.json();
    } catch {
      /* next mirror */
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

export function stationToTrack(s: RadioStation): Track {
  const tags = (s.tags || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const nice = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const codec = (s.codec || '').toUpperCase();
  return {
    id: `radio-${s.stationuuid}`,
    title: s.name.trim().replace(/\s+/g, ' '),
    artist:
      [s.country || s.countrycode, ...tags.slice(0, 2).map(nice)].filter(Boolean).join(' · ') ||
      'Radio',
    artworkUrl: s.favicon && /^https?:\/\//.test(s.favicon) ? s.favicon : '',
    durationSec: 0,
    source: 'radio',
    streamUrl: s.url_resolved || s.url,
    isLive: true,
    qualityBadge: `LIVE${codec && codec !== 'UNKNOWN' ? ` · ${codec}` : ''}${s.bitrate ? ` ${s.bitrate}k` : ''}`,
    genre: tags[0],
  };
}

function usable(s: RadioStation): boolean {
  const url = s.url_resolved || s.url;
  if (!url || !s.name?.trim()) return false;
  // AVPlayer handles MP3 / AAC / HLS; skip formats iOS can't play
  const c = (s.codec || '').toUpperCase();
  return !['OGG', 'FLAC', 'WMA', 'OPUS'].includes(c);
}

export async function searchStations(opts: {
  name?: string;
  countrycode?: string;
  tag?: string;
  limit?: number;
}): Promise<Track[]> {
  // (built by hand: React Native's URLSearchParams is incomplete)
  const q: [string, string][] = [];
  if (opts.name) q.push(['name', opts.name]);
  if (opts.countrycode) q.push(['countrycode', opts.countrycode.toUpperCase()]);
  if (opts.tag) q.push(['tag', opts.tag]);
  q.push(['hidebroken', 'true'], ['order', 'clickcount'], ['reverse', 'true']);
  q.push(['limit', String((opts.limit || 40) + 10)]);
  const qs = q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const list = (await get(`/json/stations/search?${qs}`)) as RadioStation[];
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : [])
    .filter(usable)
    .filter((s) => {
      const k = s.name.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, opts.limit || 40)
    .map(stationToTrack);
}

/** Counts a play for the station (Radio Browser's popularity ranking); fire-and-forget. */
export function registerStationClick(trackId: string): void {
  const uuid = trackId.replace(/^radio-/, '');
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return;
  get(`/json/url/${uuid}`).catch(() => undefined);
}

export const RADIO_TAGS = [
  { id: 'pop', vi: 'Pop', en: 'Pop' },
  { id: 'lofi', vi: 'Lo-fi', en: 'Lo-fi' },
  { id: 'chill', vi: 'Chill', en: 'Chill' },
  { id: 'jazz', vi: 'Jazz', en: 'Jazz' },
  { id: 'classical', vi: 'Cổ điển', en: 'Classical' },
  { id: 'kpop', vi: 'K-Pop', en: 'K-Pop' },
  { id: 'news', vi: 'Tin tức', en: 'News' },
  { id: 'rock', vi: 'Rock', en: 'Rock' },
  { id: 'edm', vi: 'EDM', en: 'EDM' },
  { id: 'ambient', vi: 'Ambient', en: 'Ambient' },
] as const;
