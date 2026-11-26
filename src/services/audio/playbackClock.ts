// Playback position, outside React context on purpose.
//
// The engine reports the position 4×/s. Kept in the app-wide context, every screen, every track
// row and every hidden tab re-rendered 4×/s — the main reason the app felt laggy. Now only the
// few components that actually show the time subscribe to it.

import { useSyncExternalStore } from 'react';

let pos = 0;
const subs = new Set<() => void>();

export const PlaybackClock = {
  get: (): number => pos,
  set(v: number): void {
    const next = Number.isFinite(v) ? Math.max(0, v) : 0;
    if (next === pos) return;
    pos = next;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** Current position in seconds (re-renders on every engine update, ~4×/s). */
export function usePositionSec(): number {
  return useSyncExternalStore(PlaybackClock.subscribe, PlaybackClock.get, PlaybackClock.get);
}

/** Position rounded down to `step` seconds: re-renders only when that changes. */
export function usePositionStep(step: number): number {
  const get = () => Math.floor(pos / step) * step;
  return useSyncExternalStore(PlaybackClock.subscribe, get, get);
}
