// Song Row Component with active equalizer bars, Offline/FLAC badges, Like & Menu

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { NowPlayingBars } from './ui/NowPlayingBars';
import { ArtworkImage } from './ArtworkImage';
import { HOLYSIC_COLORS, resolveFontFamily } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { Track } from '../types/music';
import { formatTimeSec } from './HolySicIcons';
import { T as UI, themedSheet } from '../theme/ui';
import { Tap } from './ui/Tap';
import { MenuItem, NativeMenu, nativeMenuAvailable } from './ui/NativeMenu';
import { useTrackMenu } from './menu/useTrackMenu';
import { perfCount } from '../services/perfProbe';

interface TrackRowProps {
  track: Track;
  queueContext?: Track[];
  indexBadge?: number;
  compact?: boolean;
  onRemove?: () => void;
  /** swipe → like · ← play next (off inside horizontal carousels) */
  swipeable?: boolean;
}

const SWIPE_AT = 76;

interface RowActions {
  press: () => void;
  like: () => void;
  next: () => void;
  sheet: () => void;
  remove: () => void;
  menu: (id: string) => void;
  haptic: (k: 'light' | 'medium' | 'selection') => void;
}

/**
 * Reads the app state and hands the row only what it shows (plain values) plus one stable
 * actions object. The row body is memoized, so a context change (a toast, the next song, a
 * download finishing…) re-renders just the rows it actually changes — not every row of every
 * list on every tab.
 */
export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  queueContext,
  indexBadge,
  compact = false,
  onRemove,
  swipeable = true,
}) => {
  const {
    currentTrack,
    isPlaying,
    playTrack,
    togglePlay,
    isLiked,
    toggleLike,
    setActionTrack,
    downloads,
    downloadingIds,
    palette,
    prefs,
    haptic,
    addToQueue,
    isOnline,
  } = useHolySic();
  const trackMenu = useTrackMenu();
  const active = currentTrack?.id === track.id;
  const isOffline = Boolean(downloads[track.id]);
  const unavailable =
    !isOnline &&
    !isOffline &&
    track.source !== 'local' &&
    track.source !== 'synth' &&
    !track.synthPreset;
  const menuItems = useMemo(
    () => (nativeMenuAvailable ? trackMenu.itemsFor(track) : EMPTY_MENU),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackMenu.itemsFor, track]
  );
  const actions = useRef<RowActions>(null as unknown as RowActions);
  actions.current = {
    press: () => (active ? togglePlay() : playTrack(track, queueContext)),
    like: () => toggleLike(track),
    next: () => addToQueue(track, true),
    sheet: () => setActionTrack(track),
    remove: () => onRemove?.(),
    menu: (id) => trackMenu.select(track, id),
    haptic,
  };
  return (
    <TrackRowBody
      track={track}
      indexBadge={indexBadge}
      compact={compact}
      removable={!!onRemove}
      swipeable={swipeable}
      active={active}
      playing={active && isPlaying}
      liked={isLiked(track.id)}
      isOffline={isOffline}
      isDownloading={Boolean(downloadingIds[track.id])}
      unavailable={unavailable}
      accent={palette.accent}
      container={palette.container}
      fontFamily={resolveFontFamily(prefs.fontStyle)}
      vi={prefs.language === 'vi'}
      menuItems={menuItems}
      actions={actions}
    />
  );
};

const EMPTY_MENU: MenuItem[] = [];

interface BodyProps {
  track: Track;
  indexBadge?: number;
  compact: boolean;
  removable: boolean;
  swipeable: boolean;
  active: boolean;
  playing: boolean;
  liked: boolean;
  isOffline: boolean;
  isDownloading: boolean;
  unavailable: boolean;
  accent: string;
  container: string;
  fontFamily: string | undefined;
  vi: boolean;
  menuItems: MenuItem[];
  actions: React.MutableRefObject<RowActions>;
}

