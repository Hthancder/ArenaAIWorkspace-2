// HolySic brand mark (original design) & small shared helpers

import React from 'react';
import Svg, { G, Path } from 'react-native-svg';

/**
 * HolySic mark — the app icon's calligraphic eighth note with a halo ring orbiting its stem.
 * Outline for idle tabs, filled when selected. viewBox 0 0 100 100 (drawn in the icon's
 * 1024-unit space and scaled down, so the glyph and the app icon are the very same shape).
 */
const NOTE =
  'M536 262 C548 330 622 356 674 420 C718 474 712 552 668 610 C659 622 643 615 650 600 ' +
  'C676 550 668 496 636 462 C606 430 568 420 538 418 L538 694 C540 760 486 806 414 812 ' +
  'C346 818 304 786 302 744 C300 690 356 640 430 630 C462 626 488 632 506 642 L506 268 ' +
  'C506 252 532 248 534 262 Z';
// the ring, split so its front half can pass in front of the stem
const RING_BACK = 'M338 262 A182 46 0 0 1 702 262';
const RING_FRONT = 'M338 262 A182 46 0 0 0 702 262';
const K = 0.142;
const PLACE = `translate(${50 - 506 * K} ${53 - 509 * K}) scale(${K})`;

export const HolySicMarkIcon: React.FC<{
  size?: number;
  color?: string;
  filled?: boolean;
}> = ({ size = 24, color = '#FFFFFF', filled = false }) => {
  const ring = (filled ? 7.5 : 6.5) / K;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G transform={PLACE}>
        <G transform="rotate(-9 520 262)">
          <Path d={RING_BACK} fill="none" stroke={color} strokeWidth={ring} strokeLinecap="round" />
        </G>
        <Path
          d={NOTE}
          fill={filled ? color : 'none'}
          stroke={color}
          strokeWidth={(filled ? 2 : 6.5) / K}
          strokeLinejoin="round"
        />
        <G transform="rotate(-9 520 262)">
          <Path
            d={RING_FRONT}
            fill="none"
            stroke={color}
            strokeWidth={ring}
            strokeLinecap="round"
          />
        </G>
      </G>
    </Svg>
  );
};

export function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
