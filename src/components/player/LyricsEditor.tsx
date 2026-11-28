// Lyrics for one song, your way: search every source and pick the right lyrics, paste / write
// your own (LRC or plain, with tap-to-time while the song plays), turn lyrics off, keep an
// offline copy, or go back to automatic. Choices are remembered for next time.

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
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
import { PlaybackClock } from '../../services/audio/playbackClock';
import { isLocalTrack } from '../../services/local/localLibrary';
import { lyricsFromText } from '../../services/lyrics/lyricsService';
import {
  LYRICS_SOURCES,
  LyricsCandidate,
  queryOf,
  searchLyricsCandidates,
} from '../../services/lyrics/lyricsSources';
import {
  clearStoredLyrics,
  loadLyrics,
  lyricsToLrc,
  markNoLyrics,
  saveLyricsOffline,
  setLyricsOverride,
  storedLyricsInfo,
  useStoredLyrics,
} from '../../services/lyrics/lyricsStore';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { LyricsData, Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { Tap } from '../ui/Tap';
import { LyricsTimingPane } from './LyricsTimingPane';

// ---------- open/close store ----------

let target: { track: Track; tab?: Tab } | null = null;
const subs = new Set<() => void>();
export function openLyricsEditor(track: Track | null, tab?: Tab) {
  target = track ? { track, tab } : null;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useLyricsEditorTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

type Tab = 'search' | 'write';

// Unsaved edits per song, kept while the app runs: closing the editor to find a spot in the
// player and coming back picks up exactly where you left off.
const drafts = new Map<string, string>();

const sourceName = (id: string) => LYRICS_SOURCES.find((s) => s.id === id)?.name || id;

const fmtDur = (s?: number) =>
  s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

const stamp = (s: number) => {
  const c = Math.max(0, s);
  const m = Math.floor(c / 60);
  return `[${String(m).padStart(2, '0')}:${(c - m * 60).toFixed(2).padStart(5, '0')}]`;
};

export function providerLabel(d: LyricsData, vi: boolean): string {
  if (d.provider === 'Local') return vi ? 'Tệp trên máy' : 'Local file';
  if (d.provider === 'Built-in') return 'HolySic';
  if (d.provider === 'User') return vi ? 'Lời của bạn' : 'Your lyrics';
  return d.provider;
}

// ---------- the sheet ----------

export const LyricsEditor: React.FC = () => {
  const tg = useLyricsEditorTarget();
  const [last, setLast] = useState(tg);
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
      onRequestClose={() => openLyricsEditor(null)}
    >
      <EditorBody key={shown.track.id} track={shown.track} startTab={shown.tab} />
    </Modal>
  );
};

const EditorBody: React.FC<{ track: Track; startTab?: Tab }> = ({ track, startTab }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {
    palette,
    prefs,
    showToast,
    haptic,
    currentTrack,
    lyrics: playingLyrics,
    reloadLyrics,
    downloads,
    playTrack,
    isPlaying,
    lyricsOffsetSec,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  useStoredLyrics();
  const info = storedLyricsInfo(track);
  const isCurrent = currentTrack?.id === track.id;
  const offlineSong = isLocalTrack(track) || !!downloads[track.id];

  // what the song shows now
  const [current, setCurrent] = useState<LyricsData | null>(
    isCurrent && playingLyrics?.trackId === track.id ? playingLyrics : null
  );
  useEffect(() => {
    if (current) return;
    let off = false;
    loadLyrics(track, { sources: prefs.lyricsSources }).then((d) => !off && setCurrent(d));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<Tab>(startTab || 'search');
  const close = () => openLyricsEditor(null);
  const applied = (msg: string) => {
    haptic('light');
    showToast(msg);
    if (isCurrent) reloadLyrics();
    close();
  };

  // ── search ──
  const q = useMemo(() => queryOf(track), [track]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LyricsCandidate[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, LyricsData | null | 'loading'>>({});
  const searchSeq = useRef(0);
  const runSearch = async (free?: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    setOpenKey(null);
    const list = await searchLyricsCandidates(
      q,
      free?.trim() || undefined,
      prefs.lyricsSources
    ).catch(() => [] as LyricsCandidate[]);
    if (seq !== searchSeq.current) return;
    setResults(list);
    setSearching(false);
  };
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = async (cand: LyricsCandidate) => {
    haptic('selection');
    if (openKey === cand.key) return setOpenKey(null);
    setOpenKey(cand.key);
    if (preview[cand.key] !== undefined && preview[cand.key] !== null) return;
    setPreview((p) => ({ ...p, [cand.key]: 'loading' }));
    const d = await cand.load().catch(() => null);
    setPreview((p) => ({ ...p, [cand.key]: d && d.lines.length ? d : null }));
  };
  const pickCandidate = async (cand: LyricsCandidate, d: LyricsData) => {
    await setLyricsOverride(track, { ...d, trackId: track.id }, cand.source);
    applied(
      vi
        ? `Đã dùng lời từ ${sourceName(cand.source)}`
        : `Using lyrics from ${sourceName(cand.source)}`
    );
  };

  // ── write ──
  const initialText = useMemo(
    () => (current && current.lines.length ? lyricsToLrc(current) : ''),
    [current]
  );
  // null = untouched; an unsaved draft from earlier in this session comes back
  const [text, setTextRaw] = useState<string | null>(() => drafts.get(track.id) ?? null);
  const [restored] = useState(() => drafts.has(track.id));
  const shownText = text ?? initialText;
  const sel = useRef({ start: 0, end: 0 });
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  // undo for timing changes (typing has the keyboard's own undo)
  const history = useRef<string[]>([]);
  const [, bumpHistory] = useState(0);
  const change = (next: string) => {
    if (next === shownText) return;
    history.current.push(shownText);
    if (history.current.length > 80) history.current.shift();
    bumpHistory((n) => n + 1);
    setTextRaw(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev === undefined) return;
    bumpHistory((n) => n + 1);
    setTextRaw(prev);
  };
  const [mode, setMode] = useState<'text' | 'timing'>('text');
  // lines without a time are kept (spread between their timed neighbours) — never dropped
  const parsed = useMemo(
    () =>
      shownText.trim() ? lyricsFromText(shownText, track.durationSec, { keepUntimed: true }) : null,
    [shownText, track.durationSec]
  );
  const untimedCount = useMemo(
    () => (parsed?.synced ? parsed.lines.filter((l) => l.estimated).length : 0),
    [parsed]
  );
  const dirty = text !== null && text !== initialText;
  // keep the draft while it differs from what is saved
  useEffect(() => {
    if (text !== null && text !== initialText) drafts.set(track.id, text);
    else if (current) drafts.delete(track.id);
  }, [text, initialText, current, track.id]);
  const saveText = async () => {
    if (!parsed || !parsed.lines.length) {
      showToast(vi ? 'Chưa có lời để lưu' : 'Nothing to save yet');
      return;
    }
    const data: LyricsData = {
      ...parsed,
      trackId: track.id,
      provider: 'User',
      // the text exactly as written: reopening the editor shows the untimed lines again
      editText: shownText.replace(/\r\n/g, '\n').replace(/\s+$/, ''),
    };
    await setLyricsOverride(track, data, 'user');
    drafts.delete(track.id);
    haptic('light');
    showToast(
      untimedCount
        ? vi
          ? `Đã lưu · ${untimedCount} dòng chưa có giờ vẫn được giữ`
          : `Saved · ${untimedCount} untimed lines kept`
        : vi
          ? 'Đã lưu lời của bạn cho bài này'
          : 'Saved your lyrics for this song'
    );
    if (isCurrent) reloadLyrics();
    // stay open: keep timing from here (Close when done)
    setCurrent({ ...data, origin: 'override' });
    setTextRaw(null);
    history.current = [];
    bumpHistory((n) => n + 1);
  };
  const paste = async () => {
    const clip = await Clipboard.getStringAsync().catch(() => '');
    if (!clip.trim()) {
      showToast(vi ? 'Bộ nhớ tạm đang trống' : 'Clipboard is empty');
      return;
    }
    haptic('selection');
    change(clip.replace(/\r\n/g, '\n'));
  };
  /** stamp the line under the cursor with the playing time and move to the next line */
  const tapTime = () => {
    if (!isCurrent) return;
    const t = shownText;
    const at = Math.min(sel.current.start, t.length);
    const ls = t.lastIndexOf('\n', at - 1) + 1;
    let le = t.indexOf('\n', ls);
    if (le < 0) le = t.length;
    const body = t.slice(ls, le).replace(/^\s*(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+\s*/, '');
    const line = stamp(PlaybackClock.now(isPlaying) - lyricsOffsetSec) + body;
    const next = t.slice(0, ls) + line + t.slice(le);
    haptic('light');
    change(next);
    const nextLine = Math.min(ls + line.length + 1, next.length);
    sel.current = { start: nextLine, end: nextLine };
    setSelection({ start: nextLine, end: nextLine });
  };

  // ── status line ──
  const status = (() => {
    if (info?.kind === 'none')
      return vi ? 'Bạn đã tắt lời cho bài này' : 'You turned lyrics off for this song';
    if (info?.kind === 'override')
      return info.from === 'user'
        ? vi
          ? 'Đang dùng lời bạn nhập · đã lưu trên máy'
          : 'Using your own lyrics · saved on this device'
        : vi
          ? `Đang dùng lời bạn chọn (${sourceName(info.from || '')}) · đã lưu trên máy`
          : `Using lyrics you picked (${sourceName(info.from || '')}) · saved on this device`;
    if (!current) return vi ? 'Đang tải lời hiện tại…' : 'Loading current lyrics…';
    if (!current.lines.length)
      return vi ? 'Chưa tìm thấy lời tự động' : 'No automatic lyrics found';
    const kind = current.wordSynced
      ? vi
        ? 'theo từng chữ'
        : 'word-synced'
      : current.synced
        ? vi
          ? 'đồng bộ'
          : 'synced'
        : vi
          ? 'không đồng bộ'
          : 'plain';
    const where = info?.kind === 'saved' ? (vi ? ' · đã lưu offline' : ' · saved offline') : '';
    return `${vi ? 'Tự động' : 'Automatic'}: ${providerLabel(current, vi)} · ${kind}${where}`;
  })();
  const canKeepOffline =
    !info &&
    !!current?.lines.length &&
    current.provider !== 'Built-in' &&
    current.provider !== 'Local';

  return (
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.wrap}
        pointerEvents="box-none"
      >
        <View
          style={[
            s.sheet,
            { marginTop: insets.top + 36, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={s.handle} />
          <View style={s.topBar}>
            <Tap feedback="opacity" onPress={close} hitSlop={10}>
              <Text style={s.topBtn}>{vi ? 'Đóng' : 'Close'}</Text>
            </Tap>
            <Text style={s.topTitle}>{vi ? 'Lời bài hát' : 'Lyrics'}</Text>
            {tab === 'write' ? (
              <Tap
                feedback="opacity"
                onPress={saveText}
                hitSlop={10}
                accessibilityLabel={vi ? 'Lưu lời' : 'Save lyrics'}
              >
                <Text
                  style={[
                    s.topBtn,
                    s.saveBtn,
                    { color: dirty && parsed ? palette.accent : c.text3 },
                  ]}
                >
                  {vi ? 'Lưu' : 'Save'}
                </Text>
              </Tap>
            ) : (
              <View style={{ minWidth: 48 }} />
            )}
          </View>

          {/* song */}
          <View style={s.songRow}>
            <ArtworkImage
              source={{ uri: track.artworkUrl }}
              style={s.art}
              fallbackSeed={track.title}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.songTitle} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={s.songArtist} numberOfLines={1}>
                {track.artist}
                {track.durationSec ? ` · ${fmtDur(track.durationSec)}` : ''}
              </Text>
              <Text
                style={[s.status, { color: info ? palette.accent : c.text2 }]}
                numberOfLines={2}
              >
                {status}
              </Text>
            </View>
          </View>

          {/* quick actions */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -18, flexGrow: 0 }}
            contentContainerStyle={s.actions}
          >
            {info && (
              <Tap
                onPress={async () => {
                  await clearStoredLyrics(track);
                  applied(vi ? 'Đã quay về lời tự động' : 'Back to automatic lyrics');
                }}
                style={s.chip}
              >
                <Ionicons name="sparkles-outline" size={14} color={c.icon} />
                <Text style={s.chipText}>
                  {info.kind === 'saved'
                    ? vi
                      ? 'Xoá bản offline'
                      : 'Remove offline copy'
                    : vi
                      ? 'Về tự động'
                      : 'Automatic'}
                </Text>
              </Tap>
            )}
            {canKeepOffline && current && (
              <Tap
                onPress={async () => {
                  await saveLyricsOffline(track, current);
                  haptic('light');
                  showToast(vi ? 'Đã lưu lời để nghe offline' : 'Lyrics saved for offline');
                }}
                style={s.chip}
              >
                <Ionicons name="cloud-download-outline" size={14} color={c.icon} />
                <Text style={s.chipText}>{vi ? 'Lưu lời offline' : 'Keep offline'}</Text>
              </Tap>
            )}
            {info?.kind !== 'none' && (
              <Tap
                onPress={async () => {
                  await markNoLyrics(track);
                  applied(vi ? 'Đã tắt lời cho bài này' : 'Lyrics turned off for this song');
                }}
                style={s.chip}
              >
                <Ionicons name="eye-off-outline" size={14} color={c.icon} />
                <Text style={s.chipText}>{vi ? 'Không có lời' : 'No lyrics'}</Text>
              </Tap>
            )}
            {!offlineSong && !info && (
              <View style={[s.chip, { opacity: 0.6 }]}>
                <Ionicons name="information-circle-outline" size={14} color={c.icon} />
                <Text style={s.chipText}>
                  {vi ? 'Bài tải về sẽ tự lưu lời' : 'Downloads keep lyrics automatically'}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* tabs */}
          <View style={s.segments} accessibilityRole="tablist">
            {(
              [
                ['search', 'search', vi ? 'Tìm lời khác' : 'Find lyrics'],
                ['write', 'create-outline', vi ? 'Tự nhập / sửa' : 'Write / edit'],
              ] as const
            ).map(([id, icon, label]) => {
              const on = tab === id;
              return (
                <Tap
                  key={id}
                  onPress={() => {
                    haptic('selection');
                    setTab(id);
                  }}
                  style={[s.segment, on && { backgroundColor: palette.accent }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={icon} size={14} color={on ? palette.onAccent : c.text2} />
                  <Text style={[s.segmentText, { color: on ? palette.onAccent : c.text2 }]}>
                    {label}
                  </Text>
                </Tap>
              );
            })}
          </View>

          {tab === 'search' ? (
            <>
              <View style={s.searchRow}>
                <Ionicons name="search" size={16} color={c.text3} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`${track.artist} ${track.title}`.trim()}
                  placeholderTextColor={c.text3}
                  returnKeyType="search"
                  onSubmitEditing={() => runSearch(query)}
                  style={s.searchInput}
                  autoCorrect={false}
                  accessibilityLabel={vi ? 'Tìm lời' : 'Search lyrics'}
                />
                {query.length > 0 && (
                  <Tap
                    feedback="opacity"
                    hitSlop={8}
                    onPress={() => {
                      setQuery('');
                      runSearch();
                    }}
                    accessibilityLabel={vi ? 'Xoá' : 'Clear'}
                  >
                    <Ionicons name="close-circle" size={17} color={c.text3} />
                  </Tap>
                )}
              </View>
              <ScrollView
                style={s.list}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                {searching ? (
                  <View style={s.empty}>
                    <ActivityIndicator color={palette.accent} />
                    <Text style={s.emptyText}>
                      {vi
                        ? 'Đang tìm trên LRCLib, NetEase, Kugou…'
                        : 'Searching LRCLib, NetEase, Kugou…'}
                    </Text>
                  </View>
                ) : !results?.length ? (
                  <View style={s.empty}>
                    <Ionicons name="musical-notes-outline" size={26} color={c.text3} />
                    <Text style={s.emptyText}>
                      {vi
                        ? 'Không tìm thấy. Thử gõ tên bài khác đi, hoặc tự nhập lời ở tab bên cạnh.'
                        : 'Nothing found. Try other words, or write the lyrics in the next tab.'}
                    </Text>
                  </View>
                ) : (
                  results.map((cand) => {
                    const open = openKey === cand.key;
                    const pv = preview[cand.key];
                    const match = cand.probe
                      ? { label: vi ? 'Thử tải' : 'Try', color: c.text3 }
                      : cand.score >= 0.8
                        ? { label: vi ? 'Khớp' : 'Match', color: '#34D399' }
                        : cand.score >= 0.62
                          ? { label: vi ? 'Có thể đúng' : 'Likely', color: '#FBBF24' }
                          : { label: vi ? 'Ít khớp' : 'Weak', color: c.text3 };
                    return (
                      <View
                        key={cand.key}
                        style={[s.cand, open && { borderColor: palette.accent + '88' }]}
                      >
                        <Tap onPress={() => toggle(cand)} style={s.candHead} feedback="opacity">
                          <View style={[s.srcBadge, { backgroundColor: palette.accent + '22' }]}>
                            <Text style={[s.srcText, { color: palette.accent }]} numberOfLines={1}>
                              {sourceName(cand.source)}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.candTitle} numberOfLines={1}>
                              {cand.title}
                            </Text>
                            <Text style={s.candMeta} numberOfLines={1}>
                              {[
                                cand.artist,
                                fmtDur(cand.durationSec),
                                cand.synced
                                  ? vi
                                    ? 'đồng bộ'
                                    : 'synced'
                                  : vi
                                    ? 'lời thường'
                                    : 'plain',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                          <Text style={[s.matchText, { color: match.color }]}>{match.label}</Text>
                          <Ionicons
                            name={open ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={c.text3}
                          />
                        </Tap>
                        {open && (
                          <View style={s.preview}>
                            {pv === 'loading' || pv === undefined ? (
                              <ActivityIndicator
                                color={palette.accent}
                                style={{ marginVertical: 10 }}
                              />
                            ) : pv === null ? (
                              <Text style={s.emptyText}>
                                {vi
                                  ? 'Nguồn này không có lời cho bài.'
                                  : 'No lyrics in this result.'}
                              </Text>
                            ) : (
                              <>
                                {pv.lines.slice(0, 8).map((l) => (
                                  <Text key={l.id} style={s.previewLine} numberOfLines={1}>
                                    {pv.synced && (
                                      <Text style={s.previewTime}>
                                        {fmtDur(l.startSec) || '0:00'}{' '}
                                      </Text>
                                    )}
                                    {l.text}
                                  </Text>
                                ))}
                                {pv.lines.length > 8 && (
                                  <Text style={s.previewMore}>
                                    {vi
                                      ? `+ ${pv.lines.length - 8} dòng nữa`
                                      : `+ ${pv.lines.length - 8} more lines`}
                                  </Text>
                                )}
                                <Tap
                                  onPress={() => pickCandidate(cand, pv)}
                                  style={[s.useBtn, { backgroundColor: palette.accent }]}
                                >
                                  <Ionicons name="checkmark" size={16} color={palette.onAccent} />
                                  <Text style={[s.useBtnText, { color: palette.onAccent }]}>
                                    {vi ? 'Dùng lời này' : 'Use these lyrics'}
                                  </Text>
                                </Tap>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </>
          ) : (
            <>
              {/* write: the text itself · time: stamp lines while the song plays */}
              <View style={s.modeRow} accessibilityRole="tablist">
                {(
                  [
                    ['text', 'document-text-outline', vi ? 'Văn bản' : 'Text'],
                    ['timing', 'timer-outline', vi ? 'Gắn giờ' : 'Timing'],
                  ] as const
                ).map(([id, icon, label]) => {
                  const on = mode === id;
                  return (
                    <Tap
                      key={id}
                      feedback="opacity"
                      onPress={() => {
                        haptic('selection');
                        setMode(id);
                      }}
                      style={[s.modeBtn, on && { borderColor: palette.accent }]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Ionicons name={icon} size={13} color={on ? palette.accent : c.text2} />
                      <Text style={[s.modeText, { color: on ? palette.accent : c.text2 }]}>
                        {label}
                      </Text>
                    </Tap>
                  );
                })}
              </View>
              {restored && dirty && (
                <View style={[s.draftNote, { borderColor: palette.accent + '55' }]}>
                  <Ionicons name="document-lock-outline" size={14} color={palette.accent} />
                  <Text style={s.draftText}>
                    {vi ? 'Đã mở lại bản nháp chưa lưu của bạn.' : 'Your unsaved draft is back.'}
                  </Text>
                  <Tap
                    feedback="opacity"
                    hitSlop={8}
                    onPress={() => {
                      haptic('selection');
                      change(initialText);
                    }}
                    accessibilityLabel={vi ? 'Bỏ bản nháp' : 'Discard the draft'}
                  >
                    <Text style={[s.draftBtn, { color: palette.accent }]}>
                      {vi ? 'Bỏ nháp' : 'Discard'}
                    </Text>
                  </Tap>
                </View>
              )}
              {mode === 'timing' ? (
                isCurrent ? (
                  <LyricsTimingPane
                    text={shownText}
                    onChange={change}
                    canUndo={history.current.length > 0}
                    onUndo={undo}
                    durationSec={track.durationSec || 0}
                  />
                ) : (
                  <View style={s.empty}>
                    <Ionicons name="play-circle-outline" size={28} color={c.text3} />
                    <Text style={s.emptyText}>
                      {vi
                        ? 'Gắn giờ dùng thời điểm đang phát — hãy phát bài này trước.'
                        : 'Timing uses the playing time — play this song first.'}
                    </Text>
                    <Tap
                      onPress={() => {
                        haptic('light');
                        playTrack(track);
                      }}
                      style={[s.useBtn, { backgroundColor: palette.accent, paddingHorizontal: 18 }]}
                    >
                      <Ionicons name="play" size={15} color={palette.onAccent} />
                      <Text style={[s.useBtnText, { color: palette.onAccent }]}>
                        {vi ? 'Phát bài này' : 'Play this song'}
                      </Text>
                    </Tap>
                  </View>
                )
              ) : (
                <>
                  <View style={s.writeTools}>
                    <Tap onPress={paste} style={s.chip}>
                      <Ionicons name="clipboard-outline" size={14} color={c.icon} />
                      <Text style={s.chipText}>{vi ? 'Dán' : 'Paste'}</Text>
                    </Tap>
                    {isCurrent && (
                      <Tap
                        onPress={tapTime}
                        style={[s.chip, { borderColor: palette.accent + '66' }]}
                        accessibilityLabel={
                          vi ? 'Gắn giờ cho dòng có con trỏ' : 'Time the line at the cursor'
                        }
                      >
                        <Ionicons name="timer-outline" size={14} color={palette.accent} />
                        <Text style={[s.chipText, { color: palette.accent }]}>
                          {vi ? 'Gắn giờ dòng này' : 'Time this line'}
                        </Text>
                      </Tap>
                    )}
                    {history.current.length > 0 && (
                      <Tap
                        onPress={() => {
                          haptic('selection');
                          undo();
                        }}
                        style={s.chip}
                        accessibilityLabel={vi ? 'Hoàn tác' : 'Undo'}
                      >
                        <Ionicons name="arrow-undo" size={14} color={c.icon} />
                        <Text style={s.chipText}>{vi ? 'Hoàn tác' : 'Undo'}</Text>
                      </Tap>
                    )}
                    {shownText.length > 0 && (
                      <Tap
                        onPress={() => {
                          haptic('selection');
                          change('');
                        }}
                        style={s.chip}
                      >
                        <Ionicons name="trash-outline" size={14} color={c.icon} />
                        <Text style={s.chipText}>{vi ? 'Xoá hết' : 'Clear'}</Text>
                      </Tap>
                    )}
                  </View>
                  <TextInput
                    value={shownText}
                    onChangeText={setTextRaw}
                    selection={selection}
                    onSelectionChange={(e) => {
                      sel.current = e.nativeEvent.selection;
                      if (selection) setSelection(undefined);
                    }}
                    multiline
                    autoCorrect={false}
                    autoCapitalize="none"
                    placeholder={
                      vi
                        ? 'Dán lời LRC ([00:12.50] Câu hát…) hoặc gõ lời thường, mỗi câu một dòng.'
                        : 'Paste LRC ([00:12.50] A line…) or type plain lyrics, one line each.'
                    }
                    placeholderTextColor={c.text3}
                    style={s.editor}
                    scrollEnabled
                    accessibilityLabel={vi ? 'Lời bài hát' : 'Lyrics text'}
                  />
                </>
              )}
              <Text style={s.hint}>
                {parsed
                  ? parsed.synced
                    ? untimedCount
                      ? vi
                        ? `${parsed.lines.length} dòng · ${untimedCount} dòng chưa có giờ — vẫn được lưu, tạm xếp giữa hai dòng có giờ`
                        : `${parsed.lines.length} lines · ${untimedCount} not timed yet — kept, placed between their timed neighbours`
                      : vi
                        ? `${parsed.lines.length} dòng · đồng bộ theo thời gian`
                        : `${parsed.lines.length} lines · time-synced`
                    : vi
                      ? `${parsed.lines.length} dòng · chưa có thời gian${isCurrent ? ' — mở “Gắn giờ”, phát nhạc và chạm khi mỗi câu bắt đầu' : ''}`
                      : `${parsed.lines.length} lines · not timed${isCurrent ? ' — open “Timing”, play and tap as each line starts' : ''}`
                  : vi
                    ? 'Lời sẽ được nhớ cho bài này, kể cả khi offline.'
                    : 'Remembered for this song, offline too.'}
              </Text>
            </>
          )}
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
    // fills what is left above the keyboard (a fixed height would push it off the top)
    flex: 1,
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
    marginBottom: 4,
  },
  topBtn: { color: c.text2, fontSize: 16, fontWeight: '600' as const, minWidth: 48 },
  saveBtn: { textAlign: 'right' as const, fontWeight: '800' as const },
  topTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  songRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginVertical: 6,
  },
  art: { width: 58, height: 58, borderRadius: 10 },
  songTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  songArtist: { color: c.text2, fontSize: 13, marginTop: 1 },
  status: { fontSize: 12, fontWeight: '600' as const, marginTop: 3, lineHeight: 16 },
  actions: { gap: 8, paddingHorizontal: 18, paddingVertical: 8 },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: c.field,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { color: c.text, fontSize: 12.5, fontWeight: '700' as const },
  segments: {
    flexDirection: 'row' as const,
    gap: 4,
    padding: 3,
    borderRadius: 13,
    backgroundColor: c.field,
    marginTop: 4,
    marginBottom: 10,
  },
  segment: {
    flex: 1,
    flexDirection: 'row' as const,
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  segmentText: { fontSize: 13, fontWeight: '700' as const },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: c.field,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  searchInput: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 10 },
  list: { flex: 1 },
  empty: { alignItems: 'center' as const, gap: 10, paddingVertical: 30, paddingHorizontal: 16 },
  emptyText: { color: c.text2, fontSize: 13, textAlign: 'center' as const, lineHeight: 18 },
  cand: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 8,
    overflow: 'hidden' as const,
  },
  candHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  srcBadge: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 82 },
  srcText: { fontSize: 10.5, fontWeight: '800' as const },
  candTitle: { color: c.text, fontSize: 14.5, fontWeight: '700' as const },
  candMeta: { color: c.text2, fontSize: 12, marginTop: 1 },
  matchText: { fontSize: 11.5, fontWeight: '800' as const },
  preview: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  previewLine: { color: c.text, fontSize: 13.5, lineHeight: 21, marginTop: 2 },
  previewTime: { color: c.text3, fontSize: 11.5, fontVariant: ['tabular-nums' as const] },
  previewMore: { color: c.text3, fontSize: 12, marginTop: 4 },
  useBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  useBtnText: { fontSize: 14.5, fontWeight: '800' as const },
  modeRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 8 },
  modeBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: c.border,
  },
  modeText: { fontSize: 12.5, fontWeight: '700' as const },
  draftNote: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
  },
  draftText: { flex: 1, color: c.text2, fontSize: 12 },
  draftBtn: { fontSize: 12.5, fontWeight: '800' as const },
  writeTools: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 8 },
  editor: {
    flex: 1,
    color: c.text,
    fontSize: 14,
    lineHeight: 21,
    backgroundColor: c.field,
    borderRadius: 14,
    padding: 12,
    paddingTop: 12,
    textAlignVertical: 'top' as const,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint: { color: c.text3, fontSize: 12, lineHeight: 17, marginTop: 8 },
});
