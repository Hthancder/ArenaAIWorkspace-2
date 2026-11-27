// Edit a playlist: name, description, cover (Photos / a song's artwork / automatic), and the
// song order (hold ≡ and drag, or one-tap sorts) — everything is a draft until "Lưu".

import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHolySic } from '../../context/HolySicContext';
import { isLocalTrack, LocalLibrary } from '../../services/local/localLibrary';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Playlist, Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { Tap } from '../ui/Tap';
import { TouchGuardOverlay } from '../ui/TouchGuard';

// ---------- open/close store ----------

let target: { id: string; focus?: 'cover' | 'order' } | null = null;
const subs = new Set<() => void>();
export function openPlaylistEditor(id: string | null, focus?: 'cover' | 'order') {
  target = id ? { id, focus } : null;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const usePlaylistEditorTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

// ---------- the sheet ----------

const ROW_H = 58;
type CoverDraft = { ref: string | null; shown: string; from: string } | undefined; // undefined = unchanged

export const PlaylistEditor: React.FC = () => {
  const tg = usePlaylistEditorTarget();
  const { playlists } = useHolySic();
  const pl = tg ? playlists.find((p) => p.id === tg.id) : undefined;
  // keep the last playlist while the sheet slides away
  const [last, setLast] = useState<Playlist | undefined>(pl);
  useEffect(() => {
    if (pl) setLast(pl);
  }, [pl]);
  const shown = pl || last;
  if (!shown) return null;
  return (
    <Modal
      visible={!!tg && !!pl}
      transparent
      animationType="slide"
      onRequestClose={() => openPlaylistEditor(null)}
    >
      <EditorBody key={shown.id} pl={shown} focus={tg?.focus} />
    </Modal>
  );
};

const EditorBody: React.FC<{ pl: Playlist; focus?: 'cover' | 'order' }> = ({ pl, focus }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { palette, prefs, showToast, updatePlaylist, downloads, haptic } = useHolySic();
  const vi = prefs.language === 'vi';

  const [name, setName] = useState(pl.name);
  const [desc, setDesc] = useState(pl.description || '');
  const [cover, setCover] = useState<CoverDraft>(undefined);
  const [songs, setSongs] = useState<Track[]>(pl.tracks);
  const [showArtPicker, setShowArtPicker] = useState(focus === 'cover');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const listY = useRef(0);

  const orderChanged =
    songs.length !== pl.tracks.length || songs.some((t, i) => t.id !== pl.tracks[i]?.id);
  const dirty =
    name.trim() !== pl.name ||
    desc.trim() !== (pl.description || '') ||
    cover !== undefined ||
    orderChanged;

  const shownCover =
    cover !== undefined
      ? cover.shown
      : LocalLibrary.resolveImageRef(pl.coverUrl) || songs[0]?.artworkUrl || '';
  const offlineCount = songs.filter((t) => isLocalTrack(t) || !!downloads[t.id]).length;

  // distinct song covers to choose from
  const songArts = useMemo(() => {
    const seen = new Set<string>();
    const out: { uri: string; title: string }[] = [];
    for (const t of pl.tracks) {
      if (!t.artworkUrl || seen.has(t.artworkUrl)) continue;
      seen.add(t.artworkUrl);
      out.push({ uri: t.artworkUrl, title: t.title });
      if (out.length >= 30) break;
    }
    return out;
  }, [pl.tracks]);

  useEffect(() => {
    if (focus === 'order' && songs.length)
      setTimeout(() => scrollRef.current?.scrollTo({ y: listY.current - 12, animated: true }), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => openPlaylistEditor(null);
  const requestClose = () => {
    if (!dirty || confirmDiscard) close();
    else {
      setConfirmDiscard(true);
      setTimeout(() => setConfirmDiscard(false), 2600);
    }
  };

  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      const uri = res.canceled ? undefined : res.assets?.[0]?.uri;
      if (uri) setCover({ ref: uri, shown: uri, from: vi ? 'Ảnh' : 'Photos' });
    } catch {
      showToast(vi ? 'Không mở được thư viện ảnh' : 'Couldn’t open Photos');
    }
  };

  const save = async () => {
    if (!dirty) return close();
    setSaving(true);
    let coverRef: string | null | undefined = undefined;
    if (cover) {
      if (cover.ref === null) coverRef = null;
      else if (/^https?:/i.test(cover.ref)) coverRef = cover.ref;
      else {
        coverRef = (await LocalLibrary.keepImage(cover.ref, pl.id)) ?? undefined;
        if (coverRef === undefined)
          showToast(vi ? 'Không lưu được ảnh bìa' : 'Couldn’t save cover');
      }
    }
    updatePlaylist(pl.id, {
      name: name.trim() || pl.name,
      description: desc,
      ...(coverRef !== undefined ? { coverUrl: coverRef } : {}),
      ...(orderChanged ? { tracks: songs } : {}),
    });
    setSaving(false);
    haptic('light');
    showToast(vi ? 'Đã lưu playlist' : 'Playlist saved');
    close();
  };

  const sortBy = (kind: 'title' | 'artist' | 'reverse' | 'offline') => {
    haptic('selection');
    setSongs((cur) => {
      const list = [...cur];
      if (kind === 'title') return list.sort((a, b) => a.title.localeCompare(b.title));
      if (kind === 'artist')
        return list.sort(
          (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
        );
      if (kind === 'offline') {
        const off = (t: Track) => (isLocalTrack(t) || downloads[t.id] ? 0 : 1);
        return list.sort((a, b) => off(a) - off(b));
      }
      return list.reverse();
    });
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    setSongs((cur) => {
      const list = [...cur];
      const [t] = list.splice(from, 1);
      list.splice(to, 0, t);
      return list;
    });
  };

  return (
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={requestClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.wrap}
        pointerEvents="box-none"
      >
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.handle} />
          <View style={s.topBar}>
            <Tap feedback="opacity" onPress={requestClose} hitSlop={10}>
              <Text style={[s.topBtn, confirmDiscard && { color: c.danger, fontWeight: '800' }]}>
                {confirmDiscard ? (vi ? 'Bỏ thay đổi?' : 'Discard?') : vi ? 'Huỷ' : 'Cancel'}
              </Text>
            </Tap>
            <Text style={s.topTitle}>{vi ? 'Sửa playlist' : 'Edit playlist'}</Text>
            <Tap
              feedback="opacity"
              onPress={save}
              disabled={saving}
              hitSlop={10}
              accessibilityLabel={vi ? 'Lưu playlist' : 'Save playlist'}
            >
              {saving ? (
                <ActivityIndicator color={palette.accent} />
              ) : (
                <Text style={[s.topBtn, s.saveBtn, { color: dirty ? palette.accent : c.text3 }]}>
                  {vi ? 'Lưu' : 'Save'}
                </Text>
              )}
            </Tap>
          </View>

          <ScrollView
            ref={scrollRef}
            scrollEnabled={!dragging}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 18 }}
            showsVerticalScrollIndicator={false}
          >
            {/* cover + name */}
            <View style={s.coverRow}>
              <View>
                {shownCover ? (
                  <ArtworkImage source={{ uri: shownCover }} style={s.cover} fallbackSeed={name} />
                ) : (
                  <View
                    style={[s.cover, s.coverEmpty, { backgroundColor: pl.coverTint || c.field }]}
                  >
                    <Ionicons name="musical-notes" size={38} color="#fff" />
                  </View>
                )}
                {cover?.from && cover.from !== 'song' ? (
                  <View style={[s.coverTag, { backgroundColor: palette.accent }]}>
                    <Text style={[s.coverTagText, { color: palette.onAccent }]}>{cover.from}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Tap onPress={pickPhoto} style={s.coverBtn}>
                  <Ionicons name="images-outline" size={17} color={c.icon} />
                  <Text style={s.coverBtnText}>{vi ? 'Chọn từ Ảnh' : 'From Photos'}</Text>
                </Tap>
                {songArts.length > 0 && (
                  <Tap
                    onPress={() => setShowArtPicker((v) => !v)}
                    style={[s.coverBtn, showArtPicker && { borderColor: palette.accent }]}
                  >
                    <Ionicons name="disc-outline" size={17} color={c.icon} />
                    <Text style={s.coverBtnText}>{vi ? 'Ảnh của một bài' : 'A song’s cover'}</Text>
                  </Tap>
                )}
                {(pl.coverUrl && cover?.ref !== null) || (cover && cover.ref !== null) ? (
                  <Tap
                    onPress={() =>
                      setCover({ ref: null, shown: songs[0]?.artworkUrl || '', from: 'auto' })
                    }
                    style={s.coverBtn}
                  >
                    <Ionicons name="sparkles-outline" size={17} color={c.icon} />
                    <Text style={s.coverBtnText}>{vi ? 'Tự động' : 'Automatic'}</Text>
                  </Tap>
                ) : null}
              </View>
            </View>
            {showArtPicker && songArts.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.artStrip}
                style={{ marginHorizontal: -18 }}
              >
                {songArts.map((a) => {
                  const on = cover?.ref === a.uri;
                  return (
                    <Tap
                      key={a.uri}
                      onPress={() => setCover({ ref: a.uri, shown: a.uri, from: 'song' })}
                      style={[s.artPick, on && { borderColor: palette.accent }]}
                      accessibilityLabel={a.title}
                    >
                      <ArtworkImage source={{ uri: a.uri }} style={s.artPickImg} />
                      {on && (
                        <View style={[s.artCheck, { backgroundColor: palette.accent }]}>
                          <Ionicons name="checkmark" size={12} color={palette.onAccent} />
                        </View>
                      )}
                    </Tap>
                  );
                })}
              </ScrollView>
            )}

            <Text style={s.label}>{vi ? 'Tên playlist' : 'Name'}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={pl.name}
              placeholderTextColor={c.text3}
              maxLength={80}
              style={s.input}
              accessibilityLabel={vi ? 'Tên playlist' : 'Playlist name'}
            />
            <Text style={s.label}>{vi ? 'Mô tả' : 'Description'}</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder={vi ? 'Thêm mô tả ngắn…' : 'Add a short description…'}
              placeholderTextColor={c.text3}
              maxLength={200}
              multiline
              style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]}
              accessibilityLabel={vi ? 'Mô tả' : 'Description'}
            />

            {/* songs */}
            <View
              onLayout={(e) => {
                listY.current = e.nativeEvent.layout.y;
              }}
              style={s.songsHead}
            >
              <Text style={s.section}>
                {vi ? `Bài hát · ${songs.length}` : `Songs · ${songs.length}`}
              </Text>
              {songs.length > 0 && (
                <View style={[s.offlinePill, { borderColor: palette.accent + '55' }]}>
                  <Ionicons name="cloud-offline-outline" size={12} color={palette.accent} />
                  <Text style={[s.offlinePillText, { color: palette.accent }]}>
                    {vi ? `${offlineCount} nghe offline` : `${offlineCount} offline`}
                  </Text>
                </View>
              )}
            </View>
            {songs.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -18, marginBottom: 6 }}
                contentContainerStyle={s.sortRow}
              >
                {(
                  [
                    ['title', 'text-outline', vi ? 'Tên A–Z' : 'Title'],
                    ['artist', 'person-outline', vi ? 'Nghệ sĩ' : 'Artist'],
                    ['offline', 'cloud-offline-outline', vi ? 'Offline lên đầu' : 'Offline first'],
                    ['reverse', 'swap-vertical', vi ? 'Đảo ngược' : 'Reverse'],
                  ] as const
                ).map(([k, icon, label]) => (
                  <Tap key={k} onPress={() => sortBy(k)} style={s.sortChip}>
                    <Ionicons name={icon} size={13} color={c.icon} />
                    <Text style={s.sortChipText}>{label}</Text>
                  </Tap>
                ))}
                {orderChanged && (
                  <Tap onPress={() => setSongs(pl.tracks)} style={s.sortChip}>
                    <Ionicons name="arrow-undo-outline" size={13} color={c.icon} />
                    <Text style={s.sortChipText}>{vi ? 'Hoàn tác' : 'Undo'}</Text>
                  </Tap>
                )}
              </ScrollView>
            )}
            {songs.length > 1 && (
              <Text style={s.hint}>
                {vi
                  ? 'Giữ biểu tượng ≡ rồi kéo để đổi thứ tự.'
                  : 'Hold ≡ and drag to change the order.'}
              </Text>
            )}
            <ReorderList
              songs={songs}
              accent={palette.accent}
              offline={(t) => isLocalTrack(t) || !!downloads[t.id]}
              onMove={move}
              onRemove={(i) => setSongs((cur) => cur.filter((_, k) => k !== i))}
              onDragState={setDragging}
              onPick={() => haptic('medium')}
              vi={vi}
            />
            {songs.length === 0 && (
              <Text style={[s.hint, { textAlign: 'center', marginTop: 10 }]}>
                {vi ? 'Playlist trống' : 'No songs'}
              </Text>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

// ---------- drag-to-reorder list ----------

const ReorderList: React.FC<{
  songs: Track[];
  accent: string;
  offline: (t: Track) => boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onDragState: (on: boolean) => void;
  onPick: () => void;
  vi: boolean;
}> = ({ songs, accent, offline, onMove, onRemove, onDragState, onPick, vi }) => {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const live = useRef({ songs, onMove, onDragState, onPick, drag });
  live.current = { songs, onMove, onDragState, onPick, drag };

  const start = (i: number) => {
    dy.setValue(0);
    setDrag({ from: i, to: i });
    live.current.onDragState(true);
    live.current.onPick();
  };
  const moveTo = (i: number, d: number) => {
    dy.setValue(d);
    const n = live.current.songs.length;
    const to = Math.max(0, Math.min(n - 1, i + Math.round(d / ROW_H)));
    if (live.current.drag && live.current.drag.to !== to) setDrag({ from: i, to });
  };
  const end = (i: number, d: number) => {
    const n = live.current.songs.length;
    const to = Math.max(0, Math.min(n - 1, i + Math.round(d / ROW_H)));
    // settle into the slot, then commit the order
    Animated.timing(dy, {
      toValue: (to - i) * ROW_H,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      live.current.onMove(i, to);
      setDrag(null);
      dy.setValue(0);
      live.current.onDragState(false);
    });
  };

  return (
    <View>
      {songs.map((t, i) => {
        let shift = 0;
        if (drag && i !== drag.from) {
          if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -ROW_H;
          else if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = ROW_H;
        }
        return (
          <ReorderRow
            key={`${t.id}-${i}`}
            track={t}
            index={i}
            shift={shift}
            lifted={drag?.from === i}
            dy={dy}
            accent={accent}
            offline={offline(t)}
            onStart={start}
            onMoveTo={moveTo}
            onEnd={end}
            onRemove={onRemove}
            vi={vi}
          />
        );
      })}
    </View>
  );
};

const ReorderRow: React.FC<{
  track: Track;
  index: number;
  shift: number;
  lifted: boolean;
  dy: Animated.Value;
  accent: string;
  offline: boolean;
  onStart: (i: number) => void;
  onMoveTo: (i: number, d: number) => void;
  onEnd: (i: number, d: number) => void;
  onRemove: (i: number) => void;
  vi: boolean;
}> = ({
  track,
  index,
  shift,
  lifted,
  dy,
  accent,
  offline,
  onStart,
  onMoveTo,
  onEnd,
  onRemove,
  vi,
}) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const shiftV = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shiftV, { toValue: shift, duration: 140, useNativeDriver: true }).start();
  }, [shift, shiftV]);
  const idx = useRef(index);
  idx.current = index;
  const cb = useRef({ onStart, onMoveTo, onEnd });
  cb.current = { onStart, onMoveTo, onEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => cb.current.onStart(idx.current),
      onPanResponderMove: (_e, g) => cb.current.onMoveTo(idx.current, g.dy),
      onPanResponderRelease: (_e, g) => cb.current.onEnd(idx.current, g.dy),
      onPanResponderTerminate: (_e, g) => cb.current.onEnd(idx.current, g.dy),
    })
  ).current;

  return (
    <Animated.View
      style={[
        s.row,
        lifted && s.rowLifted,
        { zIndex: lifted ? 10 : 0, transform: [{ translateY: lifted ? dy : shiftV }] },
      ]}
    >
      <Tap
        feedback="opacity"
        hitSlop={8}
        onPress={() => onRemove(index)}
        accessibilityLabel={vi ? `Bỏ ${track.title}` : `Remove ${track.title}`}
      >
        <Ionicons name="remove-circle" size={22} color={c.danger} />
      </Tap>
      <ArtworkImage source={{ uri: track.artworkUrl }} fallbackSeed={track.title} style={s.art} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={s.title}>
          {track.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {offline && (
            <Ionicons
              name={isLocalTrack(track) ? 'phone-portrait-outline' : 'arrow-down-circle'}
              size={12}
              color={accent}
            />
          )}
          <Text numberOfLines={1} style={s.sub}>
            {track.artist}
          </Text>
        </View>
      </View>
      <View
        {...pan.panHandlers}
        collapsable={false}
        style={s.grip}
        accessibilityLabel={vi ? 'Kéo để sắp xếp' : 'Drag to reorder'}
      >
        <Ionicons name="reorder-three" size={24} color={lifted ? accent : c.text3} />
        <TouchGuardOverlay />
      </View>
    </Animated.View>
  );
};

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
    maxHeight: '92%' as const,
    borderWidth: c.scheme === 'light' ? 0 : 1,
    borderColor: c.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center' as const,
    marginBottom: 8,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
    marginBottom: 6,
  },
  topBtn: { color: c.text2, fontSize: 16, fontWeight: '600' as const, minWidth: 48 },
  saveBtn: { textAlign: 'right' as const, fontWeight: '800' as const },
  topTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  coverRow: {
    flexDirection: 'row' as const,
    gap: 16,
    alignItems: 'center' as const,
    marginVertical: 8,
  },
  cover: { width: 128, height: 128, borderRadius: 16 },
  coverEmpty: { alignItems: 'center' as const, justifyContent: 'center' as const },
  coverTag: {
    position: 'absolute' as const,
    left: 8,
    bottom: 8,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  coverTagText: { fontSize: 10, fontWeight: '800' as const },
  coverBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  coverBtnText: { color: c.text, fontSize: 14, fontWeight: '600' as const },
  artStrip: { gap: 8, paddingHorizontal: 18, paddingVertical: 8 },
  artPick: { borderRadius: 12, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  artPickImg: { width: 60, height: 60, borderRadius: 9 },
  artCheck: {
    position: 'absolute' as const,
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  label: {
    color: c.text3,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 5,
    marginLeft: 2,
  },
  input: {
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    color: c.text,
    fontSize: 15,
  },
  songsHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: 20,
    marginBottom: 8,
  },
  section: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  offlinePill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offlinePillText: { fontSize: 11, fontWeight: '700' as const },
  sortRow: { gap: 8, paddingHorizontal: 18 },
  sortChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: c.field,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  sortChipText: { color: c.text, fontSize: 12.5, fontWeight: '600' as const },
  hint: { color: c.text3, fontSize: 12, marginBottom: 6, marginLeft: 2 },
  row: {
    height: ROW_H,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    backgroundColor: c.sheet,
    borderRadius: 12,
    paddingHorizontal: 4,
  },
  rowLifted: {
    backgroundColor: c.scheme === 'light' ? '#FFFFFF' : '#23232E',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  art: { width: 42, height: 42, borderRadius: 8 },
  title: { color: c.text, fontSize: 14.5, fontWeight: '700' as const },
  sub: { color: c.text3, fontSize: 12, flexShrink: 1 },
  grip: {
    width: 44,
    height: ROW_H,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
