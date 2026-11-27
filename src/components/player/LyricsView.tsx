// Synchronized Word-by-Word & Line-Synced Glowing Lyrics View — ported from LyricsScreen.kt & LyricsGlowLine.kt

import { PipButton } from './PipButton';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { t } from '../../constants/i18n';
import { LyricsEffect, LyricsPosition, LyricsSize } from '../../constants/preferences';
import { LyricLine, LyricWord } from '../../types/music';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { storedLyricsInfo, useStoredLyrics } from '../../services/lyrics/lyricsStore';
import { openLyricsEditor, providerLabel } from './LyricsEditor';
import { usePositionSec } from '../../services/audio/playbackClock';
import { Tap } from '../ui/Tap';
import { perfCount } from '../../services/perfProbe';
import { useActiveLyricIndex } from '../../services/lyrics/lyricClock';

// a fresh key per lyrics object (re-fetched lyrics re-mount the list, so every line re-measures)
const lyricsKeys = new WeakMap<object, string>();
let lyricsSeq = 0;
function lyricsKey(l: object | null | undefined): string {
  if (!l) return 'none';
  let k = lyricsKeys.get(l);
  if (!k) {
    k = `lyr-${++lyricsSeq}`;
    lyricsKeys.set(l, k);
  }
  return k;
}

