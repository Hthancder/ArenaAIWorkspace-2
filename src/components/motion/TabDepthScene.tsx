// Depth scenes behind the tabs (Settings › Effects › Motion effects › Tab scenes).
//
// Each tab has a small world of its own on three planes — far, middle, near — that slide at
// different speeds as the phone tilts (the far plane the most, like looking through a window
// at things at different distances):
//   Home      aurora    big soft lights far away, bokeh in the middle, sparks up close
//   Search    stars     a dim starfield, brighter stars, a few four-point glints in front
//   Library   records   vinyl discs in the distance, album sleeves floating, notes up close
//   HolySic   geometry  wide thin rings, turning diamonds, small crosses
// Colours come from the playing song (or the accent). Only the tab on screen has its scene:
// switching tabs unmounts the old one and fades the new one in — never four at once. Nothing
// re-renders per frame: every plane is a native-driven transform of the shared tilt values.

import React, { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { MainTab } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { Tilt } from '../../services/motion/tilt';
import { useAppActive } from '../../services/appActivity';
import { useUi } from '../../theme/ui';
import { useAmbientColors } from '../ambient/AmbientLight';
import { LowRes } from '../ui/LowRes';
import { useSvgId, useTilt } from './TiltLayers';

const LEVEL = { low: 0.6, medium: 1, high: 1.45 } as const;

/** points each plane slides at full tilt (far → near) */
const PLANES = [{ depth: 34 }, { depth: 19 }, { depth: 8 }] as const;

type Item =
  | { k: 'orb'; x: number; y: number; s: number; c: string; o: number }
  | { k: 'dot'; x: number; y: number; s: number; c: string; o: number; ring?: boolean }
  | { k: 'ring'; x: number; y: number; s: number; c: string; o: number; w: number }
  | { k: 'square'; x: number; y: number; s: number; c: string; o: number; r: number; fill: boolean }
  | { k: 'disc'; x: number; y: number; s: number; c: string; o: number }
  | { k: 'glyph'; x: number; y: number; s: number; c: string; o: number; g: string; r: number }
  | { k: 'glint'; x: number; y: number; s: number; c: string; o: number }
  | { k: 'cross'; x: number; y: number; s: number; c: string; o: number };

/** small deterministic random (the same scene every time a tab opens) */
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

const SEED: Record<MainTab, number> = { home: 11, search: 23, library: 37, settings: 53 };

/** the three planes of a tab's scene, in screen points */
export function buildScene(
  tab: MainTab,
  W: number,
  H: number,
  c: [string, string, string],
  light: boolean
): Item[][] {
  const r = rng(SEED[tab]);
  const rnd = (a: number, b: number) => a + (b - a) * r();
  const pick = () => c[Math.floor(r() * 3) % 3];
  const ink = light ? '#1A1530' : '#FFFFFF';
  const far: Item[] = [];
  const mid: Item[] = [];
  const near: Item[] = [];
  switch (tab) {
    case 'home':
      far.push(
        { k: 'orb', x: W * 0.12, y: H * 0.1, s: W * 1.0, c: c[0], o: 0.42 },
        { k: 'orb', x: W * 0.92, y: H * 0.36, s: W * 0.85, c: c[1], o: 0.32 },
        { k: 'orb', x: W * 0.35, y: H * 0.82, s: W * 0.95, c: c[2], o: 0.26 }
      );
      for (let i = 0; i < 7; i++)
        mid.push({
          k: 'dot',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(38, 96),
          c: pick(),
          o: rnd(0.07, 0.14),
          ring: true,
        });
      for (let i = 0; i < 16; i++)
        near.push({
          k: 'dot',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(2.5, 6.5),
          c: ink,
          o: rnd(0.3, 0.6),
        });
      break;
    case 'search':
      far.push({ k: 'orb', x: W * 0.5, y: -H * 0.02, s: W * 1.2, c: c[0], o: 0.34 });
      for (let i = 0; i < 46; i++)
        far.push({ k: 'dot', x: rnd(0, W), y: rnd(0, H), s: rnd(1, 2), c: ink, o: rnd(0.2, 0.45) });
      for (let i = 0; i < 20; i++)
        mid.push({
          k: 'dot',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(2, 3.2),
          c: ink,
          o: rnd(0.45, 0.75),
        });
      for (let i = 0; i < 6; i++)
        near.push({
          k: 'glint',
          x: rnd(0.05, 0.95) * W,
          y: rnd(0.05, 0.9) * H,
          s: rnd(12, 22),
          c: pick(),
          o: rnd(0.5, 0.8),
        });
      break;
    case 'library':
      far.push(
        { k: 'orb', x: W * 0.1, y: H * 0.78, s: W * 1.0, c: c[0], o: 0.3 },
        { k: 'disc', x: W * 0.95, y: H * 0.16, s: W * 0.78, c: c[1], o: 0.16 },
        { k: 'disc', x: W * 0.08, y: H * 0.5, s: W * 0.5, c: c[2], o: 0.12 }
      );
      for (let i = 0; i < 6; i++)
        mid.push({
          k: 'square',
          x: rnd(0, W),
          y: rnd(0.05, 0.95) * H,
          s: rnd(56, 112),
          c: pick(),
          o: rnd(0.16, 0.28),
          r: rnd(-20, 20),
          fill: i % 2 === 0,
        });
      for (let i = 0; i < 9; i++)
        near.push({
          k: 'glyph',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(14, 26),
          c: pick(),
          o: rnd(0.28, 0.5),
          g: ['♪', '♫', '♬'][i % 3],
          r: rnd(-18, 18),
        });
      break;
    default:
      far.push({ k: 'orb', x: W * 0.9, y: H * 0.08, s: W * 1.0, c: c[1], o: 0.32 });
      for (let i = 0; i < 3; i++)
        far.push({
          k: 'ring',
          x: [W * 0.2, W * 0.85, W * 0.4][i],
          y: [H * 0.3, H * 0.62, H * 0.92][i],
          s: [W * 0.9, W * 1.2, W * 0.75][i],
          c: c[i % 3],
          o: 0.14,
          w: 1,
        });
      for (let i = 0; i < 7; i++)
        mid.push({
          k: 'square',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(26, 64),
          c: pick(),
          o: rnd(0.2, 0.34),
          r: 45,
          fill: false,
        });
      for (let i = 0; i < 12; i++)
        near.push({
          k: 'cross',
          x: rnd(0, W),
          y: rnd(0, H),
          s: rnd(7, 12),
          c: ink,
          o: rnd(0.25, 0.45),
        });
  }
  return [far, mid, near];
}

const Orb: React.FC<{ c: string; o: number }> = ({ c, o }) => {
  const id = useSvgId('hs-orb-');
  return (
    <LowRes>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={c} stopOpacity={o} />
            <Stop offset="0.45" stopColor={c} stopOpacity={o * 0.42} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </LowRes>
  );
};

const ItemView: React.FC<{ it: Item; k: number }> = ({ it, k }) => {
  const o = Math.min(1, it.o * k);
  const box = {
    position: 'absolute' as const,
    left: it.x - it.s / 2,
    top: it.y - it.s / 2,
    width: it.s,
    height: it.s,
  };
  switch (it.k) {
    case 'orb':
      return (
        <View style={box}>
          <Orb c={it.c} o={o} />
        </View>
      );
    case 'dot':
      return (
        <View
          style={[
            box,
            { borderRadius: it.s / 2, backgroundColor: it.c, opacity: o },
            it.ring && { borderWidth: 1, borderColor: '#FFFFFF33' },
          ]}
        />
      );
    case 'ring':
      return (
        <View
          style={[
            box,
            { borderRadius: it.s / 2, borderWidth: it.w, borderColor: it.c, opacity: o },
          ]}
        />
      );
    case 'square':
      return (
        <View
          style={[
            box,
            {
              borderRadius: it.s * 0.16,
              borderWidth: 1.5,
              borderColor: it.c,
              backgroundColor: it.fill ? it.c + '22' : 'transparent',
              opacity: o,
              transform: [{ rotate: `${it.r}deg` }],
            },
          ]}
        />
      );
    case 'disc':
      // a record: dark vinyl, two groove rings, the label in the song's colour
      return (
        <View style={[box, { opacity: o }]}>
          <View style={[styles.full, { borderRadius: it.s / 2, backgroundColor: '#000000' }]} />
          {[0.82, 0.62].map((f) => (
            <View
              key={f}
              style={[
                styles.centered,
                {
                  width: it.s * f,
                  height: it.s * f,
                  left: (it.s * (1 - f)) / 2,
                  top: (it.s * (1 - f)) / 2,
                  borderRadius: (it.s * f) / 2,
                  borderWidth: 1,
                  borderColor: '#FFFFFF55',
                },
              ]}
            />
          ))}
          <View
            style={[
              styles.centered,
              {
                width: it.s * 0.3,
                height: it.s * 0.3,
                left: it.s * 0.35,
                top: it.s * 0.35,
                borderRadius: it.s * 0.15,
                backgroundColor: it.c,
              },
            ]}
          />
        </View>
      );
    case 'glyph':
      return (
        <Text
          style={{
            position: 'absolute',
            left: it.x,
            top: it.y,
            fontSize: it.s,
            color: it.c,
            opacity: o,
            transform: [{ rotate: `${it.r}deg` }],
          }}
        >
          {it.g}
        </Text>
      );
    case 'glint':
      // a four-point star: two thin bars across a bright core
      return (
        <View style={[box, { opacity: o }]}>
          <View style={[styles.bar, { top: it.s / 2 - 0.75, backgroundColor: it.c }]} />
          <View
            style={[
              styles.bar,
              { top: it.s / 2 - 0.75, backgroundColor: it.c, transform: [{ rotate: '90deg' }] },
            ]}
          />
          <View
            style={{
              position: 'absolute',
              left: it.s / 2 - 2,
              top: it.s / 2 - 2,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: '#FFFFFF',
            }}
          />
        </View>
      );
    case 'cross':
      return (
        <View style={[box, { opacity: o }]}>
          <View style={[styles.bar, { top: it.s / 2 - 0.75, backgroundColor: it.c }]} />
          <View
            style={[
              styles.bar,
              { top: it.s / 2 - 0.75, backgroundColor: it.c, transform: [{ rotate: '90deg' }] },
            ]}
          />
        </View>
      );
  }
};

/** one plane: slides with the eye by `depth` points. No animation of its own: a still phone
 *  sends nothing, so a still screen costs nothing (an endless drift re-composited the whole
 *  screen — and every blur over it — 60 times a second, for as long as the tab was open). */
const Plane: React.FC<{ depth: number; children: React.ReactNode }> = ({ depth, children }) => {
  const pad = depth + 12;
  const style = useMemo(
    () => ({
      position: 'absolute' as const,
      left: -pad,
      right: -pad,
      top: -pad,
      bottom: -pad,
      transform: [
        { translateX: Animated.multiply(Tilt.x, depth) },
        { translateY: Animated.multiply(Tilt.y, depth) },
      ],
    }),
    [depth, pad]
  );
  return (
    <Animated.View pointerEvents="none" style={style}>
      {/* the plane is oversized (its edges never show as it slides); items use screen points */}
      <View style={{ position: 'absolute', left: pad, top: pad, right: pad, bottom: pad }}>
        {children}
      </View>
    </Animated.View>
  );
};

const Scene: React.FC<{
  tab: MainTab;
  colors: [string, string, string];
  light: boolean;
  level: number;
}> = ({ tab, colors, light, level }) => {
  const { width: W, height: H } = useWindowDimensions();
  const planes = useMemo(
    () => buildScene(tab, W, H, colors, light),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, W, H, colors.join(), light]
  );
  const fade = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 520, useNativeDriver: true }).start();
  }, [fade]);
  const k = level * (light ? 0.75 : 1);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      {planes.map((items, i) => (
        <Plane key={i} depth={PLANES[i].depth}>
          {items.map((it, j) => (
            <ItemView key={j} it={it} k={k} />
          ))}
        </Plane>
      ))}
    </Animated.View>
  );
};

