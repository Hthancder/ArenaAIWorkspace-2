// Import hub. Three similar features merged into one place, with nothing duplicated:
//   • Link: YouTube / YouTube Music video or playlist, Spotify track/album/playlist, Apple Music
//     (OpenSpot Music's Spotify import + Musike's "paste a YouTube link to play")
//   • List: Musike's "Search a list". Paste a list of songs, get the best match for each with a
//     swap option, then play / like / queue / save them as a playlist. This replaces HolySic's
//     older text import.

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { parseTextList, TextItem } from '../../services/import/linkImport';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';
import { LocalLibrary } from '../../services/local/localLibrary';
import { parseM3U } from '../../services/import/m3u';
import { resolveM3U, ResolvedHow } from '../../services/import/playlistFiles';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';

/** A playlist file to open in the import screen (from Local Files or "Open with HolySic"). */
type PendingM3U = { text: string; name: string; baseDir?: string };
let pendingM3U: PendingM3U | null = null;
export function queueM3UImport(p: PendingM3U) {
  pendingM3U = p;
}
const stripPlaylistExt = (n: string) => n.replace(/\.m3u8?$/i, '');

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
  how?: ResolvedHow;
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
  } = useHolySic();
  useModalLayer('import', visible);
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
  const [fromFile, setFromFile] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setText(initialText);
      setMessage(null);
      setRows([]);
      setProgress(null);
      setSwapIdx(null);
      setFromFile(null);
      if (pendingM3U) {
        const p = pendingM3U;
        pendingM3U = null;
        runM3U(p);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialMode, initialText]);

  const runM3U = async (p: PendingM3U) => {
    const pl = parseM3U(p.text);
    setFromFile(p.name);
    setMode('list');
    setText('');
    if (!pl.entries.length) {
      setMessage(
        vi ? 'Tệp playlist trống hoặc không đúng định dạng M3U.' : 'Empty or invalid M3U file.'
      );
      return;
    }
    setBusy(true);
    setRows([]);
    setMessage(null);
    setProgress({ done: 0, total: pl.entries.length });
    try {
      const res = await resolveM3U(
        pl,
        p.baseDir,
        async (q) => (await searchTracks(q, 'all')).tracks,
        (done, total) => setProgress({ done, total })
      );
      setRows(
        res.map((r) => ({
          item: {
            title: r.entry.track?.title || r.entry.title || r.entry.location,
            artist: r.entry.track?.artist || r.entry.artist || '',
          },
          options: r.options,
          chosen: r.options.length ? 0 : -1,
          how: r.how,
        }))
      );
      setPlaylistName(pl.name || stripPlaylistExt(p.name));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const pickM3U = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type:
        Platform.OS === 'web'
          ? ['.m3u', '.m3u8', 'audio/x-mpegurl', 'application/vnd.apple.mpegurl']
          : [
              'public.m3u-playlist',
              'public.m3u8-playlist',
              'audio/x-mpegurl',
              'public.plain-text',
              'public.data',
            ],
      copyToCacheDirectory: true,
    });
    const a = res.canceled ? undefined : res.assets?.[0];
    if (!a) return;
    try {
      const body =
        Platform.OS === 'web'
          ? a.file
            ? await a.file.text()
            : await (await fetch(a.uri)).text()
          : await new FsFile(a.uri).text();
      runM3U({ text: body, name: a.name || 'Playlist' });
    } catch (e: any) {
      setMessage((vi ? 'Không đọc được tệp: ' : 'Could not read the file: ') + (e?.message || e));
    }
  };

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
          <Tap onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={UI.text} />
          </Tap>
          <Text style={[styles.title, { fontFamily }]}>{vi ? 'Nhập nhạc' : 'Import music'}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.segment}>
          {(['link', 'list'] as ImportMode[]).map((m) => (
            <Tap
              key={m}
              onPress={() => {
                setMode(m);
                setMessage(null);
                if (fromFile) {
                  setFromFile(null);
                  setRows([]);
                }
              }}
              style={[styles.segBtn, mode === m && { backgroundColor: palette.accent }]}
            >
              <Ionicons
                name={m === 'link' ? 'link' : 'list'}
                size={15}
                color={mode === m ? palette.onAccent : UI.fg(1)}
              />
              <Text
                style={{
                  color: mode === m ? palette.onAccent : UI.fg(1),
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
            </Tap>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {fromFile ? (
            <View style={styles.fileCard}>
              <Ionicons name="document-text" size={22} color={palette.accent} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {fromFile}
                </Text>
                <Text style={styles.rowSub}>
                  {busy && progress
                    ? `${vi ? 'Đang ghép bài' : 'Matching songs'} ${progress.done}/${progress.total}…`
                    : vi
                      ? 'Playlist M3U — bài trên máy ghép theo đường dẫn, bài còn lại tự tìm'
                      : 'M3U playlist — device songs matched by path, the rest searched'}
                </Text>
              </View>
              {busy ? <ActivityIndicator color={palette.accent} /> : null}
            </View>
          ) : (
            <>
              <Text style={styles.help}>
                {mode === 'link'
                  ? vi
                    ? 'YouTube / YouTube Music (bài hoặc playlist), Spotify (bài, album, playlist công khai), Apple Music. Bài hát được ghép với nguồn phát đầy đủ của HolySic.'
                    : 'YouTube / YouTube Music (song or playlist), Spotify (track, album, public playlist), Apple Music. Songs are matched to HolySic’s full-length sources.'
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
                  placeholderTextColor={UI.text3}
                  style={[
                    styles.input,
                    mode === 'list' && { minHeight: 120, textAlignVertical: 'top' },
                  ]}
                  multiline={mode === 'list'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Tap onPress={paste} style={styles.pasteBtn}>
                  <Ionicons name="clipboard-outline" size={16} color={UI.text} />
                  <Text style={{ color: UI.text, fontWeight: '700', fontSize: 12 }}>
                    {vi ? 'Dán' : 'Paste'}
                  </Text>
                </Tap>
              </View>

              <Tap
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
              </Tap>
            </>
          )}

          {message && <Text style={styles.message}>{message}</Text>}

          {mode === 'link' && (
            <Tap
              onPress={async () => {
                const n = await importLocalFiles();
                if (n > 0) {
                  onClose();
                  LocalLibrary.open('');
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
                    ? 'MP3, M4A, FLAC, WAV, AIFF… vào Nhạc trên máy, sắp xếp theo thư mục'
                    : 'MP3, M4A, FLAC, WAV, AIFF… into Local Files, organised in folders'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={UI.text3} />
            </Tap>
          )}
          {!fromFile && (mode !== 'list' || rows.length === 0) ? (
            <Tap onPress={pickM3U} style={styles.filesRow} accessibilityLabel="M3U">
              <Ionicons name="document-text-outline" size={20} color={palette.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {vi ? 'Mở tệp playlist (M3U / M3U8)' : 'Open a playlist file (M3U / M3U8)'}
                </Text>
                <Text style={styles.rowSub}>
                  {vi
                    ? 'Từ HolySic, VLC, foobar2000, Winamp, iTunes… — bài trên máy được ghép theo đường dẫn, bài còn lại tự tìm'
                    : 'From HolySic, VLC, foobar2000, Winamp, iTunes… — device songs matched by path, the rest searched'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={UI.text3} />
            </Tap>
          ) : null}

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
                        <ArtworkImage
                          source={{ uri: t.artworkUrl }}
                          fallbackSeed={t.title}
                          style={styles.art}
                        />
                      ) : (
                        <View style={[styles.art, styles.artEmpty]}>
                          <Ionicons name="help" size={18} color={UI.text3} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.rowTitle}>
                          {t ? t.title : r.item.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.rowSub}>
                          {t
                            ? `${t.artist} · ${
                                t.source === 'local' ? (vi ? 'Trên máy' : 'On device') : t.source
                              }`
                            : vi
                              ? `Không tìm thấy${r.item.artist ? ` · ${r.item.artist}` : ''}`
                              : `No match${r.item.artist ? ` · ${r.item.artist}` : ''}`}
                        </Text>
                      </View>
                      {r.options.length > 1 && (
                        <Tap
                          onPress={() => setSwapIdx(swapIdx === i ? null : i)}
                          style={styles.smallBtn}
                        >
                          <Text style={{ color: UI.text, fontSize: 12, fontWeight: '700' }}>
                            {vi ? 'Đổi' : 'Swap'}
                          </Text>
                        </Tap>
                      )}
                      <Tap
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
                          color={r.chosen >= 0 ? palette.accent : UI.text3}
                        />
                      </Tap>
                    </View>
                    {swapIdx === i &&
                      r.options.map((o, k) => (
                        <Tap
                          key={o.id}
                          onPress={() => {
                            setRows((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, chosen: k } : x))
                            );
                            setSwapIdx(null);
                          }}
                          style={[styles.option, k === r.chosen && { borderColor: palette.accent }]}
                        >
                          <Text numberOfLines={1} style={{ color: UI.text, fontSize: 13, flex: 1 }}>
                            {o.title} — {o.artist}
                          </Text>
                          <Text style={{ color: UI.text3, fontSize: 11 }}>{o.source}</Text>
                        </Tap>
                      ))}
                  </View>
                );
              })}

              {chosenTracks.length > 0 && (
                <View style={{ gap: 10, marginTop: 14 }}>
                  <View style={styles.bulkRow}>
                    <Tap
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
                    </Tap>
                    <Tap onPress={() => likeTracks(chosenTracks)} style={styles.bulkBtn}>
                      <Ionicons name="heart-outline" size={15} color={UI.text} />
                      <Text style={styles.bulkText}>{vi ? 'Thích' : 'Like'}</Text>
                    </Tap>
                    <Tap onPress={() => queueTracks(chosenTracks)} style={styles.bulkBtn}>
                      <Ionicons name="list" size={15} color={UI.text} />
                      <Text style={styles.bulkText}>{vi ? 'Hàng chờ' : 'Queue'}</Text>
                    </Tap>
                  </View>
                  <View style={styles.bulkRow}>
                    <TextInput
                      value={playlistName}
                      onChangeText={setPlaylistName}
                      style={[styles.input, { flex: 1, minWidth: 0, paddingVertical: 10 }]}
                      placeholderTextColor={UI.text3}
                    />
                    <Tap
                      onPress={() => {
                        const pl = savePlaylistFromTracks(playlistName, chosenTracks);
                        showToast(vi ? `Đã lưu "${pl.name}"` : `Saved "${pl.name}"`);
                        onClose();
                        openCollection({ kind: 'playlist', playlistId: pl.id });
                      }}
                      style={styles.bulkBtn}
                    >
                      <Ionicons name="add-circle-outline" size={15} color={UI.text} />
                      <Text style={styles.bulkText}>{vi ? 'Lưu playlist' : 'Save playlist'}</Text>
                    </Tap>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <SheetSlot layer="import" />
    </Modal>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: UI.surface('#0A0A0F') },
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
    backgroundColor: UI.fg(0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: UI.text, fontSize: 18, fontWeight: '800' },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    padding: 4,
    borderRadius: 99,
    backgroundColor: UI.fg(0.06),
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
  help: { color: UI.text2, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  inputWrap: { position: 'relative' },
  input: {
    color: UI.text,
    backgroundColor: UI.fg(0.06),
    borderWidth: 1,
    borderColor: UI.fg(0.1),
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
    backgroundColor: UI.fg(0.12),
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
    color: UI.text2,
    marginTop: 18,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
  },
  resultRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.1),
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  art: { width: 42, height: 42, borderRadius: 8 },
  artEmpty: {
    backgroundColor: UI.fg(0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: UI.text, fontWeight: '700', fontSize: 14 },
  rowSub: { color: UI.text3, fontSize: 12, marginTop: 1 },
  smallBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: UI.fg(0.08),
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
    borderColor: UI.fg(0.1),
  },
  bulkRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: UI.fg(0.06),
    marginBottom: 6,
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: UI.fg(0.1),
  },
  bulkText: { color: UI.text, fontWeight: '700', fontSize: 13 },
  filesRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.1),
  },
}));
