// Home-screen / Lock Screen widget bridge (iOS).
//
// The WidgetKit extension (targets/widget/HolySicWidget.swift) can't run JS or reach the
// network, so the app publishes a small snapshot of what's playing into the shared App Group:
//   "nowPlaying" — JSON (title, artist, state, position sampled at updatedAt, colours, up next)
//   "art"        — the cover as a small base64 JPEG (≈360 px, a few dozen KB)
//   "lyrics"     — the song's timed lyric lines (sent once per song / offset change); the
//                  widget schedules a timeline entry at every line, so lyrics follow the music
//                  with no traffic from the app while it plays
// and asks WidgetKit to redraw. Position is only re-published on jumps (seek, track change,
// pause/resume) — the widget extrapolates from updatedAt, so no per-second traffic.
//
// No-ops on web and Expo Go.

import { Platform } from 'react-native';
import type { HolySicWidgetNative, NativeWidgetStatus } from '../../../modules/holysic-widget';

export const WIDGET_APP_GROUP = 'group.com.holysic.music';

export interface WidgetQueueItem {
  title: string;
  artist: string;
}

export interface WidgetNowPlaying {
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  updatedAt: number;
  accent?: string;
  bgTop?: string;
  bgBottom?: string;
  badge?: string;
  liked?: boolean;
  isLive?: boolean;
  upNext?: WidgetQueueItem[];
  lang?: string;
  /** id of the matching "lyrics" pack (stale lyrics from another song are ignored) */
  lyricsId?: string;
  /** what the lyrics widget should say when there is no timed pack */
  lyricsState?: 'synced' | 'loading' | 'plain' | 'none';
  /** unix seconds: "playing" is only trusted until then — the app renews it while it plays, so a
   *  closed / crashed app can't leave the widget's clock and lyrics running */
  liveUntil?: number;
}

export interface WidgetLyricLine {
  /** start, seconds into the song (lyrics delay already applied) */
  t: number;
  /** text ('' = instrumental gap) */
  x: string;
  /** word starts (seconds into the song) — parallel to `wt`; the widget lights the line word by
   *  word like the player. Word-synced lyrics send real timings; line-synced ones are spread. */
  ws?: number[];
  /** the words as shown, spacing included (joined they equal `x`) */
  wt?: string[];
}

export interface WidgetLyrics {
  id: string;
  synced: boolean;
  lines: WidgetLyricLine[];
}

// Local native module (modules/holysic-widget) — present in IPA / dev-client builds only
let native: HolySicWidgetNative | null | undefined;
function mod(): HolySicWidgetNative | null {
  if (native !== undefined) return native;
  native = null;
  if (Platform.OS !== 'ios') return null;
  try {
    native = require('../../../modules/holysic-widget').HolySicWidgetModule ?? null;
  } catch {
    native = null;
  }
  return native ?? null;
}

/** The widget extension exists in this build (not Expo Go / web) */
export const widgetSupported = () => !!mod();

/**
 * The App Group actually works (its entitlement survived signing). Sideloading tools that drop
 * the entitlement leave the widget unable to read anything — Settings explains this.
 */
export function widgetLinked(): boolean {
  const m = mod();
  if (!m) return false;
  try {
    return m.isAvailable(WIDGET_APP_GROUP);
  } catch {
    return false;
  }
}

export type WidgetStatus = NativeWidgetStatus;

/** What iOS says about the widget on this install (null on web / Expo Go / older builds) */
export async function widgetStatus(): Promise<WidgetStatus | null> {
  const m = mod();
  if (!m || typeof m.status !== 'function') return null;
  try {
    return await m.status(WIDGET_APP_GROUP);
  } catch {
    return null;
  }
}

function setKey(key: string, value: string | null) {
  const m = mod();
  if (!m) return;
  if (value == null) m.remove(key, WIDGET_APP_GROUP);
  else m.setString(key, value, WIDGET_APP_GROUP);
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function reloadNow() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
  try {
    // both widgets (Now Playing + Lyrics) read the same snapshot
    mod()?.reload(null);
  } catch {
    // WidgetKit unavailable
  }
}
function reloadSoon(urgent = false) {
  // play / pause goes out at once: after a pause from the lock screen the app may be suspended
  // within moments, and a debounced reload would never fire
  if (urgent) return reloadNow();
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadNow, 350);
}

let lastJson = '';
let lastPlaying: boolean | null = null;

/** Publish the playing state (null = nothing loaded). Cheap to call: identical snapshots are skipped. */
export function publishNowPlaying(np: WidgetNowPlaying | null) {
  if (!mod()) return;
  const json = np ? JSON.stringify(np) : '';
  if (json === lastJson) return;
  lastJson = json;
  const playing = np ? np.isPlaying : null;
  const urgent = playing !== lastPlaying;
  lastPlaying = playing;
  try {
    setKey('nowPlaying', np ? json : null);
    reloadSoon(urgent);
  } catch {
    // ignore
  }
}

let lastLyrics = '';

/** Publish the current song's lyrics (null = none). Identical packs are skipped. */
export function publishLyrics(pack: WidgetLyrics | null) {
  if (!mod()) return;
  const json = pack ? JSON.stringify(pack) : '';
  if (json === lastLyrics) return;
  lastLyrics = json;
  try {
    setKey('lyrics', pack ? json : null);
    reloadSoon();
  } catch {
    // ignore
  }
}

let artKey: string | null = null;
let artJob = 0;

/** Make a small JPEG of the cover for the widget (remote, file:// or data: URIs). */
async function encodeCover(uri: string): Promise<string | null> {
  const { File, Paths } = await import('expo-file-system');
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  let src = uri;
  let tmp: InstanceType<typeof File> | null = null;
  if (/^https?:/i.test(uri)) {
    tmp = new File(Paths.cache, `widget-art-${Date.now()}`);
    const got = await File.downloadFileAsync(uri, tmp, { idempotent: true });
    src = got.uri;
  }
  try {
    const ctx = ImageManipulator.manipulate(src);
    ctx.resize({ width: 360 });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    img.release?.();
    try {
      if (out.uri) new File(out.uri).delete();
    } catch {
      // temp file already gone
    }
    return out.base64 || null;
  } finally {
    try {
      tmp?.delete();
    } catch {
      // ignore
    }
  }
}

/** Swap the widget's cover when the artwork changes (debounced per URL, newest wins). */
export async function publishArtwork(uri: string | undefined | null) {
  if (!mod()) return;
  const key = uri || '';
  if (key === artKey) return;
  artKey = key;
  const job = ++artJob;
  // svg / generated covers can't be rasterised here: the widget draws its own gradient
  if (!uri || /^data:image\/svg|\.svg($|\?)/i.test(uri)) {
    setKey('art', '');
    reloadSoon();
    return;
  }
  try {
    const b64 = await encodeCover(uri);
    if (job !== artJob) return;
    setKey('art', b64 || '');
  } catch {
    if (job !== artJob) return;
    setKey('art', '');
  }
  reloadSoon();
}

export type WidgetAction = 'toggle' | 'next' | 'prev' | 'like' | 'open' | 'lyrics';

/** holysic://widget/<action> → action */
export function parseWidgetUrl(url: string | null | undefined): WidgetAction | null {
  const m = /^holysic:\/\/widget\/([a-z]+)/i.exec(url || '');
  if (!m) return null;
  const a = m[1].toLowerCase();
  return a === 'toggle' ||
    a === 'next' ||
    a === 'prev' ||
    a === 'like' ||
    a === 'open' ||
    a === 'lyrics'
    ? a
    : null;
}
