// HolySic Audio Lab — native EQ & effects. Ported from AudioLabScreen.kt, FxPresets.kt &
// EightDAudioCard.kt (Mochy Music, GPL-3.0), rebuilt around the native iOS DSP
// (modules/holysic-dsp): every control here changes the PCM AVPlayer renders.
//
// While a control is held, the change is previewed straight on the audio engine (no app-wide
// re-render per frame); it is saved to settings once, on release.

import { useScrollLocked } from '../../services/ui/scrollLock';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HolySicDSP } from '../../../modules/holysic-dsp';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { AUTO_EQ_PRESETS } from '../../data/curatedCatalog';
import { audioEngine, SpectrumStatus } from '../../services/audio/audioEngine';
import { autoPreampDb, bassDbOf } from '../../services/audio/eqCurve';
import { T as UI, themedSheet } from '../../theme/ui';
import type { AudioLabSettings } from '../../types/music';
import { EqCurve, EqFader, LabeledSlider } from '../audio/EqControls';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';
import { Tap } from '../ui/Tap';

const BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const SPEEDS = [
  { id: 'slowed', vi: 'Slowed', en: 'Slowed', rate: 0.85, pitch: false, rev: 40 },
  { id: 'normal', vi: 'Chuẩn', en: 'Normal', rate: 1.0, pitch: true, rev: 0 },
  { id: 'fast', vi: '1.15×', en: '1.15×', rate: 1.15, pitch: true, rev: 0 },
  { id: 'nightcore', vi: 'Nightcore', en: 'Nightcore', rate: 1.25, pitch: false, rev: 0 },
];

