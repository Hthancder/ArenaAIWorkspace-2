// What sits behind the tabs (Home · Search · Library · HolySic). Settings › Background & effects.
//
//  plain       the normal page colour (nothing is drawn)
//  color       a colour / two-colour gradient the user picked (kept readable on light & dark)
//  artwork     the page takes the colours of the playing song, crossfading on every change
//  ambient     the blurred cover glows across the top of every screen, breathing with the bass
//  visualizer  song-coloured page + a soft spectrum along the bottom
//
// Performance: one layer under all tabs (not per screen). Motion is opacity / transform on the
// native driver; nothing re-renders per audio frame. While the full player is open, the app is
// in the background, Low Power Mode is on or "react to music" is off, everything is still.

import React, { useMemo } from 'react';
import { Animated, Image, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BACKDROP_COLORS } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { backgroundTone, mix, isHex, withAlpha } from '../../theme/colorMath';
import { useUi, UiScheme } from '../../theme/ui';
import { normalizeArtworkUrl } from '../ArtworkImage';
import {
  AmbientColors,
  Lobes,
  canShowImage,
  useAmbientColors,
  useAmbientEnergy,
  useCrossfade,
} from './AmbientLight';
import { SpectrumBars, useSpectrumBars } from './SpectrumBars';
import { perfCount } from '../../services/perfProbe';
import { useAppActive } from '../../services/appActivity';

const STRENGTH = { low: 0.55, medium: 0.8, high: 1 } as const;

/** a BACKDROP_COLORS id (follows light / dark) or a #hex, as a readable page tone */
export function resolveBackdropColor(value: string, scheme: UiScheme): string | null {
  if (!value) return null;
  const preset = BACKDROP_COLORS.find((c) => c.id === value);
  if (preset) return scheme === 'light' ? preset.light : preset.dark;
  return isHex(value) ? backgroundTone(value, scheme) : null;
}

/** App in the foreground (no animation work in the background) — shared store */
export { useAppActive };

export const AppBackdrop: React.FC = () => {
  perfCount('render:Backdrop');
  const { prefs, currentTrack, isPlaying, isPlayerOpen, ambient } = useHolySic();
  const ui = useUi();
  const colors = useAmbientColors();
  const appActive = useAppActive();

  const mode = prefs.pureBlack ? 'plain' : prefs.appBackdrop || 'plain';
  const s = STRENGTH[prefs.appBgStrength] ?? 0.8;
  const live =
    mode !== 'plain' &&
    mode !== 'color' &&
    prefs.appBgReactive &&
    !ambient.lowPower &&
    appActive &&
    !isPlayerOpen;

  // the bass "energy" only matters for the glowing modes
  const energy = useAmbientEnergy(
    live && (mode === 'artwork' || mode === 'ambient'),
    true,
    isPlaying
  );
  const bars = useSpectrumBars(
    28,
    live && mode === 'visualizer' && !ambient.reduceMotion,
    isPlaying,
    30
  );

  if (mode === 'plain') return null;

  if (mode === 'color') {
    const c1 = resolveBackdropColor(prefs.appBgColor, ui.scheme) ?? ui.bg;
    const c2 = resolveBackdropColor(prefs.appBgColor2, ui.scheme);
    const top = mix(ui.bg, c1, 0.45 + 0.55 * s);
    const bottom = c2 ? mix(ui.bg, c2, 0.45 + 0.55 * s) : mix(ui.bg, c1, 0.25 + 0.35 * s);
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[top, bottom]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SongWash
        colors={colors}
        scheme={ui.scheme}
        bg={ui.bg}
        strength={mode === 'visualizer' ? s * 0.7 : mode === 'ambient' ? s * 0.45 : s}
      />
      {mode === 'ambient' && (
        <CoverFlood
          uri={currentTrack ? normalizeArtworkUrl(currentTrack.artworkUrl) : ''}
          colors={colors}
          scheme={ui.scheme}
          bg={ui.bg}
          strength={s}
          energy={energy}
          still={ambient.reduceMotion || !live}
        />
      )}
      {mode === 'artwork' && (
        <TopGlow colors={colors} scheme={ui.scheme} strength={s} energy={energy} />
      )}
      {mode === 'visualizer' && (
        <VisualizerBand
          values={bars}
          colors={colors}
          scheme={ui.scheme}
          strength={s}
          variant={prefs.appBgVisualizer || 'mirror'}
        />
      )}
    </View>
  );
};

