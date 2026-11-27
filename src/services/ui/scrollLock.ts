// While a slider / fader is held, the page it sits in stops scrolling (the JS half of the fix
// for "dragging the EQ drags the whole screen"; the native half is ui/TouchGuard on iOS).

import { useSyncExternalStore } from 'react';

let holds = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const ScrollLock = {
  hold() {
    holds += 1;
    if (holds === 1) emit();
  },
  release() {
    if (holds === 0) return;
    holds -= 1;
    if (holds === 0) emit();
  },
};

export function useScrollLocked(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => holds > 0,
    () => false
  );
}