export const LyricsView: React.FC = () => {
  perfCount('render:LyricsView');
  const {
    lyrics,
    isLoadingLyrics,
    reloadLyrics,
    currentTrack,
    seekTo,
    darkPalette: palette,
    prefs,
    updatePrefs,
    haptic,
    lyricsOffsetSec,
    nudgeLyricsOffset,
    isPlaying,
    showToast,
    isOnline,
  } = useHolySic();
  const clockIndex = useActiveLyricIndex();
  const vi = prefs.language === 'vi';
  const effect: LyricsEffect = prefs.lyricsEffect || 'glow';
  useStoredLyrics();
  const stored = storedLyricsInfo(currentTrack);
  const openEditor = (tab?: 'search' | 'write') => {
    if (!currentTrack) return;
    haptic('selection');
    openLyricsEditor(currentTrack, tab);
  };
  const size = SIZES[prefs.lyricsSize || 'M'] ?? SIZES.M;

  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  // Follow the singer: the active line glides to ~⅓ from the top, measured from the real line
  // positions (wrapped lines included). Scrolling by hand pauses the follow for a few seconds,
  // like Music, so you can read ahead without being yanked back.
  //
  // Positions are kept per line id and only ever filled by the lines' own layout events — never
  // guessed. (A guess of "index × row height" is what threw the view into the margins: wrapped
  // lines are taller, and re-fetched lyrics with identical rows don't report their layout again.)
  // The list is re-mounted for every new lyrics object, so each one measures itself afresh.
  const lineYs = useRef(new Map<string, number>());
  const viewH = useRef(0);
  const handUntil = useRef(0);
  const pendingFollow = useRef(false);
  // where our own scrollTo is heading — any other movement is the user (finger, wheel, trackpad)
  const autoScroll = useRef({ from: 0, y: 0, until: 0 });
  const lastY = useRef(0);
  const [detached, setDetached] = useState(false);
  const listKey = useMemo(() => lyricsKey(lyrics), [lyrics]);
  // new lyrics: follow as soon as the active line has measured itself. Decided during render (not
  // in an effect) so it can't run after — and wipe — the first layout events. Positions are stored
  // under "<lyrics key>|<line id>", so nothing measured for other lyrics is ever used.
  const seenKey = useRef('');
  if (seenKey.current !== listKey) {
    seenKey.current = listKey;
    pendingFollow.current = true;
    if (lineYs.current.size > 3000) lineYs.current = new Map();
  }

  // plain (untimed) lyrics have no "current line": no highlight, no follow — like Music
  const timed = !!lyrics?.synced;
  const activeLyricIndex = timed ? clockIndex : -1;
  const activeRef = useRef(activeLyricIndex);
  activeRef.current = activeLyricIndex;
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const keyRef = useRef(listKey);
  keyRef.current = listKey;
  const follow = (animated: boolean) => {
    const ls = lyricsRef.current?.lines;
    const idx = activeRef.current;
    if (!ls || !scrollRef.current) return;
    if (idx < 0) {
      // before the first line: the top
      autoScroll.current = { from: lastY.current, y: 0, until: Date.now() + 900 };
      scrollRef.current.scrollTo({ y: 0, animated });
      pendingFollow.current = false;
      return;
    }
    const y = ls[idx] ? lineYs.current.get(`${keyRef.current}|${ls[idx].id}`) : undefined;
    if (y === undefined || viewH.current <= 0) {
      // not measured yet: wait for that line's layout instead of guessing
      pendingFollow.current = true;
      return;
    }
    pendingFollow.current = false;
    const to = Math.max(0, y - viewH.current * 0.3);
    autoScroll.current = { from: lastY.current, y: to, until: Date.now() + 900 };
    scrollRef.current.scrollTo({ y: to, animated });
  };
  useEffect(() => {
    if (!timed && !pendingFollow.current) return;
    if (Date.now() < handUntil.current) return;
    if (detached) setDetached(false);
    follow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLyricIndex]);
  // reading by hand: the "back to the singer" pill shows until the follow resumes
  useEffect(() => {
    if (!detached) return;
    const t = setInterval(() => {
      if (Date.now() >= handUntil.current) {
        setDetached(false);
        follow(true);
      }
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detached]);
  const backToSinger = () => {
    haptic('selection');
    handUntil.current = 0;
    setDetached(false);
    follow(true);
  };

  // stable row callbacks (rows are memoized: a line change re-renders only the rows it touches)
  const rowCtx = useRef({ listKey, seekTo, haptic, lyricsOffsetSec, follow });
  rowCtx.current = { listKey, seekTo, haptic, lyricsOffsetSec, follow };
  const onRowLayout = useCallback((id: string, idx: number, y: number) => {
    lineYs.current.set(`${rowCtx.current.listKey}|${id}`, y);
    // the line we were waiting for has its place now
    if (pendingFollow.current && idx === activeRef.current && Date.now() >= handUntil.current)
      rowCtx.current.follow(false);
  }, []);
  const onRowPress = useCallback((line: LyricLine) => {
    const c = rowCtx.current;
    c.haptic('selection');
    c.seekTo(Math.max(0, line.startSec + c.lyricsOffsetSec));
  }, []);

  const cycleAlign = () => {
    haptic('selection');
    const order: LyricsPosition[] = ['LEFT', 'CENTER', 'RIGHT'];
    const next = order[(order.indexOf(prefs.lyricsPosition) + 1) % order.length];
    updatePrefs({ lyricsPosition: next });
  };

  const cycleEffect = () => {
    haptic('selection');
    const i = LYRICS_EFFECTS.findIndex((e) => e.id === effect);
    const next = LYRICS_EFFECTS[(i + 1) % LYRICS_EFFECTS.length];
    updatePrefs({ lyricsEffect: next.id });
    showToast((vi ? 'Hiệu ứng lời: ' : 'Lyrics effect: ') + (vi ? next.vi : next.en));
  };

  if (isLoadingLyrics) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={[styles.helperText, { fontFamily }]}>
          {t(prefs.language, 'searchingLyrics')}
        </Text>
      </View>
    );
  }

  if (!lyrics || lyrics.lines.length === 0) {
    const live = !!currentTrack?.isLive;
    return (
      <View style={styles.centerBox}>
        <Ionicons
          name={live ? 'radio-outline' : 'musical-notes-outline'}
          size={44}
          color={HOLYSIC_COLORS.textMuted}
        />
        <Text style={[styles.helperText, { fontFamily }]}>
          {live
            ? vi
              ? 'Radio trực tiếp không có lời bài hát'
              : 'Live radio has no lyrics'
            : stored?.kind === 'none'
              ? vi
                ? 'Bạn đã tắt lời cho bài này'
                : 'You turned lyrics off for this song'
              : !isOnline
                ? vi
                  ? 'Đang offline — bài này chưa có lời lưu trên máy. Lời sẽ tự tải khi có mạng.'
                  : 'Offline — no saved lyrics for this song yet. They’ll load when you’re back online.'
                : t(prefs.language, 'noLyrics')}
        </Text>
        {!live && currentTrack && (
          <View style={styles.emptyActions}>
            {stored?.kind !== 'none' && (
              <Tap
                onPress={() => {
                  haptic('light');
                  reloadLyrics();
                }}
                style={[styles.retryBtn, { borderColor: palette.accent + '55' }]}
                accessibilityRole="button"
              >
                <Ionicons name="refresh" size={15} color={palette.accent} />
                <Text style={[styles.retryText, { color: palette.accent }]}>
                  {vi ? 'Tìm lại' : 'Search again'}
                </Text>
              </Tap>
            )}
            <Tap
              onPress={() => openEditor()}
              style={[
                styles.retryBtn,
                { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={15} color={palette.accent} />
              <Text style={[styles.retryText, { color: palette.accent }]}>
                {stored?.kind === 'none'
                  ? vi
                    ? 'Chọn lời'
                    : 'Choose lyrics'
                  : vi
                    ? 'Chọn / nhập lời'
                    : 'Find or write lyrics'}
              </Text>
            </Tap>
          </View>
        )}
      </View>
    );
  }

  const baseAlign =
    prefs.lyricsPosition === 'CENTER'
      ? 'center'
      : prefs.lyricsPosition === 'RIGHT'
        ? 'right'
        : 'left';

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Tap
          onPress={() => openEditor()}
          style={styles.providerBadge}
          accessibilityRole="button"
          accessibilityLabel={vi ? 'Đổi hoặc sửa lời bài hát' : 'Change or edit the lyrics'}
        >
          <Ionicons
            name={
              lyrics.origin === 'override'
                ? 'person-circle-outline'
                : stored?.kind === 'saved' || lyrics.origin === 'saved'
                  ? 'cloud-done-outline'
                  : 'sparkles'
            }
            size={12}
            color={palette.accent}
          />
          <Text numberOfLines={1} style={[styles.providerText, { color: palette.accent }]}>
            {providerLabel(lyrics, vi)}
            {lyrics.wordSynced
              ? vi
                ? ' · Từng chữ'
                : ' · Word'
              : lyrics.synced
                ? ''
                : vi
                  ? ' · Lời thường'
                  : ' · Plain'}
          </Text>
          <Ionicons name="chevron-down" size={11} color={palette.accent} style={{ opacity: 0.8 }} />
        </Tap>

        {lyrics.synced && (
          <View style={styles.offsetGroup}>
            <Tap
              feedback="opacity"
              onPress={() => nudgeLyricsOffset(-500)}
              hitSlop={6}
              style={styles.offsetBtn}
              accessibilityLabel={vi ? 'Lời sớm hơn 0,5 giây' : 'Lyrics 0.5s earlier'}
            >
              <Ionicons name="remove" size={14} color="#FFF" />
            </Tap>
            <Tap
              onPress={() => nudgeLyricsOffset('reset')}
              onLongPress={() => nudgeLyricsOffset('reset')}
              style={styles.offsetLabelWrap}
            >
              <Text
                style={[styles.offsetLabel, lyricsOffsetSec !== 0 && { color: palette.accent }]}
              >
                {lyricsOffsetSec === 0
                  ? vi
                    ? 'Lệch 0s'
                    : 'Sync 0s'
                  : `${lyricsOffsetSec > 0 ? '+' : ''}${lyricsOffsetSec.toFixed(1)}s`}
              </Text>
            </Tap>
            <Tap
              feedback="opacity"
              onPress={() => nudgeLyricsOffset(500)}
              hitSlop={6}
              style={styles.offsetBtn}
              accessibilityLabel={vi ? 'Lời trễ hơn 0,5 giây' : 'Lyrics 0.5s later'}
            >
              <Ionicons name="add" size={14} color="#FFF" />
            </Tap>
          </View>
        )}

        {lyrics.synced && (
          <PipButton size={16} color="#FFF" style={[styles.alignBtn, { marginRight: 6 }]} />
        )}
        <Tap
          onPress={cycleEffect}
          style={[styles.alignBtn, { marginRight: 6 }]}
          accessibilityLabel={vi ? 'Đổi hiệu ứng lời' : 'Change lyrics effect'}
        >
          <Ionicons name="color-wand-outline" size={15} color="#FFF" />
        </Tap>
        <Tap onPress={cycleAlign} style={styles.alignBtn}>
          <Ionicons
            name={
              prefs.lyricsPosition === 'CENTER'
                ? 'Menu' in Ionicons.glyphMap
                  ? 'reorder-three-outline'
                  : 'text-outline'
                : 'reorder-two-outline'
            }
            size={16}
            color="#FFF"
          />
        </Tap>
      </View>

      <ScrollView
        key={listKey}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => {
          const first = viewH.current <= 0;
          viewH.current = e.nativeEvent.layout.height;
          if (first || pendingFollow.current) follow(false);
        }}
        onScrollBeginDrag={() => {
          handUntil.current = Date.now() + 60_000;
          if (!detached) setDetached(true);
        }}
        onScrollEndDrag={() => (handUntil.current = Date.now() + 4000)}
        onMomentumScrollEnd={() => {
          if (handUntil.current > Date.now() + 4000) handUntil.current = Date.now() + 4000;
        }}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          lastY.current = y;
          const a = autoScroll.current;
          // our own glide: somewhere between where it started and where it is heading
          const onPath =
            Date.now() < a.until &&
            y >= Math.min(a.from, a.y) - 6 &&
            y <= Math.max(a.from, a.y) + 6;
          if (onPath || Math.abs(y - a.y) < 6) return;
          // moved by hand (also wheel / trackpad, which send no drag events)
          handUntil.current = Math.max(handUntil.current, Date.now() + 4000);
          a.y = y;
          a.until = 0;
          if (!detached) setDetached(true);
        }}
        scrollEventThrottle={32}
      >
        {!timed && (
          <Tap
            onPress={() => openEditor('write')}
            style={[styles.plainNote, { borderColor: palette.accent + '44' }]}
            accessibilityRole="button"
          >
            <Ionicons name="timer-outline" size={16} color={palette.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.plainNoteTitle}>
                {vi ? 'Lời chưa có thời gian' : 'These lyrics aren’t timed'}
              </Text>
              <Text style={styles.plainNoteText}>
                {vi
                  ? 'Chạm để tìm bản đồng bộ hoặc tự gắn giờ khi nghe.'
                  : 'Tap to find a synced version or time them as you listen.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.5)" />
          </Tap>
        )}
        {lyrics.lines.map((line, idx) => {
          const isActive = idx === activeLyricIndex;
          const isPast = idx < activeLyricIndex;
          const dist = activeLyricIndex < 0 ? 3 : Math.abs(idx - activeLyricIndex);
          if (!timed) {
            return (
              <Text
                key={line.id}
                style={[
                  styles.plainLine,
                  { fontSize: size.font * 0.8, lineHeight: size.line * 0.8 },
                  { textAlign: baseAlign, fontFamily },
                ]}
                selectable
              >
                {line.text}
              </Text>
            );
          }
          return (
            <LyricRow
              key={line.id}
              line={line}
              idx={idx}
              isActive={isActive}
              isPast={isPast}
              dist={effect === 'depth' ? Math.min(dist, 6) : 0}
              endSec={line.endSec ?? lyrics.lines[idx + 1]?.startSec}
              effect={effect}
              accent={palette.accent}
              offset={lyricsOffsetSec}
              playing={isActive ? isPlaying : false}
              baseAlign={baseAlign}
              fontFamily={fontFamily}
              font={size.font}
              lineH={size.line}
              onRowLayout={onRowLayout}
              onRowPress={onRowPress}
            />
          );
        })}

        <Text style={styles.footerText}>
          {lyrics.provider === 'Local'
            ? 'Lyrics from the song file (.lrc / embedded tags) · HolySic'
            : lyrics.provider === 'User'
              ? vi
                ? 'Lời do bạn nhập · lưu trên máy này'
                : 'Your own lyrics · saved on this device'
              : `Lyrics powered by ${lyrics.provider} · HolySic Open Lyrics`}
        </Text>
      </ScrollView>
      {detached && lyrics.synced && activeLyricIndex >= 0 && (
        <Tap
          onPress={backToSinger}
          style={[styles.backPill, { borderColor: palette.accent + '66' }]}
          accessibilityRole="button"
          accessibilityLabel={vi ? 'Về dòng đang hát' : 'Back to the current line'}
        >
          <Ionicons name="locate" size={14} color={palette.accent} />
          <Text style={[styles.backPillText, { color: palette.accent }]}>
            {vi ? 'Dòng đang hát' : 'Current line'}
          </Text>
        </Tap>
      )}
    </View>
  );
};

