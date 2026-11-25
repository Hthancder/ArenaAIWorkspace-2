// Floating Glass MiniPlayer with Mochy's MiniLyricsTicker & Artwork Tonal Progress

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MOCHY_COLORS, resolveFontFamily } from '../constants/theme';
import { useMochy } from '../context/MochyContext';
import { GlassSurface } from './GlassSurface';

export const MiniPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    positionSec,
    durationSec,
    togglePlay,
    playNext,
    setIsPlayerOpen,
    isLiked,
    toggleLike,
    lyrics,
    activeLyricIndex,
    palette,
    prefs,
  } = useMochy();

  if (!currentTrack) return null;

  const progress = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  const liked = isLiked(currentTrack.id);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const activeLine =
    prefs.showMiniLyricsTicker &&
    lyrics &&
    activeLyricIndex >= 0 &&
    lyrics.lines[activeLyricIndex]
      ? lyrics.lines[activeLyricIndex].text
      : null;

  return (
    <Pressable onPress={() => setIsPlayerOpen(true)} style={styles.outer}>
      <GlassSurface
        intensity={68}
        tintColor={palette.surface + 'D8'}
        style={[styles.card, { borderColor: palette.accent + '2E' }]}
      >
        <View style={styles.row}>
          <Image source={{ uri: currentTrack.artworkUrl }} style={styles.cover} />

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
                {currentTrack.artist}
              </Text>
            )}
          </View>

          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
              toggleLike(currentTrack);
            }}
            style={styles.ctrlBtn}
          >
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={21}
              color={liked ? MOCHY_COLORS.roseLike : '#FFFFFF'}
            />
          </Pressable>

          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
              togglePlay();
            }}
            style={[styles.playPill, { backgroundColor: palette.accent }]}
          >
            {isBuffering ? (
              <ActivityIndicator size="small" color={palette.onAccent} />
            ) : (
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={19}
                color={palette.onAccent}
                style={!isPlaying ? { marginLeft: 2 } : undefined}
              />
            )}
          </Pressable>

          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
              playNext();
            }}
            style={styles.ctrlBtn}
          >
            <Ionicons name="play-skip-forward" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Bottom hairline progress bar */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, backgroundColor: palette.accent },
            ]}
          />
        </View>
      </GlassSurface>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
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
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  artist: {
    color: MOCHY_COLORS.textSecondary,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
});
