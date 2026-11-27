// Settings › Playback › MIDI › Instruments: every instrument of the sample bank, grouped by GM
// family, with what is on the device. Instruments download by themselves when a song needs them;
// here the user can fetch some ahead (to play offline) or delete them to free space.
//
// Packs are shared: "downloaded" means every pack an instrument needs is present, and deleting
// one removes its packs — the confirmation names the other instruments that share them (they
// download again when a song needs them).

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import {
  DRUM_FAMILY,
  FAMILIES,
  Instrument,
  INSTRUMENTS,
  Instruments,
  TOTAL_BYTES,
  useInstruments,
} from '../../services/audio/sf/instruments';
import { formatBytes } from '../../services/storage/storageUsage';
import { T as UI, themedSheet } from '../../theme/ui';
import { SheetModal } from '../ui/SheetModal';
import { Tap } from '../ui/Tap';

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

/** bytes still needed for an instrument (shared packs already present count as 0) */
const missingOf = (p: Instrument) => Instruments.missingBytes(Instruments.filesFor([p.i]));

function confirm(title: string, msg: string, ok: string, cancel: string, run: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${msg}`)) run();
    return;
  }
  Alert.alert(title, msg, [
    { text: cancel, style: 'cancel' },
    { text: ok, style: 'destructive', onPress: run },
  ]);
}

export const InstrumentManager: React.FC<{
  visible: boolean;
  onClose: () => void;
  fontFamily?: string;
}> = ({ visible, onClose, fontFamily }) => {
  const { prefs, palette, haptic, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  const state = useInstruments();
  const [query, setQuery] = useState('');
  const [onlyHave, setOnlyHave] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<Set<number>>(() => new Set());

  const stored = Instruments.storedBytes();
  const listed = useMemo(() => INSTRUMENTS.filter((p) => !p.hidden), []);
  // recomputed on every download / delete (state.version)
  const have = useMemo(
    () => new Set(listed.filter((p) => Instruments.readyFor([p.i])).map((p) => p.i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.version, listed]
  );

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const out: { fam: number; items: Instrument[] }[] = [];
    for (let fam = 0; fam <= 16; fam++) {
      const items = listed.filter(
        (p) =>
          p.family === fam &&
          (!onlyHave || have.has(p.i)) &&
          (!q || fold(p.name).includes(q) || fold(famName(fam, vi)).includes(q))
      );
      if (items.length) out.push({ fam, items });
    }
    return out;
  }, [query, onlyHave, have, listed, vi]);

  const searching = !!query.trim();

  const get = async (ids: number[]) => {
    haptic('light');
    setBusy((b) => new Set([...b, ...ids]));
    const ok = await Instruments.ensure(Instruments.filesFor(ids));
    setBusy((b) => {
      const n = new Set(b);
      ids.forEach((i) => n.delete(i));
      return n;
    });
    if (!ok)
      showToast(
        vi ? 'Không tải được — kiểm tra kết nối mạng' : "Couldn't download — check the connection"
      );
  };

  const drop = (ids: number[], label: string) => {
    const shared = Instruments.sharedWith(ids);
    const names = shared
      .slice(0, 4)
      .map((p) => p.name)
      .join(', ');
    const more =
      shared.length > 4
        ? vi
          ? ` và ${shared.length - 4} nhạc cụ khác`
          : ` and ${shared.length - 4} more`
        : '';
    const sharedNote = shared.length
      ? vi
        ? `\n\nDùng chung mẫu âm nên cũng phải tải lại khi cần: ${names}${more}.`
        : `\n\nThese share its samples and will download again when needed: ${names}${more}.`
      : '';
    confirm(
      vi ? `Xoá ${label}?` : `Delete ${label}?`,
      (vi
        ? 'Bài MIDI dùng nhạc cụ này sẽ tự tải lại khi phát (hoặc tạm phát bằng âm Nhẹ khi không có mạng).'
        : 'MIDI songs using it download it again when played (or use the Light sound offline).') +
        sharedNote,
      vi ? 'Xoá' : 'Delete',
      vi ? 'Huỷ' : 'Cancel',
      async () => {
        haptic('medium');
        const freed = await Instruments.remove(ids);
        showToast(
          vi ? `Đã giải phóng ${formatBytes(freed, vi)}` : `Freed ${formatBytes(freed, vi)}`
        );
      }
    );
  };

  const dropAll = () =>
    confirm(
      vi ? 'Xoá mọi nhạc cụ đã tải?' : 'Delete every downloaded instrument?',
      vi
        ? 'Bài MIDI sẽ tải lại nhạc cụ cần dùng ở lần phát tới.'
        : 'MIDI songs download what they need again on their next play.',
      vi ? 'Xoá hết' : 'Delete all',
      vi ? 'Huỷ' : 'Cancel',
      async () => {
        haptic('medium');
        const freed = await Instruments.removeAll();
        showToast(
          vi ? `Đã giải phóng ${formatBytes(freed, vi)}` : `Freed ${formatBytes(freed, vi)}`
        );
      }
    );

  const progress = state.files
    ? vi
      ? `Đang tải ${state.done}/${state.files} · ${formatBytes(state.doneBytes, vi)} / ${formatBytes(state.bytes, vi)}`
      : `Downloading ${state.done}/${state.files} · ${formatBytes(state.doneBytes, vi)} / ${formatBytes(state.bytes, vi)}`
    : null;

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      fontFamily={fontFamily}
      closeLabel={vi ? 'Đóng' : 'Close'}
      title={vi ? 'Nhạc cụ MIDI' : 'MIDI instruments'}
      subtitle={
        vi
          ? `${have.size}/${listed.length} đã tải · ${formatBytes(stored, vi)}`
          : `${have.size}/${listed.length} downloaded · ${formatBytes(stored, vi)}`
      }
      action={
        stored > 0 ? (
          <Tap onPress={dropAll} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.headerBtn, { color: UI.danger }]}>
              {vi ? 'Xoá hết' : 'Delete all'}
            </Text>
          </Tap>
        ) : null
      }
    >
      <View style={styles.tools}>
        <View style={styles.search}>
          <Ionicons name="search" size={15} color={UI.text3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={vi ? 'Tìm nhạc cụ' : 'Search instruments'}
            placeholderTextColor={UI.text3}
            style={styles.searchInput}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        <Tap
          onPress={() => setOnlyHave((v) => !v)}
          style={[styles.filter, onlyHave && { backgroundColor: palette.accent }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: onlyHave }}
        >
          <Text style={[styles.filterText, onlyHave && { color: palette.onAccent }]}>
            {vi ? 'Đã tải' : 'Downloaded'}
          </Text>
        </Tap>
      </View>
      {progress && (
        <View style={[styles.progress, { borderColor: palette.accent + '55' }]}>
          <ActivityIndicator size="small" color={palette.accent} />
          <Text style={styles.progressText}>{progress}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          {vi
            ? `Nhạc cụ tự tải khi bài MIDI cần và được giữ lại cho lần sau — chỉ tải đúng thứ bài dùng. Tải trước để nghe khi không có mạng. Cả bộ: ${formatBytes(TOTAL_BYTES, vi)}.`
            : `Instruments download by themselves when a MIDI song needs them and stay for next time — only what songs use. Download ahead to play offline. Whole bank: ${formatBytes(TOTAL_BYTES, vi)}.`}
        </Text>
        {groups.map(({ fam, items }) => {
          const expanded = searching || onlyHave || !!open[fam];
          const got = items.filter((p) => have.has(p.i)).length;
          const missing = items.filter((p) => !have.has(p.i)).map((p) => p.i);
          const famBusy = items.some((p) => busy.has(p.i));
          const need = Instruments.missingBytes(Instruments.filesFor(missing));
          const fm = fam === 16 ? DRUM_FAMILY : FAMILIES[fam];
          return (
            <View key={fam} style={styles.group}>
              <View style={styles.groupHead}>
                <Tap
                  feedback="opacity"
                  onPress={() => setOpen((o) => ({ ...o, [fam]: !o[fam] }))}
                  disabled={searching || onlyHave}
                  style={styles.groupToggle}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${vi ? fm.vi : fm.en}, ${got}/${items.length}`}
                >
                  <View style={[styles.famIcon, { backgroundColor: palette.accent + '1F' }]}>
                    <Ionicons name={fm.icon as any} size={16} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.famName}>{vi ? fm.vi : fm.en}</Text>
                    <Text style={styles.famSub}>
                      {vi ? `${got}/${items.length} đã tải` : `${got}/${items.length} downloaded`}
                    </Text>
                  </View>
                  {!searching && !onlyHave && (
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={UI.text3}
                    />
                  )}
                </Tap>
                {famBusy ? (
                  <ActivityIndicator size="small" color={palette.accent} />
                ) : missing.length ? (
                  <Tap
                    onPress={() => get(missing)}
                    hitSlop={6}
                    style={[styles.pill, { backgroundColor: palette.accent + '22' }]}
                    accessibilityRole="button"
                    accessibilityLabel={vi ? `Tải cả nhóm ${fm.vi}` : `Download all ${fm.en}`}
                  >
                    <Ionicons name="arrow-down" size={13} color={palette.accent} />
                    <Text style={[styles.pillText, { color: palette.accent }]}>
                      {formatBytes(need, vi)}
                    </Text>
                  </Tap>
                ) : (
                  <Ionicons name="checkmark-circle" size={20} color={palette.accent} />
                )}
              </View>
              {expanded &&
                items.map((p) => {
                  const ok = have.has(p.i);
                  const working =
                    busy.has(p.i) ||
                    (!ok && Instruments.filesFor([p.i]).some(Instruments.isDownloading));
                  return (
                    <View key={p.i} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={styles.meta}>
                          {p.family === 16
                            ? vi
                              ? `Bộ trống ${p.program}`
                              : `Kit ${p.program}`
                            : `GM ${p.program + 1}${p.variation ? (vi ? ` · biến thể ${p.bank}` : ` · variation ${p.bank}`) : ''}`}
                          {!ok ? ` · ${formatBytes(missingOf(p), vi)}` : ''}
                        </Text>
                      </View>
                      {working ? (
                        <ActivityIndicator size="small" color={palette.accent} />
                      ) : ok ? (
                        <Tap
                          onPress={() => drop([p.i], p.name)}
                          hitSlop={8}
                          style={styles.iconBtn}
                          accessibilityRole="button"
                          accessibilityLabel={vi ? `Xoá ${p.name}` : `Delete ${p.name}`}
                        >
                          <Ionicons name="trash-outline" size={17} color={UI.text2} />
                        </Tap>
                      ) : (
                        <Tap
                          onPress={() => get([p.i])}
                          hitSlop={8}
                          style={styles.iconBtn}
                          accessibilityRole="button"
                          accessibilityLabel={vi ? `Tải ${p.name}` : `Download ${p.name}`}
                        >
                          <Ionicons
                            name="arrow-down-circle-outline"
                            size={20}
                            color={palette.accent}
                          />
                        </Tap>
                      )}
                    </View>
                  );
                })}
              {expanded && got > 0 && !searching && (
                <Tap
                  onPress={() =>
                    drop(
                      items.filter((p) => have.has(p.i)).map((p) => p.i),
                      vi ? `nhóm ${fm.vi}` : `all ${fm.en}`
                    )
                  }
                  style={styles.groupDelete}
                  accessibilityRole="button"
                >
                  <Text style={styles.groupDeleteText}>
                    {vi
                      ? `Xoá ${got} nhạc cụ đã tải của nhóm`
                      : `Delete ${got} downloaded in this group`}
                  </Text>
                </Tap>
              )}
            </View>
          );
        })}
        {!groups.length && (
          <Text style={styles.empty}>
            {onlyHave && !searching
              ? vi
                ? 'Chưa tải nhạc cụ nào. Phát một bài MIDI hoặc tải ở trên.'
                : 'No instruments downloaded yet. Play a MIDI song or download some above.'
              : vi
                ? 'Không có nhạc cụ khớp.'
                : 'No matching instruments.'}
          </Text>
        )}
      </ScrollView>
    </SheetModal>
  );
};

