// Connection pill — floats over the top of the app instead of pushing the page down.
//
//   • goes offline while using the app  → shown for 10 s, then slides away
//   • app opened / brought back while still offline → shown for 5 s only
//   • connection comes back after the pill was shown → a short green "back online"
//
// Native-driven (translateY + opacity): no layout pass, so the page underneath never jumps.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Mode = 'offline' | 'back';

const SHOW_LIVE_MS = 10_000;
const SHOW_LAUNCH_MS = 5_000;
const SHOW_BACK_MS = 2_400;

export const OfflineBanner: React.FC<{ isOnline: boolean; vi: boolean; enabled?: boolean }> = ({
  isOnline,
  vi,
  enabled = true,
}) => {
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(0)).current;
  const [mode, setMode] = useState<Mode | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAt = useRef(Date.now());
  const shownOffline = useRef(false);
  const prevOnline = useRef(isOnline);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const hide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    Animated.timing(v, {
      toValue: 0,
      duration: 380,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => finished && setMode(null));
  };

  const show = (m: Mode, ms: number) => {
    if (!enabledRef.current) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMode(m);
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
    hideTimer.current = setTimeout(hide, ms);
    if (m === 'offline') {
      shownOffline.current = true;
      AccessibilityInfo.announceForAccessibility?.(vi ? 'Đang ngoại tuyến' : 'You are offline');
    }
  };

  // connection changes
  useEffect(() => {
    const was = prevOnline.current;
    prevOnline.current = isOnline;
    if (!isOnline && (was || Date.now() - mountedAt.current < 4000)) {
      // the first few seconds after launch count as "opening the app while offline"
      show('offline', Date.now() - mountedAt.current < 4000 ? SHOW_LAUNCH_MS : SHOW_LIVE_MS);
    } else if (isOnline && !was && shownOffline.current) {
      shownOffline.current = false;
      show('back', SHOW_BACK_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // coming back to the app while still offline: a short reminder
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (s) => {
      if (last.match(/inactive|background/) && s === 'active' && !onlineRef.current)
        show('offline', SHOW_LAUNCH_MS);
      last = s;
    });
    return () => {
      sub.remove();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mode) return null;
  const offline = mode === 'offline';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          top: insets.top + 6,
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-46, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
    >
      <Animated.View
        style={[styles.pill, { backgroundColor: offline ? '#FBBF24' : '#34D399' }]}
        onTouchEnd={hide}
        accessibilityRole="alert"
      >
        <Ionicons name={offline ? 'cloud-offline' : 'cloud-done'} size={15} color="#111" />
        <Text style={styles.text} numberOfLines={1}>
          {offline
            ? vi
              ? 'Ngoại tuyến · nhạc trên máy vẫn phát'
              : 'Offline · downloads still play'
            : vi
              ? 'Đã kết nối lại'
              : 'Back online'}
        </Text>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: '#111', fontWeight: '700', fontSize: 12.5, flexShrink: 1 },
});