/** The page takes the song's colours: deep tones at the top melting into the page colour. */
const SongWash: React.FC<{
  colors: AmbientColors;
  scheme: UiScheme;
  bg: string;
  strength: number;
}> = React.memo(({ colors, scheme, bg, strength }) => {
  const key = `${colors.primary}|${colors.secondary}|${scheme}|${strength}`;
  const layers = useCrossfade(key, { colors, scheme, bg, strength }, 1100);
  return (
    <>
      {layers.map((l) => {
        const v = l.value;
        const a = backgroundTone(v.colors.primary, v.scheme);
        const b = backgroundTone(v.colors.secondary, v.scheme);
        const top = mix(v.bg, a, 0.35 + 0.65 * v.strength);
        const mid = mix(v.bg, b, 0.2 + 0.45 * v.strength);
        const low = mix(v.bg, a, 0.12 * v.strength);
        return (
          <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
            <LinearGradient
              colors={[top, mid, low]}
              locations={[0, 0.5, 1]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        );
      })}
    </>
  );
});

/** A soft light at the top of the page in the cover's colours, breathing with the bass. */
const TopGlow: React.FC<{
  colors: AmbientColors;
  scheme: UiScheme;
  strength: number;
  energy: Animated.Value;
}> = ({ colors, scheme, strength, energy }) => {
  const layers = useCrossfade(`${colors.primary}|${colors.corners.join()}`, colors, 1000);
  const opacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const k = (scheme === 'light' ? 0.32 : 0.5) * strength;
  return (
    <Animated.View style={[styles.topGlow, { opacity }]}>
      {layers.map((l) => (
        <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
          <Lobes colors={l.value} strength={k} spread={1.5} />
        </Animated.View>
      ))}
    </Animated.View>
  );
};

/** Ambient: the blurred cover floods the top of every screen and fades into the page. */
const CoverFlood: React.FC<{
  uri: string;
  colors: AmbientColors;
  scheme: UiScheme;
  bg: string;
  strength: number;
  energy: Animated.Value;
  still: boolean;
}> = ({ uri, colors, scheme, bg, strength, energy, still }) => {
  const layers = useCrossfade(`${uri}|${colors.primary}`, { uri, colors }, 1000);
  const breathe = energy.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const scale = still ? 1 : energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const light = scheme === 'light';
  return (
    <>
      {layers.map((l) => (
        <Animated.View key={l.key} style={[StyleSheet.absoluteFill, { opacity: l.op }]}>
          {canShowImage(l.value.uri) && (
            <Image
              source={{ uri: l.value.uri }}
              blurRadius={Platform.OS === 'web' ? 90 : 80}
              resizeMode="cover"
              style={[styles.flood, { opacity: (light ? 0.38 : 0.55) * strength }]}
            />
          )}
          <Animated.View style={[styles.topGlow, { opacity: breathe, transform: [{ scale }] }]}>
            <Lobes
              colors={l.value.colors}
              strength={(light ? 0.4 : 0.75) * strength}
              spread={1.6}
            />
          </Animated.View>
        </Animated.View>
      ))}
      {/* legibility: the light lives at the top; lists and text below sit on the page colour */}
      <LinearGradient
        colors={[
          withAlpha(bg, light ? 0.25 : 0.1),
          withAlpha(bg, light ? 0.7 : 0.55),
          withAlpha(bg, 0.94),
        ]}
        locations={[0, 0.42, 0.8]}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
};

/** Visualizer: a soft spectrum in the song's colours along the bottom of the page. */
const VisualizerBand: React.FC<{
  values: Animated.Value[];
  colors: AmbientColors;
  scheme: UiScheme;
  strength: number;
  variant: 'bars' | 'mirror' | 'wave';
}> = ({ values, colors, scheme, strength, variant }) => {
  const palette = useMemo(() => {
    const [tl, tr, bl, br] = colors.corners;
    const seq = [bl, tl, colors.primary, tr, br];
    // on the light UI the bars are deepened a touch so they read on a pale page
    return seq.map((c) => (scheme === 'light' ? mix(c, '#000000', 0.15) : c));
  }, [colors, scheme]);
  const opacity = (scheme === 'light' ? 0.22 : 0.3) * (0.6 + 0.4 * strength);
  return (
    <SpectrumBars
      values={values}
      colors={palette}
      variant={variant}
      opacity={opacity}
      gap={variant === 'bars' ? 4 : 3}
      style={variant === 'mirror' ? styles.vizMirror : styles.vizBottom}
    />
  );
};

const styles = StyleSheet.create({
  flood: {
    position: 'absolute',
    top: '-20%',
    left: '-40%',
    width: '180%',
    height: '90%',
  },
  topGlow: { position: 'absolute', top: '-30%', left: '-25%', width: '150%', height: '85%' },
  // above the floating dock (mini player + tab bar), so the band is actually seen
  vizBottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 150,
    height: '34%',
  },
  vizMirror: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 120,
    height: '36%',
  },
});
