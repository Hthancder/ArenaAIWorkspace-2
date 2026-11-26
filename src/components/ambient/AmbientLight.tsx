// HolySic Ambient Light — a YouTube "ambient mode" for music. The cover's real colours bleed
// out into the player: a huge blurred copy of the artwork floods the background, a soft glow
// shaped like the cover's colour layout (each corner glows its own colour) surrounds the art,
// and the light breathes with the bass. Changing songs crossfades the light over ~1 s.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { normalizeArtworkUrl } from '../ArtworkImage';
import { audioEngine } from '../../services/audio/audioEngine';
import { useHolySic } from '../../context/HolySicContext';

export interface AmbientColors {
  primary: string;
  secondary: string;
  dark: string;
  corners: [string, string, string, string];
}

let gradSeq = 0;
const useIds = (n: number) =>
  useMemo(() => Array.from({ length: n }, () => `amb${++gradSeq}`), [n]);

// ---------------------------------------------------------------- energy (breathing)

/**
 * 0..1 "light energy". Follows the real bass from the audio engine's spectrum when the platform
 * can tap PCM; otherwise a slow, natural breath. Calm when paused, steady when breathing is off.
 */
export function useAmbientEnergy(active: boolean, breathing: boolean, isPlaying: boolean) {
  const energy = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (!active) return;
    if (!breathing) {
      Animated.timing(energy, {
        toValue: isPlaying ? 0.5 : 0.28,
        duration: 700,
        useNativeDriver: false,
      }).start();
      return;
    }
    let target = 0.35;
    let lastReal = 0;
    let level = 0.35;
    const unsub = audioEngine.subscribeSpectrum((b) => {
      lastReal = Date.now();
      const bass = (b[0] + b[1] + b[2]) / 3;
      const all = b.reduce((a, c) => a + c, 0) / (b.length || 1);
      target = Math.min(1, bass * 0.8 + all * 0.4);
    });
    const t0 = Date.now();
    let last = 0;
    let raf = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 33) return; // ~30 fps is plenty for light
      last = ts;
      const now = Date.now();
      let tgt: number;
      if (!isPlaying) tgt = 0.22;
      else if (now - lastReal < 1200) tgt = target;
      else {
        const t = (now - t0) / 1000;
        tgt =
          0.46 + 0.2 * Math.sin((t * 2 * Math.PI) / 3.8) + 0.07 * Math.sin((t * 2 * Math.PI) / 1.3);
      }
      // fast attack, slow release, like a light reacting to a kick drum
      level += (tgt - level) * (tgt > level ? 0.4 : 0.07);
      energy.setValue(level);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [active, breathing, isPlaying, energy]);
  return energy;
}

// ---------------------------------------------------------------- crossfade

interface Layer<T> {
  key: string;
  value: T;
  op: Animated.Value;
}

/** Keeps the previous light on screen while the new one fades in over it. */
function useCrossfade<T>(key: string, value: T, ms = 1000): Layer<T>[] {
  const valueRef = useRef(value);
  valueRef.current = value;
  const [layers, setLayers] = useState<Layer<T>[]>(() => [
    { key, value, op: new Animated.Value(1) },
  ]);
  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1]?.key === key) return prev;
      const op = new Animated.Value(0);
      Animated.timing(op, {
        toValue: 1,
        duration: ms,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setLayers((cur) => cur.filter((l) => l.key === key));
      });
      return [...prev.slice(-1), { key, value: valueRef.current, op }];
    });
  }, [key, ms]);
  return layers;
}

const canShowImage = (uri: string) =>
  !!uri && (Platform.OS === 'web' || !uri.startsWith('data:image/svg'));

// ---------------------------------------------------------------- colour lobes

/** Soft radial lobes in the cover's corner colours — the shape of YouTube's glow. */
const Lobes: React.FC<{ colors: AmbientColors; strength: number; spread?: number }> = ({
  colors,
  strength,
  spread = 1,
}) => {
  const ids = useIds(5);
  const [tl, tr, bl, br] = colors.corners;
  const lobe = (id: string, c: string, o: number) => (
    <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%">
      <Stop offset="0" stopColor={c} stopOpacity={Math.min(1, o * strength)} />
      <Stop offset="0.45" stopColor={c} stopOpacity={Math.min(1, o * strength * 0.45)} />
      <Stop offset="1" stopColor={c} stopOpacity={0} />
    </RadialGradient>
  );
  const r = 34 * spread;
  return (
    <Svg width="100%" height="100%" viewBox="-25 -25 150 150" preserveAspectRatio="none">
      <Defs>
        {lobe(ids[0], colors.primary, 0.75)}
        {lobe(ids[1], tl, 0.9)}
        {lobe(ids[2], tr, 0.9)}
        {lobe(ids[3], bl, 0.9)}
        {lobe(ids[4], br, 0.9)}
      </Defs>
      <Ellipse cx="50" cy="50" rx={r * 1.25} ry={r * 1.25} fill={`url(#${ids[0]})`} />
      <Ellipse cx="30" cy="30" rx={r} ry={r} fill={`url(#${ids[1]})`} />
      <Ellipse cx="70" cy="30" rx={r} ry={r} fill={`url(#${ids[2]})`} />
      <Ellipse cx="30" cy="70" rx={r} ry={r} fill={`url(#${ids[3]})`} />
      <Ellipse cx="70" cy="70" rx={r} ry={r} fill={`url(#${ids[4]})`} />
    </Svg>
  );
};

