// "Sửa thông tin bài hát" for songs on the device: title, artist, album, year, genre, track number
// and cover. Matches from Apple Music / Deezer are looked up automatically (tap one to fill
// everything in, cover included). Nothing is written into the audio file — the details are kept by
// HolySic and "Khôi phục theo tệp" brings back exactly what the file's tags say.
//
// It is a shared sheet (see overlay/ModalLayers): it opens on top of the full player, the library
// page or the ⋯ menu's layer alike.

import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
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
import { LocalLibrary, localPathOf } from '../../services/local/localLibrary';
import { enrich, lookupCandidates, MetaCandidate } from '../../services/local/metadataLookup';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { Tap } from '../ui/Tap';

// ---------- open/close store ----------

let target: Track | null = null;
const subs = new Set<() => void>();
export function openSongEditor(t: Track | null) {
  target = t;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useSongEditorTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

// ---------- the sheet ----------

type Field = 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'genre' | 'trackNo';
type Values = Record<Field, string>;
type CoverChoice = { uri: string; from: string } | null | undefined; // undefined = unchanged

const FIELDS: { key: Field; vi: string; en: string; numeric?: boolean; half?: boolean }[] = [
  { key: 'title', vi: 'Tên bài hát', en: 'Title' },
  { key: 'artist', vi: 'Nghệ sĩ', en: 'Artist' },
  { key: 'album', vi: 'Album', en: 'Album' },
  { key: 'albumArtist', vi: 'Nghệ sĩ album', en: 'Album artist' },
  { key: 'genre', vi: 'Thể loại', en: 'Genre', half: true },
  { key: 'year', vi: 'Năm', en: 'Year', numeric: true, half: true },
  { key: 'trackNo', vi: 'Số bài', en: 'Track #', numeric: true, half: true },
];

const str = (v: unknown) => (v === undefined || v === null || v === 0 ? '' : String(v));
const UNKNOWN_ARTISTS = new Set(['Không rõ nghệ sĩ', 'Unknown artist']);
const mmss = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export const SongInfoEditor: React.FC = () => {
  const t = useSongEditorTarget();
  // keep the last song while the sheet fades out
  const [last, setLast] = useState<Track | null>(t);
  useEffect(() => {
    if (t) setLast(t);
  }, [t]);
  const shown = t || last;
  if (!shown) return null;
  return (
    <Modal
      visible={!!t}
      transparent
      animationType="slide"
      onRequestClose={() => openSongEditor(null)}
    >
      <EditorBody key={shown.id} track={shown} />
    </Modal>
  );
};

const EditorBody: React.FC<{ track: Track }> = ({ track }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { palette, prefs, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  const rel = localPathOf(track);
  const file = useMemo(() => LocalLibrary.fileDetails(rel), [rel]);
  const edit = LocalLibrary.getEdit(rel);
  const meta = LocalLibrary.getState().files.find((f) => f.path === rel)?.meta;

  const initial: Values = {
    title: track.title,
    // the "unknown artist" stand-in is a label, not a value to keep
    artist: UNKNOWN_ARTISTS.has(track.artist) ? '' : track.artist,
    album: edit?.album || file.album || '',
    albumArtist: edit?.albumArtist || meta?.albumArtist || '',
    year: str(track.releaseYear),
    genre: track.genre || '',
    trackNo: str(edit?.trackNo || file.trackNo),
  };
  const [v, setV] = useState<Values>(initial);
  const [cover, setCover] = useState<CoverChoice>(undefined);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(
    [file.artist || (track.artist !== 'Không rõ nghệ sĩ' ? track.artist : ''), file.title]
      .filter(Boolean)
      .join(' – ')
  );
  const [results, setResults] = useState<MetaCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const searchRun = useRef(0);
  const dirty =
    cover !== undefined || (Object.keys(initial) as Field[]).some((k) => v[k] !== initial[k]);

  const search = async (free?: string) => {
    const run = ++searchRun.current;
    setSearching(true);
    try {
      const q = free?.trim()
        ? (() => {
            const m = free.split(/\s+[–-]\s+/);
            return m.length >= 2
              ? { artist: m[0], title: m.slice(1).join(' '), durationSec: track.durationSec }
              : { title: free.trim(), durationSec: track.durationSec };
          })()
        : {
            title: file.title,
            artist: file.artist || undefined,
            album: file.album,
            durationSec: track.durationSec || undefined,
          };
      const list = await lookupCandidates(q, 8);
      if (run === searchRun.current) setResults(list);
    } catch {
      if (run === searchRun.current) setResults([]);
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  };
  useEffect(() => {
    search();
    return () => {
      searchRun.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyOf = (m: MetaCandidate) => `${m.source}|${m.title}|${m.artist}|${m.album}`;
  const applySeq = useRef(0);
  const apply = async (m0: MetaCandidate) => {
    setPicked(keyOf(m0));
    const seq = ++applySeq.current;
    const m = await enrich(m0);
    if (seq !== applySeq.current) return; // a newer pick won
    setV((cur) => ({
      title: m.title || cur.title,
      artist: m.artist || cur.artist,
      album: m.album || cur.album,
      // album artist: the store's when given, else the main artist of that album
      albumArtist:
        m.albumArtist ||
        cur.albumArtist ||
        (m.album && m.artist
          ? m.artist.split(/\s+[([]?(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()
          : ''),
      year: str(m.year) || cur.year,
      genre: m.genre || cur.genre,
      trackNo: str(m.trackNo) || cur.trackNo,
    }));
    if (m.coverUrl) setCover({ uri: m.coverUrl, from: m.source });
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!res.canceled && res.assets?.[0]?.uri)
      setCover({ uri: res.assets[0].uri, from: vi ? 'Ảnh' : 'Photos' });
  };
  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['image/*'],
      copyToCacheDirectory: true,
    });
    if (!res.canceled && res.assets?.[0]?.uri)
      setCover({ uri: res.assets[0].uri, from: vi ? 'Tệp' : 'Files' });
  };

  const close = () => openSongEditor(null);
  /** Cancel / tap outside: ask once before throwing edits away */
  const requestClose = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    close();
  };
  const save = async () => {
    if (saving) return;
    if (!dirty) {
      close();
      return;
    }
    setSaving(true);
    // a field equal to what the file says is not an edit (so tag changes still come through)
    const own = (k: Field, fileVal: unknown) => {
      const val = v[k].trim();
      return val && val !== str(fileVal) ? val : undefined;
    };
    const num = (x?: string) => (x && /^\d+$/.test(x) ? parseInt(x, 10) : undefined);
    try {
      await LocalLibrary.saveEdit(
        rel,
        {
          title: own('title', file.title),
          artist: own('artist', file.artist),
          album: own('album', file.album),
          albumArtist: own('albumArtist', meta?.albumArtist),
          year: num(own('year', file.year)),
          genre: own('genre', file.genre),
          trackNo: num(own('trackNo', file.trackNo)),
          fetchedFrom: cover?.from || edit?.fetchedFrom,
        },
        cover === null ? null : cover?.uri
      );
      showToast(vi ? 'Đã lưu thông tin bài hát' : 'Song info saved');
      close();
    } catch (e: any) {
      showToast((vi ? 'Không lưu được: ' : 'Could not save: ') + (e?.message || e));
      setSaving(false);
    }
  };
  const reset = async () => {
    setSaving(true);
    await LocalLibrary.resetEdit(rel);
    showToast(vi ? 'Đã khôi phục theo tệp' : 'Restored from the file');
    close();
  };

  const shownCover = cover === null ? LocalLibrary.fileArtUri(rel) : cover?.uri || track.artworkUrl;
  const hasEdit = !!edit && Object.keys(edit).some((k) => k !== 'lookedUpAt');

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
            <Tap feedback="opacity" onPress={requestClose} hitSlop={10} accessibilityLabel="Close">
              <Text style={[s.topBtn, confirmDiscard && { color: c.danger, fontWeight: '800' }]}>
                {confirmDiscard ? (vi ? 'Bỏ thay đổi?' : 'Discard?') : vi ? 'Huỷ' : 'Cancel'}
              </Text>
            </Tap>
            <Text style={s.topTitle}>{vi ? 'Sửa thông tin' : 'Edit info'}</Text>
            <Tap
              feedback="opacity"
              onPress={save}
              disabled={saving}
              hitSlop={10}
              accessibilityLabel={vi ? 'Lưu' : 'Save'}
            >
              {saving ? (
                <ActivityIndicator color={palette.accent} />
              ) : (
                <Text
                  style={[
                    s.topBtn,
                    s.saveBtn,
                    { color: dirty ? palette.accent : c.text3, fontWeight: '800' },
                  ]}
                >
                  {vi ? 'Lưu' : 'Save'}
                </Text>
              )}
            </Tap>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingBottom: 18 }}
            showsVerticalScrollIndicator={false}
          >
            {/* cover */}
            <View style={s.coverRow}>
              <View>
                {shownCover ? (
                  <ArtworkImage
                    source={{ uri: shownCover }}
                    style={s.cover}
                    fallbackSeed={v.title}
                  />
                ) : (
                  <View style={[s.cover, s.coverEmpty]}>
                    <Ionicons name="musical-notes" size={38} color={c.text3} />
                  </View>
                )}
                {cover?.from ? (
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
                <Tap onPress={pickFile} style={s.coverBtn}>
                  <Ionicons name="document-outline" size={17} color={c.icon} />
                  <Text style={s.coverBtnText}>{vi ? 'Từ Tệp' : 'From Files'}</Text>
                </Tap>
                {(cover || edit?.art) && cover !== null ? (
                  <Tap onPress={() => setCover(edit?.art ? null : undefined)} style={s.coverBtn}>
                    <Ionicons name="arrow-undo-outline" size={17} color={c.icon} />
                    <Text style={s.coverBtnText}>
                      {vi ? 'Dùng ảnh của tệp' : 'Use the file’s art'}
                    </Text>
                  </Tap>
                ) : null}
              </View>
            </View>

            {/* fields */}
            <View style={s.fields}>
              {FIELDS.map((f) => (
                <View key={f.key} style={[s.field, f.half && s.fieldThird]}>
                  <Text style={s.label}>{vi ? f.vi : f.en}</Text>
                  <TextInput
                    value={v[f.key]}
                    onChangeText={(x) =>
                      setV((cur) => ({ ...cur, [f.key]: f.numeric ? x.replace(/\D/g, '') : x }))
                    }
                    placeholder={
                      str(f.key === 'albumArtist' ? meta?.albumArtist : (file as any)[f.key]) || '—'
                    }
                    placeholderTextColor={c.text3}
                    keyboardType={f.numeric ? 'number-pad' : 'default'}
                    maxLength={f.key === 'year' ? 4 : f.numeric ? 3 : 200}
                    style={s.input}
                    accessibilityLabel={vi ? f.vi : f.en}
                  />
                </View>
              ))}
            </View>
            <Text style={s.note}>
              {vi
                ? `Tệp gốc không bị sửa: thông tin lưu trong HolySic. Tệp: ${rel}`
                : `The file itself is not modified: details are kept by HolySic. File: ${rel}`}
            </Text>

            {/* online matches */}
            <View style={s.sectionHead}>
              <Ionicons name="sparkles" size={16} color={palette.accent} />
              <Text style={s.section}>
                {vi ? 'Tìm thông tin & ảnh bìa' : 'Find details & cover'}
              </Text>
              {searching && <ActivityIndicator size="small" color={palette.accent} />}
            </View>
            <View style={s.searchRow}>
              <Ionicons name="search" size={16} color={c.text3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => search(query)}
                returnKeyType="search"
                placeholder={vi ? 'Nghệ sĩ – tên bài' : 'Artist – title'}
                placeholderTextColor={c.text3}
                style={s.searchInput}
                accessibilityLabel={vi ? 'Tìm thông tin' : 'Search info'}
              />
              <Tap
                onPress={() => search(query)}
                style={[s.searchBtn, { backgroundColor: palette.accent }]}
              >
                <Text style={[s.searchBtnText, { color: palette.onAccent }]}>
                  {vi ? 'Tìm' : 'Search'}
                </Text>
              </Tap>
            </View>
            {results && !results.length && !searching ? (
              <Text style={s.note}>
                {vi
                  ? 'Không tìm thấy — thử sửa ô tìm kiếm (vd. "Sơn Tùng – Lạc Trôi").'
                  : 'Nothing found — try editing the search (e.g. "Artist – Title").'}
              </Text>
            ) : null}
            {(results || []).map((m) => {
              const k = keyOf(m);
              const on = picked === k;
              const pct = Math.round(m.score * 100);
              const durOff =
                !!m.durationSec &&
                !!track.durationSec &&
                Math.abs(m.durationSec - track.durationSec) > 7;
              return (
                <Pressable
                  key={k}
                  onPress={() => apply(m)}
                  style={({ pressed }) => [
                    s.cand,
                    on && { borderColor: palette.accent, backgroundColor: palette.accent + '1F' },
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityLabel={`${m.title} – ${m.artist}`}
                >
                  <ArtworkImage
                    source={{ uri: m.coverUrl?.replace(/1000x1000bb/, '200x200bb') || '' }}
                    style={s.candArt}
                    fallbackSeed={m.title}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={s.candTitle}>
                      {m.title}
                    </Text>
                    <Text numberOfLines={1} style={s.candSub}>
                      {[m.artist, m.album, m.year].filter(Boolean).join(' · ')}
                    </Text>
                    <View style={s.candMeta}>
                      <Text style={s.candSource}>{m.source}</Text>
                      {!!m.durationSec && (
                        <Text style={[s.candSource, durOff && { color: '#F59E0B' }]}>
                          {mmss(m.durationSec)}
                          {durOff
                            ? vi
                              ? ` · bài trên máy ${mmss(track.durationSec)}`
                              : ` · yours is ${mmss(track.durationSec)}`
                            : ''}
                        </Text>
                      )}
                      {pct >= 30 && (
                        <View
                          style={[
                            s.match,
                            {
                              backgroundColor:
                                pct >= 78 ? c.success + '26' : pct >= 55 ? '#F59E0B26' : c.field,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              s.matchText,
                              { color: pct >= 78 ? c.success : pct >= 55 ? '#F59E0B' : c.text3 },
                            ]}
                          >
                            {pct}%
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'add-circle-outline'}
                    size={22}
                    color={on ? palette.accent : c.text3}
                  />
                </Pressable>
              );
            })}

            {hasEdit ? (
              <Tap onPress={reset} disabled={saving} style={s.resetBtn}>
                <Ionicons name="refresh" size={18} color={c.danger} />
                <Text style={[s.resetText, { color: c.danger }]}>
                  {vi ? 'Khôi phục theo tệp' : 'Restore from the file'}
                </Text>
              </Tap>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
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
  saveBtn: { textAlign: 'right' as const },
  topTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  coverRow: {
    flexDirection: 'row' as const,
    gap: 16,
    alignItems: 'center' as const,
    marginVertical: 8,
  },
  cover: { width: 128, height: 128, borderRadius: 16 },
  coverEmpty: {
    backgroundColor: c.field,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
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
  },
  coverBtnText: { color: c.text, fontSize: 14, fontWeight: '600' as const },
  fields: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginTop: 10 },
  field: { width: '100%' as const },
  fieldThird: { width: '31%' as const, flexGrow: 1 },
  label: {
    color: c.text3,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 5,
    marginLeft: 2,
  },
  input: {
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    color: c.text,
    fontSize: 15,
  },
  note: { color: c.text3, fontSize: 12, lineHeight: 17, marginTop: 10 },
  sectionHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 22,
    marginBottom: 10,
  },
  section: { color: c.text, fontSize: 16, fontWeight: '800' as const, flex: 1 },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: c.field,
    borderRadius: 14,
    paddingLeft: 12,
    padding: 4,
    marginBottom: 8,
  },
  searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 8 },
  searchBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  searchBtnText: { fontSize: 13, fontWeight: '800' as const },
  cand: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  candArt: { width: 52, height: 52, borderRadius: 10 },
  candTitle: { color: c.text, fontSize: 15, fontWeight: '700' as const },
  candSub: { color: c.text2, fontSize: 12.5, marginTop: 2 },
  candMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4 },
  candSource: { color: c.text3, fontSize: 11, fontWeight: '700' as const },
  match: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 1 },
  matchText: { fontSize: 10.5, fontWeight: '800' as const },
  resetBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: c.field,
  },
  resetText: { fontSize: 15, fontWeight: '700' as const },
});