/** The scene of the tab on screen (one layer under the tabs, above the app background). */
export const TabDepthScene: React.FC<{ hidden?: boolean }> = ({ hidden }) => {
  const { prefs, activeTab, isPlayerOpen, ambient, palette } = useHolySic();
  const ui = useUi();
  const appActive = useAppActive();
  const amb = useAmbientColors();
  const wanted =
    prefs.motionTabs !== false &&
    prefs.motionTabScenes?.[activeTab] !== false &&
    !hidden &&
    !isPlayerOpen &&
    appActive &&
    !ambient.lowPower &&
    !ambient.reduceMotion;
  const tilt = useTilt(wanted);
  if (!tilt.on) return null;
  const colors: [string, string, string] = [
    palette.accent,
    amb.corners?.[1] || amb.secondary || palette.accent,
    amb.corners?.[2] || amb.primary || palette.accent,
  ];
  return (
    <Scene
      key={activeTab}
      tab={activeTab}
      colors={colors}
      light={ui.scheme === 'light'}
      level={LEVEL[prefs.motionTabLevel] ?? 1}
    />
  );
};

const styles = StyleSheet.create({
  full: { ...StyleSheet.absoluteFillObject },
  centered: { position: 'absolute' },
  bar: { position: 'absolute', left: 0, right: 0, height: 1.5, borderRadius: 1 },
});
