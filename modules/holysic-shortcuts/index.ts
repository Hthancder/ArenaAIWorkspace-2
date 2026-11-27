// JS side of the local HolySicShortcuts native module (iOS builds only; null elsewhere).

import { requireOptionalNativeModule } from 'expo';

export interface NativeShortcutItem {
  type: string;
  title: string;
  subtitle?: string;
  /** SF Symbol name */
  icon?: string;
}

export interface NativeSpotlightItem {
  id: string;
  title: string;
  subtitle?: string;
  /** comma separated */
  keywords?: string;
}

export interface HolySicShortcutsNative {
  consumeInitial(): string | null;
  setItems(items: NativeShortcutItem[]): void;
  /** replace the Spotlight index (liked songs, playlists); a tapped result → `spotlight:<id>` */
  indexSpotlight?(items: NativeSpotlightItem[]): void;
  /** the song now playing → current NSUserActivity (Siri Suggestions "Resume …"); {} clears */
  donateListening?(d: { id?: string; title?: string; subtitle?: string }): void;
  /** current alternate icon name (null = primary) */
  getAppIcon?(): Promise<string | null>;
  /** switch the Home Screen icon; resolves 'ok', 'unsupported' or an error message */
  setAppIcon?(name: string | null): Promise<string>;
  addListener(event: 'onShortcut', cb: (e: { type: string }) => void): { remove(): void };
}

export const HolySicShortcutsModule =
  requireOptionalNativeModule<HolySicShortcutsNative>('HolySicShortcuts');
