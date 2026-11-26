// A friendly empty screen: tinted glyph, a short title, one line of guidance and (optionally) the
// one action that fills it. Settles in with a native-driven fade + rise, like UIContentUnavailableView.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from './Tap';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  accent: string;
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onAction?: () => void;
}

export const EmptyState: React.FC<Props> = ({
  icon,
  title,
  message,
  accent,
  actionLabel,
  actionIcon,
  onAction,
}) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 4,
    }).start();
  }, [v]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      <View style={[styles.glyph, { backgroundColor: accent + '1A', borderColor: accent + '33' }]}>
        <Ionicons name={icon} size={30} color={accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Tap
          onPress={onAction}
          style={[styles.action, { backgroundColor: accent }]}
          accessibilityRole="button"
        >
          {actionIcon ? <Ionicons name={actionIcon} size={16} color="#FFFFFF" /> : null}
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Tap>
      ) : null}
    </Animated.View>
  );
};

const styles = themedSheet(() => ({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 36,
    paddingTop: 48,
    paddingBottom: 32,
  },
  glyph: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: UI.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: UI.text2,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
}));
