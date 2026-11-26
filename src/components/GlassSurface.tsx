// iOS ChromeGlass & Blur Surface Wrapper — respects HolySic's enableBlur & pureBlack switches

import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useHolySic } from '../context/HolySicContext';
import { getUi } from '../theme/ui';

/** Is a colour light? (decides the blur material under a tinted glass) */
const isLightColor = (c?: string) => {
  if (!c) return false;
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  let r = 0,
    g = 0,
    b = 0;
  if (m) [r, g, b] = [+m[1], +m[2], +m[3]];
  else if (/^#[0-9a-f]{6}/i.test(c))
    [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  else return false;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
};

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  tintColor?: string;
}

export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  style,
  intensity = 55,
  tintColor,
}) => {
  const { prefs } = useHolySic();
  const ui = getUi();
  // light glass only when the tint is light (screens that stay dark, like the player, pass dark tints)
  const light = tintColor ? isLightColor(tintColor) : ui.scheme === 'light';
  const border = light ? 'rgba(20,16,40,0.10)' : 'rgba(255,255,255,0.10)';

  if (!prefs.enableBlur) {
    return (
      <View
        style={[
          styles.solidFallback,
          {
            backgroundColor: light
              ? tintColor || ui.sheet
              : prefs.pureBlack
                ? '#09090D'
                : tintColor || '#1B1B24',
            borderColor: border,
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.webBlur,
          {
            backgroundColor:
              tintColor || (light ? 'rgba(250,249,253,0.80)' : 'rgba(20, 20, 28, 0.76)'),
            borderColor: border,
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <BlurView
      intensity={intensity}
      tint={light ? 'light' : 'dark'}
      style={[styles.nativeBlur, { borderColor: border }, style]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor:
              tintColor || (light ? 'rgba(250,249,253,0.55)' : 'rgba(14, 14, 20, 0.45)'),
          },
        ]}
      />
      {children}
    </BlurView>
  );
};

const styles = StyleSheet.create({
  solidFallback: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  nativeBlur: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  webBlur: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    // @ts-ignore web backdropFilter
    backdropFilter: 'blur(26px) saturate(165%)',
    WebkitBackdropFilter: 'blur(26px) saturate(165%)',
  },
});