const TrackRowBody = React.memo(function TrackRowBody({
  track,
  indexBadge,
  compact,
  removable,
  swipeable,
  active,
  playing,
  liked,
  isOffline,
  isDownloading,
  unavailable,
  accent,
  container,
  fontFamily,
  vi,
  menuItems,
  actions,
}: BodyProps) {
  perfCount('render:TrackRow');
  const haptic = (k: 'light' | 'medium' | 'selection') => actions.current.haptic(k);

  // ── Apple-Music-style swipe actions: → like / unlike, ← play next. The row follows the finger
  // (with resistance past the trigger point), a haptic tick marks "release now to do it" ──
  const dragX = useRef(new Animated.Value(0)).current;
  const [rowW, setRowW] = useState(0);
  const armed = useRef(0);
  // a swipe must never also count as a tap on the row (web delivers the click anyway)
  const swipedAt = useRef(0);
  const acts = useRef({ like: () => {}, next: () => {}, haptic });
  acts.current = {
    like: () => actions.current.like(),
    next: () => actions.current.next(),
    haptic,
  };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => {
        armed.current = 0;
        swipedAt.current = Date.now();
      },
      onPanResponderMove: (_e, g) => {
        const d = g.dx;
        const a = Math.abs(d);
        // rubber band past the trigger point
        const shown = a <= SWIPE_AT ? d : Math.sign(d) * (SWIPE_AT + (a - SWIPE_AT) * 0.35);
        dragX.setValue(shown);
        const now = a >= SWIPE_AT ? Math.sign(d) : 0;
        if (now !== armed.current) {
          armed.current = now;
          if (now !== 0) acts.current.haptic('light');
        }
      },
      onPanResponderRelease: () => {
        swipedAt.current = Date.now();
        const dir = armed.current;
        armed.current = 0;
        if (dir > 0) acts.current.like();
        else if (dir < 0) acts.current.next();
        Animated.spring(dragX, {
          toValue: 0,
          useNativeDriver: true,
          speed: 16,
          bounciness: 6,
        }).start();
      },
      onPanResponderTerminate: () => {
        armed.current = 0;
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const onMenu = (id: string) => actions.current.menu(id);

  const { width: winW } = useWindowDimensions();
  // 4" phones: drop the secondary bits (quality pill, duration in grids) so the title gets room
  const narrow = winW < 360;

  const handlePress = () => {
    if (Date.now() - swipedAt.current < 400) return;
    actions.current.press();
  };

  // Local Files carry their real codec ("MP3 · 44.1 kHz · Trên máy") — show it, not a guess
  const qb = track.qualityBadge || '';
  const badgeLabel =
    track.source === 'local'
      ? qb.split(' · ')[0] || 'Local'
      : track.id.startsWith('ytv-')
        ? 'MV'
        : qb.includes('FLAC')
          ? 'FLAC'
          : qb.includes('320')
            ? '320k'
            : track.source === 'synth'
              ? 'LAB'
              : 'AAC';
  const lossless = /FLAC|ALAC|WAV|AIFF/.test(track.source === 'local' ? badgeLabel : qb);

  const row = (
    <Pressable
      onPress={handlePress}
      // touch and hold → the song menu, with a haptic tap (like Music's context menu)
      onLongPress={() => {
        // the native context menu takes the hold (and keeps the release from counting as a tap)
        if (nativeMenuAvailable) return;
        if (Date.now() - swipedAt.current < 400) return;
        haptic('medium');
        actions.current.sheet();
      }}
      delayLongPress={380}
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        active && { backgroundColor: container + '55' },
        unavailable && { opacity: 0.38 },
        pressed && { opacity: 0.78 },
      ]}
    >
      {indexBadge !== undefined && (
        <Text style={[styles.indexNum, { color: active ? accent : UI.text3, fontFamily }]}>
          {indexBadge}
        </Text>
      )}

      <View style={styles.artWrap}>
        <ArtworkImage
          source={{ uri: track.artworkUrl }}
          fallbackSeed={track.title}
          style={styles.art}
        />
        {active && (
          <View style={styles.playingOverlay}>
            <NowPlayingBars playing={playing} color={accent} size={16} />
          </View>
        )}
      </View>

      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <Text
            numberOfLines={1}
            style={[
              styles.title,
              {
                color: active ? accent : UI.text,
                fontFamily,
              },
            ]}
          >
            {track.title}
          </Text>
          {track.explicit && (
            <View style={styles.explicitBadge}>
              <Text style={styles.explicitText}>E</Text>
            </View>
          )}
        </View>

        <View style={styles.subRow}>
          {isOffline && (
            <Ionicons
              name="arrow-down-circle"
              size={13}
              color={HOLYSIC_COLORS.flacEmerald}
              style={{ marginRight: 4 }}
            />
          )}
          {isDownloading && (
            <Ionicons
              name="cloud-download-outline"
              size={13}
              color={HOLYSIC_COLORS.iosBlue}
              style={{ marginRight: 4 }}
            />
          )}
          {track.qualityBadge && !compact && (
            <View
              style={[
                styles.qualityPill,
                lossless && {
                  borderColor: 'rgba(52, 211, 153, 0.4)',
                  backgroundColor: 'rgba(52, 211, 153, 0.10)',
                },
              ]}
            >
              <Text style={[styles.qualityText, lossless && { color: HOLYSIC_COLORS.flacEmerald }]}>
                {badgeLabel}
              </Text>
            </View>
          )}
          <Text numberOfLines={1} style={[styles.subtitle, { fontFamily }]}>
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
      </View>

      {!(narrow && compact && !track.isLive) && (
        <Text
          style={[
            styles.duration,
            { fontFamily },
            track.isLive && { color: '#F87171', fontWeight: '900' },
          ]}
        >
          {track.isLive ? 'LIVE' : formatTimeSec(track.durationSec)}
        </Text>
      )}

      <Tap
        feedback="opacity"
        hitSlop={8}
        onPress={(e) => {
          e.stopPropagation?.();
          actions.current.like();
        }}
        style={styles.iconBtn}
      >
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={19}
          color={liked ? HOLYSIC_COLORS.roseLike : UI.text3}
        />
      </Tap>

      {removable ? (
        <Tap
          feedback="opacity"
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            actions.current.remove();
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="close-circle-outline" size={19} color={UI.text3} />
        </Tap>
      ) : nativeMenuAvailable ? (
        <NativeMenu
          items={menuItems}
          onSelect={onMenu}
          title={`${track.title} · ${track.artist}`}
          label={(vi ? 'Tuỳ chọn ' : 'Options for ') + track.title}
          style={styles.iconBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={UI.text2} />
        </NativeMenu>
      ) : (
        <Tap
          feedback="opacity"
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            actions.current.sheet();
          }}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={(vi ? 'Tuỳ chọn ' : 'Options for ') + track.title}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={UI.text2} />
        </Tap>
      )}
    </Pressable>
  );

  const lifted = nativeMenuAvailable ? (
    <NativeMenu
      trigger="longPress"
      items={menuItems}
      onSelect={onMenu}
      previewRadius={14}
      previewBackground={UI.surface('#14141B')}
    >
      {row}
    </NativeMenu>
  ) : (
    row
  );

  if (!swipeable) return lifted;
  const likeOpacity = dragX.interpolate({
    inputRange: [0, 24, SWIPE_AT],
    outputRange: [0, 0.6, 1],
    extrapolate: 'clamp',
  });
  const nextOpacity = dragX.interpolate({
    inputRange: [-SWIPE_AT, -24, 0],
    outputRange: [1, 0.6, 0],
    extrapolate: 'clamp',
  });
  const likeScale = dragX.interpolate({
    inputRange: [0, SWIPE_AT, SWIPE_AT + 20],
    outputRange: [0.6, 1, 1.18],
    extrapolate: 'clamp',
  });
  const nextScale = dragX.interpolate({
    inputRange: [-SWIPE_AT - 20, -SWIPE_AT, 0],
    outputRange: [1.18, 1, 0.6],
    extrapolate: 'clamp',
  });
  return (
    <View
      style={[styles.swipeWrap, Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null]}
      onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
      accessibilityActions={[
        { name: 'like', label: liked ? (vi ? 'Bỏ thích' : 'Unlike') : vi ? 'Thích' : 'Like' },
        { name: 'next', label: vi ? 'Phát tiếp theo' : 'Play next' },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'like') actions.current.like();
        if (e.nativeEvent.actionName === 'next') actions.current.next();
      }}
    >
      {/* revealed behind the row */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.swipeBg,
          styles.swipeLike,
          {
            width: rowW,
            opacity: likeOpacity,
            transform: [{ translateX: Animated.subtract(dragX, rowW) }],
          },
        ]}
      >
        <Animated.View style={[styles.swipeAct, { transform: [{ scale: likeScale }] }]}>
          <Ionicons name={liked ? 'heart-dislike' : 'heart'} size={20} color="#fff" />
          <Text style={styles.swipeText}>
            {liked ? (vi ? 'Bỏ thích' : 'Unlike') : vi ? 'Thích' : 'Like'}
          </Text>
        </Animated.View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.swipeBg,
          styles.swipeNext,
          {
            width: rowW,
            backgroundColor: accent,
            opacity: nextOpacity,
            transform: [{ translateX: Animated.add(dragX, rowW) }],
          },
        ]}
      >
        <Animated.View style={[styles.swipeAct, { transform: [{ scale: nextScale }] }]}>
          <Text style={[styles.swipeText, { color: UI.inv }]}>
            {vi ? 'Phát tiếp' : 'Play next'}
          </Text>
          <Ionicons name="return-down-forward" size={20} color={UI.inv} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: dragX }] }}>{lifted}</Animated.View>
    </View>
  );
});

