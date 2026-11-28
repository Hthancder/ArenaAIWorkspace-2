// Floating dust in the player: specks of light on three depths, rising slowly, glinting with the
// bass, and separating in depth when the phone tilts (far specks drift with the eye, near ones
// against it — the same parallax rule as the cover and the backdrop).
//
// Cost: each layer is ONE static SVG drawn once (two screen-heights tall, so the climb loops
// seamlessly); everything that moves is a transform / opacity on the native driver. Nothing is
// drawn when it's off, under Reduce Motion, in Low Power Mode, or while the app is hidden.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Tilt } from '../../services/motion/tilt';

interface Layer {
  count: number;
  /** speck radius range (points) */
  r: [number, number];
  /** parallax at full tilt (points): + drifts with the eye (far), − against it (near) */
  depth: number;
  /** seconds for one screen-height climb */
  climb: number;
  /** resting → on-the-beat opacity */
  opacity: [number, number];
  /** halo around each speck (near layer only) */
  halo?: boolean;
}

const LAYERS: Layer[] = [
  { count: 26, r: [0.5, 1.1], depth: 9, climb: 95, opacity: [0.32, 0.5] },
  { count: 15, r: [1.1, 1.8], depth: -7, climb: 62, opacity: [0.36, 0.7] },
  { count: 7, r: [1.8, 2.8], depth: -22, climb: 40, opacity: [0.3, 0.9], halo: true },
];

/** small deterministic PRNG so the specks don't jump around between renders */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DustLayer: React.FC<{
  layer: Layer;
  index: number;
  w: number;
  h: number;
  colors: string[];
  energy: Animated.Value;
}> = ({ layer, index, w, h, colors, energy }) => {
  const specks = useMemo(() => {
    const rand = rng(7919 * (index + 1));
    return Array.from({ length: layer.count }, () => ({
      x: rand() * w,
      y: rand() * h,
      r: layer.r[0] + rand() * (layer.r[1] - layer.r[0]),
      c: rand() < 0.45 ? '#FFFFFF' : colors[Math.floor(rand() * colors.length) % colors.length],
      o: 0.55 + rand() * 0.45,
    }));
  }, [layer, index, w, h, colors]);

  // the climb: 0 → −h, looped (the specks are drawn twice, one screen apart)
  const climb = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    climb.setValue(0);
    const loop = Animated.loop(
      Animated.timing(climb, {
        toValue: 1,
        duration: layer.climb * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [climb, layer.climb]);

  const styles3 = useMemo(
    () => ({
      parallax: {
        transform: [
          { translateX: Animated.multiply(Tilt.x, layer.depth) },
          { translateY: Animated.multiply(Tilt.y, layer.depth) },
        ],
      },
      climb: {
        transform: [
          { translateY: climb.interpolate({ inputRange: [0, 1], outputRange: [0, -h] }) },
        ],
      },
      glint: {
        opacity: energy.interpolate({
          inputRange: [0.25, 1],
          outputRange: layer.opacity,
          extrapolate: 'clamp',
        }),
      },
    }),
    [layer, climb, energy, h]
  );

  // a margin around the screen so parallax never shows an empty edge
  const m = Math.abs(layer.depth) * 1.6;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles3.glint]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles3.parallax]}>
        <Animated.View
          style={[
            { position: 'absolute', left: -m, top: 0, width: w + 2 * m, height: 2 * h },
            styles3.climb,
          ]}
        >
          <Svg width={w + 2 * m} height={2 * h}>
            {[0, h].map((dy) =>
              specks.map((s, i) => (
                <React.Fragment key={`${dy}-${i}`}>
                  {layer.halo && (
                    <Circle
                      cx={s.x + m}
                      cy={s.y + dy}
                      r={s.r * 3.2}
                      fill={s.c}
                      opacity={0.08 * s.o}
                    />
                  )}
                  <Circle cx={s.x + m} cy={s.y + dy} r={s.r} fill={s.c} opacity={s.o} />
                </React.Fragment>
              ))
            )}
          </Svg>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

/** Put it right above the player's backdrop and below its content. */
export const DustField: React.FC<{
  on: boolean;
  /** the cover's colours tint some of the specks */
  colors: string[];
  /** bass energy (0…1, native driver) — specks glint on the beat */
  energy: Animated.Value;
}> = ({ on, colors, energy }) => {
  const { width, height } = useWindowDimensions();
  const tint = useMemo(() => colors.slice(0, 4), [colors]);
  if (!on || width < 1 || height < 1) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {LAYERS.map((l, i) => (
        <DustLayer key={i} layer={l} index={i} w={width} h={height} colors={tint} energy={energy} />
      ))}
    </View>
  );
};
