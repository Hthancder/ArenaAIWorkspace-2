// Floating Glass MiniPlayer with HolySic's MiniLyricsTicker & Artwork Tonal Progress

import { usePositionSec } from '../services/audio/playbackClock';
import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArtworkImage } from './ArtworkImage';
import { HOLYSIC_COLORS, resolveFontFamily } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { GlassSurface } from './GlassSurface';
import { useHoldSeek } from '../hooks/useHoldSeek';
import { AmbientSpill, useAmbientColors } from './ambient/AmbientLight';
import { T as UI, themedSheet } from '../theme/ui';
import { LikeHeart } from './ui/LikeHeart';
import { Tap } from './ui/Tap';
import { MorphIcon, NudgeIcon } from './ui/MorphIcon';

export const MiniPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    durationSec,
    togglePlay,
    playNext,
    playPrevious,
    haptic,
    setIsPlayerOpen,
    isLiked,
    toggleLike,
    lyrics,
    activeLyricIndex,
    palette,
    prefs,
    seekBy,
    ambient,
  } = useHolySic();
  const ff = useHoldSeek(seekBy, 1);

  const ambientColors = useAmbientColors();

  // Swipe gestures, like the iOS Music mini player: ← next song · → previous · ↑ open the player
  const [nudge, setNudge] = useState(0);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  // a swipe must never also count as a tap (web still delivers the click after a drag)
  const swipedAt = useRef(0);
  const tapOk = () => Date.now() - swipedAt.current > 400;
  const acts = useRef({ playNext, playPrevious, open: () => setIsPlayerOpen(true), haptic });
  acts.current = { playNext, playPrevious, open: () => setIsPlayerOpen(true), haptic };
  const axis = useRef<'x' | 'y' | null>(null);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        (Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy)) ||
        (g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx)),
      onPanResponderGrant: (_e, g) => {
        swipedAt.current = Date.now();
        // the grant can arrive with dx = dy = 0 (web) — lock the axis on the first real movement
        axis.current =
          Math.abs(g.dx) + Math.abs(g.dy) < 6 ? null : Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
      },
      onPanResponderMove: (_e, g) => {
        if (!axis.current) {
          if (Math.abs(g.dx) + Math.abs(g.dy) < 6) return;
          axis.current = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
        }
        if (axis.current === 'x') dragX.setValue(g.dx * 0.9);
        else dragY.setValue(Math.max(-60, Math.min(0, g.dy * 0.6)));
      },
      onPanResponderRelease: (_e, g) => {
        swipedAt.current = Date.now();
        const back = () => {
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        };
        if (!axis.current) axis.current = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
        if (axis.current === 'y') {
          if (g.dy < -40 || g.vy < -0.6) {
            acts.current.haptic('light');
            acts.current.open();
          }
          back();
          return;
        }
        if (Math.abs(g.dx) > 80 || (Math.abs(g.dx) > 30 && Math.abs(g.vx) > 0.6)) {
          const dir = g.dx < 0 ? -1 : 1;
          acts.current.haptic('medium');
          Animated.timing(dragX, {
            toValue: dir * 140,
            duration: 120,
            useNativeDriver: true,
          }).start(() => {
            if (dir < 0) acts.current.playNext();
            else acts.current.playPrevious();
            dragX.setValue(-dir * 90);
            back();
          });
        } else {
          back();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!currentTrack) return null;
  // OpenSpot-style floating capsule vs. HolySic card
  const capsule = prefs.miniPlayerStyle === 'capsule';

  const liked = isLiked(currentTrack.id);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const activeLine =
    prefs.showMiniLyricsTicker && lyrics && activeLyricIndex >= 0 && lyrics.lines[activeLyricIndex]
      ? lyrics.lines[activeLyricIndex].text
      : null;

  return (
    <Animated.View
      {...pan.panHandlers}
      accessibilityHint="Swipe left or right to change song, swipe up to open the player"
      style={{
        transform: [
          { translateX: dragX },
          { translateY: dragY },
          {
            scale: dragY.interpolate({
              inputRange: [-60, 0],
              outputRange: [1.03, 1],
              extrapolate: 'clamp',
            }),
          },
        ],
        ...(Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null),
        opacity: dragX.interpolate({
          inputRange: [-160, 0, 160],
          outputRange: [0.35, 1, 0.35],
          extrapolate: 'clamp',
        }),
      }}
    >
      <Tap onPress={() => tapOk() && setIsPlayerOpen(true)} style={styles.outer}>
        {ambient.spill && !prefs.pureBlack && (
          <AmbientSpill
            colors={ambientColors}
            level={ambient.level * (isPlaying ? 1 : 0.55)}
            style={capsule ? styles.spillCapsule : styles.spill}
          />
        )}
        <GlassSurface
          intensity={68}
          tintColor={palette.surface + 'D8'}
          style={[
            styles.card,
            capsule && styles.capsuleCard,
            { borderColor: palette.accent + '2E' },
          ]}
        >
          {capsule && (
            <MiniProgress
              live={!!currentTrack.isLive}
              durationSec={durationSec}
              style={styles.capsuleFill}
              color={palette.accent + '22'}
            />
          )}
          <View style={[styles.row, capsule && { paddingVertical: 7 }]}>
            <ArtworkImage
              source={{ uri: currentTrack.artworkUrl }}
              fallbackSeed={currentTrack.title}
              style={[styles.cover, capsule && styles.capsuleCover]}
            />

            <View style={styles.meta}>
              <Text numberOfLines={1} style={[styles.title, { fontFamily }]}>
                {currentTrack.title}
              </Text>
              {activeLine ? (
                <Text
                  numberOfLines={1}
                  style={[styles.lyricTicker, { color: palette.accent, fontFamily }]}
                >
                  ♪ {activeLine}
                </Text>
              ) : (
                <Text numberOfLines={1} style={[styles.artist, { fontFamily }]}>
                  {currentTrack.isLive ? '● LIVE · ' : ''}
                  {currentTrack.artist}
                </Text>
              )}
            </View>

            <Tap
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                if (tapOk()) toggleLike(currentTrack);
              }}
              style={styles.ctrlBtn}
              accessibilityRole="button"
              accessibilityState={{ selected: liked }}
              accessibilityLabel={prefs.language === 'vi' ? 'Thích' : 'Love'}
            >
              <LikeHeart
                key={currentTrack.id}
                liked={liked}
                size={21}
                likedColor={HOLYSIC_COLORS.roseLike}
                color={UI.fg(1)}
              />
            </Tap>

            <Tap
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                if (tapOk()) togglePlay();
              }}
              style={[styles.playPill, { backgroundColor: palette.accent }]}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color={palette.onAccent} />
              ) : (
                <MorphIcon
                  on={isPlaying}
                  onIcon="pause"
                  offIcon="play"
                  size={19}
                  color={palette.onAccent}
                  offShiftX={2}
                />
              )}
            </Tap>

            <Tap
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                if (tapOk())
                  ff.guard(() => {
                    setNudge((n) => n + 1);
                    playNext();
                  })();
              }}
              onLongPress={ff.onLongPress}
              onPressOut={ff.onPressOut}
              delayLongPress={ff.delayLongPress}
              style={styles.ctrlBtn}
            >
              <NudgeIcon name="play-skip-forward" size={20} color={UI.text} dir={1} pulse={nudge} />
            </Tap>
          </View>

          {/* Bottom hairline progress bar */}
          <View style={[styles.progressTrack, capsule && { display: 'none' }]}>
            <MiniProgress
              live={!!currentTrack.isLive}
              durationSec={durationSec}
              style={styles.progressFill}
              color={palette.accent}
            />
          </View>
        </GlassSurface>
      </Tap>
    </Animated.View>
  );
};

