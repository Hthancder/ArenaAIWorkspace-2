// The current lyric line, outside React context on purpose.
//
// It used to live in the app-wide context: every line change (every 2–5 s) re-rendered every
// screen, every track row and the hidden tabs — a heavy commit landing exactly when the lyrics
// should move, which is part of why the next line looked late. Now only the lyrics view, the
// mini-player ticker and the bedside clock subscribe.
//
// Timing: the engine reports the position ~4×/s, so following the clock alone switches up to
// 250 ms late. Between reports the next line is switched by a timer at its exact start
// (extrapolated from the last report), a hair early so the animation lands on the word.

import { useSyncExternalStore } from 'react';
import { PlaybackClock } from '../audio/playbackClock';
import { perfCount, perfOn, perfSample, perfTruePos } from '../perfProbe';
import { AppActivity } from '../appActivity';

let index = -1;
const subs = new Set<() => void>();

function set(next: number): void {
  if (next === index) return;
  index = next;
  perfCount('lyricLine');
  subs.forEach((f) => f());
}

export const LyricClock = {
  get: (): number => index,
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** index of the line being sung (-1 = none / untimed lyrics) */
export function useActiveLyricIndex(): number {
  return useSyncExternalStore(subscribeVisible, LyricClock.get, LyricClock.get);
}

// on-screen readers only re-render while the app is visible (catch up when it returns)
function subscribeVisible(f: () => void): () => void {
  const a = () => {
    if (AppActivity.isActive()) f();
  };
  subs.add(a);
  const b = AppActivity.subscribe(f);
  return () => {
    subs.delete(a);
    b();
  };
}

/** switch this much before the line starts: covers the render + the highlight animation */
const LEAD_SEC = 0.15;

/**
 * Drive the clock for one set of timed lines. Returns a stop function.
 * `starts` are the line start times (sorted), `offsetSec` the per-song lyrics delay,
 * `isPlaying()` read live so a pause stops the timers at once.
 */
export function runLyricClock(
  starts: number[] | null,
  offsetSec: number,
  isPlaying: () => boolean
): () => void {
  if (!starts || !starts.length) {
    set(-1);
    return () => undefined;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let basePos = PlaybackClock.get();
  let baseAt = Date.now();

  const indexAt = (pos: number) => {
    // binary search: last start <= pos + lead
    const t = pos + LEAD_SEC;
    let lo = 0;
    let hi = starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  const now = () => {
    if (!isPlaying()) return basePos - offsetSec;
    // never run more than a second past the last report (a stalled stream stops reporting)
    const dt = Math.min(1, (Date.now() - baseAt) / 1000);
    return basePos + dt - offsetSec;
  };
  const step = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const pos = now();
    let i = indexAt(pos);
    // a report that lands a moment behind the timer's switch is jitter, not a seek back:
    // don't flick back to the previous line for it
    if (i === index - 1 && index >= 0 && starts[index] !== undefined) {
      if (pos + LEAD_SEC + 0.5 >= starts[index]) i = index;
    }
    if (perfOn() && i !== index && i >= 0 && isPlaying()) {
      const tp = perfTruePos();
      if (tp !== null)
        perfSample('lyricLateMs:new', Math.round((tp - offsetSec - starts[i]) * 1000));
    }
    set(i);
    if (!isPlaying()) return;
    const next = starts[i + 1];
    if (next === undefined) return;
    const ms = (next - LEAD_SEC - pos) * 1000;
    // the next report comes within ~250 ms; only bridge the gap up to it (plus slack)
    if (ms <= 600) timer = setTimeout(step, Math.max(0, ms) + 4);
  };
  // bench only: what the old clock-only follow (+0.15 s lead, 4 reports/s) would have done
  let oldIdx = -1;
  const unsub = PlaybackClock.subscribe(() => {
    basePos = PlaybackClock.get();
    baseAt = Date.now();
    if (perfOn()) {
      const p = basePos - offsetSec;
      let o = -1;
      for (let k = 0; k < starts.length && p + 0.15 >= starts[k]; k++) o = k;
      if (o !== oldIdx && o >= 0 && isPlaying()) {
        const tp = perfTruePos();
        if (tp !== null)
          perfSample('lyricLateMs:old', Math.round((tp - offsetSec - starts[o]) * 1000));
      }
      oldIdx = o;
    }
    step();
  });
  step();
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
