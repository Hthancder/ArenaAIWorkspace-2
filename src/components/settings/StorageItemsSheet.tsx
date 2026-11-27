// Settings › Storage › one category, item by item (downloaded songs, music files): biggest first,
// with each one's size, so the user frees exactly what they want. Tap to select, then delete the
// selection — like iPhone Storage's per-app documents. Playing, folders and playlists stay in
// Library (one place for each job); this sheet is only about space.

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { formatBytes } from '../../services/storage/storageUsage';
import { T as UI, themedSheet } from '../../theme/ui';
import { ArtworkImage } from '../ArtworkImage';
import { SheetModal } from '../ui/SheetModal';
import { Tap } from '../ui/Tap';

export interface StorageItem {
  id: string;
  title: string;
  subtitle?: string;
  bytes: number;
  /** newest first when sorting by date */
  date?: number;
  artworkUrl?: string;
}

type Sort = 'size' | 'date' | 'name';

export const StorageItemsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  items: StorageItem[];
  /** delete these; resolves when done */
  onDelete: (ids: string[]) => Promise<void>;
  /** e.g. "MIDI songs download again when played" */
  deleteNote: string;
  /** what the empty list says */
  emptyText: string;
  /** opens the full manager elsewhere (Library) — closes this sheet first */
  manageLabel?: string;
  onManage?: () => void;
  fontFamily?: string;
}> = ({
  visible,
  onClose,
  title,
  items,
  onDelete,
  deleteNote,
  emptyText,
  manageLabel,
  onManage,
  fontFamily,
}) => {
  const { prefs, palette, haptic } = useHolySic();
  const vi = prefs.language === 'vi';
  const [sort, setSort] = useState<Sort>('size');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const l = [...items];
    if (sort === 'size') l.sort((a, b) => b.bytes - a.bytes);
    else if (sort === 'date') l.sort((a, b) => (b.date || 0) - (a.date || 0));
    else l.sort((a, b) => a.title.localeCompare(b.title, vi ? 'vi' : 'en'));
    return l;
  }, [items, sort, vi]);

  // drop selections of items that went away (deleted elsewhere)
  const chosen = list.filter((it) => sel.has(it.id));
  const chosenBytes = chosen.reduce((n, it) => n + it.bytes, 0);
  const total = items.reduce((n, it) => n + it.bytes, 0);
  const allOn = chosen.length === list.length && list.length > 0;

  const toggle = (id: string) => {
    haptic('selection');
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const run = async () => {
    setBusy(true);
    haptic('medium');
    try {
      await onDelete(chosen.map((it) => it.id));
    } finally {
      setSel(new Set());
      setBusy(false);
    }
  };

  const askDelete = () => {
    if (!chosen.length || busy) return;
    const head = vi
      ? `Xoá ${chosen.length} mục · ${formatBytes(chosenBytes, vi)}?`
      : `Delete ${chosen.length} item${chosen.length > 1 ? 's' : ''} · ${formatBytes(chosenBytes, vi)}?`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${head}\n\n${deleteNote}`)) run();
      return;
    }
    Alert.alert(head, deleteNote, [
      { text: vi ? 'Huỷ' : 'Cancel', style: 'cancel' },
      { text: vi ? 'Xoá' : 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const sorts: { id: Sort; vi: string; en: string }[] = [
    { id: 'size', vi: 'Lớn nhất', en: 'Largest' },
    { id: 'date', vi: 'Mới nhất', en: 'Newest' },
    { id: 'name', vi: 'Tên', en: 'Name' },
  ];

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      title={title}
      fontFamily={fontFamily}
      closeLabel={vi ? 'Đóng' : 'Close'}
      subtitle={
        vi
          ? `${items.length} mục · ${formatBytes(total, vi)}`
          : `${items.length} items · ${formatBytes(total, vi)}`
      }
      action={
        list.length ? (
          <Tap
            onPress={() => setSel(allOn ? new Set() : new Set(list.map((it) => it.id)))}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.headerBtn, { color: palette.accent }]}>
              {allOn ? (vi ? 'Bỏ chọn' : 'None') : vi ? 'Chọn hết' : 'All'}
            </Text>
          </Tap>
        ) : null
      }
    >
      <View style={styles.sorts}>
        {sorts.map((s) => {
          const on = sort === s.id;
          return (
            <Tap
              key={s.id}
              onPress={() => setSort(s.id)}
              style={[styles.sort, on && { backgroundColor: palette.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.sortText, on && { color: palette.onAccent }]}>
                {vi ? s.vi : s.en}
              </Text>
            </Tap>
          );
        })}
        <View style={{ flex: 1 }} />
        {onManage && manageLabel ? (
          <Tap
            onPress={() => {
              onClose();
              onManage();
            }}
            hitSlop={8}
            accessibilityRole="link"
          >
            <Text style={[styles.manage, { color: palette.accent }]}>{manageLabel}</Text>
          </Tap>
        ) : null}
      </View>
      <FlatList
        data={list}
        keyExtractor={(it) => it.id}
        initialNumToRender={14}
        windowSize={9}
        contentContainerStyle={{ paddingBottom: chosen.length ? 110 : 40 }}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderItem={({ item: it }) => {
          const on = sel.has(it.id);
          return (
            <Tap
              feedback="opacity"
              onPress={() => toggle(it.id)}
              style={styles.row}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${it.title}, ${formatBytes(it.bytes, vi)}`}
            >
              <Ionicons
                name={on ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={on ? palette.accent : UI.fg(0.28)}
              />
              {it.artworkUrl !== undefined ? (
                <ArtworkImage
                  source={{ uri: it.artworkUrl }}
                  fallbackSeed={it.title}
                  style={styles.art}
                />
              ) : (
                <View style={[styles.art, styles.fileIcon]}>
                  <Ionicons name="document-outline" size={18} color={UI.text2} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {it.title}
                </Text>
                {it.subtitle ? (
                  <Text style={styles.sub} numberOfLines={1}>
                    {it.subtitle}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.size}>{formatBytes(it.bytes, vi)}</Text>
            </Tap>
          );
        }}
      />
      {chosen.length ? (
        <View style={styles.bottom}>
          <Tap
            onPress={askDelete}
            style={[styles.deleteBtn, busy && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Ionicons name="trash" size={17} color="#FFFFFF" />
            <Text style={styles.deleteText}>
              {vi
                ? `Xoá ${chosen.length} mục · ${formatBytes(chosenBytes, vi)}`
                : `Delete ${chosen.length} · ${formatBytes(chosenBytes, vi)}`}
            </Text>
          </Tap>
        </View>
      ) : null}
    </SheetModal>
  );
};

const styles = themedSheet(() => ({
  headerBtn: { fontSize: 15, fontWeight: '700' },
  sorts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  sort: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: UI.fg(0.07),
  },
  sortText: { color: UI.text, fontSize: 12.5, fontWeight: '700' },
  manage: { fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  art: { width: 42, height: 42, borderRadius: 8 },
  fileIcon: { backgroundColor: UI.fg(0.07), alignItems: 'center', justifyContent: 'center' },
  title: { color: UI.text, fontSize: 14.5, fontWeight: '600' },
  sub: { color: UI.text2, fontSize: 12, marginTop: 1 },
  size: { color: UI.text2, fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: {
    color: UI.text2,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 30,
  },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 28 },
  deleteBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#FF453A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
}));
