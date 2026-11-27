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
