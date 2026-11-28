// Vinyl depth for the motion effects (Turntable style).
//
//  • VinylSheen — the light on a record's grooves. On a real LP it is two opposite bright wedges
//    (a "bow tie") that do NOT turn with the record: they belong to the light and the eye.
//    So this layer sits above the spinning disc without spinning, and turns with the tilt,
//    brightening as the phone leans (the classic conic-gradient LP look, drawn with SVG so it
//    works the same on iOS and web).

import React, { useMemo } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Svg, { Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { Tilt } from '../../services/motion/tilt';
import { useMagnitude, useSvgId } from './TiltLayers';

// ---------------------------------------------------------------- sheen

/** an annulus slice from radius r0 to r1 between angles a0…a1 (degrees, 0 = right, clockwise) */
function wedge(c: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => {
    const t = (a * Math.PI) / 180;
    return `${(c + r * Math.cos(t)).toFixed(2)} ${(c + r * Math.sin(t)).toFixed(2)}`;
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

/** Stationary groove light. Place over the disc, same size, inside a round clip. */
export const VinylSheen: React.FC<{
  on: boolean;
  size: number;
  /** fraction of the radius covered by the paper label (no sheen there) */
  label?: number;
}> = ({ on, size, label = 0.44 }) => {
  const id = useSvgId('hs-vinyl-');
  const mag = useMagnitude();
  const c = size / 2;
  const r0 = c * label;
  const paths = useMemo(() => {
    // three nested widths per side = a soft-edged highlight
    const out: { d: string; o: number }[] = [];
    for (const [half, o] of [
      [20, 0.16],
      [14, 0.22],
      [9, 0.3],
      [5, 0.42],
      [2.5, 0.55],
    ] as const) {
      for (const mid of [0, 180]) out.push({ d: wedge(c, r0, c, mid - half, mid + half), o });
    }
    // a faint cross-light at 90° (the room's other light)
    for (const mid of [90, 270]) out.push({ d: wedge(c, r0, c, mid - 7, mid + 7), o: 0.12 });
    return out;
  }, [c, r0]);
  const style = useMemo(
    () => ({
      opacity: mag.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
      transform: [
        { rotate: '-32deg' },
        {
          // the highlight swings as the phone turns (mostly left/right, a little up/down)
          rotate: Animated.add(
            Animated.multiply(Tilt.x, 40),
            Animated.multiply(Tilt.y, 14)
          ).interpolate({ inputRange: [-180, 180], outputRange: ['-180deg', '180deg'] }),
        },
      ],
    }),
    [mag]
  );
  if (!on) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: c, overflow: 'hidden' }, style]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx={c} cy={c} r={c} gradientUnits="userSpaceOnUse">
            <Stop offset={label} stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset={label + (1 - label) * 0.35} stopColor="#FFFFFF" stopOpacity={0.2} />
            <Stop offset={0.93} stopColor="#FFFFFF" stopOpacity={0.1} />
            <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0.02} />
          </RadialGradient>
        </Defs>
        <G>
          {paths.map((p, i) => (
            <Path key={i} d={p.d} fill={`url(#${id})`} opacity={p.o} />
          ))}
        </G>
      </Svg>
    </Animated.View>
  );
};
