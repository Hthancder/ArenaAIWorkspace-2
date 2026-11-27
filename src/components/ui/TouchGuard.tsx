// Wrap a slider / fader so dragging it never scrolls the page or pulls the sheet down with it
// (native guard on iOS builds — see modules/holysic-touch). Elsewhere a plain View.

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { HolySicTouchGuardView } from '../../../modules/holysic-touch';

export const TouchGuard: React.FC<{
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
  children: React.ReactNode;
}> = ({ style, enabled = true, children }) => {
  const Guard = HolySicTouchGuardView;
  if (!Guard) return <View style={style}>{children}</View>;
  return (
    <View collapsable={false} style={style}>
      {children}
      <Guard style={StyleSheet.absoluteFill} pointerEvents="none" enabled={enabled} />
    </View>
  );
};

/** Drop-in child for a control that already is its own (non-collapsed) View */
export const TouchGuardOverlay: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const Guard = HolySicTouchGuardView;
  return Guard ? (
    <Guard style={StyleSheet.absoluteFill} pointerEvents="none" enabled={enabled} />
  ) : null;
};
