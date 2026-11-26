// UI colour scheme (Light / Dark / Auto). The scheme is resolved once (prefs.themeMode + the
// system appearance) by <ThemeBridge/> and published through a tiny store, so any component can
// read it with useUi() and build its styles with useThemedStyles().
//
// The artwork palette (accent, ambient glow) is independent of this and works on both schemes.

import { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';

export type UiScheme = 'dark' | 'light';
export type ThemeMode = 'dark' | 'light' | 'auto';

export interface UiColors {
  scheme: UiScheme;
  /** app background (behind everything) */
  bg: string;
  /** second background tone (gradients, grouped lists) */
  bg2: string;
  /** bottom sheets, dialogs */
  sheet: string;
  /** raised surfaces: cards, rows */
  card: string;
  cardPressed: string;
  /** text inputs, chips, segmented controls */
  field: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  /** icon colour on neutral surfaces */
  icon: string;
  /** dimming behind sheets */
  scrim: string;
  /** glass tint used by GlassSurface */
  glass: string;
  danger: string;
  success: string;
  /** shimmer/skeleton blocks */
  skeleton: string;
  /** status bar content */
  statusBar: 'light' | 'dark';
}

export const DARK_UI: UiColors = {
  scheme: 'dark',
  bg: '#0A0A0E',
  bg2: '#131319',
  sheet: '#16161E',
  card: 'rgba(255,255,255,0.065)',
  cardPressed: 'rgba(255,255,255,0.11)',
  field: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: '#F6F6F9',
  text2: 'rgba(246,246,249,0.66)',
  text3: 'rgba(246,246,249,0.42)',
  icon: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.62)',
  glass: 'rgba(18,18,26,0.90)',
  danger: '#F87171',
  success: '#34D399',
  skeleton: 'rgba(255,255,255,0.07)',
  statusBar: 'light',
};

export const LIGHT_UI: UiColors = {
  scheme: 'light',
  bg: '#F6F5FA',
  bg2: '#ECEAF3',
  sheet: '#FFFFFF',
  card: 'rgba(20,16,40,0.045)',
  cardPressed: 'rgba(20,16,40,0.09)',
  field: 'rgba(20,16,40,0.06)',
  border: 'rgba(20,16,40,0.10)',
  borderStrong: 'rgba(20,16,40,0.18)',
  text: '#15131C',
  text2: 'rgba(21,19,28,0.64)',
  text3: 'rgba(21,19,28,0.42)',
  icon: '#1C1A24',
  scrim: 'rgba(16,12,30,0.38)',
  glass: 'rgba(250,249,253,0.92)',
  danger: '#DC2626',
  success: '#059669',
  skeleton: 'rgba(20,16,40,0.07)',
  statusBar: 'dark',
};

let current: UiColors = DARK_UI;
const subs = new Set<() => void>();

export function setUiScheme(s: UiScheme) {
  const next = s === 'light' ? LIGHT_UI : DARK_UI;
  if (next === current) return;
  current = next;
  subs.forEach((f) => f());
}

/**
 * Switch the scheme without notifying (used while the root renders, right before it re-mounts
 * the UI with the new colours); call notifyUiScheme() from an effect afterwards.
 */
export function applyUiSchemeSilently(s: UiScheme) {
  current = s === 'light' ? LIGHT_UI : DARK_UI;
}
export function notifyUiScheme() {
  subs.forEach((f) => f());
}

export const getUi = () => current;

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};

export const useUi = (): UiColors => useSyncExternalStore(subscribe, getUi, getUi);

/** StyleSheet built from the current scheme (rebuilt only when the scheme changes). */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: UiColors) => T
): T {
  const c = useUi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(c)), [c]);
}

export const resolveScheme = (mode: ThemeMode, system: string | null | undefined): UiScheme =>
  mode === 'auto' ? (system === 'light' ? 'light' : 'dark') : mode;

// ---------- live tokens for module-level styles ----------
// Screens keep their `const styles = themedSheet(() => ({ … }))` at module level; the sheet is
// built per scheme on first use. Values below are read when a style is built / a component
// renders, and the app re-mounts its UI when the scheme changes (see <ThemedRoot/>), so
// everything picks up the new colours.

const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;

export const T = {
  get scheme(): UiScheme {
    return current.scheme;
  },
  get dark() {
    return current.scheme === 'dark';
  },
  get bg() {
    return current.bg;
  },
  get bg2() {
    return current.bg2;
  },
  get sheet() {
    return current.sheet;
  },
  get text() {
    return current.text;
  },
  get text2() {
    return current.text2;
  },
  get text3() {
    return current.text3;
  },
  get icon() {
    return current.icon;
  },
  get scrim() {
    return current.scrim;
  },
  get glass() {
    return current.glass;
  },
  get danger() {
    return current.danger;
  },
  /** foreground ink at an opacity: white on dark, near-black on light (text, hairlines, fills) */
  fg(a = 1): string {
    return current.scheme === 'dark' ? rgba(255, 255, 255, a) : rgba(21, 19, 28, a);
  },
  /** the inverse ink: text on a solid `fg` button */
  get inv() {
    return current.scheme === 'dark' ? '#0A0A0E' : '#FFFFFF';
  },
  /** a dark surface colour from the dark design, mapped to its light counterpart */
  surface(darkHex: string): string {
    if (current.scheme === 'dark') return darkHex;
    const h = darkHex.replace('#', '');
    const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6);
    const l =
      parseInt(full.slice(0, 2), 16) +
      parseInt(full.slice(2, 4), 16) +
      parseInt(full.slice(4, 6), 16);
    if (l <= 3 * 0x10) return LIGHT_UI.bg; // page backgrounds (#000 … #101010)
    if (l <= 3 * 0x22) return '#FFFFFF'; // raised surfaces / sheets
    return '#E4E2EC'; // mid greys (tracks, toggles off)
  },
  /** a translucent dark tint (glass, scrims) */
  shade(r: number, g: number, b: number, a: number): string {
    if (current.scheme === 'dark') return rgba(r, g, b, a);
    // near-black → a soft scrim; dark surfaces → frosted light glass
    return r + g + b < 30
      ? rgba(16, 12, 30, a * 0.45)
      : rgba(250, 249, 253, Math.min(0.96, a + 0.04));
  },
};

/** A StyleSheet built lazily for the current scheme (one cached sheet per scheme). */
export function themedSheet<S extends StyleSheet.NamedStyles<S>>(factory: () => S): S {
  const cache: Partial<Record<UiScheme, S>> = {};
  const get = (): S => (cache[current.scheme] ??= StyleSheet.create(factory()));
  return new Proxy({} as S, {
    get: (_t, prop) => (get() as any)[prop],
    has: (_t, prop) => prop in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_t, prop) => Object.getOwnPropertyDescriptor(get(), prop),
  });
}
