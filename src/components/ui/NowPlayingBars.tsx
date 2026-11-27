// The "now playing" bars on the current song's artwork (Music style): they dance while the song
// plays and rest low when it is paused. Transform-only, on the native driver.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useAppActive } from '../../services/appActivity';
import { usePlayerCovering } from '../../services/ui/playerStack';

const BARS = [
  { lo: 0.3, hi: 1, ms: 420 },
  { lo: 0.45, hi: 0.75, ms: 360 },
  { lo: 0.25, hi: 0.95, ms: 480 },
];

export const NowPlayingBars: React.FC<{ playing: boolean; color: string; size?: number }> = ({
  playing: playingIn,
  color,
  size = 16,
}) => {
  const vals = useRef(BARS.map((b) => new Animated.Value(b.lo))).current;
  // hidden under the full player or off screen: rest (no animation nobody can see)
  const covered = usePlayerCovering();
  const appActive = useAppActive();
  const playing = playingIn && !covered && appActive;
  useEffect(() => {
    if (!playing) {
      const rest = Animated.parallel(
        vals.map((v, i) =>
          Animated.timing(v, {
            toValue: [0.32, 0.5, 0.24][i],
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          })
        )
      );
      rest.start();
      return () => rest.stop();
    }
    const loops = vals.map((v, i) => {
      const b = BARS[i];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: b.hi,
            duration: b.ms,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: b.lo,
            duration: b.ms * 0.9,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
    });
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 90));
    return () => loops.forEach((l) => l.stop());
  }, [playing, vals]);
  const w = Math.max(2, Math.round(size / 6));
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: w * 0.7,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: w,
            height: size,
            borderRadius: w / 2,
            backgroundColor: color,
            // scale from the bottom: shift by half the lost height
            transform: [
              { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [size / 2, 0] }) },
              { scaleY: v },
            ],
          }}
        />
      ))}
    </View>
  );
};
