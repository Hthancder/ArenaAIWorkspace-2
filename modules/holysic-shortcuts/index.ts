// JS side of the local HolySicShortcuts native module (iOS builds only; null elsewhere).

import { requireOptionalNativeModule } from 'expo';

export interface NativeShortcutItem {
  type: string;
  title: string;
  subtitle?: string;
  /** SF Symbol name */
  icon?: string;
}

export interface HolySicShortcutsNative {
  consumeInitial(): string | null;
  setItems(items: NativeShortcutItem[]): void;
  addListener(event: 'onShortcut', cb: (e: { type: string }) => void): { remove(): void };
}

export const HolySicShortcutsModule =
  requireOptionalNativeModule<HolySicShortcutsNative>('HolySicShortcuts');