function famName(fam: number, vi: boolean) {
  const f = fam === 16 ? DRUM_FAMILY : FAMILIES[fam];
  return vi ? f.vi : f.en;
}

const styles = themedSheet(() => ({
  headerBtn: { fontSize: 15, fontWeight: '700' },
  tools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    backgroundColor: UI.fg(0.07),
  },
  searchInput: { flex: 1, color: UI.text, fontSize: 15, paddingVertical: 0 },
  filter: {
    paddingHorizontal: 13,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: UI.fg(0.07),
  },
  filterText: { color: UI.text, fontSize: 13.5, fontWeight: '700' },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  progressText: { flex: 1, color: UI.text, fontSize: 12.5, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  intro: { color: UI.text2, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  group: {
    borderRadius: 18,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
    marginBottom: 10,
    overflow: 'hidden',
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 },
  groupToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  famIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  famName: { color: UI.text, fontSize: 14.5, fontWeight: '700' },
  famSub: { color: UI.text2, fontSize: 12, marginTop: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 99,
  },
  pillText: { fontSize: 12, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: UI.fg(0.06),
  },
  name: { color: UI.text, fontSize: 14, fontWeight: '600' },
  meta: { color: UI.text3, fontSize: 11.5, marginTop: 1 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  groupDelete: {
    paddingVertical: 11,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: UI.fg(0.06),
  },
  groupDeleteText: { color: UI.danger, fontSize: 13, fontWeight: '700' },
  empty: { color: UI.text2, fontSize: 13.5, textAlign: 'center', marginTop: 30 },
}));
