// Visual layers for the motion effects. All of them read the shared Tilt values and animate
// only transforms / opacity on the native driver — no re-render per frame, and when the effect
// is off the layers aren't drawn at all.
//
//  • TiltCard     — a surface that turns in 3D to face the eye (world-stable, like a card held
//                   under glass) and drifts a few points in front of the page.
//  • CoverSheen   — the light on that surface: a soft specular glare that slides against the
//                   tilt (tvOS focus style) and an optional holographic foil that shifts its
//                   rainbow with the angle (trading-card holo).
//  • ParallaxLayer — a background that drifts with the eye, so it reads as being far behind
//                   the content (iOS "Perspective Zoom"). It is scaled just enough that its
//                   edges never show.

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useHolySic } from '../../context/HolySicContext';
import { Tilt, TILT_GAIN } from '../../services/motion/tilt';

// ---------------------------------------------------------------- gating

/** Strength from Settings → gain; 0 when off, under Reduce Motion or in Low Power Mode. */
export function useMotionGain(): number {
  const { prefs, ambient } = useHolySic();
  if (ambient.reduceMotion || ambient.lowPower) return 0;
  return TILT_GAIN[prefs.motionFx ?? 'medium'] ?? 1;
}

/**
 * Hold the motion sensor while `active` (the effect is on screen). Returns `on` = the effect
 * should be drawn. Several components can hold it at once; it stops when the last lets go,
 * and while the app is in the background.
 */
export function useTilt(active: boolean): { on: boolean; x: Animated.Value; y: Animated.Value } {
  const gain = useMotionGain();
  const on = active && gain > 0;
  useEffect(() => {
    if (gain > 0) Tilt.setGain(gain);
  }, [gain]);
  useEffect(() => (on ? Tilt.acquire() : undefined), [on]);
  return { on, x: Tilt.x, y: Tilt.y };
}

/** |x| + |y| mapped to 0…1 — how far from centre the phone is tilted */
export function useMagnitude() {
  return useMemo(() => {
    const ax = Tilt.x.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1] });
    const ay = Tilt.y.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1] });
    return Animated.add(ax, ay).interpolate({
      inputRange: [0, 1.2],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
  }, []);
}

let idSeq = 0;
export function useSvgId(prefix: string) {
  const ref = useRef<string | null>(null);
  if (ref.current == null) ref.current = `${prefix}${++idSeq}`;
  return ref.current;
}

// ---------------------------------------------------------------- TiltCard

export const TiltCard: React.FC<{
  on: boolean;
  /** largest turn in degrees at full tilt */
  maxDeg?: number;
  /** points the card floats against the eye (it sits in front of the page) */
  float?: number;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}> = ({ on, maxDeg = 9, float = 5, style, children }) => {
  const transform = useMemo(
    () => [
      { perspective: 900 },
      // turn to face the eye: eye to the right → the right edge recedes
      {
        rotateY: Tilt.x.interpolate({
          inputRange: [-1, 1],
          outputRange: [`${maxDeg}deg`, `${-maxDeg}deg`],
        }),
      },
      // eye below → the top edge comes forward
      {
        rotateX: Tilt.y.interpolate({
          inputRange: [-1, 1],
          outputRange: [`${-maxDeg}deg`, `${maxDeg}deg`],
        }),
      },
      { translateX: Animated.multiply(Tilt.x, -float) },
      { translateY: Animated.multiply(Tilt.y, -float) },
    ],
    [maxDeg, float]
  );
  if (!on) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, { transform }]}>{children}</Animated.View>;
};

// ---------------------------------------------------------------- CoverSheen

const HOLO = [
  '#ff7773',
  '#ffed5f',
  '#a8ff5f',
  '#83fff7',
  '#7894ff',
  '#d875ff',
  '#ff7773',
  '#ffed5f',
  '#a8ff5f',
  '#83fff7',
  '#7894ff',
  '#d875ff',
  '#ff7773',
] as const;

/**
 * Light on the cover. Put it as the LAST child inside the cover's clipping view (the one with
 * the border radius + overflow hidden) so it is clipped to the artwork.
 */
export const CoverSheen: React.FC<{
  on: boolean;
  size: number;
  glare?: boolean;
  holo?: boolean;
}> = ({ on, size, glare = true, holo = false }) => {
  const id = useSvgId('hs-glare-');
  const mag = useMagnitude();
  const S = size;
  const glareStyle = useMemo(() => {
    const G = S * 1.9;
    return {
      position: 'absolute' as const,
      width: G,
      height: G,
      // resting highlight: upper-left, where a ceiling light catches a glossy sleeve
      left: S * 0.3 - G / 2,
      top: S * 0.16 - G / 2,
      opacity: mag.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
      transform: [
        // slides against the tilt
        { translateX: Animated.multiply(Tilt.x, -S * 0.5) },
        { translateY: Animated.multiply(Tilt.y, -S * 0.45) },
      ],
    };
  }, [S, mag]);
  const holoStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      width: S * 3,
      height: S * 3,
      left: -S,
      top: -S,
      opacity: mag.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.5] }),
      transform: [
        // the foil shifts with the eye (faster than the glare, the other way) so its colours
        // sweep across the cover as it turns
        { translateX: Animated.multiply(Tilt.x, S * 0.75) },
        { translateY: Animated.multiply(Tilt.y, S * 0.6) },
      ],
      // blend modes need the new architecture (iOS) or CSS (web); elsewhere it is a plain tint
      mixBlendMode: 'overlay',
    }),
    [S, mag]
  );
  if (!on || (!glare && !holo)) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      {holo && (
        <Animated.View style={holoStyle as any}>
          <LinearGradient
            colors={HOLO}
            start={{ x: 0, y: 0.1 }}
            end={{ x: 1, y: 0.9 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
      {glare && (
        <Animated.View style={glareStyle}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.42} />
                <Stop offset="0.28" stopColor="#FFFFFF" stopOpacity={0.14} />
                <Stop offset="0.62" stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
};

// ---------------------------------------------------------------- ParallaxLayer

/**
 * A full-bleed background that drifts with the eye. `amount` = points at full tilt.
 * `cover` scales the layer up so the drift never reveals an edge (for pictures that exactly
 * fill the screen; oversized layers such as the blurred ambient flood don't need it).
 */
export const ParallaxLayer: React.FC<{
  on: boolean;
  amount?: number;
  cover?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}> = ({ on, amount = 16, cover = false, style, children }) => {
  const { width, height } = useWindowDimensions();
  const transform = useMemo(() => {
    const t: any[] = [
      { translateX: Animated.multiply(Tilt.x, amount) },
      { translateY: Animated.multiply(Tilt.y, amount) },
    ];
    // gain can reach 1.45 → room for 1.5 × amount on each side
    if (cover) t.push({ scale: 1 + (3 * amount) / Math.max(1, Math.min(width, height)) });
    return t;
  }, [amount, cover, width, height]);
  if (!on) return <View style={[StyleSheet.absoluteFill, style]}>{children}</View>;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style, { transform }]}>
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // no `isolation` here: the foil must blend with the artwork underneath (a sibling)
  clip: { overflow: 'hidden' },
});
