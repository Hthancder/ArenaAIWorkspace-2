// Settings › Playback › MIDI: which sound plays MIDI files (the real-instrument sample bank or the
// light synth), which piano stands in for GM program 0, and the downloaded instruments (the bank
// comes per instrument, on demand — see services/audio/sf/instruments.ts).

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { MIDI_PIANOS, MidiRender } from '../../services/audio/midiRender';
import { INSTRUMENTS, Instruments, useInstruments } from '../../services/audio/sf/instruments';
import { formatBytes } from '../../services/storage/storageUsage';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';
import { InstrumentManager } from './InstrumentManager';

export const MidiSoundCard: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic } = useHolySic();
  const vi = prefs.language === 'vi';
  const sound = prefs.midiSound || 'sampled';
  const piano = prefs.midiPiano || '0:0';
  const supported = MidiRender.bankSupported();
  const auto = prefs.midiAutoDownload !== false;
  const inst = useInstruments();
  const [manage, setManage] = useState(false);
  const stored = Instruments.storedBytes();
  const count = INSTRUMENTS.filter((p) => !p.hidden && Instruments.readyFor([p.i])).length;

  const choices = [
    {
      id: 'sampled' as const,
      icon: 'musical-notes' as const,
      title: vi ? 'Nhạc cụ thật' : 'Real instruments',
      desc: vi
        ? 'Bộ mẫu GeneralUser GS: piano thu âm nhiều lớp, dây, kèn, guitar, 13 bộ trống — 128 nhạc cụ GM và 133 biến thể GS, bài cần nhạc cụ nào tải nhạc cụ đó'
        : 'GeneralUser GS sample bank: multi-layer recorded pianos, strings, brass, guitars, 13 drum kits — 128 GM instruments plus 133 GS variations, each downloaded when a song needs it',
    },
    {
      id: 'synth' as const,
      icon: 'pulse' as const,
      title: vi ? 'Nhẹ (tổng hợp)' : 'Light (synth)',
      desc: vi
        ? 'Âm tổng hợp nhỏ gọn, dựng xong gần như tức thì'
        : 'A compact procedural synth that renders almost instantly',
    },
  ];

  return (
    <>
      <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>MIDI</Text>
      <View style={styles.card}>
        {choices.map((c, i) => {
          const on = sound === c.id;
          return (
            <Tap
              key={c.id}
              feedback="opacity"
              onPress={() => {
                if (on) return;
                haptic('light');
                updatePrefs({ midiSound: c.id });
              }}
              style={[styles.choice, i > 0 && styles.divider]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.title}
            >
              <View style={[styles.icon, { backgroundColor: palette.accent + (on ? '33' : '14') }]}>
                <Ionicons name={c.icon} size={17} color={palette.accent} />
              </View>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.title}>{c.title}</Text>
                <Text style={styles.desc}>{c.desc}</Text>
              </View>
              <Ionicons
                name={on ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={on ? palette.accent : UI.fg(0.25)}
              />
            </Tap>
          );
        })}

        {sound === 'sampled' && (
          <View style={styles.pianoBox}>
            <Text style={styles.label}>{vi ? 'Tiếng piano' : 'Piano voice'}</Text>
            <View style={styles.chips}>
              {MIDI_PIANOS.map((p) => {
                const on = piano === p.id;
                return (
                  <Tap
                    key={p.id}
                    onPress={() => {
                      if (on) return;
                      haptic('light');
                      updatePrefs({ midiPiano: p.id });
                    }}
                    style={[styles.chip, on && { backgroundColor: palette.accent }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={vi ? p.vi : p.en}
                  >
                    <Text style={[styles.chipText, on && { color: palette.onAccent }]}>
                      {vi ? p.vi : p.en}
                    </Text>
                  </Tap>
                );
              })}
            </View>
            <Text style={[styles.desc, { marginTop: 8 }]}>
              {vi
                ? 'Thay cho piano mặc định (GM 0) trong mọi bài MIDI. Các nhạc cụ khác giữ đúng như bài viết.'
                : 'Replaces the default piano (GM 0) in every MIDI song. Other instruments stay as written.'}
            </Text>
          </View>
        )}

        {sound === 'sampled' && supported && (
          <View style={styles.pianoBox}>
            <Tap
              feedback="opacity"
              onPress={() => setManage(true)}
              style={styles.manageRow}
              accessibilityRole="button"
              accessibilityLabel={vi ? 'Quản lý nhạc cụ' : 'Manage instruments'}
            >
              <View style={[styles.icon, { backgroundColor: palette.accent + '14' }]}>
                <Ionicons name="download-outline" size={17} color={palette.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{vi ? 'Nhạc cụ đã tải' : 'Downloaded instruments'}</Text>
                <Text style={styles.desc}>
                  {inst.files
                    ? vi
                      ? `Đang tải… ${formatBytes(inst.doneBytes, vi)} / ${formatBytes(inst.bytes, vi)}`
                      : `Downloading… ${formatBytes(inst.doneBytes, vi)} / ${formatBytes(inst.bytes, vi)}`
                    : count
                      ? vi
                        ? `${count} nhạc cụ · ${formatBytes(stored, vi)}`
                        : `${count} instruments · ${formatBytes(stored, vi)}`
                      : vi
                        ? 'Chưa có — tự tải khi phát bài MIDI'
                        : 'None yet — downloaded when a MIDI song plays'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={UI.text3} />
            </Tap>
            <View style={[styles.manageRow, { marginTop: 6 }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.title}>{vi ? 'Tự tải nhạc cụ' : 'Download automatically'}</Text>
                <Text style={styles.desc}>
                  {auto
                    ? vi
                      ? 'Bài cần nhạc cụ chưa có thì tải ngay khi phát (chỉ lần đầu).'
                      : "A song's missing instruments download when it plays (first time only)."
                    : vi
                      ? 'Tắt: chỉ dùng nhạc cụ đã tải, bài thiếu nhạc cụ tạm phát bằng âm Nhẹ.'
                      : 'Off: only downloaded instruments are used; songs missing some use the Light sound.'}
                </Text>
              </View>
              <Switch
                value={auto}
                onValueChange={(v) => {
                  haptic('selection');
                  updatePrefs({ midiAutoDownload: v });
                }}
                trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
                accessibilityLabel={vi ? 'Tự tải nhạc cụ' : 'Download instruments automatically'}
              />
            </View>
          </View>
        )}

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={14} color={UI.text2} />
          <Text style={styles.noteText}>
            {!supported && sound === 'sampled'
              ? vi
                ? 'Bản cài này chưa hỗ trợ nhạc cụ thật — MIDI tạm phát bằng âm Nhẹ. Cài bản build mới để dùng.'
                : "This build can't play real instruments yet — MIDI uses the Light sound until you install a newer build."
              : vi
                ? 'Đổi âm thanh: bài MIDI được dựng lại ở lần phát tới (bản cũ vẫn giữ trong Dung lượng để mở lại tức thì).'
                : 'Changing the sound re-renders a MIDI song on its next play (older renders stay cached, see Storage).'}
          </Text>
        </View>
      </View>
      {manage && (
        <InstrumentManager visible onClose={() => setManage(false)} fontFamily={fontFamily} />
      )}
    </>
  );
};

const styles = themedSheet(() => ({
  sectionTitle: {
    color: UI.text,
    fontSize: 17.5,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  card: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: UI.fg(0.07), marginTop: 4, paddingTop: 12 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: UI.text, fontSize: 14.5, fontWeight: '700' },
  desc: { color: UI.text2, fontSize: 12.5, marginTop: 2, lineHeight: 18 },
  pianoBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: UI.fg(0.07) },
  label: {
    color: UI.text2,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: UI.fg(0.07),
  },
  chipText: { color: UI.text, fontSize: 12.5, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'flex-start' },
  noteText: { flex: 1, color: UI.text2, fontSize: 11.5, lineHeight: 16 },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