const styles = themedSheet(() => ({
  swipeWrap: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
  },
  swipeBg: {
    position: 'absolute',
    left: 0,
    top: 2,
    bottom: 2,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  // the icon rides the row's edge as it slides
  swipeLike: {
    backgroundColor: HOLYSIC_COLORS.roseLike,
    justifyContent: 'flex-end',
  },
  swipeNext: {
    justifyContent: 'flex-start',
  },
  swipeAct: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  swipeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginVertical: 2,
  },
  rowCompact: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  indexNum: {
    width: 24,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginRight: 6,
  },
  artWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1E1E28',
    marginRight: 12,
  },
  art: {
    width: '100%',
    height: '100%',
  },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: UI.shade(0, 0, 0, 0.56),
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  explicitBadge: {
    marginLeft: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: UI.fg(0.16),
  },
  explicitText: {
    color: '#D8D8E2',
    fontSize: 9,
    fontWeight: '800',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  subtitle: {
    fontSize: 12.5,
    color: UI.text2,
    flexShrink: 1,
  },
  // inline next to the artist (Apple Music "Lossless" style) so the title keeps its width
  qualityPill: {
    paddingHorizontal: 4,
    paddingVertical: 0.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: UI.fg(0.12),
    backgroundColor: UI.fg(0.05),
    marginRight: 5,
  },
  qualityText: {
    color: UI.text2,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  duration: {
    fontSize: 12,
    color: UI.text3,
    marginRight: 6,
    minWidth: 34,
    textAlign: 'right',
  },
  iconBtn: {
    padding: 5,
    marginLeft: 2,
  },
}));
