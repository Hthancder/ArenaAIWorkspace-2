// HolySic Recap & Flippable Listener ID Card Modal — Inspired by RecapStory.kt & IdCardBack.kt (Mochy Music)

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { HolySicMarkIcon } from '../HolySicIcons';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';

export const RecapModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { isRecapOpen, setIsRecapOpen, history, likedTracks, downloads, darkPalette: palette, prefs, haptic } =
    useHolySic();
  useModalLayer('recap', isRecapOpen);

  const [flipped, setFlipped] = useState(false);
  const vi = prefs.language === 'vi';

  const stats = useMemo(() => {
    // real listened time only (no padding / no minimum)
    const totalSec = history.reduce((acc, e) => acc + (e.listenedSec || 0), 0);
    const totalMinutes = Math.round(totalSec / 60);

    const artistCounts = new Map<string, { count: number; art: string }>();
    const songCounts = new Map<
      string,
      { title: string; artist: string; count: number; art: string }
    >();

    for (const ev of history) {
      const prevA = artistCounts.get(ev.track.artist);
      artistCounts.set(ev.track.artist, {
        count: (prevA?.count || 0) + 1,
        art: ev.track.artworkUrl,
      });

      const prevS = songCounts.get(ev.track.id);
      songCounts.set(ev.track.id, {
        title: ev.track.title,
        artist: ev.track.artist,
        count: (prevS?.count || 0) + 1,
        art: ev.track.artworkUrl,
      });
    }

    const topArtists = [...artistCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4);

    const topSongs = [...songCounts.values()].sort((a, b) => b.count - a.count).slice(0, 4);

    return { totalMinutes, topArtists, topSongs };
  }, [history]);

  return (
    <Modal
      visible={isRecapOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsRecapOpen(false)}
    >
      <View
        style={[
          styles.root,
          {
            backgroundColor: '#09090D',
            paddingTop: Math.max(insets.top, 16),
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>HolySic Recap & ID Card</Text>
          <Pressable onPress={() => setIsRecapOpen(false)} style={styles.closeBtn}>
            <Ionicons name="close" size={21} color="#FFFFFF" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Flippable HolySic Listener ID Card */}
          <Pressable
            onPress={() => {
              haptic('selection');
              setFlipped((f) => !f);
            }}
          >
            <LinearGradient
              colors={
                flipped
                  ? ['#181822', '#0D0D14']
                  : [palette.appleMesh[0], palette.appleMesh[1], '#12121A']
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.idCard, { borderColor: palette.accent + '45' }]}
            >
              {!flipped ? (
                <>
                  <View style={styles.idCardTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <HolySicMarkIcon size={24} color={palette.accent} filled />
                      <Text style={styles.idIssuer}>HOLYSIC LISTENER PASS · iOS</Text>
                    </View>
                    <Text style={[styles.tapFlipHint, { color: palette.accent }]}>
                      {vi ? 'Chạm để lật ↻' : 'Tap to flip ↻'}
                    </Text>
                  </View>

                  <View style={styles.idMainStat}>
                    <Text style={styles.minutesBig}>{stats.totalMinutes}</Text>
                    <Text style={styles.minutesLabel}>
                      {vi ? 'PHÚT ĐẮM CHÌM TRONG ÂM NHẠC' : 'MINUTES IMMERSED IN SOUND'}
                    </Text>
                  </View>

                  <View style={styles.idBottomRow}>
                    <View>
                      <Text style={styles.idMetaKey}>{vi ? 'ĐÃ THÍCH' : 'LIKED'}</Text>
                      <Text style={styles.idMetaVal}>{likedTracks.length} tracks</Text>
                    </View>
                    <View>
                      <Text style={styles.idMetaKey}>OFFLINE</Text>
                      <Text style={styles.idMetaVal}>{Object.keys(downloads).length} files</Text>
                    </View>
                    <View>
                      <Text style={styles.idMetaKey}>PLAYER</Text>
                      <Text style={styles.idMetaVal}>{prefs.playerStyle}</Text>
                    </View>
                  </View>
                </>
              ) : (
                /* Back of the HolySic ID Card (IdCardBack.kt tribute, Mochy Music) */
                <View style={{ justifyContent: 'space-between', flex: 1 }}>
                  <View style={styles.magneticStrip} />
                  <View style={{ paddingVertical: 10 }}>
                    <Text style={styles.backSerial}>
                      SERIAL NO · HLYS-IOS-2026-{String(history.length + 108).padStart(4, '0')}
                    </Text>
                    <Text style={styles.backTerms}>
                      Issued by HolySic under GNU GPL v3.0 · Zero Telemetry · Zero Paywalls ·
                      Powered by Mochy Music Open Ecosystem (github.com/realidkroo/Mochy-Music)
                    </Text>
                  </View>
                  <View style={styles.barcodeRow}>
                    {[3, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4, 2, 1, 3, 2].map((w, idx) => (
                      <View
                        key={idx}
                        style={{
                          width: w * 3,
                          height: 30,
                          backgroundColor: 'rgba(255,255,255,0.78)',
                        }}
                      />
                    ))}
                  </View>
                </View>
              )}
            </LinearGradient>
          </Pressable>

          {/* Top Songs */}
          <Text style={styles.secTitle}>
            {vi ? 'Bài hát nghe nhiều nhất' : 'Top Played Tracks'}
          </Text>
          {stats.topSongs.length === 0 ? (
            <Text style={styles.placeholder}>
              {vi
                ? 'Hãy phát vài bài nhạc để HolySic bắt đầu dựng biểu đồ Recap cho riêng bạn!'
                : 'Play a few tracks and HolySic will build your personal chart here!'}
            </Text>
          ) : (
            stats.topSongs.map((s, idx) => (
              <View key={idx} style={styles.rankRow}>
                <Text style={[styles.rankNum, { color: palette.accent }]}>#{idx + 1}</Text>
                <ArtworkImage source={{ uri: s.art }} style={styles.rankArt} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.rankTitle}>
                    {s.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.rankSub}>
                    {s.artist}
                  </Text>
                </View>
                <Text style={styles.rankCount}>{s.count}x</Text>
              </View>
            ))
          )}

          {/* Top Artists */}
          {stats.topArtists.length > 0 && (
            <>
              <Text style={styles.secTitle}>{vi ? 'Nghệ sĩ đồng hành' : 'Top Artists'}</Text>
              {stats.topArtists.map(([artistName, info], idx) => (
                <View key={artistName} style={styles.rankRow}>
                  <Text style={[styles.rankNum, { color: palette.accent }]}>#{idx + 1}</Text>
                  <ArtworkImage
                    source={{ uri: info.art }}
                    style={[styles.rankArt, { borderRadius: 22 }]}
                  />
                  <Text style={[styles.rankTitle, { flex: 1 }]}>{artistName}</Text>
                  <Text style={styles.rankCount}>{info.count} plays</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </View>
      <SheetSlot layer="recap" />
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idCard: {
    minHeight: 220,
    borderRadius: 26,
    padding: 20,
    borderWidth: 1.5,
    justifyContent: 'space-between',
  },
  idCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  idIssuer: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tapFlipHint: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  idMainStat: {
    marginVertical: 18,
  },
  minutesBig: {
    color: '#FFFFFF',
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -1,
  },
  minutesLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  idBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  idMetaKey: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
  },
  idMetaVal: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 2,
  },
  magneticStrip: {
    height: 34,
    backgroundColor: '#040407',
    marginHorizontal: -20,
    marginTop: 4,
  },
  backSerial: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  backTerms: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 6,
  },
  barcodeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 6,
  },
  secTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 24,
    marginBottom: 10,
  },
  placeholder: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rankNum: {
    width: 28,
    fontSize: 15,
    fontWeight: '900',
  },
  rankArt: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  rankTitle: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  rankSub: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  rankCount: {
    color: HOLYSIC_COLORS.textMuted,
    fontSize: 12.5,
    fontWeight: '700',
  },
});