export const AudioLabModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const scrollLocked = useScrollLocked();
  const {
    isAudioLabOpen,
    setIsAudioLabOpen,
    audioLab,
    updateAudioLab,
    applyEqPreset,
    palette,
    prefs,
    updatePrefs,
    haptic,
  } = useHolySic();
  useModalLayer('audiolab', isAudioLabOpen);
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const accent = palette.accent;

  // ── where the DSP runs, and whether it reaches the current song ──
  const backend = audioEngine.dspBackend();
  const [spec, setSpec] = useState<SpectrumStatus>({ state: 'idle' });
  const [tap, setTap] = useState<{ state: string; reason?: string }>({ state: 'idle' });
  useEffect(() => audioEngine.subscribeSpectrumStatus(setSpec), []);
  useEffect(() => audioEngine.subscribeDspTap(setTap), []);
  const [rate, setRate] = useState(0);
  useEffect(() => {
    if (!isAudioLabOpen || backend !== 'native' || !HolySicDSP) return;
    const read = () => {
      try {
        const s = HolySicDSP!.getStatus();
        setRate(s.liveTaps > 0 ? s.sampleRate : 0);
      } catch {
        setRate(0);
      }
    };
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, [isAudioLabOpen, backend]);
  const dspUsable = backend === 'native' || (backend === 'web' && spec.reason !== 'cors');
  const songBlocked = backend === 'native' && tap.state === 'unsupported';

  // ── draft: live preview while dragging, saved on release ──
  const [draft, setDraft] = useState<AudioLabSettings>(audioLab);
  const holding = useRef(0);
  useEffect(() => {
    if (holding.current === 0) setDraft(audioLab);
  }, [audioLab]);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AudioLabSettings | null>(null);
  const preview = useCallback((patch: Partial<AudioLabSettings>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      pending.current = next;
      if (!applyTimer.current) {
        applyTimer.current = setTimeout(() => {
          applyTimer.current = null;
          if (pending.current) audioEngine.applyAudioLab(pending.current);
        }, 24);
      }
      return next;
    });
  }, []);
  const commit = useCallback(
    (patch: Partial<AudioLabSettings>) => {
      holding.current = 0;
      setDraft((d) => ({ ...d, ...patch }));
      updateAudioLab(patch);
    },
    [updateAudioLab]
  );

  const gains = draft.bands.map((b) => b.gainDb);
  const preampDb = useMemo(() => autoPreampDb(draft), [draft]);
  const setBand = (idx: number, v: number, save: boolean) => {
    const bands = draft.bands.map((b, i) => (i === idx ? { ...b, gainDb: v } : b));
    const patch = { enabled: true, presetId: 'custom', bands };
    if (save) commit(patch);
    else preview(patch);
  };
  const activePreset = AUTO_EQ_PRESETS.find(
    (p) => draft.presetId === p.id && p.gains.every((g, i) => Math.abs(g - gains[i]) < 0.01)
  );
  const width = draft.stereoWidth ?? 100;
  const tick = () => haptic('selection');

  const statusLine = (() => {
    if (prefs.bitPerfect) return null;
    if (backend === 'native') {
      if (songBlocked)
        return {
          icon: 'warning' as const,
          color: HOLYSIC_COLORS.aacAmber,
          text:
            tap.reason === 'hls'
              ? vi
                ? 'Bài này phát dạng luồng HLS, iOS không cho xử lý nên EQ chưa áp dụng được. Bài từ nguồn khác, bài đã tải và tệp trên máy thì có.'
                : 'This song is an HLS stream, which iOS keeps out of reach, so the EQ cannot touch it. Other sources, downloads and local files work.'
              : vi
                ? 'iOS không mở được bộ xử lý cho bài này. Thử chuyển bài hoặc phát lại.'
                : "iOS couldn't open the processor for this song. Try skipping or replaying it.",
        };
      return {
        icon: 'pulse' as const,
        color: accent,
        text:
          (vi ? 'Xử lý âm thanh gốc trên iPhone' : 'Native iPhone audio processing') +
          (rate ? ` · ${(rate / 1000).toFixed(rate % 1000 ? 1 : 0)} kHz · 32-bit float` : ''),
      };
    }
    if (backend === 'web')
      return dspUsable
        ? {
            icon: 'pulse' as const,
            color: accent,
            text: vi ? 'Web Audio đang xử lý (bản xem thử)' : 'Web Audio processing (preview)',
          }
        : {
            icon: 'information-circle' as const,
            color: HOLYSIC_COLORS.aacAmber,
            text: vi
              ? 'Nguồn này chặn xử lý âm thanh trên trình duyệt (CORS). Trên iPhone EQ vẫn hoạt động.'
              : 'This source blocks in-browser processing (CORS). The EQ works on iPhone.',
          };
    return {
      icon: 'information-circle' as const,
      color: HOLYSIC_COLORS.aacAmber,
      text: vi
        ? 'Bộ xử lý âm thanh cần bản HolySic đã cài (IPA). Expo Go không có module này.'
        : 'The audio processor needs the installed HolySic app (IPA); Expo Go lacks it.',
    };
  })();

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
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
            <Text style={[styles.title, { fontFamily }]} numberOfLines={1}>
              Audio Lab
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {draft.enabled
                ? activePreset?.name || (vi ? 'Tuỳ chỉnh' : 'Custom')
                : vi
                  ? 'Đang tắt · âm thanh gốc'
                  : 'Off · original sound'}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Switch
              value={draft.enabled}
              onValueChange={(v) => {
                haptic('selection');
                commit({ enabled: v });
              }}
              trackColor={{ false: UI.surface('#2A2A36'), true: accent }}
              accessibilityLabel={vi ? 'Bật Audio Lab' : 'Audio Lab on'}
            />
            <Tap
              onPress={() => setIsAudioLabOpen(false)}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={UI.text} />
            </Tap>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!scrollLocked}
        >
          {prefs.bitPerfect && (
            <View style={[styles.note, { borderColor: accent + '55' }]}>
              <Ionicons name="lock-closed" size={17} color={accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.noteText}>
                  {vi
                    ? 'Bit-perfect đang bật nên Audio Lab được bỏ qua: tín hiệu đi thẳng, không qua EQ hay đổi tốc độ. Cài đặt của bạn vẫn được giữ.'
                    : 'Bit-perfect is on, so Audio Lab is bypassed: no EQ or speed change touches the signal. Your settings are kept.'}
                </Text>
                <Tap
                  onPress={() => updatePrefs({ bitPerfect: false })}
                  style={[styles.noteBtn, { backgroundColor: accent }]}
                  accessibilityLabel="Turn off bit-perfect"
                >
                  <Text style={{ color: palette.onAccent, fontWeight: '800', fontSize: 12.5 }}>
                    {vi ? 'Tắt bit-perfect' : 'Turn off bit-perfect'}
                  </Text>
                </Tap>
              </View>
            </View>
          )}
          {statusLine && (
            <View style={styles.statusRow}>
              <Ionicons name={statusLine.icon} size={15} color={statusLine.color} />
              <Text style={styles.statusText}>{statusLine.text}</Text>
            </View>
          )}

          <View pointerEvents={dspUsable ? 'auto' : 'none'} style={!dspUsable && { opacity: 0.4 }}>
            {/* ── EQ: curve + faders ── */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { fontFamily }]}>
                  {vi ? 'Equalizer 10 băng' : '10-band equalizer'}
                </Text>
                <Tap
                  onPress={() => {
                    haptic('light');
                    applyEqPreset('flat');
                  }}
                  hitSlop={8}
                  feedback="opacity"
                >
                  <Text style={[styles.link, { color: accent }]}>{vi ? 'Đặt lại' : 'Reset'}</Text>
                </Tap>
              </View>
              <EqCurve
                gains={gains}
                bassDb={bassDbOf(draft.bassBoost)}
                preampDb={preampDb}
                enabled={draft.enabled}
                color={accent}
              />
              <View style={styles.faders}>
                {draft.bands.map((b, idx) => (
                  <EqFader
                    key={b.freqHz}
                    value={b.gainDb}
                    label={BAND_LABELS[idx] || b.label}
                    color={accent}
                    enabled={draft.enabled}
                    haptic={tick}
                    onGrab={() => (holding.current += 1)}
                    onPreview={(v) => setBand(idx, v, false)}
                    onCommit={(v) => setBand(idx, v, true)}
                    accessibilityLabel={`${BAND_LABELS[idx]} Hz`}
                  />
                ))}
              </View>
              <Text style={styles.foot}>
                {draft.enabled && preampDb < -0.05
                  ? vi
                    ? `Preamp tự động ${preampDb.toFixed(1)} dB để không bị vỡ tiếng · chạm đúp một cột để về 0`
                    : `Auto pre-amp ${preampDb.toFixed(1)} dB so boosts never clip · double-tap a band to reset`
                  : vi
                    ? 'Kéo từng cột lên xuống · chạm đúp để về 0 dB'
                    : 'Drag a band up or down · double-tap for 0 dB'}
              </Text>
            </View>

            {/* ── presets ── */}
            <Text style={[styles.section, { fontFamily }]}>{vi ? 'Cấu hình sẵn' : 'Presets'}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingRight: 8 }}
            >
              {AUTO_EQ_PRESETS.map((preset) => {
                const selected = draft.enabled && activePreset?.id === preset.id;
                return (
                  <Tap
                    key={preset.id}
                    onPress={() => applyEqPreset(preset.id)}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: accent, borderColor: accent },
                    ]}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[styles.chipText, { color: selected ? palette.onAccent : UI.fg(1) }]}
                    >
                      {preset.name}
                    </Text>
                  </Tap>
                );
              })}
            </ScrollView>

            {/* ── tone & space ── */}
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { fontFamily }]}>
                {vi ? 'Âm trầm & không gian' : 'Bass & space'}
              </Text>
              <LabeledSlider
                label="Bass Boost"
                valueText={`+${bassDbOf(draft.bassBoost).toFixed(1)} dB`}
                value={draft.bassBoost / 100}
                color={accent}
                haptic={tick}
                onPreview={(v) => {
                  holding.current = 1;
                  preview({ enabled: true, bassBoost: Math.round(v * 100) });
                }}
                onCommit={(v) => commit({ enabled: true, bassBoost: Math.round(v * 100) })}
              />
              <LabeledSlider
                label={vi ? 'Reverb (phòng thu)' : 'Room reverb'}
                valueText={`${draft.reverbMix} %`}
                value={draft.reverbMix / 100}
                color={accent}
                haptic={tick}
                onPreview={(v) => {
                  holding.current = 1;
                  preview({ enabled: true, reverbMix: Math.round(v * 100) });
                }}
                onCommit={(v) => commit({ enabled: true, reverbMix: Math.round(v * 100) })}
              />
              {backend !== 'web' && (
                <LabeledSlider
                  label={vi ? 'Độ rộng stereo' : 'Stereo width'}
                  valueText={width === 0 ? 'Mono' : `${width} %`}
                  value={width / 200}
                  color={accent}
                  haptic={tick}
                  hint={
                    vi
                      ? '0 % = mono · 100 % = gốc · 200 % = rộng hơn khi đeo tai nghe'
                      : '0 % = mono · 100 % = original · 200 % = wider on headphones'
                  }
                  onPreview={(v) => {
                    holding.current = 1;
                    preview({ enabled: true, stereoWidth: Math.round(v * 40) * 5 });
                  }}
                  onCommit={(v) => commit({ enabled: true, stereoWidth: Math.round(v * 40) * 5 })}
                />
              )}
            </View>

            {/* ── 8D ── */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.cardTitle, { fontFamily }]}>8D Audio</Text>
                  <Text style={styles.subNote}>
                    {vi
                      ? 'Âm thanh xoay quanh đầu, nghe rõ nhất bằng tai nghe'
                      : 'The sound orbits your head; best on headphones'}
                  </Text>
                </View>
                <Switch
                  value={draft.eightDEnabled}
                  onValueChange={(v) => {
                    haptic('selection');
                    commit({ enabled: true, eightDEnabled: v });
                  }}
                  trackColor={{ false: UI.surface('#2A2A36'), true: accent }}
                  accessibilityLabel="8D Audio"
                />
              </View>
              {draft.eightDEnabled && (
                <LabeledSlider
                  label={vi ? 'Một vòng mất' : 'One orbit takes'}
                  valueText={`${draft.eightDSpeedSec}s`}
                  value={(draft.eightDSpeedSec - 4) / 12}
                  color={accent}
                  haptic={tick}
                  onPreview={(v) => {
                    holding.current = 1;
                    preview({ eightDSpeedSec: 4 + Math.round(v * 12) });
                  }}
                  onCommit={(v) => commit({ eightDSpeedSec: 4 + Math.round(v * 12) })}
                />
              )}
            </View>
          </View>

          {/* ── speed & pitch (AVPlayer itself: works for every source) ── */}
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { fontFamily }]}>
              {vi ? 'Tốc độ & cao độ' : 'Speed & pitch'}
            </Text>
            <View style={styles.segment}>
              {SPEEDS.map((opt) => {
                const active = Math.abs(draft.playbackRate - opt.rate) < 0.02;
                return (
                  <Tap
                    key={opt.id}
                    onPress={() => {
                      haptic('selection');
                      commit({
                        enabled: true,
                        playbackRate: opt.rate,
                        preservePitch: opt.pitch,
                        reverbMix: opt.rev,
                      });
                    }}
                    style={[styles.segItem, active && { backgroundColor: accent }]}
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.segText, { color: active ? palette.onAccent : UI.fg(1) }]}
                    >
                      {vi ? opt.vi : opt.en}
                    </Text>
                  </Tap>
                );
              })}
            </View>
            <LabeledSlider
              label={vi ? 'Tốc độ phát' : 'Playback speed'}
              valueText={`${draft.playbackRate.toFixed(2)}×`}
              value={(draft.playbackRate - 0.5) / 1}
              color={accent}
              haptic={tick}
              onPreview={(v) => {
                holding.current = 1;
                preview({ enabled: true, playbackRate: Math.round((0.5 + v) * 20) / 20 });
              }}
              onCommit={(v) =>
                commit({ enabled: true, playbackRate: Math.round((0.5 + v) * 20) / 20 })
              }
            />
            <View style={[styles.cardHead, { marginTop: 14, marginBottom: 0 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.rowLabel}>{vi ? 'Giữ cao độ' : 'Keep pitch'}</Text>
                <Text style={styles.subNote}>
                  {vi
                    ? 'Tắt để giọng cao lên khi nhanh (Nightcore), trầm xuống khi chậm'
                    : 'Off: voices rise when faster (Nightcore), drop when slower'}
                </Text>
              </View>
              <Switch
                value={draft.preservePitch}
                onValueChange={(v) => {
                  haptic('selection');
                  commit({ preservePitch: v });
                }}
                trackColor={{ false: UI.surface('#2A2A36'), true: accent }}
              />
            </View>
          </View>
        </ScrollView>
      </View>
      <SheetSlot layer="audiolab" />
    </Modal>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: UI.fg(0.18),
    marginBottom: 8,
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
  title: { color: UI.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: UI.text2, fontSize: 12.5, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: UI.fg(0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  statusText: { flex: 1, color: UI.text2, fontSize: 12.5, lineHeight: 17 },
  note: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: UI.fg(0.05),
    marginBottom: 12,
  },
  noteText: { color: UI.fg(0.88), fontSize: 12.5, lineHeight: 18 },
  noteBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
  },
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: UI.fg(0.05),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: UI.fg(0.1),
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: { color: UI.text, fontSize: 16, fontWeight: '800' },
  link: { fontSize: 13.5, fontWeight: '700' },
  faders: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  foot: { color: UI.text3, fontSize: 11.5, marginTop: 10, lineHeight: 16, textAlign: 'center' },
  section: { color: UI.text, fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 6 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: UI.fg(0.07),
    borderWidth: 1,
    borderColor: UI.fg(0.12),
  },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  subNote: { color: UI.text2, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  rowLabel: { color: UI.text, fontSize: 14, fontWeight: '700' },
  segment: {
    flexDirection: 'row',
    marginTop: 12,
    padding: 3,
    borderRadius: 12,
    backgroundColor: UI.fg(0.07),
  },
  segItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  segText: { fontSize: 12, fontWeight: '700' },
}));
