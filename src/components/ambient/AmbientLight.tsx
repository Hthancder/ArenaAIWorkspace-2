// HolySic Ambient Light — a YouTube "ambient mode" for music. The cover's real colours bleed
// out into the player: a huge blurred copy of the artwork floods the background, a soft glow
// shaped like the cover's colour layout (each corner glows its own colour) surrounds the art,
// and the light breathes with the bass. Changing songs crossfades the light over ~1 s.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { normalizeArtworkUrl } from '../ArtworkImage';
import { perfCount } from '../../services/perfProbe';
import { useAppActive } from '../../services/appActivity';
import { audioEngine } from '../../services/audio/audioEngine';
import { useHolySic } from '../../context/HolySicContext';
import { getUi } from '../../theme/ui';
import { Tilt } from '../../services/motion/tilt';
import { LowRes } from '../ui/LowRes';

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
export function useAmbientEnergy(activeIn: boolean, breathing: boolean, isPlaying: boolean) {
  const active = useAppActive() && activeIn;
  const energy = useRef(new Animated.Value(0.35)).current;
  // Everything here runs on the native driver: JS only picks a target ~30×/s from the real
  // spectrum, the UI thread does the easing at full frame rate.
  useEffect(() => {
    Animated.timing(energy, { toValue: 0.35, duration: 1, useNativeDriver: true }).start();
  }, [energy]);
  useEffect(() => {
    if (!active) return;
    const to = (v: number, ms: number, easing = Easing.out(Easing.quad)) =>
      Animated.timing(energy, { toValue: v, duration: ms, easing, useNativeDriver: true });
    if (!breathing || !isPlaying) {
      to(isPlaying ? 0.5 : 0.24, 700, Easing.inOut(Easing.quad)).start();
      return;
    }
    let level = 0.35;
    let lastReal = 0;
    let lastPush = 0;
    let calm: Animated.CompositeAnimation | null = null;
    const startCalm = () => {
      if (calm) return;
      // no readable audio (e.g. HLS): a slow, calm breath — never a fake beat
      calm = Animated.loop(
        Animated.sequence([
          to(0.61, 2100, Easing.inOut(Easing.sin)),
          to(0.29, 2100, Easing.inOut(Easing.sin)),
        ])
      );
      calm.start();
    };
    const stopCalm = () => {
      calm?.stop();
      calm = null;
    };
    const unsub = audioEngine.subscribeSpectrum((b) => {
      const now = Date.now();
      lastReal = now;
      if (now - lastPush < 33) return;
      lastPush = now;
      stopCalm();
      // 32 real bands: the lowest ~20% (≈40–150 Hz) is the kick & bass line
      const nb = Math.max(1, Math.round(b.length * 0.2));
      let bass = 0;
      for (let i = 0; i < nb; i++) bass += b[i];
      bass /= nb;
      let all = 0;
      for (let i = 0; i < b.length; i++) all += b[i];
      all /= b.length || 1;
      const target = Math.min(1, bass * 0.85 + all * 0.35);
      // fast attack, slow release, like a light reacting to a kick drum. Smoothed here and sent
      // as one value (not a new native animation per event: that was 3 bridge calls each time)
      const next = target > level ? level + (target - level) * 0.6 : level + (target - level) * 0.1;
      if (Math.abs(next - level) < 0.008) return;
      level = next;
      perfCount('anim:ambient');
      energy.setValue(next);
    });
    const watch = setInterval(() => {
      if (Date.now() - lastReal > 1200) startCalm();
    }, 600);
    if (Date.now() - lastReal > 1200) startCalm();
    return () => {
      clearInterval(watch);
      stopCalm();
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
export function useCrossfade<T>(key: string, value: T, ms = 1000): Layer<T>[] {
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

export const canShowImage = (uri: string) =>
  !!uri && (Platform.OS === 'web' || !uri.startsWith('data:image/svg'));

// ---------------------------------------------------------------- colour lobes

/** Soft radial lobes in the cover's corner colours — the shape of YouTube's glow. */
export const Lobes: React.FC<{ colors: AmbientColors; strength: number; spread?: number }> =
  React.memo(({ colors, strength, spread = 1 }) => {
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
    // pure gradients: drawn at low resolution and scaled up (1/16 of the bitmap memory)
    return (
      <LowRes>
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
      </LowRes>
    );
  });

// ---------------------------------------------------------------- tilt drift

/** translate with the motion-effect tilt (its own node, never mixed with the energy values) */
function useDrift(amount: number) {
  return useMemo(
    () =>
      amount
        ? {
            transform: [
              { translateX: Animated.multiply(Tilt.x, amount) },
              { translateY: Animated.multiply(Tilt.y, amount) },
            ],
          }
        : null,
    [amount]
  );
}

// ---------------------------------------------------------------- full-screen backdrop

/** Full-screen ambient backdrop for the player: blurred cover flood + colour lobes + scrim. */
export const AmbientBackdrop: React.FC<{
  artworkUrl?: string;
  colors: AmbientColors;
  level: number;
  energy: Animated.Value;
  /** Reduce Motion: breathe with opacity only, never zoom */
  still?: boolean;
  /** motion effects: points the light drifts with the tilt (0 = fixed) */
  drift?: number;
}> = React.memo(({ artworkUrl, colors, level, energy, still, drift = 0 }) => {
  const uri = normalizeArtworkUrl(artworkUrl);
  const layers = useCrossfade(`${uri}|${colors.primary}|${colors.corners.join()}`, {
    uri,
    colors,
  });
  const breathe = energy.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const scale = still ? 1 : energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const driftStyle = useDrift(drift);
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
          {/* the light is far behind the cover: it drifts with the eye. Only the oversized
              flood and lobes move — the base gradient and the scrim stay put (no edges) */}
          <Animated.View style={[StyleSheet.absoluteFill, driftStyle]}>
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
});

// ---------------------------------------------------------------- glow around the cover

/** Wraps the cover art and lets its colours glow around it, breathing with the music. */
export const CoverGlow: React.FC<{
  colors: AmbientColors;
  level: number;
  energy: Animated.Value;
  size: number;
  children: React.ReactNode;
  style?: ViewStyle;
  still?: boolean;
  /** motion effects: points the glow drifts with the tilt — it sits behind the cover */
  drift?: number;
}> = ({ colors, level, energy, size, children, style, still, drift = 0 }) => {
  const layers = useCrossfade(`${colors.primary}|${colors.corners.join()}`, colors);
  const driftStyle = useDrift(drift);
  const pad = size * 0.55;
  const opacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const scale = still ? 1 : energy.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.1] });
  return (
    <View style={style}>
      {level > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: -pad, top: -pad, right: -pad, bottom: -pad },
            driftStyle,
          ]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale }] }]}>
            {layers.map((l) => (
              <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
                <Lobes colors={l.value} strength={level} spread={1.3} />
              </Animated.View>
            ))}
          </Animated.View>
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
    <LowRes>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {colors.corners.map((c, i) => (
            <RadialGradient key={i} id={ids[i]} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={c} stopOpacity={0.75 * level} />
              <Stop offset="1" stopColor={c} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {[colors.corners[0], colors.corners[2], colors.corners[1], colors.corners[3]].map(
          (_, i) => (
            <Ellipse
              key={i}
              cx={[14, 38, 62, 86][i]}
              cy={50}
              rx={30}
              ry={50}
              fill={`url(#${ids[[0, 2, 1, 3][i]]})`}
            />
          )
        )}
      </Svg>
    </LowRes>
  );
};

const Wash: React.FC<{ colors: AmbientColors; level: number }> = ({ colors, level }) => {
  const ids = useIds(1);
  // the wash fades into the page background (light or dark UI)
  const ui = getUi();
  const fade = ui.bg;
  return (
    <>
      <Lobes colors={colors} strength={(ui.scheme === 'light' ? 0.42 : 0.6) * level} spread={1.5} />
      <LowRes>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id={ids[0]} cx="50%" cy="0%" rx="85%" ry="100%">
              <Stop offset="0" stopColor={fade} stopOpacity={0} />
              <Stop offset="0.7" stopColor={fade} stopOpacity={0.6} />
              <Stop offset="1" stopColor={fade} stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${ids[0]})`} />
        </Svg>
      </LowRes>
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
  const { artColors, darkPalette: palette } = useHolySic();
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
