// JS side of the local HolySicMenu native view (iOS builds only; null elsewhere).
// Use it through src/components/ui/NativeMenu.tsx.

import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform } from 'react-native';

export interface NativeMenuChild {
  id: string;
  title: string;
  subtitle?: string;
  /** SF Symbol name */
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
  checked?: boolean;
}

export interface NativeMenuItem extends NativeMenuChild {
  /** items sharing a section number are grouped; groups are split by a divider */
  section?: number;
  /** this group shows as one row of small icon buttons (iOS 16+) */
  row?: boolean;
  /** a submenu (one level) */
  children?: NativeMenuChild[];
}

export interface NativeMenuViewProps {
  items: NativeMenuItem[];
  title?: string;
  trigger?: 'tap' | 'longPress';
  previewRadius?: number;
  previewBackground?: string;
  label?: string;
  pointerEvents?: 'auto' | 'none';
  style?: unknown;
  onSelect?: (e: { nativeEvent: { id: string } }) => void;
  onOpen?: () => void;
}

let view: ComponentType<NativeMenuViewProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    if (requireOptionalNativeModule('HolySicMenu')) {
      view = requireNativeView<NativeMenuViewProps>('HolySicMenu', 'HolySicMenuView');
    }
  } catch {
    view = null;
  }
}

export const HolySicMenuView = view;