// ---------------------------------------------------------------- effects

export const LYRICS_EFFECTS: {
  id: LyricsEffect;
  vi: string;
  en: string;
  descVi: string;
  descEn: string;
}[] = [
  {
    id: 'glow',
    vi: 'Toả sáng',
    en: 'Glow',
    descVi: 'Câu đang hát phóng to, sáng theo màu nhấn',
    descEn: 'The sung line zooms in and glows in the accent colour',
  },
  {
    id: 'karaoke',
    vi: 'Karaoke',
    en: 'Karaoke',
    descVi: 'Từng chữ được tô màu dần theo giọng hát',
    descEn: 'Each word fills with colour as it is sung',
  },
  {
    id: 'wave',
    vi: 'Nhảy chữ',
    en: 'Bounce',
    descVi: 'Chữ nảy nhẹ lên đúng lúc được hát',
    descEn: 'Words hop gently as they are sung',
  },
  {
    id: 'depth',
    vi: 'Chiều sâu',
    en: 'Depth',
    descVi: 'Câu xa mờ dần, như Apple Music',
    descEn: 'Lines fade with distance, Apple Music style',
  },
  {
    id: 'neon',
    vi: 'Neon',
    en: 'Neon',
    descVi: 'Chữ phát sáng rực như đèn neon',
    descEn: 'A bright neon-sign glow',
  },
  {
    id: 'minimal',
    vi: 'Tối giản',
    en: 'Minimal',
    descVi: 'Không hiệu ứng, chỉ đậm nhạt — dễ đọc nhất',
    descEn: 'No effects, just bright and dim — easiest to read',
  },
];

