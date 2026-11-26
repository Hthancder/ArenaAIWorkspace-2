// Full-Screen HolySic Player Modal — Flagship, Turntable, iPod, Poster & Bedside Presets + Queue, Lyrics, Sleep Timer & Diagnostics

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLAYER_STYLE_META, PlayerStyle } from '../../constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { formatTimeSec } from '../HolySicIcons';
import { useHoldSeek } from '../../hooks/useHoldSeek';
import { QueuePane } from './QueuePane';
import { SpectrumBars } from './SpectrumBars';
import { BedsideClockView } from './BedsidePlayer';
import { IpodClassicView } from './IpodPlayer';
import { LyricsView } from './LyricsView';
import { TurntableVinylStage } from './TurntablePlayer';

type SubPane = 'artwork' | 'lyrics' | 'queue' | 'sleep' | 'diagnostics' | 'styles';

export const FullPlayerModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    isPlayerOpen,
    setIsPlayerOpen,
    currentTrack,
    resolvedStream,
    isPlaying,
    isBuffering,
    positionSec,
    durationSec,
    volume,
    togglePlay,
    playNext,
    playPrevious,
    seekTo,
    setVolume,
    shuffle,
    toggleShuffle,
    repeatMode,
    cycleRepeat,
    queue,
    isLiked,
    toggleLike,
    setActionTrack,
    setIsAudioLabOpen,
    audioLab,
    sleepRemainingSec,
    sleepEndOfTrack,
    setSleepTimer,
    palette,
    prefs,
    updatePrefs,
    seekBy,
    loudnessLabel,
  } = useHolySic();
  const ff = useHoldSeek(seekBy, 1);
  const rw = useHoldSeek(seekBy, -1);

  const [pane, setPane] = useState<SubPane>('artwork');
  const [seekBarWidth, setSeekBarWidth] = useState(300);
  const [volBarWidth, setVolBarWidth] = useState(240);

  if (!currentTrack) return null;
  const vi = prefs.language === 'vi';
  const liked = isLiked(currentTrack.id);
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const progress = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;

  const gradientColors: readonly [string, string, ...string[]] =
    prefs.playerStyle === 'BEDSIDE' || prefs.playerBackground === 'SOLID' || prefs.pureBlack
      ? ['#050508', '#020204', '#000000']
      : prefs.playerBackground === 'APPLE_MUSIC'
        ? palette.appleMesh
        : prefs.playerBackground === 'DARK_GRADIENT'
          ? [palette.surface, '#0A0A0F', '#040406']
          : palette.gradient;

  const handleSeekPress = (evt: any) => {
    const locX = evt?.nativeEvent?.locationX;
    if (typeof locX === 'number' && seekBarWidth > 0 && durationSec > 0) {
      const ratio = Math.max(0, Math.min(1, locX / seekBarWidth));
      seekTo(ratio * durationSec);
    }
  };

  const handleVolumePress = (evt: any) => {
    const locX = evt?.nativeEvent?.locationX;
    if (typeof locX === 'number' && volBarWidth > 0) {
      setVolume(Math.max(0, Math.min(1, locX / volBarWidth)));
    }
  };

  return (
    <Modal
      visible={isPlayerOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setIsPlayerOpen(false)}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[
          styles.root,
          {
            paddingTop: Math.max(insets.top, 14),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable hitSlop={10} onPress={() => setIsPlayerOpen(false)} style={styles.topIconBtn}>
            <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
          </Pressable>

          {/* Interactive Stream Quality Pill -> Opens HolySic Diagnostics */}
          <Pressable
            onPress={() => setPane((p) => (p === 'diagnostics' ? 'artwork' : 'diagnostics'))}
            style={[styles.qualityBadgeBtn, { borderColor: palette.accent + '40' }]}
          >
            <Ionicons
              name={resolvedStream?.isOffline ? 'arrow-down-circle' : 'sparkles'}
              size={12}
              color={palette.accent}
            />
            <Text numberOfLines={1} style={[styles.qualityBadgeLabel, { color: palette.accent }]}>
              {resolvedStream?.qualityLabel || currentTrack.qualityBadge || 'HolySic Stream'}
              {loudnessLabel ? ` · RG ${loudnessLabel}` : ''}
            </Text>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              hitSlop={8}
              onPress={() => setPane((p) => (p === 'styles' ? 'artwork' : 'styles'))}
              style={[
                styles.styleChipBtn,
                pane === 'styles' && { backgroundColor: palette.accent },
              ]}
            >
              <Ionicons
                name="color-wand-outline"
                size={16}
                color={pane === 'styles' ? palette.onAccent : '#FFFFFF'}
              />
            </Pressable>

            <Pressable
              hitSlop={8}
              onPress={() => setActionTrack(currentTrack)}
              style={styles.topIconBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={21} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* Center Stage */}
        <View style={styles.stageArea}>
          {pane === 'lyrics' ? (
            <LyricsView />
          ) : pane === 'queue' ? (
            <QueuePane onDone={() => setPane('artwork')} />
          ) : pane === 'sleep' ? (
            <View style={styles.overlayCard}>
              <Text style={[styles.paneTitle, { fontFamily, marginBottom: 6 }]}>
                {vi ? 'Hẹn giờ tắt nhạc (Sleep Timer)' : 'Sleep Timer'}
              </Text>
              <Text style={styles.subHelper}>
                {sleepEndOfTrack
                  ? vi
                    ? 'Đang bật: Tự dừng khi hết bài hiện tại'
                    : 'Active: Stops after current song'
                  : sleepRemainingSec !== null
                    ? vi
                      ? `Còn lại: ${formatTimeSec(sleepRemainingSec)}`
                      : `Remaining: ${formatTimeSec(sleepRemainingSec)}`
                    : vi
                      ? 'Chọn thời gian để HolySic tự động dừng phát nhạc'
                      : 'Choose when HolySic gently pauses playback'}
              </Text>
              <View style={styles.sleepGrid}>
                {[5, 15, 30, 45, 60].map((mins) => (
                  <Pressable
                    key={mins}
                    onPress={() => {
                      setSleepTimer(mins);
                      setPane('artwork');
                    }}
                    style={[styles.sleepOption, { borderColor: palette.accent + '44' }]}
                  >
                    <Text style={styles.sleepOptionText}>
                      {mins} {vi ? 'phút' : 'min'}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    setSleepTimer('end_of_track');
                    setPane('artwork');
                  }}
                  style={[styles.sleepOption, { borderColor: palette.accent + '44' }]}
                >
                  <Text style={styles.sleepOptionText}>{vi ? 'Hết bài này' : 'End of Song'}</Text>
                </Pressable>
              </View>
              {(sleepRemainingSec !== null || sleepEndOfTrack) && (
                <Pressable onPress={() => setSleepTimer(null)} style={styles.turnOffSleepBtn}>
                  <Text style={{ color: '#F87171', fontWeight: '700' }}>
                    {vi ? 'Tắt hẹn giờ' : 'Turn Off Timer'}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : pane === 'diagnostics' ? (
            <View style={styles.overlayCard}>
              <View style={styles.paneHeaderRow}>
                <Text style={[styles.paneTitle, { fontFamily }]}>
                  {vi ? 'Chẩn đoán luồng phát' : 'Stream Source Diagnostics'}
                </Text>
                <Pressable onPress={() => setPane('artwork')}>
                  <Ionicons name="close" size={22} color="#FFF" />
                </Pressable>
              </View>
              <Text style={styles.subHelper}>
                {resolvedStream
                  ? `${resolvedStream.sourceLabel} · ${resolvedStream.qualityLabel} (${resolvedStream.codec})`
                  : 'Resolving modules…'}
              </Text>
              <ScrollView style={{ marginTop: 12 }}>
                {(resolvedStream?.diagnostics || []).map((d, idx) => (
                  <View key={idx} style={styles.diagRow}>
                    <Ionicons
                      name={
                        d.ok === true
                          ? 'checkmark-circle'
                          : d.ok === false
                            ? 'close-circle'
                            : 'ellipse-outline'
                      }
                      size={18}
                      color={d.ok ? '#34D399' : '#94A3B8'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.diagTitle}>
                        {d.module} · {d.step}
                        {d.latencyMs !== undefined ? ` (${d.latencyMs}ms)` : ''}
                      </Text>
                      <Text style={styles.diagDetail}>{d.detail}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : pane === 'styles' ? (
            <View style={styles.overlayCard}>
              <View style={styles.paneHeaderRow}>
                <Text style={[styles.paneTitle, { fontFamily }]}>
                  {vi ? 'Chọn giao diện Player HolySic' : 'HolySic Player Presets'}
                </Text>
                <Pressable onPress={() => setPane('artwork')}>
                  <Ionicons name="close" size={22} color="#FFF" />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {PLAYER_STYLE_META.map((meta) => {
                  const selected = prefs.playerStyle === meta.id;
                  return (
                    <Pressable
                      key={meta.id}
                      onPress={() => {
                        updatePrefs({ playerStyle: meta.id as PlayerStyle });
                        setPane('artwork');
                      }}
                      style={[
                        styles.styleSelectCard,
                        selected && {
                          borderColor: palette.accent,
                          backgroundColor: palette.container + '66',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.styleCardTitle}>
                          {vi ? meta.titleVi : meta.titleEn}
                        </Text>
                        <Text style={styles.styleCardDesc}>{vi ? meta.descVi : meta.descEn}</Text>
                      </View>
                      <View
                        style={[
                          styles.styleCardBadge,
                          { backgroundColor: selected ? palette.accent : 'rgba(255,255,255,0.1)' },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '800',
                            color: selected ? palette.onAccent : '#FFF',
                          }}
                        >
                          {meta.badge}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : prefs.playerStyle === 'IPOD' ? (
            <IpodClassicView />
          ) : prefs.playerStyle === 'BEDSIDE' ? (
            <BedsideClockView />
          ) : prefs.playerStyle === 'TURNTABLE' ? (
            <TurntableVinylStage />
          ) : (
            /* Flagship & Poster Cover Stage */
            <View style={styles.flagshipCoverCenter}>
              <View
                style={[
                  styles.coverShadowWrap,
                  prefs.playerStyle === 'POSTER' && styles.posterCoverWrap,
                  !isPlaying && { transform: [{ scale: 0.94 }] },
                ]}
              >
                <ArtworkImage source={{ uri: currentTrack.artworkUrl }} style={styles.coverImage} />
                {prefs.playerStyle === 'POSTER' && (
                  <View style={styles.posterVisualizerRow}>
                    <SpectrumBars
                      isPlaying={isPlaying}
                      positionSec={positionSec}
                      color={palette.accent}
                    />
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Hide standard Flagship controls when in self-contained iPod / Bedside view (unless user is on sub-pane) */}
        {((prefs.playerStyle !== 'IPOD' && prefs.playerStyle !== 'BEDSIDE') ||
          pane !== 'artwork') && (
          <View style={styles.controlsBlock}>
            {/* Song Info + LikeBurst Heart */}
            <View style={styles.songInfoRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text numberOfLines={1} style={[styles.trackTitle, { fontFamily }]}>
                  {currentTrack.title}
                </Text>
                <Text numberOfLines={1} style={[styles.trackArtist, { fontFamily }]}>
                  {currentTrack.artist}
                  {currentTrack.album ? ` · ${currentTrack.album}` : ''}
                </Text>
              </View>

              <Pressable
                hitSlop={10}
                onPress={() => toggleLike(currentTrack)}
                style={[
                  styles.likeCircle,
                  liked && { backgroundColor: 'rgba(255, 77, 121, 0.18)' },
                ]}
              >
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={24}
                  color={liked ? HOLYSIC_COLORS.roseLike : '#FFFFFF'}
                />
              </Pressable>
            </View>

            {/* Interactive Scrubbing Seek Bar */}
            <View style={styles.seekSection}>
              <Pressable
                onLayout={(e: LayoutChangeEvent) =>
                  setSeekBarWidth(e.nativeEvent.layout.width || 300)
                }
                onPress={handleSeekPress}
                style={styles.seekHitBox}
              >
                <View style={styles.seekTrack}>
                  <View
                    style={[
                      styles.seekFill,
                      { width: `${progress * 100}%`, backgroundColor: palette.accent },
                    ]}
                  />
                  <View
                    style={[
                      styles.seekThumb,
                      {
                        left: `${progress * 100}%`,
                        backgroundColor: palette.accent,
                      },
                    ]}
                  />
                </View>
              </Pressable>

              <View style={styles.timestampRow}>
                <Text style={styles.timestampText}>{formatTimeSec(positionSec)}</Text>
                <Pressable
                  onPress={() => updatePrefs({ showRemainingTime: !prefs.showRemainingTime })}
                >
                  <Text style={styles.timestampText}>
                    {prefs.showRemainingTime
                      ? `-${formatTimeSec(Math.max(0, durationSec - positionSec))}`
                      : formatTimeSec(durationSec)}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Primary Transport Row */}
            <View style={styles.transportRow}>
              <Pressable hitSlop={10} onPress={toggleShuffle} style={styles.sideCtrl}>
                <Ionicons
                  name="shuffle"
                  size={22}
                  color={shuffle ? palette.accent : 'rgba(255,255,255,0.48)'}
                />
              </Pressable>

              <Pressable
                hitSlop={10}
                onPress={rw.guard(playPrevious)}
                onLongPress={rw.onLongPress}
                onPressOut={rw.onPressOut}
                delayLongPress={rw.delayLongPress}
                style={styles.skipBtn}
              >
                <Ionicons name="play-skip-back" size={30} color="#FFFFFF" />
              </Pressable>

              <Pressable
                onPress={togglePlay}
                style={[styles.bigPlayBtn, { backgroundColor: palette.accent }]}
              >
                {isBuffering ? (
                  <ActivityIndicator size="small" color={palette.onAccent} />
                ) : (
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={32}
                    color={palette.onAccent}
                    style={!isPlaying ? { marginLeft: 3 } : undefined}
                  />
                )}
              </Pressable>

              <Pressable
                hitSlop={10}
                onPress={ff.guard(playNext)}
                onLongPress={ff.onLongPress}
                onPressOut={ff.onPressOut}
                delayLongPress={ff.delayLongPress}
                style={styles.skipBtn}
              >
                <Ionicons name="play-skip-forward" size={30} color="#FFFFFF" />
              </Pressable>

              <Pressable hitSlop={10} onPress={cycleRepeat} style={styles.sideCtrl}>
                <Ionicons
                  name="repeat"
                  size={22}
                  color={repeatMode !== 'OFF' ? palette.accent : 'rgba(255,255,255,0.48)'}
                />
                {repeatMode === 'ONE' && (
                  <Text style={[styles.repeatOneDot, { color: palette.accent }]}>1</Text>
                )}
              </Pressable>
            </View>

            {/* Volume Bar */}
            <View style={styles.volumeRow}>
              <Ionicons name="volume-low" size={16} color="rgba(255,255,255,0.5)" />
              <Pressable
                onLayout={(e) => setVolBarWidth(e.nativeEvent.layout.width || 220)}
                onPress={handleVolumePress}
                style={styles.volTrackHit}
              >
                <View style={styles.volTrack}>
                  <View
                    style={[
                      styles.volFill,
                      { width: `${volume * 100}%`, backgroundColor: 'rgba(255,255,255,0.82)' },
                    ]}
                  />
                </View>
              </Pressable>
              <Ionicons name="volume-high" size={16} color="rgba(255,255,255,0.5)" />
            </View>
          </View>
        )}

        {/* Bottom HolySic Action Deck (Lyrics · Queue · Audio Lab · Sleep Timer) */}
        <View style={styles.bottomDeck}>
          <Pressable
            onPress={() => setPane((p) => (p === 'lyrics' ? 'artwork' : 'lyrics'))}
            style={[styles.deckPill, pane === 'lyrics' && { backgroundColor: palette.container }]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={pane === 'lyrics' ? palette.accent : '#FFFFFF'}
            />
            <Text style={[styles.deckLabel, pane === 'lyrics' && { color: palette.accent }]}>
              {vi ? 'Lời nhạc' : 'Lyrics'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setPane((p) => (p === 'queue' ? 'artwork' : 'queue'))}
            style={[styles.deckPill, pane === 'queue' && { backgroundColor: palette.container }]}
          >
            <Ionicons name="list" size={18} color={pane === 'queue' ? palette.accent : '#FFFFFF'} />
            <Text style={[styles.deckLabel, pane === 'queue' && { color: palette.accent }]}>
              {vi ? 'Hàng chờ' : 'Queue'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setIsAudioLabOpen(true)}
            style={[styles.deckPill, audioLab.enabled && { backgroundColor: palette.container }]}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={audioLab.enabled ? palette.accent : '#FFFFFF'}
            />
            <Text style={[styles.deckLabel, audioLab.enabled && { color: palette.accent }]}>
              Audio Lab
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setPane((p) => (p === 'sleep' ? 'artwork' : 'sleep'))}
            style={[
              styles.deckPill,
              (sleepRemainingSec !== null || sleepEndOfTrack || pane === 'sleep') && {
                backgroundColor: palette.container,
              },
            ]}
          >
            <Ionicons
              name="moon-outline"
              size={17}
              color={sleepRemainingSec !== null || sleepEndOfTrack ? palette.accent : '#FFFFFF'}
            />
            <Text style={styles.deckLabel}>
              {sleepRemainingSec !== null
                ? formatTimeSec(sleepRemainingSec)
                : sleepEndOfTrack
                  ? '1x'
                  : vi
                    ? 'Hẹn giờ'
                    : 'Sleep'}
            </Text>
          </Pressable>
        </View>
      </LinearGradient>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  topIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleChipBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    maxWidth: 210,
  },
  qualityBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  stageArea: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 6,
  },
  flagshipCoverCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverShadowWrap: {
    width: 300,
    height: 300,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#191922',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  posterCoverWrap: {
    width: 320,
    height: 336,
    borderRadius: 32,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  posterVisualizerRow: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    height: 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  visBar: {
    width: 6,
    borderRadius: 3,
  },
  overlayCard: {
    flex: 1,
    backgroundColor: 'rgba(12, 12, 18, 0.72)',
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  paneHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  paneTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  subHelper: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  sleepGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  sleepOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sleepOptionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  turnOffSleepBtn: {
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(248, 113, 113, 0.14)',
    alignItems: 'center',
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  diagTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  diagDetail: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  styleSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 9,
  },
  styleCardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  styleCardDesc: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  styleCardBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  controlsBlock: {
    marginTop: 4,
  },
  songInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  trackArtist: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 3,
  },
  likeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekSection: {
    marginBottom: 12,
  },
  seekHitBox: {
    paddingVertical: 10,
  },
  seekTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    position: 'relative',
    justifyContent: 'center',
  },
  seekFill: {
    height: '100%',
    borderRadius: 3,
  },
  seekThumb: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 6.5,
    marginLeft: -6.5,
  },
  timestampRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timestampText: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '600',
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginVertical: 8,
  },
  sideCtrl: {
    padding: 8,
    position: 'relative',
  },
  repeatOneDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    fontSize: 9,
    fontWeight: '900',
  },
  skipBtn: {
    padding: 10,
  },
  bigPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
    paddingHorizontal: 6,
  },
  volTrackHit: {
    flex: 1,
    paddingVertical: 8,
  },
  volTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  volFill: {
    height: '100%',
  },
  bottomDeck: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  deckPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deckLabel: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
});
