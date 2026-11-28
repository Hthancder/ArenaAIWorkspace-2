// HolySic signature visuals: a soft halo aura behind headers, a small halo mark for section
// titles, and a halo ring for the active tab. Gold halo + the current accent colour.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { T as UI, themedSheet } from '../../theme/ui';
import { LowRes } from '../ui/LowRes';

export const HALO_GOLD = '#FCD34D';
let seq = 0;
const useGradId = (p: string) => useMemo(() => `${p}${++seq}`, [p]);

/** Absolute aura at the top of a screen. Pointer-transparent. */
export const HaloGlow: React.FC<{ color: string; height?: number; intensity?: number }> = ({
  color,
  height = 300,
  intensity = 1,
}) => {
  const a = useGradId('hgA');
  const b = useGradId('hgB');
  return (
    <View pointerEvents="none" style={[styles.glow, { height }]}>
      {/* a soft gradient: drawn at low resolution and scaled up */}
      <LowRes>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={a} cx="50%" cy="0%" rx="75%" ry="95%" fx="50%" fy="0%">
              <Stop offset="0" stopColor={color} stopOpacity={0.3 * intensity} />
              <Stop offset="0.55" stopColor={color} stopOpacity={0.08 * intensity} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={b} cx="50%" cy="10%" rx="35%" ry="28%" fx="50%" fy="10%">
              <Stop offset="0" stopColor={HALO_GOLD} stopOpacity={0.14 * intensity} />
              <Stop offset="1" stopColor={HALO_GOLD} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50" cy="0" rx="100" ry="100" fill={`url(#${a})`} />
          <Ellipse cx="50" cy="10" rx="50" ry="30" fill={`url(#${b})`} />
        </Svg>
      </LowRes>
    </View>
  );
};

/** Tiny halo ring used before section titles. */
export const HaloMark: React.FC<{ size?: number; color?: string }> = ({
  size = 16,
  color = HALO_GOLD,
}) => (
  <Svg width={size} height={size * 0.5} viewBox="0 0 32 16">
    <Ellipse cx="16" cy="8" rx="13" ry="5" fill="none" stroke={color} strokeWidth={3} />
  </Svg>
);

const styles = themedSheet(() => ({
  glow: { position: 'absolute', top: 0, left: 0, right: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  titleHalo: { marginTop: -10, marginRight: -2 },
  titleText: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
}));

/** Section heading with the halo mark — the HolySic way of titling a shelf. */
export const SectionTitle: React.FC<{
  children: React.ReactNode;
  fontFamily?: string;
  color?: string;
}> = ({ children, fontFamily, color = UI.text }) => (
  <View style={styles.titleRow}>
    <View style={styles.titleHalo}>
      <HaloMark size={15} />
    </View>
    <Text
      numberOfLines={1}
      style={[styles.titleText, { color }, fontFamily ? { fontFamily } : null]}
    >
      {children}
    </Text>
  </View>
);
