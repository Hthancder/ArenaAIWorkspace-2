// Soft light drawn at low resolution, then scaled up.
//
// On iOS a react-native-svg view draws into a bitmap of its own size × the screen scale²: a
// full-screen radial-gradient glow costs ~12 MB, the player's ambient lobes ~21 MB, and a song
// change keeps two of them alive during the crossfade. These layers are nothing but smooth
// gradients, so drawing them at 1/4 size and letting the GPU stretch the bitmap (bilinear
// filtering) looks the same while using 1/16 of the memory and of the draw time.
//
// Use only for soft content (gradients, glows) — never for text, icons or sharp edges.
// Fills its parent; the web draws vectors natively, so there it is a plain fill.
//
// `opacity` (e.g. a light breathing with the bass) belongs here rather than on a container
// above: on iOS a view with opacity < 1 that has subviews is composited in an offscreen pass
// the size of that view. Applied to the small, pre-scale box, that pass is 1/16 of the area.

import React from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

type Op = number | Animated.Value | Animated.AnimatedInterpolation<number>;

export const LowRes: React.FC<{ factor?: number; opacity?: Op; children: React.ReactNode }> = ({
  factor = 4,
  opacity,
  children,
}) => {
  const f = Platform.OS === 'web' ? 1 : factor;
  const op = opacity == null ? null : { opacity };
  if (f <= 1) {
    return (
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, op]}>
        {children}
      </Animated.View>
    );
  }
  const k = 100 / f;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: `${k}%`,
            height: `${k}%`,
            left: `${50 - k / 2}%`,
            top: `${50 - k / 2}%`,
            transform: [{ scale: f }],
          },
          op,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
};
