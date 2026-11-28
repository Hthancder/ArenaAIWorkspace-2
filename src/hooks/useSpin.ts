// A record's rotation (0…1 per turn) on the native driver. It resumes from wherever it stopped
// instead of snapping back to 0° on every play / pause, and stops while the app is hidden.

import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

export function useSpin(spinning: boolean, periodMs = 9000): Animated.Value {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) {
      spin.stopAnimation();
      return;
    }
    let stopped = false;
    let anim: Animated.CompositeAnimation | null = null;
    spin.stopAnimation((from) => {
      if (stopped) return;
      const start = from % 1;
      spin.setValue(start);
      anim = Animated.timing(spin, {
        toValue: 1,
        duration: Math.max(1, (1 - start) * periodMs),
        easing: Easing.linear,
        useNativeDriver: true,
      });
      anim.start(({ finished }) => {
        if (!finished || stopped) return;
        spin.setValue(0);
        anim = Animated.loop(
          Animated.timing(spin, {
            toValue: 1,
            duration: periodMs,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        );
        anim.start();
      });
    });
    return () => {
      stopped = true;
      anim?.stop();
    };
  }, [spinning, spin, periodMs]);
  return spin;
}
