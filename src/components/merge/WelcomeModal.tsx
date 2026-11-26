// First-run welcome (Spotube's welcome module): choose language and accent colour, then a quick
// tour of what HolySic can do, including the features merged from OpenSpot, Musike and Cog.
// Shown once. Existing users see it once after updating, as a "what's new".

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT_PRESETS } from '../../constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { HolySicMarkIcon } from '../HolySicIcons';

const FEATURES: { icon: string; vi: string; en: string; dvi: string; den: string }[] = [
  {
    icon: 'flash',
    vi: 'Phát bản đầy đủ, nhiều nguồn',
    en: 'Full tracks, many sources',
    dvi: 'YouTube Music · Monochrome FLAC · JioSaavn, tự nhớ nguồn chạy tốt',
    den: 'YouTube Music · Monochrome FLAC · JioSaavn with source memory',
  },
  {
    icon: 'link',
    vi: 'Dán link là nghe',
    en: 'Paste a link to play',
    dvi: 'YouTube, Spotify, Apple Music; nhập cả playlist Spotify/YouTube',
    den: 'YouTube, Spotify, Apple Music; import whole playlists',
  },
  {
    icon: 'globe-outline',
    vi: 'Bảng xếp hạng 60 quốc gia',
    en: 'Charts in 60 countries',
    dvi: 'Lọc theo thể loại: K-Pop, Hip-Hop, Indie…',
    den: 'Filter by genre: K-Pop, Hip-Hop, Indie…',
  },
  {
    icon: 'list',
    vi: 'Tìm theo danh sách',
    en: 'Search a list',
    dvi: 'Dán cả danh sách bài, chọn bản đúng, lưu thành playlist',
    den: 'Paste a song list, pick versions, save as playlist',
  },
  {
    icon: 'pulse',
    vi: 'Chuẩn hoá âm lượng',
    en: 'Volume normalisation',
    dvi: 'ReplayGain/loudness từ nguồn, chống vỡ tiếng',
    den: 'Source ReplayGain/loudness with clipping prevention',
  },
  {
    icon: 'radio-outline',
    vi: 'Scrobble Last.fm & ListenBrainz',
    en: 'Last.fm & ListenBrainz',
    dvi: 'Lưu lịch sử nghe lên tài khoản của bạn',
    den: 'Scrobble your listening history',
  },
  {
    icon: 'folder-open-outline',
    vi: 'Nghe tệp từ ứng dụng Tệp',
    en: 'Play files from Files',
    dvi: 'MP3, M4A, FLAC, WAV… offline',
    den: 'MP3, M4A, FLAC, WAV… offline',
  },
  {
    icon: 'shield-checkmark-outline',
    vi: 'Sao lưu & danh sách chặn',
    en: 'Backup & blacklist',
    dvi: 'Xuất/nhập thư viện, chặn bài hoặc nghệ sĩ',
    den: 'Export/import library, block songs or artists',
  },
];

export const WelcomeModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { prefs, updatePrefs, palette } = useHolySic();
  const [step, setStep] = useState(0);
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  if (prefs.onboarded) return null;

  const finish = () => updatePrefs({ onboarded: true });

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={finish}>
      <LinearGradient
        colors={[palette.gradient[0], '#0A0A0F', '#050507']}
        style={[styles.root, { paddingTop: insets.top + 24 }]}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 120 }}
        >
          <View style={[styles.logo, { backgroundColor: palette.container }]}>
            <HolySicMarkIcon size={40} color={palette.accent} filled />
          </View>
          <Text style={[styles.h1, { fontFamily }]}>
            {vi ? 'Chào mừng đến HolySic' : 'Welcome to HolySic'}
          </Text>
          <Text style={styles.lead}>
            {vi
              ? 'Trình phát nhạc iOS gom những điểm mạnh nhất của nhiều dự án mã nguồn mở. Miễn phí, không quảng cáo, không theo dõi.'
              : 'An iOS music player with the best ideas from several open-source projects. Free, no ads, no tracking.'}
          </Text>

          {step === 0 ? (
            <>
              <Text style={styles.label}>{vi ? 'Ngôn ngữ' : 'Language'}</Text>
              <View style={styles.row}>
                {(['vi', 'en'] as const).map((l) => (
                  <Pressable
                    key={l}
                    onPress={() => updatePrefs({ language: l })}
                    style={[
                      styles.choice,
                      prefs.language === l && {
                        borderColor: palette.accent,
                        backgroundColor: palette.accent + '22',
                      },
                    ]}
                  >
                    <Text style={styles.choiceText}>
                      {l === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>{vi ? 'Màu nhấn' : 'Accent colour'}</Text>
              <View style={styles.swatches}>
                {ACCENT_PRESETS.map((a) => {
                  const active = prefs.accentColor === a.color;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => updatePrefs({ accentColor: a.color })}
                      style={styles.swatchWrap}
                    >
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: a.color === 'dynamic' ? '#333' : a.color },
                          active && { borderColor: '#FFF', borderWidth: 3 },
                        ]}
                      >
                        {a.color === 'dynamic' && (
                          <Ionicons name="color-palette" size={18} color="#FFF" />
                        )}
                      </View>
                      <Text style={styles.swatchLabel}>{vi ? a.vi : a.en}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={{ gap: 10, marginTop: 8 }}>
              {FEATURES.map((f) => (
                <View key={f.icon} style={styles.feature}>
                  <View style={[styles.featureIcon, { backgroundColor: palette.accent + '22' }]}>
                    <Ionicons name={f.icon as any} size={18} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureTitle}>{vi ? f.vi : f.en}</Text>
                    <Text style={styles.featureDesc}>{vi ? f.dvi : f.den}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable onPress={finish}>
            <Text style={{ color: HOLYSIC_COLORS.textMuted, fontWeight: '700' }}>
              {vi ? 'Bỏ qua' : 'Skip'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => (step === 0 ? setStep(1) : finish())}
            style={[styles.next, { backgroundColor: palette.accent }]}
          >
            <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
              {step === 0 ? (vi ? 'Tiếp' : 'Next') : vi ? 'Bắt đầu nghe' : 'Start listening'}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={palette.onAccent} />
          </Pressable>
        </View>
      </LinearGradient>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  h1: { color: '#FFF', fontSize: 30, fontWeight: '900' },
  lead: { color: HOLYSIC_COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 8 },
  label: { color: '#FFF', fontWeight: '800', fontSize: 15, marginTop: 26, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: HOLYSIC_COLORS.glassBorder,
    alignItems: 'center',
  },
  choiceText: { color: '#FFF', fontWeight: '700' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatchWrap: { alignItems: 'center', width: 64 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  feature: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  featureDesc: { color: HOLYSIC_COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 12,
    backgroundColor: 'rgba(5,5,7,0.92)',
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 99,
  },
});
