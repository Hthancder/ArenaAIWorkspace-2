// Synchronized Word-by-Word & Line-Synced Glowing Lyrics View — ported from LyricsScreen.kt & LyricsGlowLine.kt

import { PipButton } from './PipButton';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
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
import { PlaybackClock } from '../../services/audio/playbackClock';
import { AppActivity } from '../../services/appActivity';
import { luminance, spectrumColor } from '../../theme/colorMath';
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
  {
    id: 'focus',
    vi: 'Lấy nét',
    en: 'Focus',
    descVi: 'Chữ mờ nhoè rồi nét dần đúng lúc được hát, như máy quay lấy nét',
    descEn: 'Words sit out of focus and pull sharp as they are sung, like a camera',
  },
  {
    id: 'typewriter',
    vi: 'Gõ chữ',
    en: 'Typewriter',
    descVi: 'Từng ký tự hiện ra theo giọng hát, con trỏ chạy theo',
    descEn: 'Letters type out with the voice, a cursor running ahead',
  },
  {
    id: 'marker',
    vi: 'Bút dạ quang',
    en: 'Highlighter',
    descVi: 'Một nét bút màu nhấn quét dưới chữ theo giọng hát',
    descEn: 'An accent-colour marker sweeps under the words as they are sung',
  },
  {
    id: 'glitch',
    vi: 'Lệch màu',
    en: 'Glitch',
    descVi: 'Chữ chưa hát tách lớp đỏ–xanh, khớp lại khi được hát',
    descEn: 'Unsung words split into red and cyan, snapping together when sung',
  },
  {
    id: 'dissolve',
    vi: 'Tan biến',
    en: 'Dissolve',
    descVi: 'Chữ bừng sáng khi được hát rồi tan thành bụi sáng, bay đi',
    descEn: 'Words light up as they are sung, then crumble into glowing dust and drift away',
  },
  {
    id: 'bloom',
    vi: 'Bừng nở',
    en: 'Bloom',
    descVi: 'Chữ bật nở khi được hát, một vầng sáng màu nhấn lan toả ra',
    descEn: 'Words pop open as they are sung, a ring of accent light spreading out',
  },
  {
    id: 'spectrum',
    vi: 'Sắc màu',
    en: 'Spectrum',
    descVi: 'Mỗi chữ một sắc cầu vồng bắt đầu từ màu nhấn, tô dần theo giọng hát',
    descEn: 'Every word its own rainbow hue, starting from the accent, filling with the voice',
  },
  {
    id: 'rain',
    vi: 'Mưa chữ',
    en: 'Rain',
    descVi: 'Chữ rơi từ trên xuống và nảy nhẹ đúng lúc được hát',
    descEn: 'Words fall into place and bounce as they are sung',
  },
  {
    id: 'lift',
    vi: 'Nâng chữ',
    en: 'Lift',
    descVi: 'Chữ sáng dần và nhích lên theo giọng hát, kiểu Apple Music',
    descEn: 'Words brighten and rise slightly with the voice, Apple Music style',
  },
];

/** effects that run word by word (estimated timing when the lyrics have none) */
// Reduce Motion: words still light up, but nothing hops, jolts or scales
let calm = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => (calm = v))
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (calm = v));

