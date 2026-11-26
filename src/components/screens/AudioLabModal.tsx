// HolySic Audio Lab & Equalizer Modal — Ported from AudioLabScreen.kt, FxPresets.kt & EightDAudioCard.kt (Mochy Music)

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { audioEngine, SpectrumStatus } from '../../services/audio/audioEngine';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { AUTO_EQ_PRESETS } from '../../data/curatedCatalog';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';
import { T as UI, themedSheet } from '../../theme/ui';

export const AudioLabModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    isAudioLabOpen,
    setIsAudioLabOpen,
    audioLab,
    updateAudioLab,
    applyEqPreset,
    palette,
    prefs,
    haptic,
  } = useHolySic();
  useModalLayer('audiolab', isAudioLabOpen);

  // Be honest about what actually changes the sound. EQ / bass / reverb / 8D run in the Web Audio
  // graph; on iOS the player (AVPlayer via expo-audio) exposes only speed & pitch, so those
  // controls would do nothing — they're shown locked with the reason instead of pretending.
  const [spec, setSpec] = useState<SpectrumStatus>({ state: 'idle' });
  useEffect(() => audioEngine.subscribeSpectrumStatus(setSpec), []);
  const isWeb = Platform.OS === 'web';
  const dspLive = isWeb && spec.reason !== 'cors';

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const adjustBand = (index: number, delta: number) => {
    haptic('selection');
    const nextBands = audioLab.bands.map((b, i) =>
      i === index
        ? { ...b, gainDb: Math.max(-12, Math.min(12, Math.round((b.gainDb + delta) * 2) / 2)) }
        : b
    );
    updateAudioLab({ enabled: true, presetId: 'custom', bands: nextBands });
  };

  return (
    <Modal
      visible={isAudioLabOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setIsAudioLabOpen(false)}
    >
      <View
        style={[
          styles.root,
          {
            backgroundColor: prefs.pureBlack ? UI.surface('#000000') : UI.surface('#0B0B10'),
            paddingTop: Math.max(insets.top, 16),
          },
        ]}
      >
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
            <Text style={[styles.title, { fontFamily }]} numberOfLines={1}>
              HolySic Audio Lab
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              10-Band EQ · AutoEQ · Bass · Reverb · 8D · Speed
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Switch
              value={audioLab.enabled}
              onValueChange={(v) => {
                haptic('selection');
                updateAudioLab({ enabled: v });
              }}
              trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
            />
            <Pressable onPress={() => setIsAudioLabOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={21} color={UI.text} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {!dspLive && (
            <View style={[styles.honestCard, { borderColor: palette.accent + '55' }]}>
              <Ionicons name="information-circle" size={18} color={palette.accent} />
              <Text style={styles.honestText}>
                {isWeb
                  ? vi
                    ? 'Nguồn đang phát chặn xử lý âm thanh trên trình duyệt (CORS), nên EQ, Bass, Reverb và 8D tạm không có tác dụng với bài này. Tốc độ & cao độ vẫn hoạt động.'
                    : 'This source blocks in-browser audio processing (CORS), so EQ, bass, reverb and 8D have no effect on this song. Speed & pitch still work.'
                  : vi
                    ? 'Trên iPhone hiện chỉ Tốc độ phát, Giữ cao độ (và Chuẩn hoá âm lượng trong Cài đặt) thật sự thay đổi âm thanh. EQ, Bass, Reverb và 8D cần bộ xử lý âm thanh gốc cho iOS nên được khoá lại thay vì giả vờ hoạt động.'
                    : 'On iPhone only playback speed, pitch preservation (and loudness normalisation in Settings) actually change the sound. EQ, bass, reverb and 8D need a native iOS DSP, so they are locked instead of pretending to work.'}
              </Text>
            </View>
          )}

          <View pointerEvents={dspLive ? 'auto' : 'none'} style={!dspLive && styles.lockedBlock}>
            {/* AutoEQ & HolySic Presets */}
            <Text style={[styles.sectionLabel, { fontFamily }]}>
              {vi
                ? 'Cấu hình AutoEQ & Tai nghe (AirPods / Audiophile)'
                : 'AutoEQ & Headphone Profiles'}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 6 }}
            >
              {AUTO_EQ_PRESETS.map((preset) => {
                const selected = audioLab.presetId === preset.id && audioLab.enabled;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => applyEqPreset(preset.id)}
                    style={[
                      styles.presetChip,
                      selected && {
                        backgroundColor: palette.accent,
                        borderColor: palette.accent,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 12.5,
                        fontWeight: '700',
                        color: selected ? palette.onAccent : UI.fg(1),
                      }}
                    >
                      {preset.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* 10-Band Graphic Equalizer */}
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={[styles.cardTitle, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
                  {vi ? 'EQ 10 băng tần' : '10-Band Graphic EQ'}
                </Text>
                <Pressable onPress={() => applyEqPreset('flat')}>
                  <Text style={{ color: palette.accent, fontSize: 12.5, fontWeight: '700' }}>
                    {vi ? 'Đặt lại (Flat)' : 'Reset Flat'}
                  </Text>
                </Pressable>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.eqRow}>
                  {audioLab.bands.map((band, idx) => {
                    const pct = ((band.gainDb + 12) / 24) * 100;
                    return (
                      <View key={band.freqHz} style={styles.bandCol}>
                        <Pressable onPress={() => adjustBand(idx, 1.5)} style={styles.stepMiniBtn}>
                          <Ionicons name="add" size={14} color={UI.text} />
                        </Pressable>

                        <View style={styles.bandBarTrack}>
                          <View
                            style={[
                              styles.bandBarFill,
                              {
                                height: `${pct}%`,
                                backgroundColor: audioLab.enabled ? palette.accent : '#52525B',
                              },
                            ]}
                          />
                        </View>

                        <Pressable onPress={() => adjustBand(idx, -1.5)} style={styles.stepMiniBtn}>
                          <Ionicons name="remove" size={14} color={UI.text} />
                        </Pressable>

                        <Text style={styles.dbText}>
                          {band.gainDb > 0 ? `+${band.gainDb}` : band.gainDb}
                        </Text>
                        <Text style={styles.freqText}>{band.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {/* Sub-Bass & Space Reverb */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {vi ? 'Sub-Bass & Không gian phòng (Reverb)' : 'Sub-Bass & Space Reverb'}
              </Text>

              <View style={styles.knobRow}>
                <Text style={styles.knobLabel}>Bass Boost</Text>
                <View style={styles.levelPills}>
                  {[0, 25, 50, 75, 100].map((val) => {
                    const active = audioLab.bassBoost === val;
                    return (
                      <Pressable
                        key={val}
                        onPress={() => updateAudioLab({ enabled: true, bassBoost: val })}
                        style={[styles.levelPill, active && { backgroundColor: palette.accent }]}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: active ? palette.onAccent : UI.fg(1),
                          }}
                        >
                          {val}%
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.knobRow, { marginTop: 14 }]}>
                <Text style={styles.knobLabel}>Space Reverb</Text>
                <View style={styles.levelPills}>
                  {[0, 20, 40, 65, 90].map((val) => {
                    const active = audioLab.reverbMix === val;
                    return (
                      <Pressable
                        key={val}
                        onPress={() => updateAudioLab({ enabled: true, reverbMix: val })}
                        style={[styles.levelPill, active && { backgroundColor: palette.accent }]}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: active ? palette.onAccent : UI.fg(1),
                          }}
                        >
                          {val}%
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* 8D Spatial Orbit Card */}
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.cardTitle}>8D Spatial Audio Orbit</Text>
                  <Text style={styles.subNote}>
                    {vi
                      ? 'Âm thanh xoay nhẹ quanh đầu khi đeo tai nghe'
                      : 'Smooth stereo stage rotation around your headphones'}
                  </Text>
                </View>
                <Switch
                  value={audioLab.eightDEnabled}
                  onValueChange={(v) => updateAudioLab({ enabled: true, eightDEnabled: v })}
                  trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
                />
              </View>
            </View>
          </View>

          {/* Speed, Nightcore & Slowed+Reverb */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {vi ? 'Tốc độ phát & Cao độ (Nightcore / Slowed)' : 'Speed, Pitch & Vibes'}
            </Text>
            <View style={styles.speedRow}>
              {[
                { label: 'Slowed 0.85x', rate: 0.85, pitch: false, rev: 40 },
                { label: 'Normal 1.0x', rate: 1.0, pitch: true, rev: 0 },
                { label: '1.15x', rate: 1.15, pitch: true, rev: 0 },
                { label: 'Nightcore 1.25x', rate: 1.25, pitch: false, rev: 0 },
              ].map((opt) => {
                const active = Math.abs(audioLab.playbackRate - opt.rate) < 0.02;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() =>
                      updateAudioLab({
                        enabled: true,
                        playbackRate: opt.rate,
                        preservePitch: opt.pitch,
                        reverbMix: opt.rev,
                      })
                    }
                    style={[styles.speedChip, active && { backgroundColor: palette.accent }]}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: active ? palette.onAccent : UI.fg(1),
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
      <SheetSlot layer="audiolab" />
    </Modal>
  );
};

const styles = themedSheet(() => ({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.1),
  },
  title: {
    color: UI.text,
    fontSize: 21,
    fontWeight: '800',
  },
  sub: {
    color: UI.text2,
    fontSize: 12,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: UI.fg(0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    color: UI.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: UI.fg(0.07),
    borderWidth: 1,
    borderColor: UI.fg(0.12),
  },
  honestCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: UI.fg(0.05),
    marginBottom: 12,
  },
  honestText: { flex: 1, color: UI.fg(0.88), fontSize: 12.5, lineHeight: 18 },
  lockedBlock: { opacity: 0.38 },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: {
    color: UI.text,
    fontSize: 15.5,
    fontWeight: '800',
  },
  subNote: {
    color: UI.text2,
    fontSize: 12.5,
    marginTop: 3,
  },
  eqRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  bandCol: {
    alignItems: 'center',
    width: 34,
  },
  stepMiniBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: UI.fg(0.09),
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  bandBarTrack: {
    width: 10,
    height: 112,
    borderRadius: 5,
    backgroundColor: UI.fg(0.12),
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bandBarFill: {
    width: '100%',
    borderRadius: 5,
  },
  dbText: {
    color: UI.text,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 4,
  },
  freqText: {
    color: UI.text3,
    fontSize: 10,
    marginTop: 2,
  },
  knobRow: {
    marginTop: 10,
  },
  knobLabel: {
    color: UI.text2,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  levelPills: {
    flexDirection: 'row',
    gap: 8,
  },
  levelPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: UI.fg(0.08),
    alignItems: 'center',
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  speedChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: UI.fg(0.08),
  },
}));
