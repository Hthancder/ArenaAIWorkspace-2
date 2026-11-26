// HolySic iPod Classic Player Look — Ported from IpodTheme & IpodWheelColor in PreferenceKeys.kt (Mochy Music)

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { IpodTheme } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { usePositionSec } from '../../services/audio/playbackClock';
import { useHoldSeek } from '../../hooks/useHoldSeek';
import { formatTimeSec } from '../HolySicIcons';

const IPOD_PALETTES: Record<
  IpodTheme,
  {
    body: string;
    border: string;
    wheel: string;
    center: string;
    wheelText: string;
    darkLcd: boolean;
  }
> = {
  SILVER: {
    body: '#E2E4E9',
    border: '#FFFFFF',
    wheel: '#FFFFFF',
    center: '#D8DCE3',
    wheelText: '#6E7380',
    darkLcd: false,
  },
  BLACK: {
    body: '#1E1F24',
    border: '#383A44',
    wheel: '#111216',
    center: '#22242C',
    wheelText: '#D4D4DC',
    darkLcd: false,
  },
  U2: {
    body: '#16161A',
    border: '#2D2D35',
    wheel: '#DC2626',
    center: '#18181D',
    wheelText: '#FFFFFF',
    darkLcd: true,
  },
  TRUE_DARK: {
    body: '#09090C',
    border: '#22222B',
    wheel: '#14141B',
    center: '#0A0A0E',
    wheelText: '#A1A1AA',
    darkLcd: true,
  },
};

