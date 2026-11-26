// HolySic Bedside Nightstand Clock Player — Ported from BedsideClockFace & BedsideNightTint in PreferenceKeys.kt (Mochy Music)

import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { BedsideClockFace, BedsideNightTint } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { useHoldSeek } from '../../hooks/useHoldSeek';

export const BedsideClockView: React.FC = () => {
  useKeepAwake();
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    playNext,
    playPrevious,
    lyrics,
    activeLyricIndex,
    darkPalette: palette,
    prefs,
    updatePrefs,
    haptic,
    seekBy,
  } = useHolySic();
  const ff = useHoldSeek(seekBy, 1);
  const rw = useHoldSeek(seekBy, -1);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!currentTrack) return null;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dateLabel = now.toLocaleDateString(prefs.language === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const tintColor =
    prefs.bedsideNightTint === 'ORANGE'
      ? '#FF8A3D'
      : prefs.bedsideNightTint === 'COVER'
        ? palette.accent
        : '#F4F4F8';

  const cycleTint = () => {
    haptic('selection');
    const order: BedsideNightTint[] = ['ORANGE', 'COVER', 'OFF'];
    const next = order[(order.indexOf(prefs.bedsideNightTint) + 1) % order.length];
    updatePrefs({ bedsideNightTint: next });
  };

  const cycleFace = () => {
    haptic('selection');
    const order: BedsideClockFace[] = ['BIG', 'STACKED', 'COVER'];
    const next = order[(order.indexOf(prefs.bedsideClockFace) + 1) % order.length];
    updatePrefs({ bedsideClockFace: next });
  };

  const activeLyric = lyrics && activeLyricIndex >= 0 ? lyrics.lines[activeLyricIndex]?.text : null;

  return (
    <View style={styles.container}>
      {/* Clock Tile */}
      <Pressable onPress={cycleFace} style={styles.clockTile}>
        {prefs.bedsideClockFace === 'STACKED' ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.stackedDigits, { color: tintColor }]}>{hh}</Text>
            <Text style={[styles.stackedDigits, { color: tintColor, marginTop: -18 }]}>{mm}</Text>
          </View>
        ) : (
          <Text style={[styles.bigDigits, { color: tintColor }]}>
            {hh}:{mm}
          </Text>
        )}
        <Text style={[styles.dateSub, { color: tintColor + 'AA' }]}>
          {dateLabel.toUpperCase()} · NIGHTSTAND OLED
        </Text>
      </Pressable>

      {/* Quiet Music Tile */}
      <View style={[styles.musicTile, { borderColor: tintColor + '28' }]}>
        <View style={styles.musicHeader}>
          <ArtworkImage source={{ uri: currentTrack.artworkUrl }} style={styles.miniArt} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.songTitle, { color: tintColor }]}>
              {currentTrack.title}
            </Text>
            <Text numberOfLines={1} style={styles.songArtist}>
              {currentTrack.artist}
            </Text>
          </View>
          <Pressable onPress={cycleTint} style={styles.tintPill}>
            <Ionicons name="moon" size={13} color={tintColor} />
            <Text style={[styles.tintText, { color: tintColor }]}>{prefs.bedsideNightTint}</Text>
          </Pressable>
        </View>

        {activeLyric && (
          <Text numberOfLines={2} style={[styles.nightLyric, { color: tintColor + 'CC' }]}>
            “{activeLyric}”
          </Text>
        )}

        <View style={styles.nightControls}>
          <Pressable
            onPress={rw.guard(playPrevious)}
            onLongPress={rw.onLongPress}
            onPressOut={rw.onPressOut}
            delayLongPress={rw.delayLongPress}
            style={styles.nightBtn}
          >
            <Ionicons name="play-skip-back" size={24} color={tintColor} />
          </Pressable>
          <Pressable
            onPress={togglePlay}
            style={[styles.nightPlayCircle, { borderColor: tintColor }]}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={26}
              color={tintColor}
              style={!isPlaying ? { marginLeft: 2 } : undefined}
            />
          </Pressable>
          <Pressable
            onPress={ff.guard(playNext)}
            onLongPress={ff.onLongPress}
            onPressOut={ff.onPressOut}
            delayLongPress={ff.delayLongPress}
            style={styles.nightBtn}
          >
            <Ionicons name="play-skip-forward" size={24} color={tintColor} />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-around',
    paddingVertical: 12,
  },
  clockTile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 28,
    backgroundColor: 'rgba(8, 8, 12, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bigDigits: {
    fontSize: 84,
    fontWeight: '800',
    letterSpacing: -2,
  },
  stackedDigits: {
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: -1,
  },
  dateSub: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 6,
  },
  musicTile: {
    padding: 18,
    borderRadius: 26,
    backgroundColor: 'rgba(10, 10, 14, 0.9)',
    borderWidth: 1,
  },
  musicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  miniArt: {
    width: 52,
    height: 52,
    borderRadius: 12,
    opacity: 0.9,
  },
  songTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  songArtist: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 13,
    marginTop: 2,
  },
  tintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  tintText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  nightLyric: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 14,
  },
  nightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    marginTop: 18,
  },
  nightBtn: {
    padding: 10,
  },
  nightPlayCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
