// Small colour helpers for backgrounds: mixing, alpha and "make this readable as a page
// background on the light / dark UI" (keeps the hue, clamps the lightness).

import type { UiScheme } from './ui';

type RGB = [number, number, number];

export function parseHex(h: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((h || '').trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const isHex = (h: string) => parseHex(h) !== null;

export function toHex([r, g, b]: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
      .toUpperCase()
  );
}

/** a → b by t (0..1) */
export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return a;
  const k = Math.max(0, Math.min(1, t));
  return toHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** #RRGGBB + alpha → #RRGGBBAA (works for LinearGradient and styles on iOS and web) */
export function withAlpha(hex: string, a: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const aa = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return toHex(c) + aa.toUpperCase();
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, Math.min(1, s), l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * A colour made safe as a page background: same hue, lightness clamped so text stays readable
 * (dark UI: deep tone; light UI: pale tint). `depth` 0..1 = how far from the neutral background.
 */
export function backgroundTone(hex: string, scheme: UiScheme, depth = 1): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const [h, s, l] = rgbToHsl(c);
  const d = Math.max(0, Math.min(1, depth));
  if (scheme === 'light') {
    const L = Math.max(0.86, Math.min(0.95, l));
    return toHex(hslToRgb(h, Math.min(s, 0.55) * d, 0.97 - (0.97 - L) * d));
  }
  const L = Math.min(0.2, Math.max(0.07, l));
  return toHex(hslToRgb(h, Math.min(s, 0.62) * d, 0.045 + (L - 0.045) * d));
}

/** Relative luminance 0..1 (for picking a readable tint) */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
