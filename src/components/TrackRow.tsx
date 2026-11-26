// Song Row Component with active equalizer bars, Offline/FLAC badges, Like & Menu

import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
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
import { ArtworkImage } from './ArtworkImage';
import { HOLYSIC_COLORS, resolveFontFamily } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { Track } from '../types/music';
import { formatTimeSec } from './HolySicIcons';
import { T as UI, themedSheet } from '../theme/ui';
import { Tap } from './ui/Tap';

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
  } = useHolySic();

  // ── Apple-Music-style swipe actions: → like / unlike, ← play next. The row follows the finger
  // (with resistance past the trigger point), a haptic tick marks "release now to do it" ──
  const dragX = useRef(new Animated.Value(0)).current;
  const [rowW, setRowW] = useState(0);
  const armed = useRef(0);
  // a swipe must never also count as a tap on the row (web delivers the click anyway)
  const swipedAt = useRef(0);
  const acts = useRef({ like: () => {}, next: () => {}, haptic });
  acts.current = {
    like: () => toggleLike(track),
    next: () => addToQueue(track, true),
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

  const { width: winW } = useWindowDimensions();
  // 4" phones: drop the secondary bits (quality pill, duration in grids) so the title gets room
  const narrow = winW < 360;
  const active = currentTrack?.id === track.id;
  const liked = isLiked(track.id);
  const isOffline = Boolean(downloads[track.id]);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const handlePress = () => {
    if (Date.now() - swipedAt.current < 400) return;
    if (active) {
      togglePlay();
    } else {
      playTrack(track, queueContext);
    }
  };

  // Local Files carry their real codec ("MP3 · 44.1 kHz · Trên máy") — show it, not a guess
  const qb = track.qualityBadge || '';
  const badgeLabel =
    track.source === 'local'
      ? qb.split(' · ')[0] || 'Local'
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
        if (Date.now() - swipedAt.current < 400) return;
        haptic('medium');
        setActionTrack(track);
      }}
      delayLongPress={380}
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        active && { backgroundColor: palette.container + '55' },
        pressed && { opacity: 0.78 },
      ]}
    >
      {indexBadge !== undefined && (
        <Text style={[styles.indexNum, { color: active ? palette.accent : UI.text3, fontFamily }]}>
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
            <Ionicons name={isPlaying ? 'stats-chart' : 'pause'} size={16} color={palette.accent} />
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
                color: active ? palette.accent : UI.text,
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
          toggleLike(track);
        }}
        style={styles.iconBtn}
      >
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={19}
          color={liked ? HOLYSIC_COLORS.roseLike : UI.text3}
        />
      </Tap>

      {onRemove ? (
        <Tap
          feedback="opacity"
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            onRemove();
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="close-circle-outline" size={19} color={UI.text3} />
        </Tap>
      ) : (
        <Tap
          feedback="opacity"
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            setActionTrack(track);
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={UI.text2} />
        </Tap>
      )}
    </Pressable>
  );

  if (!swipeable) return row;
  const vi = prefs.language === 'vi';
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
        if (e.nativeEvent.actionName === 'like') toggleLike(track);
        if (e.nativeEvent.actionName === 'next') addToQueue(track, true);
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
            backgroundColor: palette.accent,
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
      <Animated.View style={{ transform: [{ translateX: dragX }] }}>{row}</Animated.View>
    </View>
  );
};

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