const SIZES: Record<LyricsSize, { font: number; line: number }> = {
  S: { font: 21, line: 30 },
  M: { font: 25, line: 35 },
  L: { font: 30, line: 41 },
};

const DEPTH_OPACITY = [1, 0.5, 0.32, 0.2, 0.13];

/** How a line looks for an effect: its colour/glow, scale and opacity (scale & opacity animate) */
function lineLook(
  effect: LyricsEffect,
  accent: string,
  active: boolean,
  past: boolean,
  dist: number
): { text: TextStyle; scale: number; opacity: number } {
  const dim = past ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.52)';
  switch (effect) {
    case 'depth':
      return {
        text: active
          ? { color: '#FFFFFF', textShadowColor: 'rgba(255,255,255,0.35)', textShadowRadius: 10 }
          : { color: '#FFFFFF' },
        scale: active ? 1 : Math.max(0.84, 0.93 - dist * 0.02),
        opacity: DEPTH_OPACITY[Math.min(dist, DEPTH_OPACITY.length - 1)],
      };
    case 'neon':
      return {
        text: active
          ? { color: '#FFFFFF', textShadowColor: accent, textShadowRadius: 20 }
          : { color: accent + (past ? '55' : '80') },
        scale: active ? 1 : 0.9,
        opacity: 1,
      };
    case 'minimal':
      return {
        text: {
          color: active ? '#FFFFFF' : past ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.4)',
        },
        scale: 1,
        opacity: 1,
      };
    default:
      return {
        text: active
          ? { color: '#FFFFFF', textShadowColor: accent + '88', textShadowRadius: 14 }
          : { color: dim },
        scale: active ? 1 : 0.88,
        opacity: 1,
      };
  }
}

