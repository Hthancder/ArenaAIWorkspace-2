// Sleep-timer countdown, kept OUT of the app context.
//
// The countdown changes every second; when it lived in the context value every screen using
// useHolySic() re-rendered once a second while a timer ran (the player stuttered, menus were
// rebuilt). Now only the few labels that show the time subscribe to it.

import { useSyncExternalStore } from 'react';

let remaining: number | null = null;
const subs = new Set<() => void>();

export const SleepClock = {
  get: () => remaining,
  set(v: number | null) {
    if (v === remaining) return;
    remaining = v;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/**
 * Seconds left (null = no countdown). `step` rounds UP to that many seconds, so a label showing
 * minutes re-renders once a minute instead of every second.
 */
export function useSleepRemaining(step = 1): number | null {
  return useSyncExternalStore(
    SleepClock.subscribe,
    () => (remaining === null ? null : Math.ceil(remaining / step) * step),
    () => null
  );
}

/** "1 giờ 30 phút" / "45 phút" / "2 giờ" */
export function formatSleepLength(min: number, vi: boolean): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (vi) return [h ? `${h} giờ` : '', m || !h ? `${m} phút` : ''].filter(Boolean).join(' ');
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** countdown text: m:ss, or h:mm:ss from an hour up */
export function formatSleepLeft(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = `${s < 10 ? '0' : ''}${s}`;
  return h ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
}
