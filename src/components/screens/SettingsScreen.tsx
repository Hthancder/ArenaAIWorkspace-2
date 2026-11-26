// Mochy Tab (Settings, Player Customizer, Source Modules, iOS Install Guide & Complete Open-Source Credits)
// Preserves full attribution to realidkroo/Mochy-Music and all upstream open-source contributors.

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MOCHY_DISCORD_URL, MOCHY_ORIGIN_URL, UPSTREAM_CREDITS } from '../../constants/credits';
import { t } from '../../constants/i18n';
import {
  AppFontStyle,
  JioSaavnQuality,
  PLAYER_STYLE_META,
  PlayerBackgroundStyle,
  PlayerStyle,
} from '../../constants/preferences';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { StreamFileCache } from '../../services/audio/streamFileCache';
import { SourceMemory } from '../../services/providers/sourceMemory';
import { MochyMarkIcon } from '../MochyIcons';

export const SettingsScreen: React.FC = () => {
  const {
    prefs,
    updatePrefs,
    palette,
    setIsAudioLabOpen,
    setIsRecapOpen,
    monochromeServers,
    addMonochromeServer,
    removeMonochromeServer,
    verifyAllServers,
    haptic,
  } = useMochy();

  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerKind, setNewServerKind] = useState<'streamer' | 'relay'>('relay');
  const [verifying, setVerifying] = useState(false);
  const [memoryCount, setMemoryCount] = useState(() => SourceMemory.stats().tracks);

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const moveModuleUp = (idx: number) => {
    if (idx <= 0) return;
    haptic('selection');
    const order = [...prefs.moduleOrder];
    const tmp = order[idx - 1];
    order[idx - 1] = order[idx];
    order[idx] = tmp;
    updatePrefs({ moduleOrder: order });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero Brand Banner */}
      <View style={[styles.brandBanner, { borderColor: palette.accent + '35' }]}>
        <View style={[styles.heroIconWrap, { backgroundColor: palette.container }]}>
          <MochyMarkIcon size={36} color={palette.accent} filled />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.brandName, { fontFamily }]}>Mochy Music · iOS</Text>
          <Text style={styles.brandSub}>
            {vi
              ? 'Bản port iOS (Expo / React Native) dựa trên Mochy Music bởi realidkroo · GPL-3.0 >_<'
              : 'iOS port built on top of Mochy Music by realidkroo · GPL-3.0 >_<'}
          </Text>
          <View style={styles.bannerLinksRow}>
            <Pressable
              onPress={() => Linking.openURL(MOCHY_ORIGIN_URL)}
              style={[styles.miniLinkPill, { backgroundColor: palette.accent }]}
            >
              <Ionicons name="logo-github" size={14} color={palette.onAccent} />
              <Text style={{ color: palette.onAccent, fontSize: 12, fontWeight: '800' }}>
                Mochy GitHub
              </Text>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(MOCHY_DISCORD_URL)}
              style={styles.miniLinkPillGhost}
            >
              <Ionicons name="chatbubbles-outline" size={14} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
                Mochy&apos;s Bar
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Quick Tools */}
      <View style={styles.quickRow}>
        <Pressable
          onPress={() => setIsAudioLabOpen(true)}
          style={styles.quickToolCard}
        >
          <Ionicons name="options" size={22} color={palette.accent} />
          <Text style={styles.quickToolTitle}>Audio Lab & EQ</Text>
          <Text style={styles.quickToolSub}>AutoEQ · 8D · Reverb</Text>
        </Pressable>

        <Pressable
          onPress={() => setIsRecapOpen(true)}
          style={styles.quickToolCard}
        >
          <Ionicons name="id-card" size={22} color="#34D399" />
          <Text style={styles.quickToolTitle}>Mochy Recap ID</Text>
          <Text style={styles.quickToolSub}>Stats & Listener Card</Text>
        </Pressable>
      </View>

      {/* Language Switch */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Ngôn ngữ / Language' : 'Language / Ngôn ngữ'}
      </Text>
      <View style={styles.segmentedRow}>
        {(['vi', 'en'] as const).map((lang) => {
          const active = prefs.language === lang;
          return (
            <Pressable
              key={lang}
              onPress={() => {
                haptic('selection');
                updatePrefs({ language: lang });
              }}
              style={[
                styles.segmentBtn,
                active && { backgroundColor: palette.accent },
              ]}
            >
              <Text
                style={{
                  fontWeight: '800',
                  color: active ? palette.onAccent : '#FFFFFF',
                }}
              >
                {lang === 'vi' ? '🇻🇳 Tiếng Việt' : '🌐 English'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Player Style Selector */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'playerStyleTitle')}
      </Text>
      <View style={styles.cardGroup}>
        {PLAYER_STYLE_META.map((meta) => {
          const active = prefs.playerStyle === meta.id;
          return (
            <Pressable
              key={meta.id}
              onPress={() => {
                haptic('selection');
                updatePrefs({ playerStyle: meta.id as PlayerStyle });
              }}
              style={[
                styles.styleRow,
                active && {
                  borderColor: palette.accent,
                  backgroundColor: palette.container + '55',
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {vi ? meta.titleVi : meta.titleEn}
                </Text>
                <Text style={styles.rowDesc}>
                  {vi ? meta.descVi : meta.descEn}
                </Text>
              </View>
              <Ionicons
                name={active ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={active ? palette.accent : MOCHY_COLORS.textMuted}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Customize Mochy Appearance */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'customizeLook')}
      </Text>
      <View style={styles.cardGroup}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{t(prefs.language, 'pureBlackOled')}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tiết kiệm pin tối đa trên màn hình OLED của iPhone'
                : 'Pitch-black #000000 surfaces for iPhone Super Retina OLED'}
            </Text>
          </View>
          <Switch
            value={prefs.pureBlack}
            onValueChange={(v) => updatePrefs({ pureBlack: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{t(prefs.language, 'frostedBlur')}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tắt nếu muốn máy đời cũ chạy siêu mượt (như gợi ý trong FAQ Mochy)'
                : 'Disable blur on older devices for maximum frame rate'}
            </Text>
          </View>
          <Switch
            value={prefs.enableBlur}
            onValueChange={(v) => updatePrefs({ enableBlur: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{t(prefs.language, 'miniLyricsTicker')}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Hiển thị câu hát đang phát ngay trên thanh MiniPlayer'
                : 'Show active lyric line inside the floating MiniPlayer'}
            </Text>
          </View>
          <Switch
            value={prefs.showMiniLyricsTicker}
            onValueChange={(v) => updatePrefs({ showMiniLyricsTicker: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        {/* Player Background Mode */}
        <Text style={[styles.inlineSubLabel, { marginTop: 12 }]}>
          {vi ? 'Hiệu ứng màu nền Player' : 'Player Background Palette'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
            {(
              [
                ['APPLE_MUSIC', 'Apple Mesh'],
                ['COVER_GRADIENT', 'Cover Gradient'],
                ['DARK_GRADIENT', 'Dark Tone'],
                ['SOLID', 'Solid OLED'],
              ] as [PlayerBackgroundStyle, string][]
            ).map(([id, label]) => {
              const selected = prefs.playerBackground === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => updatePrefs({ playerBackground: id })}
                  style={[
                    styles.smallOptionPill,
                    selected && { backgroundColor: palette.accent },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: selected ? palette.onAccent : '#FFF',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* Font Customizer */}
        <Text style={[styles.inlineSubLabel, { marginTop: 10 }]}>
          {vi ? 'Phông chữ ứng dụng (App Font)' : 'App Typography'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
            {(
              [
                ['inter', 'Inter / SF'],
                ['rounded', 'SF Rounded'],
                ['serif', 'New York Serif'],
                ['mono', 'SF Mono'],
              ] as [AppFontStyle, string][]
            ).map(([id, label]) => {
              const selected = prefs.fontStyle === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => updatePrefs({ fontStyle: id })}
                  style={[
                    styles.smallOptionPill,
                    selected && { backgroundColor: palette.accent },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: selected ? palette.onAccent : '#FFF',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Audio Source Modules & Priority Order */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'sourceModules')}
      </Text>
      <View style={styles.cardGroup}>
        <Text style={styles.rowDesc}>
          {vi
            ? 'Thứ tự ưu tiên khi Mochy tìm luồng nhạc chất lượng cao nhất cho bài hát:'
            : 'Module resolution priority when matching tracks:'}
        </Text>

        {prefs.moduleOrder.map((modId, idx) => {
          const enabled = prefs.enabledModules[modId];
          const labelMap: Record<typeof modId, string> = {
            monochrome: 'Monochrome · Lossless FLAC (16/24-bit)',
            jiosaavn: `JioSaavn · Full AAC (${prefs.preferredJioSaavnQuality} kbps)`,
            innertube: 'YouTube Music InnerTube (iOS / visionOS)',
            itunes: vi ? 'Apple · Preview 30s (chỉ khi cho phép)' : 'Apple · 30s preview (only if allowed)',
          };
          return (
            <View key={modId} style={styles.moduleRow}>
              <Pressable
                disabled={idx === 0}
                onPress={() => moveModuleUp(idx)}
                style={[styles.upBtn, idx === 0 && { opacity: 0.25 }]}
              >
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.moduleLabel, !enabled && { opacity: 0.45 }]}>
                {idx + 1}. {labelMap[modId]}
              </Text>
              <Switch
                value={enabled}
                onValueChange={(v) =>
                  updatePrefs({
                    enabledModules: { ...prefs.enabledModules, [modId]: v },
                  })
                }
                trackColor={{ false: '#2A2A36', true: palette.accent }}
              />
            </View>
          );
        })}

        {/* Playback source behaviour */}
        <View style={[styles.switchRow, { marginTop: 10 }]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>
              {vi ? 'Nhớ nguồn phát được' : 'Remember working sources'}
            </Text>
            <Text style={styles.rowDesc}>
              {vi
                ? `Bài đã phát được sẽ dùng lại đúng nguồn đó lần sau, nguồn hay lỗi bị xếp xuống cuối (${memoryCount} bài đã nhớ)`
                : `Replays use the source that worked last time; failing modules are tried last (${memoryCount} remembered)`}
            </Text>
          </View>
          <Switch
            value={prefs.rememberSources}
            onValueChange={(v) => updatePrefs({ rememberSources: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>
              {vi ? 'Ưu tiên phát ngay' : 'Prefer instant start'}
            </Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Trên iPhone, FLAC Monochrome phải tải về 1 lần (~30 MB) mới phát được, nên chỉ dùng khi nguồn phát ngay (YouTube / JioSaavn) không có. Tắt nếu luôn muốn lossless.'
                : 'On iPhone, Monochrome FLAC needs a one-time ~30 MB download, so it is used after instant sources. Turn off to always prefer lossless.'}
            </Text>
          </View>
          <Switch
            value={prefs.preferInstantStart}
            onValueChange={(v) => updatePrefs({ preferInstantStart: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>
              {vi ? 'Cho phép bản preview 30 giây' : 'Allow 30-second previews'}
            </Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tắt (mặc định): chỉ phát bản đầy đủ, không bao giờ phát đoạn preview Apple 30s. Bật: dùng preview khi mọi nguồn đầy đủ đều lỗi.'
                : 'Off (default): full-length tracks only. On: fall back to Apple 30s previews when every full source fails.'}
            </Text>
          </View>
          <Switch
            value={prefs.allowPreviewFallback}
            onValueChange={(v) => updatePrefs({ allowPreviewFallback: v })}
            trackColor={{ false: '#2A2A36', true: palette.accent }}
          />
        </View>

        <Pressable
          onPress={() => {
            haptic('selection');
            SourceMemory.clear();
            StreamFileCache.clear();
            setMemoryCount(0);
          }}
          style={{ marginTop: 6, alignSelf: 'flex-start' }}
        >
          <Text style={{ color: palette.accent, fontSize: 12, fontWeight: '700' }}>
            {vi ? 'Xoá bộ nhớ nguồn & cache FLAC' : 'Clear source memory & FLAC cache'}
          </Text>
        </Pressable>

        {/* JioSaavn Bitrate Choice */}
        <Text style={[styles.inlineSubLabel, { marginTop: 12 }]}>
          JioSaavn Stream Bitrate
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['320', '160', '96'] as JioSaavnQuality[]).map((q) => {
            const active = prefs.preferredJioSaavnQuality === q;
            return (
              <Pressable
                key={q}
                onPress={() => updatePrefs({ preferredJioSaavnQuality: q })}
                style={[
                  styles.smallOptionPill,
                  active && { backgroundColor: palette.accent },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: active ? palette.onAccent : '#FFF',
                  }}
                >
                  AAC {q} kbps
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Monochrome Relay Server List */}
        <View style={styles.relaySection}>
          <View style={styles.relayTopRow}>
            <Text style={styles.inlineSubLabel}>Monochrome FLAC Servers</Text>
            <Pressable
              disabled={verifying}
              onPress={async () => {
                setVerifying(true);
                await verifyAllServers();
                setVerifying(false);
              }}
            >
              <Text style={{ color: palette.accent, fontSize: 12, fontWeight: '700' }}>
                {verifying ? 'Checking…' : t(prefs.language, 'verifyServers')}
              </Text>
            </Pressable>
          </View>

          {monochromeServers.map((srv) => (
            <View key={srv.url} style={styles.srvRow}>
              <Ionicons
                name={
                  srv.lastStatus === 'ok'
                    ? 'checkmark-circle'
                    : srv.lastStatus === 'down'
                      ? 'alert-circle'
                      : 'radio-outline'
                }
                size={16}
                color={
                  srv.lastStatus === 'ok'
                    ? '#34D399'
                    : srv.lastStatus === 'down'
                      ? '#FBBF24'
                      : '#94A3B8'
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>
                  {srv.name} ({srv.kind})
                </Text>
                {srv.lastMessage && (
                  <Text style={{ color: MOCHY_COLORS.textMuted, fontSize: 11 }}>
                    {srv.lastMessage}
                  </Text>
                )}
              </View>
              {!srv.builtIn && (
                <Pressable onPress={() => removeMonochromeServer(srv.url)}>
                  <Ionicons name="trash-outline" size={17} color="#F87171" />
                </Pressable>
              )}
            </View>
          ))}

          <View style={styles.addSrvRow}>
            <TextInput
              value={newServerUrl}
              onChangeText={setNewServerUrl}
              placeholder="https://your-relay.example.dev"
              placeholderTextColor={MOCHY_COLORS.textMuted}
              autoCapitalize="none"
              style={styles.srvInput}
            />
            <Pressable
              onPress={() =>
                setNewServerKind((k) => (k === 'relay' ? 'streamer' : 'relay'))
              }
              style={styles.kindToggle}
            >
              <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>
                {newServerKind.toUpperCase()}
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!newServerUrl.trim()) return;
                await addMonochromeServer(newServerUrl, newServerKind);
                setNewServerUrl('');
              }}
              style={[styles.addSrvBtn, { backgroundColor: palette.accent }]}
            >
              <Ionicons name="add" size={18} color={palette.onAccent} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* iOS Installation Guide Card */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'iosInstallGuide')}
      </Text>
      <View style={styles.cardGroup}>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: '#FFF' }}>1. Expo Go (Nhanh nhất): </Text>
          {vi
            ? 'Cài Expo Go từ App Store, chạy npx expo start và quét mã QR bằng Camera iPhone.'
            : 'Install Expo Go from the App Store, run npx expo start, and scan the QR code.'}
        </Text>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: '#FFF' }}>
            2. Sideload file .ipa (AltStore / SideStore / TrollStore):{' '}
          </Text>
          {vi
            ? 'Mở tab GitHub Actions → chạy workflow "Build iOS IPA" để tải file MochyMusic-iOS-Unsigned.ipa cài trực tiếp lên iPhone mà không cần máy Mac!'
            : 'Run the included GitHub Actions "Build iOS IPA" workflow to download MochyMusic-iOS-Unsigned.ipa — no Mac required!'}
        </Text>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: '#FFF' }}>3. Safari PWA: </Text>
          {vi
            ? 'Mở bản Web trên Safari iOS → Chia sẻ → "Thêm vào Màn hình chính" để dùng full-screen kèm điều khiển Lock Screen.'
            : 'Open in iOS Safari → Share → "Add to Home Screen" for full-screen standalone mode.'}
        </Text>
      </View>

      {/* Open-Source Credits & GPL-3.0 Attribution */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'aboutAndCredits')}
      </Text>
      <View style={styles.cardGroup}>
        <Text style={[styles.rowDesc, { marginBottom: 12 }]}>
          {t(prefs.language, 'freeForeverNote')}
        </Text>

        {UPSTREAM_CREDITS.map((credit) => (
          <Pressable
            key={credit.name}
            onPress={() => Linking.openURL(credit.url)}
            style={[
              styles.creditItem,
              credit.highlight && {
                borderColor: palette.accent + '66',
                backgroundColor: palette.container + '44',
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.creditTitle}>
                {credit.name}{' '}
                <Text style={{ color: palette.accent, fontWeight: '600' }}>
                  by {credit.author}
                </Text>
              </Text>
              <Text style={styles.creditDesc}>
                {vi ? credit.roleVi : credit.roleEn}
              </Text>
            </View>
            <Ionicons name="open-outline" size={17} color={MOCHY_COLORS.textSecondary} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 185,
  },
  brandBanner: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    alignItems: 'center',
  },
  heroIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  brandSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 3,
  },
  bannerLinksRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  miniLinkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
  },
  miniLinkPillGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  quickToolCard: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickToolTitle: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
    marginTop: 8,
  },
  quickToolSub: {
    color: MOCHY_COLORS.textMuted,
    fontSize: 11.5,
    marginTop: 2,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17.5,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 10,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  cardGroup: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  rowDesc: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  inlineSubLabel: {
    color: '#E4E4EC',
    fontSize: 13,
    fontWeight: '700',
  },
  smallOptionPill: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  upBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  relaySection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  relayTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  srvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
  },
  addSrvRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  srvInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 12.5,
  },
  kindToggle: {
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
  },
  addSrvBtn: {
    width: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideStep: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19.5,
    marginBottom: 10,
  },
  creditItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 8,
  },
  creditTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  creditDesc: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16.5,
  },
});