// ---------------------------------------------------------------- full-screen backdrop

/** Full-screen ambient backdrop for the player: blurred cover flood + colour lobes + scrim. */
export const AmbientBackdrop: React.FC<{
  artworkUrl?: string;
  colors: AmbientColors;
  level: number;
  energy: Animated.Value;
}> = ({ artworkUrl, colors, level, energy }) => {
  const uri = normalizeArtworkUrl(artworkUrl);
  const layers = useCrossfade(`${uri}|${colors.primary}|${colors.corners.join()}`, {
    uri,
    colors,
  });
  const breathe = energy.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const scale = energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {layers.map((l) => (
        <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
          <LinearGradient
            colors={[l.value.colors.dark, '#050507']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {canShowImage(l.value.uri) && (
            <Image
              source={{ uri: l.value.uri }}
              blurRadius={Platform.OS === 'web' ? 80 : 70}
              resizeMode="cover"
              style={[styles.flood, { opacity: 0.62 * level }]}
            />
          )}
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: breathe, transform: [{ scale }] }]}
          >
            <View style={styles.lobesTop}>
              <Lobes colors={l.value.colors} strength={0.9 * level} spread={1.6} />
            </View>
          </Animated.View>
        </Animated.View>
      ))}
      {/* legibility scrim: lighter at the top where the cover sits, darker under the controls */}
      <LinearGradient
        colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.26)', 'rgba(0,0,0,0.62)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

// ---------------------------------------------------------------- glow around the cover

/** Wraps the cover art and lets its colours glow around it, breathing with the music. */
export const CoverGlow: React.FC<{
  colors: AmbientColors;
  level: number;
  energy: Animated.Value;
  size: number;
  children: React.ReactNode;
  style?: ViewStyle;
}> = ({ colors, level, energy, size, children, style }) => {
  const layers = useCrossfade(`${colors.primary}|${colors.corners.join()}`, colors);
  const pad = size * 0.55;
  const opacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const scale = energy.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.1] });
  return (
    <View style={style}>
      {level > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -pad,
            top: -pad,
            right: -pad,
            bottom: -pad,
            opacity,
            transform: [{ scale }],
          }}
        >
          {layers.map((l) => (
            <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
              <Lobes colors={l.value} strength={level} spread={1.3} />
            </Animated.View>
          ))}
        </Animated.View>
      )}
      {children}
    </View>
  );
};

// ---------------------------------------------------------------- spill (mini player / Home)

const Band: React.FC<{ colors: AmbientColors; level: number }> = ({ colors, level }) => {
  const ids = useIds(4);
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        {colors.corners.map((c, i) => (
          <RadialGradient key={i} id={ids[i]} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={c} stopOpacity={0.75 * level} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {[colors.corners[0], colors.corners[2], colors.corners[1], colors.corners[3]].map((_, i) => (
        <Ellipse
          key={i}
          cx={[14, 38, 62, 86][i]}
          cy={50}
          rx={30}
          ry={50}
          fill={`url(#${ids[[0, 2, 1, 3][i]]})`}
        />
      ))}
    </Svg>
  );
};

const Wash: React.FC<{ colors: AmbientColors; level: number }> = ({ colors, level }) => {
  const ids = useIds(1);
  return (
    <>
      <Lobes colors={colors} strength={0.6 * level} spread={1.5} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id={ids[0]} cx="50%" cy="0%" rx="85%" ry="100%">
            <Stop offset="0" stopColor="#0A0A0E" stopOpacity={0} />
            <Stop offset="0.7" stopColor="#0A0A0E" stopOpacity={0.6} />
            <Stop offset="1" stopColor="#0A0A0E" stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${ids[0]})`} />
      </Svg>
    </>
  );
};

/** Static, cheap light spill behind a surface (mini player) or across the top of a screen. */
export const AmbientSpill: React.FC<{
  colors: AmbientColors;
  level: number;
  style?: ViewStyle;
  /** 'band' = wide strip (mini player), 'wash' = top-of-screen wash fading downwards */
  variant?: 'band' | 'wash';
}> = ({ colors, level, style, variant = 'band' }) => {
  const layers = useCrossfade(`${colors.primary}|${colors.corners.join()}`, colors, 900);
  return (
    <View pointerEvents="none" style={style}>
      {layers.map((l) => (
        <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
          {variant === 'band' ? (
            <Band colors={l.value} level={level} />
          ) : (
            <Wash colors={l.value} level={level} />
          )}
        </Animated.View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------- colours hook

/** Ambient colours for the current song: the real cover colours, or the palette as fallback. */
export function useAmbientColors(): AmbientColors {
  const { artColors, palette } = useHolySic();
  return useMemo(() => {
    if (artColors) return artColors;
    const m = palette.appleMesh;
    return {
      primary: palette.seed,
      secondary: m[1],
      dark: palette.surface,
      corners: [m[0], m[1], m[2], palette.seed],
    };
  }, [artColors, palette]);
}

const styles = StyleSheet.create({
  flood: {
    position: 'absolute',
    top: '-25%',
    left: '-45%',
    width: '190%',
    height: '115%',
  },
  lobesTop: { position: 'absolute', top: '-22%', left: '-30%', width: '160%', height: '112%' },
});
