// Visual layers for the motion effects. All of them read the shared Tilt values and animate
// only transforms / opacity on the native driver — no re-render per frame, and when the effect
// is off the layers aren't drawn at all.
//
//  • TiltCard     — a surface that turns in 3D to face the eye (world-stable, like a card held
//                   under glass), floats a few points in front of the page, and — with `depth` —
//                   is a real slab: its edge shows on the side you lean toward, and it hovers
//                   over a soft shadow cast on the page behind it.
//  (backgrounds drift through their own `drift` / `parallax` props: AmbientLight, MediaBackdrop;
//   the tabs' depth scenes are in TabDepthScene)
//
// No specular "sheen" on the surface any more (Phase 26): depth now comes from geometry — the
// turn, the thickness, the cast shadow and the layers moving at different speeds.

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

/** slabs drawn for the card's edge (more = smoother edge, each is one small layer) */
const EDGE_SLICES = 5;

export const TiltCard: React.FC<{
  on: boolean;
  /** largest turn in degrees at full tilt */
  maxDeg?: number;
  /** points the card floats against the eye (it sits in front of the page) */
  float?: number;
  /** thickness in points (0 = a flat surface): the edge + the cast shadow */
  depth?: number;
  /** corner radius of the card (its edge follows it) */
  radius?: number;
  /** the card's content is still (artwork): cache it as a bitmap while it turns, so its edges
   *  are antialiased (iOS doesn't smooth the edges of a layer turned in 3D: they stair-step) */
  crisp?: boolean;
  /** transforms the card's content has of its own (a swipe, a pause scale…): the edge and the
   *  shadow follow them, so they never peek out from behind a moving card */
  follow?: any[];
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}> = ({
  on,
  maxDeg = 9,
  float = 5,
  depth = 0,
  radius = 20,
  crisp = false,
  follow,
  style,
  children,
}) => {
  const transform = useMemo(
    () => [
      // a closer eye than before (900): the same turn reads as more depth
      { perspective: 650 },
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
  // the edge: slabs behind the face, each a little further back. Lean right and the back of a
  // slab shifts right of its face (nearer points move more), so the right edge shows.
  const slices = useMemo(
    () =>
      depth > 0
        ? Array.from({ length: EDGE_SLICES }, (_, i) => {
            const k = (depth * (EDGE_SLICES - i)) / EDGE_SLICES;
            return {
              key: i,
              // the far slab is darkest; the one just behind the face catches a little light
              shade: i === EDGE_SLICES - 1 ? '#2A2A34' : i === 0 ? '#08080B' : '#15151C',
              transform: [
                ...(follow || []),
                { translateX: Animated.multiply(Tilt.x, k) },
                { translateY: Animated.multiply(Tilt.y, k) },
              ],
            };
          })
        : [],
    [depth, follow]
  );
  // the cast shadow on the page: far behind the card, so it slides with the eye, further
  const shadowStyle = useMemo(
    () =>
      depth > 0
        ? {
            transform: [
              ...(follow || []),
              { translateX: Animated.multiply(Tilt.x, depth * 2.2) },
              { translateY: Animated.add(Animated.multiply(Tilt.y, depth * 1.6), depth * 1.4) },
            ],
          }
        : null,
    [depth, follow]
  );
  const showDepth = on && depth > 0;
  // The turning layer gets a wrapper of its own (`collapsable={false}`: a real native view, never
  // flattened away). On iOS, Core Animation depth-sorts sibling layers in one shared 3D space:
  // half of a turned card sits behind z = 0, so the glow drawn next to it (CoverGlow) cut across
  // the cover in a hard diagonal and tinted that half. A plain parent flattens its sublayers into
  // its own plane, so inside the wrapper the card has nothing to intersect.
  // Always the same elements: toggling the effect (Low Power, Reduce Motion…) must not remount
  // the cover underneath — a music video in it would restart.
  return (
    <View collapsable={false} style={style}>
      {showDepth && shadowStyle && (
        <Animated.View pointerEvents="none" style={[styles.castShadow, shadowStyle]}>
          <CastShadow radius={radius} />
        </Animated.View>
      )}
      <Animated.View style={on ? { transform } : null}>
        {showDepth &&
          slices.map((sl) => (
            // each slab is cached as a bitmap with a transparent margin (its own movement doesn't
            // invalidate the cache), so its rim is smooth when turned
            <Animated.View
              key={sl.key}
              pointerEvents="none"
              shouldRasterizeIOS
              style={[styles.slabWrap, { transform: sl.transform }]}
            >
              <View style={[styles.slab, { borderRadius: radius, backgroundColor: sl.shade }]} />
            </Animated.View>
          ))}
        <View
          collapsable={false}
          shouldRasterizeIOS={on && crisp}
          // a transparent margin around the face: the cached bitmap's own edge is clear, the
          // card's edge sits inside it and is filtered smooth as it turns
          style={crisp ? styles.crispPad : null}
        >
          {children}
        </View>
      </Animated.View>
    </View>
  );
};

/** soft dark blob under a floating card (a low-res gradient: cheap at any size) */
const CastShadow: React.FC<{ radius: number }> = ({ radius }) => {
  const id = useSvgId('hs-cast-');
  return (
    <LowRes>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#000000" stopOpacity={0.55} />
            <Stop offset={radius > 40 ? '0.6' : '0.5'} stopColor="#000000" stopOpacity={0.3} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </LowRes>
  );
};

const styles = StyleSheet.create({
  castShadow: { position: 'absolute', left: '-12%', right: '-12%', top: '-6%', bottom: '-18%' },
  slabWrap: { position: 'absolute', left: -2, top: -2, right: -2, bottom: -2 },
  slab: { position: 'absolute', left: 2, top: 2, right: 2, bottom: 2 },
  crispPad: { padding: 2, margin: -2 },
});
