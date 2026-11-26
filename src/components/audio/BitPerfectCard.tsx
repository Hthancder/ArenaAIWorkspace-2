// Settings › Audio quality: the bit-perfect switch and the live signal path behind it.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Switch, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { T as UI, themedSheet } from '../../theme/ui';
import { SignalPathList } from './SignalPathList';
import { useSignalPath } from './useSignalPath';

export const BitPerfectCard: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, currentTrack } = useHolySic();
  const vi = prefs.language === 'vi';
  const path = useSignalPath();
  const on = prefs.bitPerfect;

  return (
    <>
      <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
        {vi ? 'Chất lượng âm thanh' : 'Audio quality'}
      </Text>
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: palette.accent + '22' }]}>
            <Ionicons name="pulse" size={18} color={palette.accent} />
          </View>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.title}>Bit-perfect</Text>
            <Text style={styles.desc}>
              {vi
                ? 'Phát đúng từng mẫu âm của tệp: tắt mọi xử lý, âm lượng phần mềm 100 %, ưu tiên nguồn lossless và cho đầu ra chạy đúng tần số của bài'
                : 'Play every sample as it is: no processing, software volume at 100 %, lossless sources first and the output at the song’s own sample rate'}
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={(v) => updatePrefs({ bitPerfect: v })}
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
            accessibilityLabel="Bit-perfect"
          />
        </View>

        {on ? (
          <>
            {currentTrack ? (
              <View style={styles.pathBox}>
                <View style={styles.verdict}>
                  <Ionicons
                    name={path.perfect ? 'checkmark-done-circle' : 'git-network-outline'}
                    size={16}
                    color={path.perfect ? '#34D399' : UI.text2}
                  />
                  <Text style={[styles.verdictText, path.perfect && { color: '#34D399' }]}>
                    {path.perfect
                      ? vi
                        ? 'Đang bit-perfect — tín hiệu tới DAC nguyên vẹn'
                        : 'Bit-perfect now — samples reach the DAC untouched'
                      : vi
                        ? `Đường tín hiệu · ${currentTrack.title}`
                        : `Signal path · ${currentTrack.title}`}
                  </Text>
                </View>
                <SignalPathList
                  checks={path.checks}
                  text={UI.text}
                  text2={UI.text2}
                  line={UI.fg(0.1)}
                />
              </View>
            ) : (
              <Text style={styles.note}>
                {vi
                  ? 'Phát một bài để xem đường tín hiệu (nguồn → xử lý → âm lượng → đầu ra).'
                  : 'Play a song to see its signal path (source → processing → volume → output).'}
              </Text>
            )}
            <Text style={styles.note}>
              {vi
                ? 'Tạm tắt khi bật: Audio Lab, chuẩn hoá âm lượng, crossfade, thanh âm lượng trong app. Bit-perfect thật cần DAC USB có dây — loa trong, AirPods và Bluetooth luôn bị iOS đổi tần số hoặc nén lại.'
                : 'Paused while on: Audio Lab, normalisation, crossfade and the in-app volume slider. True bit-perfect needs a wired USB DAC — the speaker, AirPods and Bluetooth are always resampled or re-encoded by iOS.'}
            </Text>
          </>
        ) : null}
      </View>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { color: UI.text, fontSize: 15, fontWeight: '800' },
  desc: { color: UI.text2, fontSize: 12.5, marginTop: 2, lineHeight: 18 },
  pathBox: {
    marginTop: 14,
    padding: 13,
    borderRadius: 16,
    backgroundColor: UI.fg(0.04),
    borderWidth: 1,
    borderColor: UI.fg(0.06),
  },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  verdictText: { flex: 1, color: UI.text2, fontSize: 12.5, fontWeight: '700' },
  note: { color: UI.text3, fontSize: 12, lineHeight: 17, marginTop: 12 },
}));
