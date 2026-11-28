// Visual layers for the motion effects. All of them read the shared Tilt values and animate
// only transforms / opacity on the native driver — no re-render per frame, and when the effect
// is off the layers aren't drawn at all.
//
//  • TiltCard     — a surface that turns in 3D to face the eye (world-stable, like a card held
//                   under glass) and drifts a few points in front of the page.
//  • CoverSheen   — the light on that surface: a soft specular glare that slides against the
//                   tilt (tvOS focus style).
//  (backgrounds drift through their own `drift` / `parallax` props: AmbientLight, MediaBackdrop)

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useHolySic } from '../../context/HolySicContext';
import { Tilt, TILT_GAIN } from '../../services/motion/tilt';
import { LowRes } from '../ui/LowRes';

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
  // The turning layer gets a wrapper of its own (`collapsable={false}`: a real native view, never
  // flattened away). On iOS, Core Animation depth-sorts sibling layers in one shared 3D space:
  // half of a turned card sits behind z = 0, so the glow drawn next to it (CoverGlow) cut across
  // the cover in a hard diagonal and tinted that half. A plain parent flattens its sublayers into
  // its own plane, so inside the wrapper the card has nothing to intersect.
  // Always the same elements: toggling the effect (Low Power, Reduce Motion…) must not remount
  // the cover underneath — a music video in it would restart.
  return (
    <View collapsable={false} style={style}>
      <Animated.View style={on ? { transform } : null}>{children}</Animated.View>
    </View>
  );
};

// ---------------------------------------------------------------- CoverSheen

/**
 * Light on the cover. Put it as the LAST child inside the cover's clipping view (the one with
 * the border radius + overflow hidden) so it is clipped to the artwork.
 */
export const CoverSheen: React.FC<{ on: boolean; size: number }> = ({ on, size }) => {
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
  if (!on) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Animated.View style={glareStyle}>
        {/* a soft blob — drawn at low resolution (full size would be ~12 MB of bitmap) */}
        <LowRes>
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
        </LowRes>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