/** A line without word timing gets estimated word starts (by syllable-ish length) so karaoke and
 *  bounce still flow through it; real word timing is always preferred. */
function estimateWords(line: LyricLine, endSec?: number): LyricWord[] {
  const parts = line.text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const span = Math.min(12, Math.max(0.8, (endSec ?? line.startSec + 4) - line.startSec));
  const dur = span * 0.82;
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  let acc = 0;
  return parts.map((p) => {
    const start = line.startSec + (dur * acc) / total;
    acc += p.length + 1;
    return { text: p, startSec: start, endSec: line.startSec + (dur * acc) / total };
  });
}

/** How many words are lit. Position arrives ~4×/s; between updates each next word is lit by a
 *  timer at its exact start, so words land on time without re-rendering every frame. */
function useLitCount(words: LyricWord[], offset: number, playing: boolean): number {
  const pos = usePositionSec();
  const t = pos - offset + 0.08;
  let base = 0;
  while (base < words.length && words[base].startSec <= t) base++;
  const [extra, setExtra] = useState<{ at: number; n: number }>({ at: -1, n: 0 });
  useEffect(() => {
    if (!playing) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = base; i < words.length; i++) {
      const ms = (words[i].startSec - t) * 1000;
      if (ms > 450) break;
      const n = i - base + 1;
      timers.push(setTimeout(() => setExtra({ at: pos, n }), Math.max(0, ms)));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, playing, words]);
  return Math.min(words.length, base + (extra.at === pos ? extra.n : 0));
}