export const IpodClassicView: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    durationSec,
    togglePlay,
    playNext,
    playPrevious,
    seekTo,
    queue,
    queueIndex,
    jumpToQueueIndex,
    prefs,
    updatePrefs,
    haptic,
    seekBy,
  } = useHolySic();
  const positionSec = usePositionSec();
  const ff = useHoldSeek(seekBy, 1);
  const rw = useHoldSeek(seekBy, -1);

  const [menuOpen, setMenuOpen] = useState(false);

  if (!currentTrack) return null;

  const skin = IPOD_PALETTES[prefs.ipodTheme] || IPOD_PALETTES.BLACK;
  const progress = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;

  const cycleSkin = () => {
    haptic('selection');
    const order: IpodTheme[] = ['BLACK', 'SILVER', 'U2', 'TRUE_DARK'];
    const next = order[(order.indexOf(prefs.ipodTheme) + 1) % order.length];
    updatePrefs({ ipodTheme: next });
  };

  return (
    <View style={styles.outer}>
      <View style={[styles.chassis, { backgroundColor: skin.body, borderColor: skin.border }]}>
        {/* Top Retro Backlit LCD */}
        <View style={[styles.lcdFrame, { backgroundColor: skin.darkLcd ? '#0D1017' : '#F3F6FA' }]}>
          {/* LCD Status Bar */}
          <View
            style={[
              styles.lcdTopBar,
              {
                backgroundColor: skin.darkLcd ? '#1A202E' : '#DCE4F0',
                borderBottomColor: skin.darkLcd ? '#2A3244' : '#B8C4D6',
              },
            ]}
          >
            <Text style={[styles.lcdTopTitle, { color: skin.darkLcd ? '#F4F4F8' : '#1E293B' }]}>
              {menuOpen ? 'HolySic Queue' : 'Now Playing'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Ionicons
                name={isPlaying ? 'play' : 'pause'}
                size={11}
                color={skin.darkLcd ? '#60A5FA' : '#2563EB'}
              />
              <Ionicons
                name="battery-full"
                size={15}
                color={skin.darkLcd ? '#34D399' : '#16A34A'}
              />
            </View>
          </View>

          {menuOpen ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {queue.slice(0, 14).map((item, idx) => {
                const selected = idx === queueIndex;
                return (
                  <Pressable
                    key={`${item.id}-${idx}`}
                    onPress={() => {
                      haptic('selection');
                      jumpToQueueIndex(idx);
                      setMenuOpen(false);
                    }}
                    style={[styles.lcdMenuRow, selected && { backgroundColor: '#2563EB' }]}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 12.5,
                        fontWeight: '700',
                        color: selected ? '#FFFFFF' : skin.darkLcd ? '#E2E8F0' : '#0F172A',
                        flex: 1,
                      }}
                    >
                      {idx + 1}. {item.title}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color={selected ? '#FFF' : '#94A3B8'}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.lcdBody}>
              <View style={styles.lcdMainRow}>
                <ArtworkImage
                  source={{ uri: currentTrack.artworkUrl }}
                  fallbackSeed={currentTrack.title}
                  style={styles.lcdArt}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: '700',
                      color: skin.darkLcd ? '#94A3B8' : '#64748B',
                    }}
                  >
                    {queueIndex + 1} of {queue.length}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: 14,
                      fontWeight: '800',
                      color: skin.darkLcd ? '#F8FAFC' : '#0F172A',
                      marginTop: 3,
                    }}
                  >
                    {currentTrack.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: skin.darkLcd ? '#CBD5E1' : '#334155',
                      marginTop: 2,
                    }}
                  >
                    {currentTrack.artist}
                  </Text>
                  {currentTrack.album && (
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 11,
                        color: skin.darkLcd ? '#64748B' : '#64748B',
                        marginTop: 2,
                      }}
                    >
                      {currentTrack.album}
                    </Text>
                  )}
                </View>
              </View>

              {/* Classic iPod glossy blue progress bar */}
              <View style={styles.lcdProgressArea}>
                <Pressable
                  onPress={(e) => {
                    const locX = (e.nativeEvent as any).locationX;
                    if (typeof locX === 'number' && durationSec > 0) {
                      seekTo(Math.max(0, Math.min(durationSec, (locX / 240) * durationSec)));
                    }
                  }}
                  style={[
                    styles.lcdBarBg,
                    { backgroundColor: skin.darkLcd ? '#1E293B' : '#CBD5E1' },
                  ]}
                >
                  <View style={[styles.lcdBarFill, { width: `${progress * 100}%` }]} />
                </Pressable>
                <View style={styles.lcdTimes}>
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: '700',
                      color: skin.darkLcd ? '#94A3B8' : '#475569',
                    }}
                  >
                    {formatTimeSec(positionSec)}
                  </Text>
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: '700',
                      color: skin.darkLcd ? '#94A3B8' : '#475569',
                    }}
                  >
                    -{formatTimeSec(Math.max(0, durationSec - positionSec))}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Tactile Click Wheel */}
        <View style={[styles.wheel, { backgroundColor: skin.wheel }]}>
          <Pressable
            hitSlop={12}
            onPress={() => {
              haptic('selection');
              setMenuOpen((m) => !m);
            }}
            style={styles.wheelTop}
          >
            <Text style={[styles.wheelMenuText, { color: skin.wheelText }]}>MENU</Text>
          </Pressable>

          <Pressable
            hitSlop={12}
            onPress={rw.guard(playPrevious)}
            onLongPress={rw.onLongPress}
            onPressOut={rw.onPressOut}
            delayLongPress={rw.delayLongPress}
            style={styles.wheelLeft}
          >
            <Ionicons name="play-back" size={18} color={skin.wheelText} />
          </Pressable>

          <Pressable
            hitSlop={12}
            onPress={ff.guard(playNext)}
            onLongPress={ff.onLongPress}
            onPressOut={ff.onPressOut}
            delayLongPress={ff.delayLongPress}
            style={styles.wheelRight}
          >
            <Ionicons name="play-forward" size={18} color={skin.wheelText} />
          </Pressable>

          <Pressable hitSlop={12} onPress={togglePlay} style={styles.wheelBottom}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Ionicons name="play" size={15} color={skin.wheelText} />
              <Ionicons name="pause" size={15} color={skin.wheelText} />
            </View>
          </Pressable>

          {/* Center Button cycles iPod Chassis Finish (Silver / Black / U2 / True Dark) */}
          <Pressable
            onPress={cycleSkin}
            style={[styles.centerBtn, { backgroundColor: skin.center }]}
          >
            <Text style={[styles.skinHint, { color: skin.wheelText }]}>{prefs.ipodTheme}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  chassis: {
    width: 304,
    height: 454,
    borderRadius: 36,
    borderWidth: 2,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lcdFrame: {
    width: '100%',
    height: 196,
    borderRadius: 12,
    borderWidth: 2.5,
    borderColor: '#0F172A',
    overflow: 'hidden',
  },
  lcdTopBar: {
    height: 24,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  lcdTopTitle: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  lcdBody: {
    flex: 1,
    padding: 11,
    justifyContent: 'space-between',
  },
  lcdMainRow: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'center',
  },
  lcdArt: {
    width: 96,
    height: 96,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  lcdProgressArea: {
    marginTop: 6,
  },
  lcdBarBg: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  lcdBarFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
  },
  lcdTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  lcdMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  wheel: {
    width: 204,
    height: 204,
    borderRadius: 102,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  wheelTop: {
    position: 'absolute',
    top: 16,
  },
  wheelMenuText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  wheelLeft: {
    position: 'absolute',
    left: 18,
  },
  wheelRight: {
    position: 'absolute',
    right: 18,
  },
  wheelBottom: {
    position: 'absolute',
    bottom: 16,
  },
  centerBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skinHint: {
    fontSize: 8.5,
    fontWeight: '800',
    opacity: 0.7,
    letterSpacing: 0.5,
  },
});
