// HolySic brand mark (original design) & small shared helpers

import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * HolySic mark — an eighth note under a halo. Outline for idle tabs, filled when selected.
 * viewBox 0 0 100 100; strokes scale with the icon.
 */
const HALO =
  'M24 19 C24 12.5 36 8 50 8 C64 8 76 12.5 76 19 C76 25.5 64 30 50 30 C36 30 24 25.5 24 19 Z';
const STEM = 'M60.5 41 V80';
const FLAG = 'M60.5 41 C66 44.5 76 47.5 78 57 C79 62 77 66 74.5 68.5';
const HEAD =
  'M33.5 82.5 C33.5 75 40.5 69.5 49 69.5 C56.5 69.5 61.5 74 61.5 79.5 C61.5 87 54.5 92.5 46 92.5 C38.5 92.5 33.5 88 33.5 82.5 Z';

export const HolySicMarkIcon: React.FC<{
  size?: number;
  color?: string;
  filled?: boolean;
}> = ({ size = 24, color = '#FFFFFF', filled = false }) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Path d={HALO} fill="none" stroke={color} strokeWidth={filled ? 9 : 7.5} />
    <Path d={STEM} stroke={color} strokeWidth={filled ? 10 : 8} strokeLinecap="round" />
    <Path
      d={FLAG}
      fill="none"
      stroke={color}
      strokeWidth={filled ? 10 : 8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d={HEAD}
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={filled ? 6 : 8}
      strokeLinejoin="round"
    />
  </Svg>
);

export function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
