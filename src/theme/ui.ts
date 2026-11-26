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