const ActiveLine: React.FC<{
  line: LyricLine;
  endSec?: number;
  effect: LyricsEffect;
  accent: string;
  offset: number;
  playing: boolean;
  textStyle: any;
  align: 'left' | 'center' | 'right';
  gap: number;
}> = (p) => {
  const flowing = p.effect === 'karaoke' || p.effect === 'wave';
  const hasWords = !!p.line.words && p.line.words.length > 0;
  if (!hasWords && !flowing) {
    const look = lineLook(p.effect, p.accent, true, false, 0);
    return <Text style={[p.textStyle, look.text]}>{p.line.text}</Text>;
  }
  return <ActiveWords {...p} />;
};

const ActiveWords: React.FC<React.ComponentProps<typeof ActiveLine>> = ({
  line,
  endSec,
  effect,
  accent,
  offset,
  playing,
  textStyle,
  align,
  gap,
}) => {
  const words = useMemo(
    () => (line.words && line.words.length ? line.words : estimateWords(line, endSec)),
    [line, endSec]
  );
  const lit = useLitCount(words, offset, playing);

  if (effect === 'karaoke' || effect === 'wave') {
    return (
      <View
        style={[
          styles.wordRow,
          {
            justifyContent:
              align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        {words.map((w, i) => (
          <FlowWord
            key={i}
            text={w.text}
            lit={i < lit}
            ms={Math.max(120, Math.min(700, (w.endSec - w.startSec) * 1000))}
            effect={effect}
            accent={accent}
            textStyle={textStyle}
            gap={gap}
          />
        ))}
      </View>
    );
  }

  // glow / depth / neon / minimal with real word timing: lit words light up in place
  const on: TextStyle =
    effect === 'minimal'
      ? { color: '#FFFFFF' }
      : effect === 'neon'
        ? { color: '#FFFFFF', textShadowColor: accent, textShadowRadius: 20 }
        : { color: '#FFFFFF', textShadowColor: accent, textShadowRadius: 12 };
  const off: TextStyle = {
    color: effect === 'neon' ? accent + '99' : 'rgba(255,255,255,0.38)',
    textShadowColor: 'transparent',
    textShadowRadius: 0,
  };
  return (
    <Text style={textStyle}>
      {words.map((w, i) => (
        <Text key={i} style={i < lit ? on : off}>
          {w.text}
          {i < words.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
};

/** One word of a karaoke / bounce line: the lit copy fades in over the word's own duration
 *  (karaoke) or the word hops (bounce). Native-driven opacity / transform only. */
const FlowWord: React.FC<{
  text: string;
  lit: boolean;
  ms: number;
  effect: 'karaoke' | 'wave';
  accent: string;
  textStyle: any;
  gap: number;
}> = React.memo(({ text, lit, ms, effect, accent, textStyle, gap }) => {
  const v = useRef(new Animated.Value(lit ? 1 : 0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!lit) {
      Animated.timing(v, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(v, {
      toValue: 1,
      duration: effect === 'karaoke' ? ms : 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    if (effect === 'wave') {
      hop.setValue(0);
      Animated.sequence([
        Animated.timing(hop, {
          toValue: 1,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(hop, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 10 }),
      ]).start();
    }
  }, [lit, ms, effect, v, hop]);
  const litColor = effect === 'karaoke' ? accent : '#FFFFFF';
  return (
    <Animated.View
      style={[
        { marginRight: gap },
        effect === 'wave' && {
          transform: [
            { translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
            { scale: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
          ],
        },
      ]}
    >
      <Text style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.4)' }]}>{text}</Text>
      <Animated.Text
        style={[
          textStyle,
          styles.wordText,
          styles.wordLit,
          {
            color: litColor,
            opacity: v,
            textShadowColor: effect === 'karaoke' ? accent + 'AA' : accent + '88',
            textShadowRadius: 12,
          },
        ]}
      >
        {text}
      </Animated.Text>
    </Animated.View>
  );
});

/** Lines settle to their effect's scale / opacity (no font-size jump, so the page never
 *  reflows), anchored on the side the text is aligned to. */
/** One timed line. Memoized: only rows whose look changes re-render on a line switch. */
const LyricRow: React.FC<{
  line: LyricLine;
  idx: number;
  isActive: boolean;
  isPast: boolean;
  dist: number;
  endSec?: number;
  effect: LyricsEffect;
  accent: string;
  offset: number;
  playing: boolean;
  baseAlign: 'left' | 'center' | 'right';
  fontFamily: string | undefined;
  font: number;
  lineH: number;
  onRowLayout: (id: string, idx: number, y: number) => void;
  onRowPress: (line: LyricLine) => void;
}> = React.memo(
  ({
    line,
    idx,
    isActive,
    isPast,
    dist,
    endSec,
    effect,
    accent,
    offset,
    playing,
    baseAlign,
    fontFamily,
    font,
    lineH,
    onRowLayout,
    onRowPress,
  }) => {
    const isDuetV2 = line.agent && line.agent.toLowerCase().includes('2');
    const textAlign = line.isBackground ? 'center' : isDuetV2 ? 'right' : baseAlign;
    const look = lineLook(effect, accent, isActive, isPast, dist);
    const textStyle: TextStyle = line.isBackground
      ? styles.bgLineText
      : {
          fontSize: font,
          lineHeight: lineH,
          fontWeight: effect === 'minimal' ? '700' : '800',
        };

    return (
      <Tap
        feedback="opacity"
        onLayout={(e) => onRowLayout(line.id, idx, e.nativeEvent.layout.y)}
        onPress={() => onRowPress(line)}
        style={[
          styles.lineWrap,
          isActive &&
            (effect === 'glow' || effect === 'karaoke' || effect === 'wave') && {
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderRadius: 16,
            },
        ]}
      >
        <LineScale
          scale={look.scale}
          opacity={look.opacity}
          origin={textAlign === 'center' ? 'center' : textAlign === 'right' ? 'right' : 'left'}
        >
          {isActive && !line.isBackground ? (
            <ActiveLine
              line={line}
              endSec={endSec}
              effect={effect}
              accent={accent}
              offset={offset}
              playing={playing}
              textStyle={[textStyle, { textAlign, fontFamily }]}
              align={textAlign}
              gap={font * 0.27}
            />
          ) : (
            <Text style={[textStyle, look.text, { textAlign, fontFamily }]}>{line.text}</Text>
          )}
        </LineScale>
      </Tap>
    );
  }
);

const LineScale: React.FC<{
  scale: number;
  opacity: number;
  origin: 'left' | 'center' | 'right';
  children: React.ReactNode;
}> = ({ scale, opacity, origin, children }) => {
  const s = useRef(new Animated.Value(scale)).current;
  const o = useRef(new Animated.Value(opacity)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(s, { toValue: scale, useNativeDriver: true, speed: 20, bounciness: 3 }),
      Animated.timing(o, {
        toValue: opacity,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity, s, o]);
  return (
    <Animated.View style={{ transformOrigin: origin, opacity: o, transform: [{ scale: s }] }}>
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backPill: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(12,12,18,0.82)',
  },
  backPillText: { fontSize: 13, fontWeight: '700' },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  helperText: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: { fontSize: 13.5, fontWeight: '700' },
  plainLine: {
    color: 'rgba(255,255,255,0.88)',
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  plainNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  plainNoteTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  plainNoteText: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: 1 },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  providerBadge: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  providerText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: '700',
  },
  offsetGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 8,
    marginRight: 8,
  },
  offsetBtn: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center' },
  offsetLabelWrap: { paddingHorizontal: 2 },
  offsetLabel: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '800',
    minWidth: 46,
    textAlign: 'center',
  },
  alignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    paddingVertical: 20,
    paddingHorizontal: 8,
    paddingBottom: 90,
  },
  lineWrap: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginVertical: 2,
  },
  // one size for every line — the active one is scaled, not re-laid-out
  lineText: {
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 35,
  },
  lineTextActive: {
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 35,
  },
  bgLineText: {
    fontSize: 16.5,
    fontStyle: 'italic',
    fontWeight: '600',
    lineHeight: 24,
  },
  wordRow: { flexDirection: 'row', flexWrap: 'wrap' },
  // the word box sizes to the word; lines keep their height
  wordText: { textAlign: 'left' },
  wordLit: { position: 'absolute', left: 0, top: 0 },
  footerText: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 28,
  },
});
