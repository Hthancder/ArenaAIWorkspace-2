// ArtworkPalette & HolySic Dark Theme — ported from ArtworkPalette.kt & Theme.kt in realidkroo/Mochy-Music

import { Platform } from 'react-native';
import { AppFontStyle } from './preferences';

export interface ArtworkPalette {
  seed: string;
  accent: string;
  onAccent: string;
  container: string;
  onContainer: string;
  surface: string;
  glow: string;
  gradient: [string, string, string];
  appleMesh: [string, string, string, string];
}

export const HOLYSIC_COLORS = {
  pureBlack: '#000000',
  obsidian: '#0A0A0E',
  surface: '#131319',
  surfaceElevated: '#1B1B24',
  surfaceCard: 'rgba(255, 255, 255, 0.065)',
  surfaceCardHover: 'rgba(255, 255, 255, 0.11)',
  glassBorder: 'rgba(255, 255, 255, 0.10)',
  glassBorderStrong: 'rgba(255, 255, 255, 0.18)',
  textPrimary: '#F6F6F9',
  textSecondary: 'rgba(246, 246, 249, 0.66)',
  textMuted: 'rgba(246, 246, 249, 0.42)',
  defaultAccent: '#E4E4EC',
  roseLike: '#FF4D79',
  flacEmerald: '#34D399',
  aacAmber: '#FBBF24',
  iosBlue: '#60A5FA',
  /** HolySic brand: halo gold */
  halo: '#FCD34D',
};

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Deterministic perceptual hue & saturation extractor seeded from track artwork/title,
 * mirroring HolySic's ArtworkPalette.from(seed) tonal palette math so every song paints
 * its own cohesive, legible Material-style tonal set.
 */
export function buildArtworkPalette(seedKey?: string, hintHue?: number): ArtworkPalette {
  if (!seedKey && hintHue === undefined) {
    return {
      seed: '#8E8E8E',
      accent: '#FFFFFF',
      onAccent: '#0B0B0F',
      container: '#262630',
      onContainer: '#FFFFFF',
      surface: '#121217',
      glow: 'rgba(255,255,255,0.18)',
      gradient: ['#2A2A36', '#15151C', '#07070A'],
      appleMesh: ['#2E2B44', '#1F293D', '#181822', '#09090D'],
    };
  }

  let hash = 2166136261;
  const str = seedKey || 'holysic';
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = hintHue !== undefined ? hintHue : Math.abs(hash) % 360;
  const rawSat = 0.48 + (Math.abs(hash >> 8) % 35) / 100;
  const saturation = Math.max(0.32, Math.min(0.82, rawSat));

  // Ported directly from ArtworkPalette.kt:
  // accent = hsl(hue, sat, 0.72), container = hsl(hue, sat * 0.55, 0.26), surface = hsl(hue, sat * 0.35, 0.11)
  const seed = hslToHex(hue, saturation, 0.52);
  const accent = hslToHex(hue, saturation, 0.74);
  const container = hslToHex(hue, saturation * 0.55, 0.25);
  const surface = hslToHex(hue, saturation * 0.38, 0.11);

  const onAccent = relativeLuminance(accent) > 0.42 ? '#0A0A0E' : '#FFFFFF';
  const onContainer = relativeLuminance(container) > 0.42 ? '#0A0A0E' : '#FFFFFF';

  const secondaryHue = (hue + 38) % 360;
  const tertiaryHue = (hue + 322) % 360;

  return {
    seed,
    accent,
    onAccent,
    container,
    onContainer,
    surface,
    glow: hslToHex(hue, saturation, 0.55) + '44',
    gradient: [
      hslToHex(hue, saturation * 0.68, 0.32),
      hslToHex(hue, saturation * 0.48, 0.16),
      '#060609',
    ],
    appleMesh: [
      hslToHex(hue, saturation * 0.72, 0.34),
      hslToHex(secondaryHue, saturation * 0.62, 0.24),
      hslToHex(tertiaryHue, saturation * 0.52, 0.15),
      '#07070B',
    ],
  };
}

export function resolveFontFamily(style: AppFontStyle): string | undefined {
  if (Platform.OS === 'web') {
    switch (style) {
      case 'inter':
        return 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
      case 'rounded':
        return 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif';
      case 'mono':
        return '"SF Mono", ui-monospace, Menlo, Monaco, monospace';
      case 'serif':
        return '"New York", ui-serif, Georgia, serif';
      default:
        return '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    }
  }
  switch (style) {
    case 'mono':
      return Platform.OS === 'ios' ? 'Menlo' : 'monospace';
    case 'serif':
      return Platform.OS === 'ios' ? 'Georgia' : 'serif';
    default:
      return undefined; // Native SF Pro on iOS
  }
}

/** Hue (0–360) of a #RRGGBB colour, or null when it isn't a valid hex colour */
export function hexToHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
