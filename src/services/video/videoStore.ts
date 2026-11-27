// Shared state of the music video (one muted player for the whole app, see MusicVideoHost).
// Outside React context on purpose: it changes often and only the video views care.

import { useSyncExternalStore } from 'react';
import type { VideoPlayer } from 'expo-video';

export type VideoStatus =
  | 'off'
  // "Tự phát MV" is off: nothing loads until the camera button asks for this song
  | 'idle'
  | 'searching'
  | 'loading'
  | 'ready'
  | 'none'
  | 'error'
  | 'offline'
  | 'wifi';

export interface VideoState {
  trackId: string | null;
  videoId: string | null;
  status: VideoStatus;
  /** "720p · H.264 · YouTube visionOS" */
  label?: string;
  /** width / height of the picture */
  aspect: number;
  /** the audio comes from the same video (exact sync) */
  synced: boolean;
  /** playing a saved copy (Settings › Storage › MV đã lưu) */
  local?: boolean;
  /** the song whose video the user asked for (camera button, while auto-play is off) */
  requested?: string | null;
  /** the picture's height in lines (720…), for the quality sheet */
  height?: number;
}

let state: VideoState = {
  trackId: null,
  videoId: null,
  status: 'off',
  aspect: 16 / 9,
  synced: false,
};
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const VideoStore = {
  get: () => state,
  set(patch: Partial<VideoState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof VideoState)[]).every((k) => next[k] === state[k])) return;
    state = next;
    subs.forEach((f) => f());
  },
  subscribe,
  player: null as VideoPlayer | null,
  /** load this song's video now (auto-play off) */
  request(trackId: string) {
    VideoStore.set({ requested: trackId });
  },
};

/** the picture is wanted: "Music video" is on, or the song itself is a video (Search › Video MV) */
export const videoWanted = (musicVideo: boolean | undefined, track?: { id: string } | null) =>
  !!track && (!!musicVideo || track.id.startsWith('ytv-'));

export const useVideoState = () => useSyncExternalStore(subscribe, VideoStore.get, VideoStore.get);

// ── which views are on screen and "live" (the picture moves only while one is) ──
let live = 0;
const liveSubs = new Set<() => void>();
export const VideoLive = {
  hold() {
    live += 1;
    if (live === 1) liveSubs.forEach((f) => f());
    let done = false;
    return () => {
      if (done) return;
      done = true;
      live = Math.max(0, live - 1);
      if (live === 0) liveSubs.forEach((f) => f());
    };
  },
  get: () => live > 0,
  subscribe(f: () => void) {
    liveSubs.add(f);
    return () => {
      liveSubs.delete(f);
    };
  },
};
