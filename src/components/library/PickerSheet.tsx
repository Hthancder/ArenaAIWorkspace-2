// A small bottom sheet: a list of choices (folders, playlists, actions) with an optional
// "new…" text field. Used by the Downloads manager for move / group / rename.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Tap } from '../ui/Tap';

export interface PickerItem {
  key: string;
  label: string;
  sub?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  selected?: boolean;
  /** indent level (sub-folders) */
  depth?: number;
}

export const PickerSheet: React.FC<{
  visible: boolean;
  title: string;
  message?: string;
  items: PickerItem[];
  accent: string;
  onAccent: string;
  /** shows a text field + button; called with the typed name */
  newLabel?: string;
  newPlaceholder?: string;
  initialText?: string;
  onNew?: (text: string) => void;
  onPick: (key: string) => void;
  onClose: () => void;
}> = ({
  visible,
  title,
  message,
  items,
  accent,
  onAccent,
  newLabel,
  newPlaceholder,
  initialText,
  onNew,
  onPick,
  onClose,
}) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText || '');
  useEffect(() => {
    if (visible) setText(initialText || '');
  }, [visible, initialText]);
  const submit = () => {
    if (!text.trim() || !onNew) return;
    onNew(text.trim());
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable style={s.scrim} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.wrap}
          pointerEvents="box-none"
        >
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={s.handle} />
            <Text style={s.title}>{title}</Text>
            {message ? <Text style={s.message}>{message}</Text> : null}
            {onNew && (
              <View style={s.newRow}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={newPlaceholder}
                  placeholderTextColor={c.text3}
                  onSubmitEditing={submit}
                  returnKeyType="done"
                  maxLength={60}
                  autoFocus={!items.length}
                  style={s.input}
                  accessibilityLabel={newPlaceholder}
                />
                <Tap
                  onPress={submit}
                  disabled={!text.trim()}
                  style={[s.newBtn, { backgroundColor: accent, opacity: text.trim() ? 1 : 0.45 }]}
                >
                  <Text style={[s.newBtnText, { color: onAccent }]}>{newLabel}</Text>
                </Tap>
              </View>
            )}
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {items.map((it) => (
                <Tap
                  key={it.key}
                  feedback="opacity"
                  onPress={() => onPick(it.key)}
                  style={[s.item, { paddingLeft: 6 + (it.depth || 0) * 18 }]}
                >
                  <Ionicons
                    name={it.icon || 'folder-outline'}
                    size={20}
                    color={it.danger ? c.danger : it.selected ? accent : c.icon}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[s.itemLabel, it.danger && { color: c.danger }]}>
                      {it.label}
                    </Text>
                    {it.sub ? (
                      <Text numberOfLines={1} style={s.itemSub}>
                        {it.sub}
                      </Text>
                    ) : null}
                  </View>
                  {it.selected && <Ionicons name="checkmark" size={18} color={accent} />}
                </Tap>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const makeStyles = (c: UiColors) => ({
  scrim: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.scrim,
  },
  wrap: { flex: 1, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderWidth: c.scheme === 'light' ? 0 : 1,
    borderColor: c.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center' as const,
    marginBottom: 10,
  },
  title: { color: c.text, fontSize: 17, fontWeight: '800' as const, marginBottom: 4 },
  message: { color: c.text2, fontSize: 12.5, lineHeight: 18, marginBottom: 6 },
  newRow: { flexDirection: 'row' as const, gap: 8, marginVertical: 8 },
  input: {
    flex: 1,
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    color: c.text,
    fontSize: 15,
  },
  newBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  newBtnText: { fontSize: 14, fontWeight: '800' as const },
  item: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 11,
    paddingRight: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  itemLabel: { color: c.text, fontSize: 15, fontWeight: '600' as const },
  itemSub: { color: c.text3, fontSize: 12, marginTop: 1 },
});
