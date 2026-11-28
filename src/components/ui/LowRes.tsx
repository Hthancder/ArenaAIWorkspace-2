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

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

export const LowRes: React.FC<{ factor?: number; children: React.ReactNode }> = ({
  factor = 4,
  children,
}) => {
  const f = Platform.OS === 'web' ? 1 : factor;
  if (f <= 1) {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {children}
      </View>
    );
  }
  const k = 100 / f;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          width: `${k}%`,
          height: `${k}%`,
          left: `${50 - k / 2}%`,
          top: `${50 - k / 2}%`,
          transform: [{ scale: f }],
        }}
      >
        {children}
      </View>
    </View>
  );
};
