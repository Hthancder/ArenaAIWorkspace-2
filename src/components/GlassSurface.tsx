// iOS ChromeGlass & Blur Surface Wrapper — respects HolySic's enableBlur & pureBlack switches

import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { HOLYSIC_COLORS } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';

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

  if (!prefs.enableBlur) {
    return (
      <View
        style={[
          styles.solidFallback,
          {
            backgroundColor: prefs.pureBlack
              ? '#09090D'
              : tintColor || HOLYSIC_COLORS.surfaceElevated,
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
            backgroundColor: tintColor || 'rgba(20, 20, 28, 0.76)',
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <BlurView intensity={intensity} tint="dark" style={[styles.nativeBlur, style]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: tintColor || 'rgba(14, 14, 20, 0.45)' },
        ]}
      />
      {children}
    </BlurView>
  );
};

const styles = StyleSheet.create({
  solidFallback: {
    borderColor: HOLYSIC_COLORS.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  nativeBlur: {
    borderColor: HOLYSIC_COLORS.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  webBlur: {
    borderColor: HOLYSIC_COLORS.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    // @ts-ignore web backdropFilter
    backdropFilter: 'blur(26px) saturate(165%)',
    WebkitBackdropFilter: 'blur(26px) saturate(165%)',
  },
});
