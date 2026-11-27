// The tag sheet — one place for everything about tags:
//   • "Gắn thẻ": tick tags on a song, many songs (Select) or a playlist; type to find a tag or
//     create a new one. Changes apply at once (like Notes / Files tags).
//   • "Quản lý thẻ": rename, recolour, delete (with undo) and open each tag's page.
// Opened from the song menu, the Select bar, a playlist's page / menu, the Library › Thẻ tab
// and Search. Lives in the shared sheet slot so it shows above the player and other pages.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import { useHolySic } from '../../context/HolySicContext';
import {
  cleanTagName,
  normTag,
  Tag,
  TAG_COLORS,
  TAG_NAME_MAX,
  TagStore,
  useTags,
} from '../../services/library/tags';
import { ToastStore } from '../../services/ui/toastStore';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Track } from '../../types/music';
import { Tap } from '../ui/Tap';
import { TagChip } from './TagChip';

// ---------- open / close ----------

export type TagSheetTarget =
  | { kind: 'tracks'; tracks: Track[] }
  | { kind: 'playlist'; playlistId: string; name: string }
  | { kind: 'manage' };

let target: TagSheetTarget | null = null;
const subs = new Set<() => void>();
export function openTagSheet(t: TagSheetTarget | null) {
  target = t;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useTagSheetTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

// ---------- the sheet ----------

export const TagSheet: React.FC = () => {
  const tg = useTagSheetTarget();
  // keep the last target while the sheet slides away
  const [last, setLast] = useState<TagSheetTarget | null>(tg);
  useEffect(() => {
    if (tg) setLast(tg);
  }, [tg]);
  const shown = tg || last;
  if (!shown) return null;
  return (
    <Modal
      visible={!!tg}
      transparent
      animationType="slide"
      onRequestClose={() => openTagSheet(null)}
    >
      <SheetBody target={shown} />
    </Modal>
  );
};

const SheetBody: React.FC<{ target: TagSheetTarget }> = ({ target: tgt }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { prefs, palette, haptic, openCollection } = useHolySic();
  const vi = prefs.language === 'vi';
  useTags();
  const [mode, setMode] = useState<'assign' | 'manage'>(
    tgt.kind === 'manage' ? 'manage' : 'assign'
  );
  const [q, setQ] = useState('');
  useEffect(() => {
    setMode(tgt.kind === 'manage' ? 'manage' : 'assign');
    setQ('');
  }, [tgt]);

  const close = () => openTagSheet(null);
  const all = TagStore.list();

  // ── what the target carries ──
  const stateOf = (id: string): boolean | 'some' => {
    if (tgt.kind === 'playlist') return TagStore.idsOfPlaylist(tgt.playlistId).includes(id);
    if (tgt.kind !== 'tracks') return false;
    const n = tgt.tracks.filter((t) => TagStore.idsOfTrack(t.id).includes(id)).length;
    return n === 0 ? false : n === tgt.tracks.length ? true : 'some';
  };
  const setOn = (id: string, on: boolean) => {
    if (tgt.kind === 'playlist') {
      const cur = TagStore.idsOfPlaylist(tgt.playlistId);
      TagStore.setPlaylistTags(
        tgt.playlistId,
        on ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id)
      );
    } else if (tgt.kind === 'tracks') TagStore.applyToTracks(tgt.tracks, id, on);
  };
  const toggle = (id: string) => {
    haptic('selection');
    // a mixed tag ("some") becomes on for all — the usual multi-select rule
    setOn(id, stateOf(id) !== true);
  };

  const query = cleanTagName(q);
  const filtered = useMemo(
    () => (query ? TagStore.search(query) : all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, all]
  );
  const exact = query ? TagStore.findByName(query) : undefined;
  const createFromQuery = () => {
    if (!query) return;
    const tag = exact || TagStore.create(query);
    if (!tag) return;
    haptic('light');
    if (mode === 'assign') setOn(tag.id, true);
    setQ('');
  };

  const subtitle =
    tgt.kind === 'tracks'
      ? tgt.tracks.length === 1
        ? tgt.tracks[0].title
        : vi
          ? `${tgt.tracks.length} bài đã chọn`
          : `${tgt.tracks.length} songs selected`
      : tgt.kind === 'playlist'
        ? vi
          ? `Playlist · ${tgt.name}`
          : `Playlist · ${tgt.name}`
        : vi
          ? `${all.length} thẻ`
          : `${all.length} tags`;

  const openTagPage = (tag: Tag) => {
    close();
    setTimeout(() => openCollection({ kind: 'tag', tagId: tag.id }), 380);
  };

  return (
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={close} accessibilityLabel={vi ? 'Đóng' : 'Close'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.wrap}
        pointerEvents="box-none"
      >
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          <View style={s.topBar}>
            {tgt.kind !== 'manage' ? (
              <Tap
                feedback="opacity"
                hitSlop={10}
                onPress={() => setMode((m) => (m === 'assign' ? 'manage' : 'assign'))}
                accessibilityRole="button"
              >
                <Text style={s.sideBtn}>
                  {mode === 'assign' ? (vi ? 'Quản lý' : 'Manage') : vi ? '‹ Gắn thẻ' : '‹ Tag'}
                </Text>
              </Tap>
            ) : (
              <View style={{ minWidth: 64 }} />
            )}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.title}>
                {mode === 'assign' ? (vi ? 'Gắn thẻ' : 'Tags') : vi ? 'Quản lý thẻ' : 'Manage tags'}
              </Text>
              <Text style={s.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <Tap feedback="opacity" hitSlop={10} onPress={close} accessibilityRole="button">
              <Text style={[s.sideBtn, s.doneBtn, { color: palette.accent }]}>
                {vi ? 'Xong' : 'Done'}
              </Text>
            </Tap>
          </View>

          {/* find or create */}
          <View style={s.inputRow}>
            <Ionicons name={mode === 'assign' ? 'search' : 'add'} size={16} color={c.text3} />
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={createFromQuery}
              placeholder={
                mode === 'assign'
                  ? vi
                    ? 'Tìm hoặc tạo thẻ mới…'
                    : 'Find or create a tag…'
                  : vi
                    ? 'Tên thẻ mới…'
                    : 'New tag name…'
              }
              placeholderTextColor={c.text3}
              maxLength={TAG_NAME_MAX + 1}
              returnKeyType="done"
              autoCorrect={false}
              style={s.input}
              accessibilityLabel={vi ? 'Tên thẻ' : 'Tag name'}
            />
            {q ? (
              <Tap hitSlop={8} feedback="opacity" onPress={() => setQ('')}>
                <Ionicons name="close-circle" size={17} color={c.text3} />
              </Tap>
            ) : null}
          </View>
          {query && !exact ? (
            <Tap onPress={createFromQuery} style={s.createRow} accessibilityRole="button">
              <View style={[s.createIcon, { backgroundColor: palette.accent }]}>
                <Ionicons name="add" size={16} color={palette.onAccent} />
              </View>
              <Text style={s.createText} numberOfLines={1}>
                {vi ? `Tạo thẻ “${query}”` : `Create tag “${query}”`}
                {mode === 'assign' && tgt.kind !== 'manage' ? (vi ? ' và gắn' : ' and add') : ''}
              </Text>
            </Tap>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {all.length === 0 && !query ? (
              <View style={s.empty}>
                <Ionicons name="pricetags-outline" size={30} color={c.text3} />
                <Text style={s.emptyTitle}>{vi ? 'Chưa có thẻ nào' : 'No tags yet'}</Text>
                <Text style={s.emptyText}>
                  {vi
                    ? 'Gõ tên ở ô trên để tạo thẻ đầu tiên — ví dụ “Chill”, “Tập gym”, “Lái xe”.'
                    : 'Type a name above to create your first tag — e.g. “Chill”, “Gym”, “Driving”.'}
                </Text>
              </View>
            ) : mode === 'assign' ? (
              <View style={s.chips}>
                {filtered.map((t) => (
                  <TagChip key={t.id} tag={t} state={stateOf(t.id)} onPress={() => toggle(t.id)} />
                ))}
                {query && !filtered.length ? (
                  <Text style={s.emptyText}>
                    {vi ? 'Không có thẻ trùng tên.' : 'No tag with that name.'}
                  </Text>
                ) : null}
              </View>
            ) : (
              <ManageList tags={filtered} vi={vi} onOpen={openTagPage} />
            )}
          </ScrollView>
          {mode === 'assign' && all.length > 0 ? (
            <Text style={s.hint}>
              {vi
                ? 'Chạm thẻ để gắn / bỏ. Mở thẻ trong Thư viện › Thẻ hoặc tìm “#tên thẻ”.'
                : 'Tap a tag to add / remove it. Open tags in Library › Tags or search “#tag”.'}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

// ---------- manage: rename · colour · delete · open ----------

const ManageList: React.FC<{
  tags: Tag[];
  vi: boolean;
  onOpen: (t: Tag) => void;
}> = ({ tags, vi, onOpen }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const { haptic } = useHolySic();
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const counts = TagStore.counts();

  const commitName = (t: Tag) => {
    const typed = names[t.id];
    if (typed === undefined) return;
    setNames(({ [t.id]: _drop, ...rest }) => rest);
    const clean = cleanTagName(typed);
    if (!clean || clean === t.name) return;
    const other = TagStore.findByName(clean);
    const kept = TagStore.rename(t.id, clean);
    if (other && other.id !== t.id && kept)
      ToastStore.show(vi ? `Đã gộp vào thẻ “${other.name}”` : `Merged into “${other.name}”`);
  };

  const del = (t: Tag) => {
    if (armed !== t.id) {
      haptic('selection');
      setArmed(t.id);
      setTimeout(() => setArmed((a) => (a === t.id ? null : a)), 3000);
      return;
    }
    setArmed(null);
    haptic('medium');
    const undo = TagStore.remove(t.id);
    if (!undo) return;
    ToastStore.show(vi ? `Đã xoá thẻ “${t.name}”` : `Deleted “${t.name}”`, undefined, {
      label: vi ? 'Hoàn tác' : 'Undo',
      onPress: () => TagStore.restore(undo),
    });
  };

  return (
    <View style={s.manage}>
      {tags.map((t, i) => {
        const n = counts[t.id] || { songs: 0, playlists: 0 };
        const parts = [
          vi ? `${n.songs} bài` : `${n.songs} song${n.songs === 1 ? '' : 's'}`,
          n.playlists ? (vi ? `${n.playlists} playlist` : `${n.playlists} playlists`) : '',
        ].filter(Boolean);
        return (
          <View key={t.id} style={[s.mRow, i > 0 && s.mDivider]}>
            <View style={s.mTop}>
              <Tap
                feedback="scale"
                hitSlop={6}
                onPress={() => setColorFor((x) => (x === t.id ? null : t.id))}
                style={[s.swatch, { backgroundColor: t.color }]}
                accessibilityLabel={vi ? `Đổi màu thẻ ${t.name}` : `Change colour of ${t.name}`}
              />
              <View style={{ flex: 1 }}>
                <TextInput
                  value={names[t.id] ?? t.name}
                  onChangeText={(v) => setNames((m) => ({ ...m, [t.id]: v }))}
                  onBlur={() => commitName(t)}
                  onSubmitEditing={() => commitName(t)}
                  maxLength={TAG_NAME_MAX + 1}
                  returnKeyType="done"
                  autoCorrect={false}
                  style={s.mName}
                  accessibilityLabel={vi ? `Đổi tên thẻ ${t.name}` : `Rename ${t.name}`}
                />
                <Text style={s.mSub}>{parts.join(' · ')}</Text>
              </View>
              <Tap
                feedback="opacity"
                hitSlop={6}
                onPress={() => del(t)}
                style={[s.mBtn, armed === t.id && { backgroundColor: c.danger }]}
                accessibilityLabel={vi ? `Xoá thẻ ${t.name}` : `Delete ${t.name}`}
              >
                {armed === t.id ? (
                  <Text style={s.mBtnDanger}>{vi ? 'Xoá?' : 'Delete?'}</Text>
                ) : (
                  <Ionicons name="trash-outline" size={16} color={c.danger} />
                )}
              </Tap>
              <Tap
                feedback="opacity"
                hitSlop={6}
                onPress={() => onOpen(t)}
                style={s.mBtn}
                accessibilityLabel={vi ? `Mở thẻ ${t.name}` : `Open ${t.name}`}
              >
                <Ionicons name="chevron-forward" size={17} color={c.text2} />
              </Tap>
            </View>
            {colorFor === t.id ? (
              <View style={s.palette}>
                {TAG_COLORS.map((col) => (
                  <Tap
                    key={col}
                    feedback="scale"
                    onPress={() => {
                      haptic('selection');
                      TagStore.recolor(t.id, col);
                    }}
                    style={[
                      s.paletteDot,
                      { backgroundColor: col },
                      t.color === col && { borderColor: c.text },
                    ]}
                    accessibilityLabel={col}
                    accessibilityState={{ selected: t.color === col }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {tags.length > 0 ? (
        <Text style={[s.hint, { marginTop: 10 }]}>
          {vi
            ? 'Chạm ô màu để đổi màu, chạm tên để đổi tên. Đặt trùng tên thẻ khác thì hai thẻ được gộp lại.'
            : 'Tap the colour to change it, the name to rename. Using another tag’s name merges the two.'}
        </Text>
      ) : null}
    </View>
  );
};

/** tag names as a short readable list ("Chill · Gym") */
export const tagNames = (ids: string[]) =>
  ids
    .map((id) => TagStore.byId(id)?.name)
    .filter(Boolean)
    .join(' · ');

/** "#chill" → the tags it names (search) */
export const tagQueryOf = (q: string) => (q.trim().startsWith('#') ? normTag(q) : null);

const makeStyles = (c: UiColors) => ({
  root: { flex: 1 },
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
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 8,
    maxHeight: '86%' as const,
    borderWidth: c.scheme === 'light' ? 0 : 1,
    borderColor: c.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center' as const,
    marginBottom: 6,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    marginBottom: 6,
    gap: 8,
  },
  sideBtn: { color: c.text2, fontSize: 15.5, fontWeight: '600' as const, minWidth: 64 },
  doneBtn: { textAlign: 'right' as const, fontWeight: '800' as const },
  title: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  subtitle: { color: c.text3, fontSize: 12, marginTop: 1, maxWidth: 220 },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  input: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 0 },
  createRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    marginTop: 6,
  },
  createIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  createText: { color: c.text, fontSize: 14.5, fontWeight: '700' as const, flex: 1 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, paddingTop: 12 },
  empty: { alignItems: 'center' as const, paddingVertical: 22, gap: 6 },
  emptyTitle: { color: c.text, fontSize: 15, fontWeight: '800' as const },
  emptyText: { color: c.text2, fontSize: 13, textAlign: 'center' as const, lineHeight: 18 },
  hint: { color: c.text3, fontSize: 12, lineHeight: 17, marginTop: 8 },
  manage: { paddingTop: 6 },
  mRow: { paddingVertical: 8 },
  mDivider: { borderTopWidth: 1, borderTopColor: c.border },
  mTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  mName: { color: c.text, fontSize: 15, fontWeight: '700' as const, paddingVertical: 2 },
  mSub: { color: c.text3, fontSize: 12 },
  mBtn: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 8,
    backgroundColor: c.field,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  mBtnDanger: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' as const },
  palette: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    paddingTop: 10,
    paddingLeft: 36,
  },
  paletteDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'transparent',
  },
});
