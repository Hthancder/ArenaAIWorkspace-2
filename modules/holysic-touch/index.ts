// JS side of the local HolySicTouch native view (iOS builds only; null elsewhere).
// Use it through src/components/ui/TouchGuard.tsx.

import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform } from 'react-native';

export interface TouchGuardViewProps {
  enabled?: boolean;
  pointerEvents?: 'none';
  style?: unknown;
}

let view: ComponentType<TouchGuardViewProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    if (requireOptionalNativeModule('HolySicTouch')) {
      view = requireNativeView<TouchGuardViewProps>('HolySicTouch', 'HolySicTouchGuardView');
    }
  } catch {
    view = null;
  }
}

export const HolySicTouchGuardView = view;
