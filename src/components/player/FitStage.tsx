/*
 * HolySic — iOS music player. Based on Mochy Music by realidkroo (GPL-3.0).
 * https://github.com/realidkroo/Mochy-Music
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

/**
 * Centres its child and scales it down (never up) so that fixed-size player
 * art — the 300pt cover, the vinyl deck, the iPod body — always fits inside the
 * space the player has left for it. On a 4" iPhone SE the stage is ~190pt tall;
 * without this the cover would ride over the top bar and the song title.
 */
export const FitStage: React.FC<{ children: React.ReactNode; padding?: number }> = ({
  children,
  padding = 4,
}) => {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [content, setContent] = useState({ w: 0, h: 0 });

  const onBox = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - box.w) > 0.5 || Math.abs(height - box.h) > 0.5)
      setBox({ w: width, h: height });
  };
  const onContent = (e: LayoutChangeEvent) => {
    // layout reports the un-transformed size, so this never feeds back on itself
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - content.w) > 0.5 || Math.abs(height - content.h) > 0.5)
      setContent({ w: width, h: height });
  };

  let scale = 1;
  if (box.h > 0 && content.h > 0) {
    scale = Math.min(1, (box.h - padding * 2) / content.h, (box.w - padding * 2) / content.w);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    scale = Math.max(0.45, scale);
  }

  return (
    <View style={styles.box} onLayout={onBox}>
      <View onLayout={onContent} style={[styles.content, scale < 1 && { transform: [{ scale }] }]}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