const FLOWING: LyricsEffect[] = [
  'karaoke',
  'wave',
  'focus',
  'typewriter',
  'marker',
  'glitch',
  'dissolve',
  'bloom',
  'spectrum',
  'rain',
  'lift',
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
    case 'focus':
      // the other lines stay soft (a halo of their own colour), the sung one is crisp
      return {
        text: active
          ? { color: '#FFFFFF' }
          : {
              color: past ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.36)',
              textShadowColor: 'rgba(255,255,255,0.4)',
              textShadowRadius: 7,
            },
        scale: active ? 1 : 0.92,
        opacity: 1,
      };
    case 'typewriter':
      // paper and ink: no zoom, typed lines stay, lines ahead are faint
      return {
        text: {
          color: active ? '#FFFFFF' : past ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.2)',
        },
        scale: 1,
        opacity: 1,
      };
    case 'glitch':
      return {
        text: active ? { color: '#FFFFFF' } : { color: dim },
        scale: active ? 1 : 0.9,
        opacity: 1,
      };
    case 'dissolve':
      // sung lines are gone (a faint trace), the ones ahead wait
      return {
        text: {
          color: active ? '#FFFFFF' : past ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.5)',
        },
        scale: active ? 1 : 0.92,
        opacity: 1,
      };
    case 'rain':
      return {
        text: {
          color: active ? '#FFFFFF' : past ? 'rgba(255,255,255,0.36)' : 'rgba(255,255,255,0.26)',
        },
        scale: active ? 1 : 0.92,
        opacity: 1,
      };
    case 'lift':
      return {
        text: active
          ? { color: '#FFFFFF', textShadowColor: 'rgba(255,255,255,0.4)', textShadowRadius: 10 }
          : { color: past ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.4)' },
        scale: active ? 1 : 0.94,
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

/** How many words are lit — re-renders only when that number changes. The clock reports ~4×/s;
 *  between reports one timer wakes at the next word's exact start. (It used to re-render the whole
 *  line on every clock report and re-arm a timer per upcoming word.) */
function useLitCount(words: LyricWord[], offset: number, playing: boolean): number {
  const count = useCallback(() => {
    const t = PlaybackClock.now(playing) - offset + 0.08;
    let n = 0;
    while (n < words.length && words[n].startSec <= t) n++;
    return n;
  }, [words, offset, playing]);
  const [lit, setLit] = useState(count);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      // off screen: nothing to draw (the catch-up runs when the app comes back)
      if (!AppActivity.isActive()) return;
      const n = count();
      setLit(n); // same number: React skips the render
      if (!playing || n >= words.length) return;
      const ms = (words[n].startSec - (PlaybackClock.now(true) - offset + 0.08)) * 1000;
      timer = setTimeout(update, Math.max(16, Math.min(1000, ms)));
    };
    update();
    const a = PlaybackClock.subscribe(update);
    const b = AppActivity.subscribe(update);
    return () => {
      if (timer) clearTimeout(timer);
      a();
      b();
    };
  }, [count, playing, offset, words]);
  return lit;
}

