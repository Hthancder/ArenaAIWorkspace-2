/*
 * HolySic — iOS music player. Based on Mochy Music by realidkroo (GPL-3.0).
 * https://github.com/realidkroo/Mochy-Music
 */
import { TouchGuardOverlay } from '../ui/TouchGuard';
import { ScrollLock } from '../../services/ui/scrollLock';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

/**
 * A draggable slider in the Apple Music style: touch anywhere on the bar and drag. The bar thickens
 * while held, the value follows the finger 1:1 (it starts from where you touched, so
 * dragging to the very end is easy), and a light haptic marks hitting 0 % or 100 %.
 *
 *  • onChange — live, on every move (volume)
 *  • onCommit — once, on release (seeking: avoids hammering the player with seeks)
 *
 * The pan responder refuses to hand the touch over while dragging, so the player's
 * swipe-down-to-close never steals a scrub. VoiceOver: adjustable, swipe up / down = ±step.
 */
export const ScrubBar: React.FC<{
  value: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  color: string;
  trackColor?: string;
  /** resting track thickness (grows by ~70 % while held) */
  thickness?: number;
  /** show the round thumb (seek bar) */
  thumb?: boolean;
  disabled?: boolean;
  haptic?: () => void;
  step?: number;
  accessibilityLabel?: string;
  accessibilityValueText?: string;
  style?: StyleProp<ViewStyle>;
}> = ({
  value,
  onChange,
  onCommit,
  onScrubStart,
  onScrubEnd,
  color,
  trackColor = 'rgba(255,255,255,0.2)',
  thickness = 5,
  thumb = false,
  disabled = false,
  haptic,
  step = 0.05,
  accessibilityLabel,
  accessibilityValueText,
  style,
}) => {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const grow = useRef(new Animated.Value(0)).current;

  // latest props for the (stable) responder callbacks
  const live = useRef({ width, value, onChange, onCommit, onScrubStart, onScrubEnd, haptic });
  live.current = { width, value, onChange, onCommit, onScrubStart, onScrubEnd, haptic };
  const startX = useRef(0);
  const lastEdge = useRef<0 | 1 | null>(null);
  const current = useRef(0);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const animate = (to: number) =>
    Animated.spring(grow, {
      toValue: to,
      useNativeDriver: true,
      speed: 28,
      bounciness: 0,
    }).start();

  const ratioAt = (x: number) => {
    const w = live.current.width;
    return w > 0 ? Math.max(0, Math.min(1, x / w)) : 0;
  };

  const update = (r: number) => {
    current.current = r;
    setDrag(r);
    live.current.onChange?.(r);
    const edge = r <= 0.0001 ? 0 : r >= 0.9999 ? 1 : null;
    if (edge !== null && lastEdge.current !== edge) live.current.haptic?.();
    lastEdge.current = edge;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        // children have pointerEvents="none", so locationX is relative to the bar itself
        startX.current = e.nativeEvent.locationX;
        lastEdge.current = null;
        live.current.onScrubStart?.();
        ScrollLock.hold();
        animate(1);
        update(ratioAt(startX.current));
      },
      onPanResponderMove: (_e, g) => update(ratioAt(startX.current + g.dx)),
      onPanResponderRelease: () => {
        live.current.onCommit?.(current.current);
        live.current.onScrubEnd?.();
        ScrollLock.release();
        animate(0);
        setDrag(null);
      },
      onPanResponderTerminate: () => {
        live.current.onCommit?.(current.current);
        live.current.onScrubEnd?.();
        ScrollLock.release();
        animate(0);
        setDrag(null);
      },
    })
  ).current;

  const shown = Math.max(0, Math.min(1, drag ?? value));
  // native-driven: the track thickens with scaleY (no layout pass per frame)
  const trackScale = grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const thumbScale = grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });

  const onA11y = (e: AccessibilityActionEvent) => {
    const v = live.current.value;
    const next =
      e.nativeEvent.actionName === 'increment'
        ? Math.min(1, v + step)
        : e.nativeEvent.actionName === 'decrement'
          ? Math.max(0, v - step)
          : v;
    live.current.onChange?.(next);
    live.current.onCommit?.(next);
  };

  return (
    <View
      {...responder.panHandlers}
      collapsable={false}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: accessibilityValueText ?? `${Math.round(shown * 100)}%` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onA11y}
      style={[
        {
          // 44 pt touch target (Apple HIG) around a thin bar
          height: 44,
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        },
        // web preview: a mouse drag must not start a text selection (that would end the gesture)
        Platform.OS === 'web'
          ? ({ userSelect: 'none', cursor: 'pointer', touchAction: 'none' } as any)
          : null,
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          height: thickness,
          borderRadius: 99,
          backgroundColor: trackColor,
          overflow: 'hidden',
          transform: [{ scaleY: trackScale }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${shown * 100}%`,
            borderRadius: 99,
            backgroundColor: color,
          }}
        />
      </Animated.View>
      {thumb && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${shown * 100}%`,
            top: 22 - 6.5,
            width: 13,
            height: 13,
            borderRadius: 6.5,
            marginLeft: -6.5,
            backgroundColor: color,
            transform: [{ scale: thumbScale }],
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
      )}
      {/* a drag here never scrolls the page / pulls the sheet (iOS) */}
      <TouchGuardOverlay enabled={!disabled} />
    </View>
  );
};
