// Small glyph animations that make the transport controls feel physical:
//   <MorphIcon>  play ⇄ pause (or any two glyphs) swap with a spun cross-fade + springy scale
//   <NudgeIcon>  skip arrows jump in their direction each time `pulse` changes (like Music)

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type Glyph = keyof typeof Ionicons.glyphMap;

interface MorphProps {
  on: boolean;
  onIcon: Glyph;
  offIcon: Glyph;
  size: number;
  color: string;
  /** optical nudge for the "off" glyph (play triangles sit a touch right) */
  offShiftX?: number;
  style?: StyleProp<ViewStyle>;
}

export const MorphIcon: React.FC<MorphProps> = ({
  on,
  onIcon,
  offIcon,
  size,
  color,
  offShiftX = 0,
  style,
}) => {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.spring(v, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 9,
    }).start();
  }, [on, v]);
  const onStyle = {
    opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 1] }),
    transform: [
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
      { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-80deg', '0deg'] }) },
    ],
  };
  const offStyle = {
    opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0.9, 0] }),
    transform: [
      { translateX: offShiftX },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) },
      { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '80deg'] }) },
    ],
  };
  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, offStyle]}>
        <Ionicons name={offIcon} size={size} color={color} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, onStyle]}>
        <Ionicons name={onIcon} size={size} color={color} />
      </Animated.View>
    </View>
  );
};

interface NudgeProps {
  name: Glyph;
  size: number;
  color: string;
  /** -1 back · 1 forward */
  dir: 1 | -1;
  /** change this (e.g. a counter) to play the nudge */
  pulse: number;
}

export const NudgeIcon: React.FC<NudgeProps> = ({ name, size, color, dir, pulse }) => {
  const x = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    x.setValue(0);
    Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 12 }),
    ]).start();
  }, [pulse, x]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        transform: [
          { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 7 * dir] }) },
          { scale: x.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) },
        ],
      }}
    >
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
