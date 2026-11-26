// Import hub. Three similar features merged into one place, with nothing duplicated:
//   • Link: YouTube / YouTube Music video or playlist, Spotify track/album/playlist, Apple Music
//     (OpenSpot Music's Spotify import + Musike's "paste a YouTube link to play")
//   • List: Musike's "Search a list". Paste a list of songs, get the best match for each with a
//     swap option, then play / like / queue / save them as a playlist. This replaces Mochy's
//     older text import.

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { parseTextList, TextItem } from '../../services/import/linkImport';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';

export type ImportMode = 'link' | 'list';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialMode?: ImportMode;
  initialText?: string;
}

interface Row {
  item: TextItem;
  options: Track[];
  chosen: number; // -1 = skipped
}

export const ImportModal: React.FC<Props> = ({
  visible,
  onClose,
  initialMode = 'link',
  initialText = '',
}) => {
  const insets = useSafeAreaInsets();
  const {
    prefs,
    palette,
    openMusicLink,
    openCollection,
    searchTracks,
    playTrack,
    likeTracks,
    queueTracks,
    savePlaylistFromTracks,
    showToast,
    setIsPlayerOpen,
    importLocalFiles,
  } = useMochy();
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const [playlistName, setPlaylistName] = useState('');

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setText(initialText);
      setMessage(null);
      setRows([]);
      setProgress(null);
      setSwapIdx(null);
    }
  }, [visible, initialMode, initialText]);

  const paste = async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip) setText(clip);
    } catch {
      // ignore
    }
  };

  const runLink = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage(null);
    setProgress(null);
    try {
      const res = await openMusicLink(text.trim(), (done, total) => setProgress({ done, total }));
      if (res.kind === 'played') {
        onClose();
      } else if (res.kind === 'playlist') {
        showToast(vi ? `Đã tạo playlist "${res.playlist.name}"` : `Created "${res.playlist.name}"`);
        onClose();
        openCollection({ kind: 'playlist', playlistId: res.playlist.id });
      } else {
        setMessage(res.message);
      }
    } catch (e: any) {
      setMessage(String(e?.message || 'Error'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runList = async () => {
    const items = parseTextList(text);
    if (items.length === 0) return;
    setBusy(true);
    setRows([]);
    setProgress({ done: 0, total: items.length });
    const out: Row[] = items.map((item) => ({ item, options: [], chosen: -1 }));
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        const it = items[i];
        try {
          const res = await searchTracks(
            `${it.artist ? it.artist + ' ' : ''}${it.title}`.trim(),
            'all'
          );
          out[i] = {
            item: it,
            options: res.tracks.slice(0, 6),
            chosen: res.tracks.length > 0 ? 0 : -1,
          };
        } catch {
          // keep empty
        }
        done += 1;
        setProgress({ done, total: items.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    setRows(out);
    setBusy(false);
    setProgress(null);
    setPlaylistName(
      vi
        ? `Danh sách ${new Date().toLocaleDateString()}`
        : `List ${new Date().toLocaleDateString()}`
    );
  };

  const chosenTracks = rows.filter((r) => r.chosen >= 0).map((r) => r.options[r.chosen]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color="#FFF" />
          </Pressable>
          <Text style={[styles.title, { fontFamily }]}>{vi ? 'Nhập nhạc' : 'Import music'}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.segment}>
          {(['link', 'list'] as ImportMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
                setMessage(null);
              }}
              style={[styles.segBtn, mode === m && { backgroundColor: palette.accent }]}
            >
              <Ionicons
                name={m === 'link' ? 'link' : 'list'}
                size={15}
                color={mode === m ? palette.onAccent : '#FFF'}
              />
              <Text
                style={{
                  color: mode === m ? palette.onAccent : '#FFF',
                  fontWeight: '800',
                  fontSize: 13,
                }}
              >
                {m === 'link'
                  ? vi
                    ? 'Dán liên kết'
                    : 'Paste link'
                  : vi
                    ? 'Tìm theo danh sách'
                    : 'Search a list'}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.help}>
            {mode === 'link'
              ? vi
                ? 'YouTube / YouTube Music (bài hoặc playlist), Spotify (bài, album, playlist công khai), Apple Music. Bài hát được ghép với nguồn phát đầy đủ của Mochy.'
                : 'YouTube / YouTube Music (song or playlist), Spotify (track, album, public playlist), Apple Music. Songs are matched to Mochy’s full-length sources.'
              : vi
                ? 'Mỗi dòng một bài, hoặc ngăn cách bằng dấu phẩy. Dạng "Nghệ sĩ - Tên bài" cho kết quả chính xác nhất.'
                : 'One song per line or comma separated. "Artist - Title" gives the best matches.'}
          </Text>

          <View style={styles.inputWrap}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={
                mode === 'link'
                  ? 'https://open.spotify.com/playlist/…'
                  : vi
                    ? 'Sơn Tùng M-TP - Chúng Ta Của Hiện Tại\nMONO - Waiting For You, Shape of You'
                    : 'Artist - Title, Another song…'
              }
              placeholderTextColor={MOCHY_COLORS.textMuted}
              style={[
                styles.input,
                mode === 'list' && { minHeight: 120, textAlignVertical: 'top' },
              ]}
              multiline={mode === 'list'}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={paste} style={styles.pasteBtn}>
              <Ionicons name="clipboard-outline" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 12 }}>
                {vi ? 'Dán' : 'Paste'}
              </Text>
            </Pressable>
          </View>

          <Pressable
            disabled={busy || !text.trim()}
            onPress={mode === 'link' ? runLink : runList}
            style={[
              styles.goBtn,
              { backgroundColor: palette.accent, opacity: busy || !text.trim() ? 0.5 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={palette.onAccent} />
            ) : (
              <Ionicons
                name={mode === 'link' ? 'arrow-forward' : 'search'}
                size={17}
                color={palette.onAccent}
              />
            )}
            <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
              {progress
                ? `${progress.done}/${progress.total}`
                : mode === 'link'
                  ? vi
                    ? 'Mở'
                    : 'Open'
                  : vi
                    ? 'Tìm tất cả'
                    : 'Find all'}
            </Text>
          </Pressable>

          {message && <Text style={styles.message}>{message}</Text>}

          {mode === 'link' && (
            <Pressable
              onPress={async () => {
                const n = await importLocalFiles();
                if (n > 0) {
                  onClose();
                  openCollection({ kind: 'offline' });
                }
              }}
              style={styles.filesRow}
            >
              <Ionicons name="folder-open-outline" size={20} color={palette.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {vi ? 'Nhập tệp từ ứng dụng Tệp' : 'Import from the Files app'}
                </Text>
                <Text style={styles.rowSub}>
                  {vi
                    ? 'MP3, M4A, FLAC, WAV, AIFF… nghe offline ngay trong Mochy'
                    : 'MP3, M4A, FLAC, WAV, AIFF… play offline in Mochy'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={MOCHY_COLORS.textMuted} />
            </Pressable>
          )}

          {mode === 'list' && rows.length > 0 && (
            <>
              <Text style={styles.resultHead}>
                {vi
                  ? `Khớp ${chosenTracks.length}/${rows.length} bài — chạm "Đổi" để chọn bản khác`
                  : `Matched ${chosenTracks.length}/${rows.length} — tap "Swap" to pick another version`}
              </Text>
              {rows.map((r, i) => {
                const t = r.chosen >= 0 ? r.options[r.chosen] : null;
                return (
                  <View key={i} style={styles.resultRow}>
                    <View style={styles.rowMain}>
                      {t ? (
                        <ArtworkImage source={{ uri: t.artworkUrl }} style={styles.art} />
                      ) : (
                        <View style={[styles.art, styles.artEmpty]}>
                          <Ionicons name="help" size={18} color={MOCHY_COLORS.textMuted} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.rowTitle}>
                          {t ? t.title : r.item.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.rowSub}>
                          {t ? `${t.artist} · ${t.source}` : vi ? 'Không tìm thấy' : 'No match'}
                        </Text>
                      </View>
                      {r.options.length > 1 && (
                        <Pressable
                          onPress={() => setSwapIdx(swapIdx === i ? null : i)}
                          style={styles.smallBtn}
                        >
                          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
                            {vi ? 'Đổi' : 'Swap'}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() =>
                          setRows((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, chosen: x.chosen >= 0 ? -1 : x.options.length ? 0 : -1 }
                                : x
                            )
                          )
                        }
                        style={styles.smallBtn}
                      >
                        <Ionicons
                          name={r.chosen >= 0 ? 'checkmark-circle' : 'ellipse-outline'}
                          size={18}
                          color={r.chosen >= 0 ? palette.accent : MOCHY_COLORS.textMuted}
                        />
                      </Pressable>
                    </View>
                    {swapIdx === i &&
                      r.options.map((o, k) => (
                        <Pressable
                          key={o.id}
                          onPress={() => {
                            setRows((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, chosen: k } : x))
                            );
                            setSwapIdx(null);
                          }}
                          style={[styles.option, k === r.chosen && { borderColor: palette.accent }]}
                        >
                          <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, flex: 1 }}>
                            {o.title} — {o.artist}
                          </Text>
                          <Text style={{ color: MOCHY_COLORS.textMuted, fontSize: 11 }}>
                            {o.source}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                );
              })}

              {chosenTracks.length > 0 && (
                <View style={{ gap: 10, marginTop: 14 }}>
                  <View style={styles.bulkRow}>
                    <Pressable
                      onPress={() => {
                        playTrack(chosenTracks[0], chosenTracks);
                        setIsPlayerOpen(true);
                        onClose();
                      }}
                      style={[styles.bulkBtn, { backgroundColor: palette.accent }]}
                    >
                      <Ionicons name="play" size={15} color={palette.onAccent} />
                      <Text style={{ color: palette.onAccent, fontWeight: '800', fontSize: 13 }}>
                        {vi ? 'Phát' : 'Play'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => likeTracks(chosenTracks)} style={styles.bulkBtn}>
                      <Ionicons name="heart-outline" size={15} color="#FFF" />
                      <Text style={styles.bulkText}>{vi ? 'Thích' : 'Like'}</Text>
                    </Pressable>
                    <Pressable onPress={() => queueTracks(chosenTracks)} style={styles.bulkBtn}>
                      <Ionicons name="list" size={15} color="#FFF" />
                      <Text style={styles.bulkText}>{vi ? 'Hàng chờ' : 'Queue'}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.bulkRow}>
                    <TextInput
                      value={playlistName}
                      onChangeText={setPlaylistName}
                      style={[styles.input, { flex: 1, paddingVertical: 10 }]}
                      placeholderTextColor={MOCHY_COLORS.textMuted}
                    />
                    <Pressable
                      onPress={() => {
                        const pl = savePlaylistFromTracks(playlistName, chosenTracks);
                        showToast(vi ? `Đã lưu "${pl.name}"` : `Saved "${pl.name}"`);
                        onClose();
                        openCollection({ kind: 'playlist', playlistId: pl.id });
                      }}
                      style={styles.bulkBtn}
                    >
                      <Ionicons name="add-circle-outline" size={15} color="#FFF" />
                      <Text style={styles.bulkText}>{vi ? 'Lưu playlist' : 'Save playlist'}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    padding: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 99,
  },
  help: { color: MOCHY_COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  inputWrap: { position: 'relative' },
  input: {
    color: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    paddingRight: 74,
    fontSize: 14,
  },
  pasteBtn: {
    position: 'absolute',
    right: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  goBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 99,
  },
  message: { color: '#FCA5A5', marginTop: 12, fontSize: 13, lineHeight: 19 },
  resultHead: {
    color: MOCHY_COLORS.textSecondary,
    marginTop: 18,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
  },
  resultRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOCHY_COLORS.glassBorder,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  art: { width: 42, height: 42, borderRadius: 8 },
  artEmpty: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  rowSub: { color: MOCHY_COLORS.textMuted, fontSize: 12, marginTop: 1 },
  smallBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginLeft: 52,
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
  },
  bulkRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  bulkText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  filesRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
  },
});
