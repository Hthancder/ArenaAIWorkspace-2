// Is the app on screen? Everything purely visual (visualizer, ambient light, progress text, the
// lyrics follow…) stops while it isn't: music keeps playing in the background, but the phone
// shouldn't spend CPU drawing a screen nobody sees — that work made other apps stutter.

import { useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';

let active = AppState.currentState !== 'background';
const subs = new Set<(active: boolean) => void>();

AppState.addEventListener('change', (s: AppStateStatus) => {
  // 'inactive' = Control Centre / app switcher / incoming call: still visible, keep drawing
  const next = s !== 'background';
  if (next === active) return;
  active = next;
  subs.forEach((f) => f(active));
});

export const AppActivity = {
  isActive: () => active,
  subscribe(f: (active: boolean) => void): () => void {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

const sub = (f: () => void) => AppActivity.subscribe(f);
const get = () => active;

/** true while the app is on screen (re-renders when that changes) */
export function useAppActive(): boolean {
  return useSyncExternalStore(sub, get, get);
}