/** Animated.Value made once (useRef(new …) builds — and throws away — one per render) */
function useAnim(init: number): Animated.Value {
  const r = useRef<Animated.Value | null>(null);
  if (!r.current) r.current = new Animated.Value(init);
  return r.current;
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
  const flowing = FLOWING.includes(p.effect);
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
  perfCount('render:ActiveWords');
  const words = useMemo(
    () => (line.words && line.words.length ? line.words : estimateWords(line, endSec)),
    [line, endSec]
  );
  const lit = useLitCount(words, offset, playing);
  // lyrics time when this line appeared: words finished well before it skip their entrance
  const [shownAt] = useState(() => PlaybackClock.now(playing) - offset);

  if (effect === 'typewriter') {
    return (
      <TypeLine
        words={words}
        offset={offset}
        playing={playing}
        textStyle={textStyle}
        accent={accent}
      />
    );
  }

  if (isFlowFx(effect)) {
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
            tint={effect === 'spectrum' ? spectrumColor(accent, i) : accent}
            seed={i}
            settled={w.endSec + 0.4 < shownAt}
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

/** Typewriter: the sung part of the line is typed out letter by letter, a block cursor sits on
 *  the next letter. Unsung letters keep their place (ghosted), so the line never reflows. Only
 *  the one active line re-renders, ~20×/s while playing. */
const TypeLine: React.FC<{
  words: LyricWord[];
  offset: number;
  playing: boolean;
  textStyle: any;
  accent: string;
}> = ({ words, offset, playing, textStyle, accent }) => {
  perfCount('render:TypeLine');
  const full = useMemo(() => words.map((w) => w.text).join(' '), [words]);
  const typed = useCallback(() => {
    const t = PlaybackClock.now(playing) - offset + 0.08;
    let shown = 0;
    let pos = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const span = Math.max(0.12, w.endSec - w.startSec);
      const f = Math.max(0, Math.min(1, (t - w.startSec) / span));
      if (f <= 0) break;
      shown = pos + Math.ceil(w.text.length * f);
      pos += w.text.length + 1;
      if (f < 1) break;
      shown = Math.min(full.length, pos); // the space after a finished word
    }
    return shown;
  }, [words, offset, playing, full]);
  // checked 20×/s, but the line only re-renders when another letter is typed
  const [shown, setShown] = useState(typed);
  useEffect(() => {
    const update = () => {
      if (AppActivity.isActive()) setShown(typed());
    };
    update();
    const unsub = PlaybackClock.subscribe(update);
    if (!playing) return unsub;
    const id = setInterval(update, 50);
    return () => {
      clearInterval(id);
      unsub();
    };
  }, [typed, playing]);
  const done = shown >= full.length;
  const ink = luminance(accent) > 0.55 ? '#111116' : '#FFFFFF';
  return (
    <Text style={textStyle}>
      <Text style={{ color: '#FFFFFF' }}>{full.slice(0, shown)}</Text>
      {!done && <Text style={{ color: ink, backgroundColor: accent }}>{full.charAt(shown)}</Text>}
      {!done && <Text style={{ color: 'rgba(255,255,255,0.16)' }}>{full.slice(shown + 1)}</Text>}
    </Text>
  );
};

type FlowFx =
  | 'karaoke'
  | 'wave'
  | 'focus'
  | 'marker'
  | 'glitch'
  | 'dissolve'
  | 'bloom'
  | 'spectrum'
  | 'rain'
  | 'lift';
const FLOW_FX = new Set<string>([
  'karaoke',
  'wave',
  'focus',
  'marker',
  'glitch',
  'dissolve',
  'bloom',
  'spectrum',
  'rain',
  'lift',
]);
const isFlowFx = (e: LyricsEffect): e is FlowFx => FLOW_FX.has(e);

/** how long the lit copy takes to come in, per effect (karaoke-like fills use the word's length) */
function litMs(effect: FlowFx, ms: number): number {
  switch (effect) {
    case 'karaoke':
    case 'marker':
    case 'spectrum':
    case 'lift':
      return ms;
    case 'focus':
      return 280;
    case 'glitch':
      return 220;
    case 'rain':
      return 200;
    case 'dissolve':
      return 180;
    default:
      return 160;
  }
}

/** dust specks of a dissolving word: where they start (% across the word) and where they fly */
const DUST = [
  { x: 12, dx: -9, dy: 20, r: 3, accent: true },
  { x: 34, dx: 4, dy: 30, r: 2.5, accent: false },
  { x: 58, dx: -3, dy: 24, r: 3.5, accent: true },
  { x: 80, dx: 10, dy: 32, r: 2.5, accent: false },
  { x: 46, dx: 7, dy: 16, r: 2, accent: false },
];

const IN = { inputRange: [0, 1], extrapolate: 'clamp' as const };

/** One word of a word-by-word line. Native-driven opacity / transform only — every moving part is
 *  an interpolation of one or two values, built once per word (not on each render):
 *  karaoke   the lit copy fades in over the word's own duration
 *  wave      the word hops
 *  focus     a soft, haloed copy pulls into a crisp one
 *  marker    an accent band sweeps under the word over its duration
 *  glitch    red / cyan copies split off the unsung word snap back with a short jolt
 *  dissolve  lights up, holds, then blurs out and crumbles into specks of light that drift up
 *  bloom     pops open while an accent copy of the word spreads out and fades, like a ripple
 *  spectrum  fills with its own hue of a rainbow that starts at the accent
 *  rain      drops in from above and lands with a little bounce
 *  lift      brightens and rises a hair over its duration (Apple Music style) */
const FlowWord: React.FC<{
  text: string;
  lit: boolean;
  ms: number;
  effect: FlowFx;
  accent: string;
  /** this word's colour (the spectrum hue; the accent otherwise) */
  tint: string;
  /** the word's index (varies the dust) */
  seed: number;
  /** already sung (and over) when the line appeared: shown in its final state, no entrance */
  settled: boolean;
  textStyle: any;
  gap: number;
}> = React.memo(({ text, lit, ms, effect, accent, tint, seed, settled, textStyle, gap }) => {
  const done = settled && lit;
  const v = useAnim(done ? 1 : 0);
  const hop = useAnim(0);
  // dissolve: 0 → 1 as the word falls apart; bloom: the ripple
  const d = useAnim(done && effect === 'dissolve' ? 1 : 0);
  const fs: number = (StyleSheet.flatten(textStyle)?.fontSize as number) || 25;

  // a word long sung when the line appears (opened mid-line, a seek) just sits in its final
  // state — no burst of every earlier word replaying its entrance at once
  const fresh = useRef(true);
  const doneRef = useRef(done);
  useEffect(() => {
    const anims: Animated.CompositeAnimation[] = [];
    const run = (a: Animated.CompositeAnimation) => {
      anims.push(a);
      a.start();
    };
    if (fresh.current) {
      fresh.current = false;
      if (doneRef.current) return;
    }
    if (!lit) {
      d.stopAnimation();
      d.setValue(0);
      hop.setValue(0);
      run(Animated.timing(v, { toValue: 0, duration: 140, useNativeDriver: true }));
      return () => anims.forEach((a) => a.stop());
    }
    run(
      Animated.timing(v, {
        toValue: 1,
        duration: litMs(effect, ms),
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    if (effect === 'dissolve') {
      // stays lit while it is sung (+ a beat), then falls apart
      d.setValue(0);
      run(
        Animated.timing(d, {
          toValue: 1,
          delay: ms + 380,
          duration: calm ? 600 : 1000,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      );
      return () => anims.forEach((a) => a.stop());
    }
    if (effect === 'bloom') {
      d.setValue(0);
      run(
        Animated.timing(d, {
          toValue: 1,
          duration: 720,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );
    }
    if (calm) return () => anims.forEach((a) => a.stop());
    if (effect === 'wave' || effect === 'bloom' || effect === 'spectrum') {
      hop.setValue(0);
      run(
        Animated.sequence([
          Animated.timing(hop, {
            toValue: 1,
            duration: effect === 'wave' ? 130 : 110,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(hop, {
            toValue: 0,
            useNativeDriver: true,
            speed: 14,
            bounciness: effect === 'bloom' ? 12 : 10,
          }),
        ])
      );
    } else if (effect === 'rain') {
      // from above, landing with a bounce (the spring overshoots below the line and back)
      hop.setValue(1);
      run(Animated.spring(hop, { toValue: 0, useNativeDriver: true, speed: 11, bounciness: 13 }));
    } else if (effect === 'glitch') {
      // a few frames of jolt as the layers lock together
      hop.setValue(0);
      run(
        Animated.sequence(
          [1, -0.7, 0.45, -0.2, 0].map((x) =>
            Animated.timing(hop, { toValue: x, duration: 36, useNativeDriver: true })
          )
        )
      );
    }
    return () => anims.forEach((a) => a.stop());
  }, [lit, ms, effect, v, hop, d]);

  // interpolation nodes, built once per word / effect
  const n = useMemo(() => {
    const off = v.interpolate({ ...IN, outputRange: [1, 0] });
    switch (effect) {
      case 'glitch': {
        const split = off;
        return {
          off,
          splitOpacity: Animated.multiply(split, 0.6),
          splitL: Animated.multiply(split, -2.5),
          splitR: Animated.multiply(split, 2.5),
          jolt: hop.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }),
        };
      }
      case 'dissolve':
        return {
          dustXY: DUST.map((p, k) => {
            // each word scatters a little differently
            const flip = (seed + k) % 2 ? 1 : -1;
            return {
              x: d.interpolate({ ...IN, outputRange: [0, p.dx * flip] }),
              y: d.interpolate({
                ...IN,
                outputRange: [0, -(p.dy + ((seed * 7 + k * 5) % 9)) * (fs / 25)],
              }),
            };
          }),
          dustScale: d.interpolate({ ...IN, outputRange: [0.6, 0.2] }),
          // the unsung word, then (once gone) a faint trace so the line keeps its shape
          base: Animated.add(off, d.interpolate({ ...IN, outputRange: [0, 0.28] })),
          crisp: Animated.multiply(
            v,
            d.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [1, 0.2, 0],
              extrapolate: 'clamp',
            })
          ),
          halo: d.interpolate({
            inputRange: [0, 0.35, 1],
            outputRange: [0, 0.9, 0],
            extrapolate: 'clamp',
          }),
          rise: d.interpolate({ ...IN, outputRange: [0, calm ? 0 : -fs * 0.22] }),
          grow: d.interpolate({ ...IN, outputRange: [1, calm ? 1 : 1.07] }),
          dust: d.interpolate({
            inputRange: [0, 0.12, 0.7, 1],
            outputRange: [0, 1, 0.65, 0],
            extrapolate: 'clamp',
          }),
        };
      case 'bloom':
        return {
          off,
          pop: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }),
          ripple: d.interpolate({
            inputRange: [0, 0.1, 1],
            outputRange: [0, 0.5, 0],
            extrapolate: 'clamp',
          }),
          rippleScale: d.interpolate({ ...IN, outputRange: [1, calm ? 1 : 1.45] }),
        };
      case 'rain':
        return { off, drop: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -fs * 0.8] }) };
      case 'lift':
        return { off, lift: v.interpolate({ ...IN, outputRange: [0, calm ? 0 : -fs * 0.1] }) };
      case 'spectrum':
        return {
          off,
          lift: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
          pop: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }),
        };
      case 'focus':
        return {
          off,
          scale: v.interpolate({ ...IN, outputRange: [calm ? 1 : 0.96, 1] }),
        };
      case 'wave':
        return {
          off,
          hopY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }),
          hopS: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
        };
      default:
        return { off };
    }
  }, [effect, v, hop, d, fs, seed]) as Record<string, any>;

  if (effect === 'focus') {
    return (
      <Animated.View style={{ marginRight: gap, transform: [{ scale: n.scale }] }}>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            {
              color: 'rgba(255,255,255,0.3)',
              textShadowColor: 'rgba(255,255,255,0.75)',
              textShadowRadius: 9,
              opacity: n.off,
            },
            // the web can really blur
            Platform.OS === 'web' && ({ filter: 'blur(2.5px)' } as any),
          ]}
        >
          {text}
        </Animated.Text>
        <Animated.Text
          style={[textStyle, styles.wordText, styles.wordLit, { color: '#FFFFFF', opacity: v }]}
        >
          {text}
        </Animated.Text>
      </Animated.View>
    );
  }

  if (effect === 'marker') {
    const ink = luminance(accent) > 0.55 ? '#111116' : '#FFFFFF';
    return (
      // the band runs on under the space, so a sung phrase reads as one stroke
      <View style={{ paddingRight: gap }}>
        <Animated.View
          style={[
            styles.markerBand,
            { backgroundColor: accent, transformOrigin: 'left', transform: [{ scaleX: v }] },
          ]}
        />
        <Text style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.42)' }]}>
          {text}
        </Text>
        <Animated.Text
          style={[textStyle, styles.wordText, styles.wordLit, { color: ink, opacity: v }]}
        >
          {text}
        </Animated.Text>
      </View>
    );
  }

  if (effect === 'glitch') {
    return (
      <Animated.View style={{ marginRight: gap, transform: [{ translateX: n.jolt }] }}>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            { color: '#FF2D55', opacity: n.splitOpacity, transform: [{ translateX: n.splitL }] },
          ]}
        >
          {text}
        </Animated.Text>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            { color: '#22E4FF', opacity: n.splitOpacity, transform: [{ translateX: n.splitR }] },
          ]}
        >
          {text}
        </Animated.Text>
        <Text style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.5)' }]}>{text}</Text>
        <Animated.Text
          style={[textStyle, styles.wordText, styles.wordLit, { color: '#FFFFFF', opacity: v }]}
        >
          {text}
        </Animated.Text>
      </Animated.View>
    );
  }

  if (effect === 'dissolve') {
    const moving = { transform: [{ translateY: n.rise }, { scale: n.grow }] };
    return (
      <View style={{ marginRight: gap }}>
        <Animated.Text
          style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.5)', opacity: n.base }]}
        >
          {text}
        </Animated.Text>
        {/* breaking up: a soft, glowing copy takes over from the crisp one, then fades */}
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            moving,
            {
              color: 'rgba(255,255,255,0.4)',
              textShadowColor: tint,
              textShadowRadius: 16,
              opacity: n.halo,
            },
            Platform.OS === 'web' && ({ filter: 'blur(3px)' } as any),
          ]}
        >
          {text}
        </Animated.Text>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            moving,
            {
              color: '#FFFFFF',
              textShadowColor: accent + 'CC',
              textShadowRadius: 14,
              opacity: n.crisp,
            },
          ]}
        >
          {text}
        </Animated.Text>
        {lit &&
          !calm &&
          DUST.slice(0, text.length > 3 ? 5 : 3).map((p, k) => (
            <Animated.View
              key={k}
              pointerEvents="none"
              style={[
                styles.dust,
                {
                  left: `${p.x}%`,
                  width: p.r * 2,
                  height: p.r * 2,
                  borderRadius: p.r,
                  backgroundColor: p.accent ? accent : '#FFFFFF',
                  shadowColor: accent,
                  opacity: n.dust,
                  transform: [
                    { translateX: n.dustXY[k].x },
                    { translateY: n.dustXY[k].y },
                    { scale: n.dustScale },
                  ],
                },
              ]}
            />
          ))}
      </View>
    );
  }

  if (effect === 'bloom') {
    return (
      <Animated.View style={{ marginRight: gap, transform: [{ scale: n.pop }] }}>
        <Animated.Text
          style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.42)', opacity: n.off }]}
        >
          {text}
        </Animated.Text>
        {/* the ripple: an accent copy of the word that spreads out and fades */}
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            {
              color: accent,
              textShadowColor: accent,
              textShadowRadius: 18,
              opacity: n.ripple,
              transform: [{ scale: n.rippleScale }],
            },
          ]}
        >
          {text}
        </Animated.Text>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            { color: '#FFFFFF', textShadowColor: accent, textShadowRadius: 14, opacity: v },
          ]}
        >
          {text}
        </Animated.Text>
      </Animated.View>
    );
  }

  if (effect === 'rain') {
    return (
      <View style={{ marginRight: gap }}>
        <Animated.Text
          style={[textStyle, styles.wordText, { color: 'rgba(255,255,255,0.24)', opacity: n.off }]}
        >
          {text}
        </Animated.Text>
        <Animated.Text
          style={[
            textStyle,
            styles.wordText,
            styles.wordLit,
            {
              color: '#FFFFFF',
              textShadowColor: accent + '99',
              textShadowRadius: 10,
              opacity: v,
              transform: [{ translateY: n.drop }],
            },
          ]}
        >
          {text}
        </Animated.Text>
      </View>
    );
  }

  const litColor = effect === 'karaoke' ? accent : effect === 'spectrum' ? tint : '#FFFFFF';
  const glow =
    effect === 'karaoke'
      ? accent + 'AA'
      : effect === 'spectrum'
        ? tint + 'AA'
        : effect === 'lift'
          ? 'rgba(255,255,255,0.55)'
          : accent + '88';
  return (
    <Animated.View
      style={[
        { marginRight: gap },
        effect === 'wave' && { transform: [{ translateY: n.hopY }, { scale: n.hopS }] },
        effect === 'spectrum' && { transform: [{ translateY: n.lift }, { scale: n.pop }] },
        effect === 'lift' && { transform: [{ translateY: n.lift }] },
      ]}
    >
      <Text
        style={[
          textStyle,
          styles.wordText,
          { color: effect === 'lift' ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.4)' },
        ]}
      >
        {text}
      </Text>
      <Animated.Text
        style={[
          textStyle,
          styles.wordText,
          styles.wordLit,
          {
            color: litColor,
            opacity: v,
            textShadowColor: glow,
            textShadowRadius: effect === 'lift' ? 10 : 12,
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
          // written without a time in the lyrics editor: its moment is a guess
          ...(line.estimated && !isActive ? { fontStyle: 'italic' as const } : null),
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
  const s = useAnim(scale);
  const o = useAnim(opacity);
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
  // a highlighter stroke: the lower ⅔ of the line, slightly past the word's start
  // a speck of a dissolving word (starts on the word's middle, flies up as it fades)
  dust: {
    position: 'absolute',
    top: '46%',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  markerBand: {
    position: 'absolute',
    left: -3,
    right: 0,
    top: '24%',
    bottom: '10%',
    borderRadius: 5,
    opacity: 0.92,
  },
  footerText: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 28,
  },
});
