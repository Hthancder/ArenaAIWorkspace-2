// Lightweight spectrum visualizer for backgrounds and the tab bar.
//
// Cost model: one spectrum subscription, JS smooths the 32 real bands down to N bars and pushes
// them with setValue() into *native* Animated values ~30×/s. Bars move with translateY only
// (UI thread, no layout, no React re-render). When the audio can't be read (HLS / web preview)
// the bars breathe on a native loop — no fake beat, no JS per frame. Paused → they settle.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { audioEngine } from '../../services/audio/audioEngine';
import { perfCount } from '../../services/perfProbe';
import { useAppActive } from '../../services/appActivity';
import { withAlpha } from '../../theme/colorMath';

const REST = 0.05;

/** N native-driven 0..1 levels following the real spectrum. */
export function useSpectrumBars(count: number, activeIn: boolean, isPlaying: boolean, fps = 30) {
  // nothing to draw off screen
  const active = useAppActive() && activeIn;
  const vals = useRef<Animated.Value[]>([]).current;
  if (vals.length !== count) {
    vals.length = 0;
    for (let i = 0; i < count; i++) vals.push(new Animated.Value(REST));
  }
  // attach every value to the native driver once, so later setValue() calls go straight to the
  // UI thread instead of re-rendering through JS
  useEffect(() => {
    vals.forEach((v) =>
      Animated.timing(v, { toValue: REST, duration: 1, useNativeDriver: true }).start()
    );
  }, [vals, count]);

  useEffect(() => {
    if (!active) return;
    const settle = (to: number, ms: number) =>
      Animated.parallel(
        vals.map((v) =>
          Animated.timing(v, {
            toValue: to,
            duration: ms,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        )
      ).start();
    if (!isPlaying) {
      settle(REST, 650);
      return;
    }
    const level = new Array(count).fill(REST);
    const gap = 1000 / Math.max(10, Math.min(60, fps));
    let lastReal = 0;
    let lastPush = 0;
    let calm: Animated.CompositeAnimation | null = null;
    const startCalm = () => {
      if (calm) return;
      // a slow, staggered breath — reads as "music is playing" without inventing a beat
      calm = Animated.parallel(
        vals.map((v, i) => {
          const peak = 0.14 + 0.16 * Math.abs(Math.sin(i * 1.7 + 0.6));
          const ms = 1500 + ((i * 337) % 900);
          return Animated.loop(
            Animated.sequence([
              Animated.timing(v, {
                toValue: peak,
                duration: ms,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
              Animated.timing(v, {
                toValue: REST + 0.03,
                duration: ms,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
            ])
          );
        })
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
      if (now - lastPush < gap) return;
      lastPush = now;
      stopCalm();
      const n = b.length || 1;
      for (let i = 0; i < count; i++) {
        // slightly log-spaced: more bars for lows/mids where the music lives
        const a = Math.floor(Math.pow(i / count, 1.35) * n);
        const z = Math.max(a + 1, Math.floor(Math.pow((i + 1) / count, 1.35) * n));
        let sum = 0;
        for (let k = a; k < z && k < n; k++) sum += b[k];
        const raw = sum / Math.max(1, z - a);
        // treble bands are naturally quieter; lift them a little so the right side moves too
        const target = Math.min(1, Math.pow(raw * (1 + (i / count) * 0.8), 0.85) * 1.05);
        const prev = level[i];
        const next = target > prev ? prev + (target - prev) * 0.75 : prev + (target - prev) * 0.22;
        const v = Math.max(REST, next);
        if (Math.abs(v - prev) > 0.012) {
          vals[i].setValue(v);
          perfCount('setValue:bars');
        }
        level[i] = v;
      }
    });
    const watch = setInterval(() => {
      if (Date.now() - lastReal > 1200) startCalm();
    }, 700);
    if (Date.now() - lastReal > 1200) startCalm();
    return () => {
      clearInterval(watch);
      stopCalm();
      unsub();
    };
  }, [active, isPlaying, count, fps, vals]);

  return vals;
}

export type BarsStyle = 'bars' | 'mirror' | 'wave';

/**
 * Bars that rise from the bottom of their box ('bars'), mirror around the middle ('mirror') or
 * soft overlapping glow columns ('wave'). `colors` is spread left → right.
 */
export const SpectrumBars: React.FC<{
  values: Animated.Value[];
  colors: string[];
  variant?: BarsStyle;
  opacity?: number;
  style?: ViewStyle;
  gap?: number;
}> = React.memo(({ values, colors, variant = 'bars', opacity = 1, style, gap = 3 }) => {
  const [h, setH] = useState(0);
  const n = values.length;
  const half = variant === 'mirror' ? h * 0.62 : h;
  // translateY drives the height (resting level = fully hidden, no row of dots when paused): a bar is a full-height pill pushed down out of its clipped
  // column, so its rounded top always stays round
  const ty = useMemo(
    () =>
      values.map((v) =>
        v.interpolate({ inputRange: [REST, 1], outputRange: [half, 0], extrapolate: 'clamp' })
      ),
    [values, half]
  );
  const tyDown = useMemo(
    () =>
      values.map((v) =>
        v.interpolate({
          inputRange: [REST, 1],
          outputRange: [-(h - half), 0],
          extrapolate: 'clamp',
        })
      ),
    [values, h, half]
  );
  const color = (i: number) =>
    colors[Math.min(colors.length - 1, Math.floor((i / n) * colors.length))];

  return (
    <View
      pointerEvents="none"
      style={[style, { opacity }]}
      onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}
    >
      {h > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.row, { gap: variant === 'wave' ? 0 : gap }]}>
          {values.map((_, i) => {
            const c = color(i) || '#FFFFFF';
            if (variant === 'mirror') {
              return (
                <View key={i} style={styles.col}>
                  <View style={[styles.clip, { height: half }]}>
                    <Animated.View
                      style={[
                        styles.bar,
                        { height: half, backgroundColor: c, transform: [{ translateY: ty[i] }] },
                      ]}
                    />
                  </View>
                  <View style={[styles.clip, { height: h - half, opacity: 0.32 }]}>
                    <Animated.View
                      style={[
                        styles.bar,
                        {
                          height: h - half,
                          backgroundColor: c,
                          transform: [{ translateY: tyDown[i] }],
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            }
            if (variant === 'wave') {
              return (
                <View key={i} style={[styles.col, styles.waveCol]}>
                  <Animated.View
                    style={[styles.waveBar, { height: h, transform: [{ translateY: ty[i] }] }]}
                  >
                    <LinearGradient
                      colors={[withAlpha(c, 0.9), withAlpha(c, 0.35), withAlpha(c, 0)]}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                </View>
              );
            }
            return (
              <View key={i} style={[styles.col, styles.clip, { height: h }]}>
                <Animated.View
                  style={[
                    styles.bar,
                    { height: h, backgroundColor: c, transform: [{ translateY: ty[i] }] },
                  ]}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flex: 1 },
  clip: { overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 99 },
  waveCol: { overflow: 'hidden', height: '100%', marginHorizontal: -6 },
  waveBar: { width: '100%', borderTopLeftRadius: 99, borderTopRightRadius: 99, overflow: 'hidden' },
});
