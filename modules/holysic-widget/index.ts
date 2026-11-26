// JS side of the local HolySicWidget native module (iOS builds only; null elsewhere).

import { requireOptionalNativeModule } from 'expo';

export interface HolySicWidgetNative {
  isAvailable(group: string): boolean;
  setString(key: string, value: string, group: string): void;
  remove(key: string, group: string): void;
  reload(kind?: string | null): void;
}

export const HolySicWidgetModule =
  requireOptionalNativeModule<HolySicWidgetNative>('HolySicWidget');
