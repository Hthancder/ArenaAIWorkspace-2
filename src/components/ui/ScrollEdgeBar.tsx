// UINavigationBar "scroll edge" behaviour for the tab screens: while the page's large header is in
// view the top is clear; once it scrolls away a frosted bar with a small centred title fades in
// (it also covers the status-bar strip, like a real navigation bar). Driven by the screen's
// native-driver scroll offset, so it costs nothing per frame on the JS thread.

import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T as UI, themedSheet } from '../../theme/ui';
import { GlassSurface } from '../GlassSurface';

interface Props {
  scrollY: Animated.Value;
  title: string;
  /** offset where the bar starts / finishes appearing */
  from?: number;
  to?: number;
  fontFamily?: string;
}

const BAR_H = 44;

export const ScrollEdgeBar: React.FC<Props> = ({
  scrollY,
  title,
  from = 24,
  to = 64,
  fontFamily,
}) => {
  const insets = useSafeAreaInsets();
  // the app viewport already sits below the status bar: reach up over it
  const top = insets.top;
  const fade = scrollY.interpolate({
    inputRange: [from, to],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const rise = scrollY.interpolate({
    inputRange: [from, to + 20],
    outputRange: [8, 0],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: -top, height: top + BAR_H, opacity: fade }]}
    >
      <GlassSurface
        intensity={70}
        tintColor={UI.shade(12, 12, 18, 0.8)}
        style={[StyleSheet.absoluteFill, styles.glass]}
      >
        <View />
      </GlassSurface>
      <View style={[styles.titleRow, { top }]}>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.title,
            fontFamily ? { fontFamily } : null,
            { transform: [{ translateY: rise }] },
          ]}
        >
          {title}
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

/** A hairline under a pinned header that appears once content scrolls beneath it. */
export const ScrollEdgeHairline: React.FC<{ scrollY: Animated.Value }> = ({ scrollY }) => (
  <Animated.View
    pointerEvents="none"
    style={[
      styles.hairline,
      {
        opacity: scrollY.interpolate({
          inputRange: [0, 14],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        }),
      },
    ]}
  />
);

const styles = themedSheet(() => ({
  wrap: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  glass: {
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,140,0.28)',
  },
  titleRow: {
    position: 'absolute',
    left: 60,
    right: 60,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '800',
  },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(127,127,140,0.35)',
  },
}));
