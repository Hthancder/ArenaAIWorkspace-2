// HolySic Audio Lab & Equalizer Modal — Ported from AudioLabScreen.kt, FxPresets.kt & EightDAudioCard.kt (Mochy Music)

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { AUTO_EQ_PRESETS } from '../../data/curatedCatalog';

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
            backgroundColor: prefs.pureBlack ? '#000000' : '#0B0B10',
            paddingTop: Math.max(insets.top, 16),
          },
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { fontFamily }]}>HolySic Audio Lab</Text>
            <Text style={styles.sub}>10-Band EQ · AutoEQ · Bass · Reverb · 8D · Speed</Text>
          </View>
          <View style={styles.headerRight}>
            <Switch
              value={audioLab.enabled}
              onValueChange={(v) => {
                haptic('selection');
                updateAudioLab({ enabled: v });
              }}
              trackColor={{ false: '#2A2A36', true: palette.accent }}
            />
            <Pressable onPress={() => setIsAudioLabOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={21} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
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
                      color: selected ? palette.onAccent : '#F4F4F8',
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
              <Text style={styles.cardTitle}>10-Band Graphic Equalizer</Text>
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
                        <Ionicons name="add" size={14} color="#FFFFFF" />
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
                        <Ionicons name="remove" size={14} color="#FFFFFF" />
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
                          color: active ? palette.onAccent : '#FFF',
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
                          color: active ? palette.onAccent : '#FFF',
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
                trackColor={{ false: '#2A2A36', true: palette.accent }}
              />
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
                        color: active ? palette.onAccent : '#FFF',
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
  },
  sub: {
    color: HOLYSIC_COLORS.textSecondary,
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
  },
  subNote: {
    color: HOLYSIC_COLORS.textSecondary,
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
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  bandBarTrack: {
    width: 10,
    height: 112,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bandBarFill: {
    width: '100%',
    borderRadius: 5,
  },
  dbText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 4,
  },
  freqText: {
    color: HOLYSIC_COLORS.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  knobRow: {
    marginTop: 10,
  },
  knobLabel: {
    color: HOLYSIC_COLORS.textSecondary,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
