// The "card stack" behind the full player (iOS sheet presentation): while the player is up the app
// recedes — scaled back with rounded corners — and comes forward again as the player is pulled down
// or closed. FullPlayerModal drives both values (native driver); App.tsx reads them.

import { Animated, Easing } from 'react-native';

export const PlayerStack = {
  /** 0 closed … 1 open */
  open: new Animated.Value(0),
  /** the player's drag-to-dismiss offset in px (0 = resting) */
  drag: new Animated.Value(0),
  setOpen(open: boolean) {
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