/** Progress fill: follows the playback clock without re-rendering the whole mini player. */
const MiniProgress: React.FC<{
  live: boolean;
  durationSec: number;
  color: string;
  style: object;
}> = ({ live, durationSec, color, style }) => {
  const positionSec = usePositionSec();
  const progress = live
    ? 1
    : durationSec > 0
      ? Math.min(1, Math.max(0, positionSec / durationSec))
      : 0;
  return (
    <View
      pointerEvents="none"
      style={[style, { width: `${progress * 100}%`, backgroundColor: color }]}
    />
  );
};

const styles = themedSheet(() => ({
  spill: { position: 'absolute', left: -6, right: -6, top: -18, bottom: -4 },
  spillCapsule: { position: 'absolute', left: 8, right: 8, top: -16, bottom: -2 },
  outer: {
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  capsuleCard: {
    borderRadius: 99,
    borderWidth: 1,
    marginHorizontal: 14,
  },
  capsuleCover: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  capsuleFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 11,
    marginRight: 11,
    backgroundColor: '#222',
  },
  meta: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    color: UI.text,
    fontSize: 14.5,
    fontWeight: '700',
  },
  artist: {
    color: UI.text2,
    fontSize: 12.5,
    marginTop: 2,
  },
  lyricTicker: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  ctrlBtn: {
    padding: 8,
  },
  playPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
  },
  progressTrack: {
    height: 2.5,
    backgroundColor: UI.fg(0.12),
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
}));
