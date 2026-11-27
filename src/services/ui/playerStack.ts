// The "card stack" behind the full player (iOS sheet presentation): while the player is up the app
// recedes — scaled back with rounded corners — and comes forward again as the player is pulled down
// or closed. FullPlayerModal drives both values (native driver); App.tsx reads them.

import { useSyncExternalStore } from 'react';
import { Animated, Easing } from 'react-native';

const openSubs = new Set<() => void>();

export const PlayerStack = {
  /** 0 closed … 1 open */
  open: new Animated.Value(0),
  /** the player's drag-to-dismiss offset in px (0 = resting) */
  drag: new Animated.Value(0),
  /** plain flag for things that just stop while the player covers the app */
  isOpen: false,
  subscribe(f: () => void): () => void {
    openSubs.add(f);
    return () => {
      openSubs.delete(f);
    };
  },
  setOpen(open: boolean) {
    if (PlayerStack.isOpen !== open) {
      PlayerStack.isOpen = open;
      openSubs.forEach((f) => f());
    }
    if (open) {
      Animated.spring(PlayerStack.open, {
        toValue: 1,
        useNativeDriver: true,
        speed: 11,
        bounciness: 2,
      }).start();
    } else {
      Animated.timing(PlayerStack.open, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  },
};

const getOpen = () => PlayerStack.isOpen;
/** true while the full player covers the app (re-renders on change) */
export function usePlayerCovering(): boolean {
  return useSyncExternalStore(PlayerStack.subscribe, getOpen, getOpen);
}
