// Floating dust in the player: specks of light on three depths, rising slowly, glinting with the
// bass, and separating in depth when the phone tilts (far specks drift with the eye, near ones
// against it — the same parallax rule as the cover and the backdrop).
//
// Cost: each speck is a tiny round View (no bitmap — a two-screen-tall SVG per layer would be
// ~26 MB of backing store at 3×), laid out once over two screen-heights so the climb loops
// seamlessly; everything that moves is a transform / opacity on the native driver. Nothing is
// drawn when it's off, under Reduce Motion, in Low Power Mode, or while the app is hidden.
// The bass glint is applied to each speck, never to a layer: on iOS a container with opacity
// below 1 is composited as a group in an offscreen pass — three full-screen offscreen passes per
// frame (the climb never stops) just to dim a few dozen dots. A handful of shared opacity
// nodes (one per brightness step) drive all the specks instead.
// Lighter still (it was felt on the phone): fewer specks, and only the near layer glints — the
// far and middle specks are plain Views with a fixed opacity, so the native animation graph
// updates ~10 views per frame instead of ~110 (the eye only catches the beat on the big
// specks anyway). The climb and the tilt stay one transform per layer.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
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
  /** the specks glint with the bass (otherwise they rest between the two opacities) */
  glint?: boolean;
}

const LAYERS: Layer[] = [
  { count: 18, r: [0.6, 1.2], depth: 9, climb: 95, opacity: [0.32, 0.5] },
  { count: 10, r: [1.1, 1.8], depth: -7, climb: 62, opacity: [0.36, 0.7] },
  { count: 5, r: [1.8, 2.8], depth: -22, climb: 40, opacity: [0.3, 0.9], halo: true, glint: true },
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
      // three brightness steps (each a shared native node below), not one value per speck
      o: [0.62, 0.8, 0.98][Math.floor(rand() * 3) % 3],
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
    }),
    [layer, climb, h]
  );
  // glint × brightness step → opacity, per step (speck) and for the halos
  const glintOp = useMemo(() => {
    const glint = energy.interpolate({
      inputRange: [0.25, 1],
      outputRange: layer.opacity,
      extrapolate: 'clamp',
    });
    const speck: Record<number, Animated.AnimatedInterpolation<number>> = {};
    const halo: Record<number, Animated.AnimatedInterpolation<number>> = {};
    for (const o of [0.62, 0.8, 0.98]) {
      const [a, b] = layer.opacity;
      speck[o] = glint.interpolate({ inputRange: [a, b], outputRange: [a * o, b * o] });
      halo[o] = glint.interpolate({
        inputRange: [a, b],
        outputRange: [a * o * 0.08, b * o * 0.08],
      });
    }
    return { speck, halo };
  }, [energy, layer]);

  // a margin around the screen so parallax never shows an empty edge
  const m = Math.abs(layer.depth) * 1.6;
  // a resting speck: a plain View, nothing to update per frame
  const rest = (layer.opacity[0] + layer.opacity[1]) / 2;
  const Speck: React.ComponentType<any> = layer.glint ? Animated.View : View;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles3.parallax]}>
        <Animated.View
          style={[
            { position: 'absolute', left: -m, top: 0, width: w + 2 * m, height: 2 * h },
            styles3.climb,
          ]}
        >
          {[0, h].map((dy) =>
            specks.map((sp, i) => (
              <React.Fragment key={`${dy}-${i}`}>
                {layer.halo && (
                  <Speck
                    style={{
                      position: 'absolute',
                      left: sp.x + m - sp.r * 3.2,
                      top: sp.y + dy - sp.r * 3.2,
                      width: sp.r * 6.4,
                      height: sp.r * 6.4,
                      borderRadius: sp.r * 3.2,
                      backgroundColor: sp.c,
                      opacity: layer.glint ? glintOp.halo[sp.o] : rest * sp.o * 0.08,
                    }}
                  />
                )}
                <Speck
                  style={{
                    position: 'absolute',
                    left: sp.x + m - sp.r,
                    top: sp.y + dy - sp.r,
                    width: sp.r * 2,
                    height: sp.r * 2,
                    borderRadius: sp.r,
                    backgroundColor: sp.c,
                    opacity: layer.glint ? glintOp.speck[sp.o] : rest * sp.o,
                  }}
                />
              </React.Fragment>
            ))
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
};

/** Put it right above the player's backdrop and below its content. */
const DustFieldImpl: React.FC<{
  on: boolean;
  /** the cover's colours tint some of the specks */
  colors: string[];
  /** bass energy (0…1, native driver) — specks glint on the beat */
  energy: Animated.Value;
}> = ({ on, colors, energy }) => {
  const { width, height } = useWindowDimensions();
  const key = colors.slice(0, 4).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tint = useMemo(() => colors.slice(0, 4), [key]);
  if (!on || width < 1 || height < 1) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {LAYERS.map((l, i) => (
        <DustLayer key={i} layer={l} index={i} w={width} h={height} colors={tint} energy={energy} />
      ))}
    </View>
  );
};

// the player re-renders several times a second (clock, spectrum state…): the specks only care
// about their own props, compared by value
export const DustField = React.memo(
  DustFieldImpl,
  (a, b) =>
    a.on === b.on &&
    a.energy === b.energy &&
    a.colors.slice(0, 4).join('|') === b.colors.slice(0, 4).join('|')
);
