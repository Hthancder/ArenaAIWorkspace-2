// A page sheet (iOS card that slides up, swipe down to close) with the app's standard header:
// close button · title + subtitle · optional action on the right. Every "manage …" screen opened
// from Settings uses it, so they all look and close the same way.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from './Tap';

export const SheetModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fontFamily?: string;
  /** right side of the header (a text button, a menu…) */
  action?: React.ReactNode;
  closeLabel: string;
  children: React.ReactNode;
}> = ({ visible, onClose, title, subtitle, fontFamily, action, closeLabel, children }) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.root,
          {
            // a page sheet sits below the status bar on iOS; full screen elsewhere
            paddingTop: Platform.OS === 'ios' ? 14 : Math.max(14, insets.top + 6),
          },
        ]}
      >
        <View style={styles.header}>
          <Tap
            onPress={onClose}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          >
            <Ionicons name="chevron-down" size={22} color={UI.text} />
          </Tap>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, fontFamily ? { fontFamily } : null]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.sub} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
        {children}
      </View>
    </Modal>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: UI.surface('#0A0A0F') },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: UI.fg(0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: UI.text, fontSize: 21, fontWeight: '800' },
  sub: { color: UI.text2, fontSize: 13, marginTop: 2 },
}));
