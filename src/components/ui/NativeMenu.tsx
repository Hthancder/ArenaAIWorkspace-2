// Native iOS menus.
//
//   <NativeMenu trigger="tap" items={…} onSelect={…}>  the system pull-down UIMenu ("…" buttons)
//   <NativeMenu trigger="longPress" …>                 touch and hold lifts the content out with a
//                                                      blurred backdrop + the menu (UIContextMenu)
//
// iOS builds only (modules/holysic-menu). Elsewhere `nativeMenuAvailable` is false and the
// wrapper is a plain View, so callers keep their own fallback (the in-app action sheet).

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { HolySicMenuView, NativeMenuItem } from '../../../modules/holysic-menu';

export type MenuItem = NativeMenuItem;

export const nativeMenuAvailable = Boolean(HolySicMenuView);

interface Props {
  items: MenuItem[];
  onSelect: (id: string) => void;
  trigger?: 'tap' | 'longPress';
  title?: string;
  /** corner radius of the lifted preview (long press) */
  previewRadius?: number;
  /** backdrop behind the lifted preview — rows are transparent, so give it the page colour */
  previewBackground?: string;
  /** VoiceOver label of the tap button */
  label?: string;
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const NativeMenu: React.FC<Props> = ({
  items,
  onSelect,
  trigger = 'tap',
  title,
  previewRadius,
  previewBackground,
  label,
  onOpen,
  style,
  children,
}) => {
  const Native = HolySicMenuView;
  if (!Native) return <View style={style}>{children}</View>;
  const tap = trigger === 'tap';
  return (
    <View
      collapsable={false}
      style={style}
      // tap mode: own the touch, so the row / card underneath doesn't also react to it
      onStartShouldSetResponder={tap ? () => true : undefined}
    >
      {children}
      <Native
        style={StyleSheet.absoluteFill}
        pointerEvents={tap ? 'auto' : 'none'}
        items={items}
        title={title}
        trigger={trigger}
        previewRadius={previewRadius}
        previewBackground={previewBackground}
        label={label}
        onSelect={(e) => onSelect(e.nativeEvent.id)}
        onOpen={onOpen}
      />
    </View>
  );
};
