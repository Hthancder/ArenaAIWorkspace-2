// JS side of the local HolySicWidget native module (iOS builds only; null elsewhere).

import { requireOptionalNativeModule } from 'expo';

export interface HolySicWidgetNative {
  isAvailable(group: string): boolean;
  setString(key: string, value: string, group: string): void;
  remove(key: string, group: string): void;
  reload(kind?: string | null): void;
  status(group: string): Promise<NativeWidgetStatus>;
}

export interface NativeWidgetStatus {
  /** HolySicWidget.appex survived installation (sideloaders can strip extensions) */
  extensionEmbedded: boolean;
  extensions: string[];
  /** the App Group in use (may be renamed by AltStore / SideStore) */
  group: string;
  groupAvailable: boolean;
  bundleId: string;
  /** widgets of each kind currently on the Home / Lock Screen */
  placed?: Record<string, number>;
  placedCount?: number;
  placedError?: string;
}

export const HolySicWidgetModule =
  requireOptionalNativeModule<HolySicWidgetNative>('HolySicWidget');
