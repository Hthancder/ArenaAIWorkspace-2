// Vinyl depth for the motion effects.
//
//  • VinylSheen — the light on a record's grooves. On a real LP it is two opposite bright wedges
//    (a "bow tie") that do NOT turn with the record: they belong to the light and the eye.
//    So this layer sits above the spinning disc without spinning, and turns with the tilt,
//    brightening as the phone leans (the classic conic-gradient LP look, drawn with SVG so it
//    works the same on iOS and web).
//  • VinylPeek — a record half-hidden behind the Flagship cover, like an LP sliding out of its
//    sleeve. It spins while the song plays, sits a layer behind the sleeve (drifts with the eye)
//    and takes the sleeve's shadow along its edge.

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { useSpin } from '../../hooks/useSpin';
import { useAppActive } from '../../services/appActivity';
import { Tilt } from '../../services/motion/tilt';
import { ArtworkImage } from '../ArtworkImage';
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

// ---------------------------------------------------------------- record

const VinylRecord: React.FC<{
  size: number;
  artworkUrl?: string;
  seed: string;
  accent: string;
  spin: Animated.Value;
}> = ({ size, artworkUrl, seed, accent, spin }) => {
  const r = size / 2;
  const label = size * 0.4;
  const rotate = useMemo(
    () => spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
    [spin]
  );
  return (
    <Animated.View
      style={[styles.disc, { width: size, height: size, borderRadius: r, transform: [{ rotate }] }]}
    >
      {[0.92, 0.8, 0.68, 0.56].map((f, i) => (
        <View
          key={f}
          style={{
            position: 'absolute',
            width: size * f,
            height: size * f,
            borderRadius: (size * f) / 2,
            borderWidth: 1,
            borderColor: `rgba(255,255,255,${[0.06, 0.045, 0.06, 0.05][i]})`,
          }}
        />
      ))}
      <View
        style={{
          width: label,
          height: label,
          borderRadius: label / 2,
          overflow: 'hidden',
          borderWidth: 2,
          borderColor: accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ArtworkImage
          source={{ uri: artworkUrl }}
          fallbackSeed={seed}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.hole, { width: size * 0.045, height: size * 0.045 }]} />
      </View>
    </Animated.View>
  );
};

// ---------------------------------------------------------------- record behind the cover

/**
 * The LP half out of its sleeve. Render it as the FIRST child of the box that holds the cover
 * (so it is drawn behind it); `size` is the cover's size.
 */
export const VinylPeek: React.FC<{
  size: number;
  artworkUrl?: string;
  seed: string;
  accent: string;
  playing: boolean;
}> = ({ size, artworkUrl, seed, accent, playing }) => {
  const d = Math.round(size * 0.92);
  const peek = Math.round(size * 0.095);
  const active = useAppActive();
  const spin = useSpin(playing && active, 4200);
  // slides out of the sleeve when it appears
  const out = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(out, {
      toValue: 1,
      duration: 520,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [out]);
  const slide = useMemo(
    () => ({
      transform: [{ translateX: out.interpolate({ inputRange: [0, 1], outputRange: [-peek, 0] }) }],
    }),
    [out, peek]
  );
  // a layer behind the sleeve: drifts with the eye, so it slides out further as you turn right
  const drift = useMemo(
    () => ({
      transform: [
        { translateX: Animated.multiply(Tilt.x, size * 0.04) },
        { translateY: Animated.multiply(Tilt.y, size * 0.015) },
      ],
    }),
    [size]
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: d, height: d, top: (size - d) / 2, left: size - d + peek },
        drift,
      ]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: d / 2, overflow: 'hidden' }, slide]}
      >
        <VinylRecord size={d} artworkUrl={artworkUrl} seed={seed} accent={accent} spin={spin} />
        <VinylSheen on size={d} label={0.4} />
        {/* the sleeve's shadow on the record, just past the sleeve's edge */}
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: d - peek - 4,
            width: Math.max(10, peek * 0.75),
          }}
        />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  disc: {
    backgroundColor: '#0E0E12',
    borderWidth: 3,
    borderColor: '#23232D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hole: {
    position: 'absolute',
    borderRadius: 99,
    backgroundColor: '#111116',
    borderWidth: 1.5,
    borderColor: '#D4D4DC',
  },
});
