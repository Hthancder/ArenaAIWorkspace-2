// Playback position, outside React context on purpose.
//
// The engine reports the position 4×/s. Kept in the app-wide context, every screen, every track
// row and every hidden tab re-rendered 4×/s — the main reason the app felt laggy. Now only the
// few components that actually show the time subscribe to it.

import { useSyncExternalStore } from 'react';
import { perfCount } from '../perfProbe';
import { AppActivity } from '../appActivity';

let pos = 0;
let at = 0;
const subs = new Set<() => void>();

export const PlaybackClock = {
  get: (): number => pos,
  /** the position right now: the last report moved on by the time since (≤ 1 s) when playing */
  now(playing: boolean): number {
    if (!playing || !at) return pos;
    return pos + Math.min(1, (Date.now() - at) / 1000);
  },
  set(v: number): void {
    const next = Number.isFinite(v) ? Math.max(0, v) : 0;
    if (next === pos) return;
    pos = next;
    at = Date.now();
    perfCount('clockTick');
    subs.forEach((f) => f());
  },
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** On-screen subscribers only: quiet while the app is in the background (nothing to draw),
 *  one catch-up render when it comes back. */
function subscribeVisible(f: () => void): () => void {
  const a = PlaybackClock.subscribe(() => {
    if (AppActivity.isActive()) f();
  });
  const b = AppActivity.subscribe(f);
  return () => {
    a();
    b();
  };
}

/** Current position in seconds, for display (re-renders ~4×/s while the app is on screen). */
export function usePositionSec(): number {
  return useSyncExternalStore(subscribeVisible, PlaybackClock.get, PlaybackClock.get);
}

/** Position rounded down to `step` seconds: re-renders only when that changes. */
export function usePositionStep(step: number): number {
  const get = () => Math.floor(pos / step) * step;
  return useSyncExternalStore(PlaybackClock.subscribe, get, get);
}
