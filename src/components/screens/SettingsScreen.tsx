// HolySic Tab (Settings, Player Customizer, Source Modules, iOS Install Guide & Complete Open-Source Credits)
// Preserves full attribution to realidkroo/Mochy-Music and all upstream open-source contributors.

import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  UPSTREAM_DISCORD_URL,
  UPSTREAM_ORIGIN_URL,
  UPSTREAM_CREDITS,
} from '../../constants/credits';
import { t } from '../../constants/i18n';
import {
  AppFontStyle,
  JioSaavnQuality,
  PLAYER_STYLE_META,
  PlayerBackgroundStyle,
  PlayerStyle,
} from '../../constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { StreamFileCache } from '../../services/audio/streamFileCache';
import { SourceMemory } from '../../services/providers/sourceMemory';
import { HolySicMarkIcon } from '../HolySicIcons';
import { MergedSettings } from '../merge/MergedSettings';
import { WidgetCardAnchor } from '../widget/widgetAnchor';
import { T as UI, themedSheet } from '../../theme/ui';
import { useTabScrollToTop } from '../../services/ui/tabBus';
import { Tap } from '../ui/Tap';

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
    ambient,
  } = useHolySic();
  const scrollRef = useTabScrollToTop('settings');
  const scrollY = useRef(0);

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

  const jumpToWidget = () => {
    const target = WidgetCardAnchor.get();
    const sv = scrollRef.current;
    if (!target || !sv) return;
    haptic('selection');
    target.measureInWindow((_x, y) => {
      (sv as unknown as View).measureInWindow((_sx, sy) => {
        sv.scrollTo({ y: Math.max(0, scrollY.current + (y - sy) - 8), animated: true });
      });
    });
  };

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* Hero Brand Banner */}
      <View style={[styles.brandBanner, { borderColor: palette.accent + '35' }]}>
        <View style={[styles.heroIconWrap, { backgroundColor: palette.container }]}>
          <HolySicMarkIcon size={36} color={palette.accent} filled />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.brandName, { fontFamily }]}>HolySic · iOS</Text>
          <Text style={styles.brandSub}>
            {vi
              ? 'Bản port iOS (Expo / React Native) dựa trên Mochy Music bởi realidkroo · GPL-3.0 >_<'
              : 'iOS port built on top of Mochy Music by realidkroo · GPL-3.0 >_<'}
          </Text>
          <View style={styles.bannerLinksRow}>
            <Tap
              onPress={() => Linking.openURL(UPSTREAM_ORIGIN_URL)}
              style={[styles.miniLinkPill, { backgroundColor: palette.accent }]}
            >
              <Ionicons name="logo-github" size={14} color={palette.onAccent} />
              <Text style={{ color: palette.onAccent, fontSize: 12, fontWeight: '800' }}>
                {vi ? 'Mã nguồn gốc' : 'Upstream'}
              </Text>
            </Tap>
            <Tap
              onPress={() => Linking.openURL(UPSTREAM_DISCORD_URL)}
              style={styles.miniLinkPillGhost}
            >
              <Ionicons name="chatbubbles-outline" size={14} color={UI.text} />
              <Text style={{ color: UI.text, fontSize: 12, fontWeight: '700' }}>Discord</Text>
            </Tap>
          </View>
        </View>
      </View>

      {/* Quick Tools */}
      <View style={styles.quickRow}>
        <Tap onPress={() => setIsAudioLabOpen(true)} style={styles.quickToolCard}>
          <Ionicons name="options" size={22} color={palette.accent} />
          <Text style={styles.quickToolTitle}>Audio Lab & EQ</Text>
          <Text style={styles.quickToolSub}>AutoEQ · 8D · Reverb</Text>
        </Tap>

        <Tap onPress={() => setIsRecapOpen(true)} style={styles.quickToolCard}>
          <Ionicons name="id-card" size={22} color="#34D399" />
          <Text style={styles.quickToolTitle}>HolySic Recap ID</Text>
          <Text style={styles.quickToolSub}>Stats & Listener Card</Text>
        </Tap>
      </View>

      {/* Widget — easy to find: jumps to the widget card (preview, status, how to add) */}
      <Tap
        onPress={jumpToWidget}
        style={[styles.widgetRow, { borderColor: palette.accent + '33' }]}
        accessibilityRole="button"
        accessibilityLabel={vi ? 'Widget màn hình chính' : 'Home Screen widget'}
      >
        <View style={[styles.widgetIcon, { backgroundColor: palette.container }]}>
          <Ionicons name="apps" size={18} color={palette.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.quickToolTitle2}>
            {vi ? 'Widget màn hình chính' : 'Home Screen widget'}
          </Text>
          <Text numberOfLines={1} style={styles.quickToolSub}>
            {vi
              ? 'Đang phát · Lời bài hát · màn hình khoá — xem trước & cách thêm'
              : 'Now Playing · Lyrics · Lock Screen — preview & how to add'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={UI.text3} />
      </Tap>

      {/* Language Switch */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Ngôn ngữ / Language' : 'Language / Ngôn ngữ'}
      </Text>
      <View style={styles.segmentedRow}>
        {(['vi', 'en'] as const).map((lang) => {
          const active = prefs.language === lang;
          return (
            <Tap
              key={lang}
              onPress={() => {
                haptic('selection');
                updatePrefs({ language: lang });
              }}
              style={[styles.segmentBtn, active && { backgroundColor: palette.accent }]}
            >
              <Text
                style={{
                  fontWeight: '800',
                  color: active ? palette.onAccent : UI.fg(1),
                }}
              >
                {lang === 'vi' ? '🇻🇳 Tiếng Việt' : '🌐 English'}
              </Text>
            </Tap>
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
            <Tap
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
                <Text style={styles.rowTitle}>{vi ? meta.titleVi : meta.titleEn}</Text>
                <Text style={styles.rowDesc}>{vi ? meta.descVi : meta.descEn}</Text>
              </View>
              <Ionicons
                name={active ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={active ? palette.accent : UI.text3}
              />
            </Tap>
          );
        })}
      </View>

      {/* Customize HolySic Appearance */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'customizeLook')}
      </Text>
      <View style={styles.cardGroup}>
        <View style={styles.themeBlock}>
          <Text style={styles.rowTitle}>{vi ? 'Giao diện' : 'Appearance'}</Text>
          <Text style={styles.rowDesc}>
            {vi
              ? 'Tự động: sáng ban ngày, tối ban đêm — theo cài đặt của iPhone'
              : 'Auto follows your iPhone: light by day, dark at night'}
          </Text>
          <View style={styles.themeRow}>
            {(
              [
                { id: 'light', icon: 'sunny', vi: 'Sáng', en: 'Light' },
                { id: 'dark', icon: 'moon', vi: 'Tối', en: 'Dark' },
                { id: 'auto', icon: 'contrast', vi: 'Tự động', en: 'Auto' },
              ] as const
            ).map((o) => {
              const on = (prefs.themeMode || 'dark') === o.id;
              return (
                <Tap
                  key={o.id}
                  onPress={() => updatePrefs({ themeMode: o.id })}
                  style={[
                    styles.themeChip,
                    on && { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
                  ]}
                  accessibilityLabel={(vi ? 'Giao diện ' : 'Appearance ') + (vi ? o.vi : o.en)}
                  accessibilityState={{ selected: on }}
                >
                  <View
                    style={[
                      styles.themePreview,
                      o.id === 'light'
                        ? { backgroundColor: '#F6F5FA' }
                        : o.id === 'dark'
                          ? { backgroundColor: '#0A0A0E' }
                          : { backgroundColor: '#0A0A0E', overflow: 'hidden' },
                    ]}
                  >
                    {o.id === 'auto' && <View style={styles.themeHalf} />}
                    <Ionicons
                      name={o.icon}
                      size={18}
                      color={
                        o.id === 'light' ? '#F59E0B' : o.id === 'dark' ? '#C4B5FD' : palette.accent
                      }
                    />
                  </View>
                  <Text style={[styles.themeLabel, on && { color: palette.accent }]}>
                    {vi ? o.vi : o.en}
                  </Text>
                </Tap>
              );
            })}
          </View>
        </View>
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
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{t(prefs.language, 'frostedBlur')}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tắt nếu muốn máy đời cũ chạy siêu mượt (như gợi ý trong FAQ HolySic)'
                : 'Disable blur on older devices for maximum frame rate'}
            </Text>
          </View>
          <Switch
            value={prefs.enableBlur}
            onValueChange={(v) => updatePrefs({ enableBlur: v })}
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
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
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
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
                ['AMBIENT', 'Ambient Light'],
                ['APPLE_MUSIC', 'Apple Mesh'],
                ['COVER_GRADIENT', 'Cover Gradient'],
                ['DARK_GRADIENT', 'Dark Tone'],
                ['SOLID', 'Solid OLED'],
              ] as [PlayerBackgroundStyle, string][]
            ).map(([id, label]) => {
              const selected = prefs.playerBackground === id;
              return (
                <Tap
                  key={id}
                  onPress={() => updatePrefs({ playerBackground: id })}
                  style={[styles.smallOptionPill, selected && { backgroundColor: palette.accent }]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: selected ? palette.onAccent : UI.fg(1),
                    }}
                  >
                    {label}
                  </Text>
                </Tap>
              );
            })}
          </View>
        </ScrollView>

        {/* Ambient Light (YouTube-style glow from the cover's real colours) */}
        <Text style={[styles.inlineSubLabel, { marginTop: 12 }]}>
          {vi ? 'Ánh sáng Ambient (như YouTube)' : 'Ambient light (YouTube-style)'}
        </Text>
        <Text style={{ color: UI.text3, fontSize: 12, lineHeight: 17 }}>
          {vi
            ? 'Màu thật của ảnh bìa lan ra nền, toả sáng quanh ảnh và nhịp theo tiếng bass.'
            : "The cover's real colours flood the background, glow around the art and pulse with the bass."}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
          {(
            [
              ['off', vi ? 'Tắt' : 'Off'],
              ['low', vi ? 'Nhẹ' : 'Low'],
              ['medium', vi ? 'Vừa' : 'Medium'],
              ['high', vi ? 'Mạnh' : 'High'],
            ] as const
          ).map(([id, label]) => {
            const selected = prefs.ambientLight === id;
            return (
              <Tap
                key={id}
                onPress={() => updatePrefs({ ambientLight: id })}
                style={[styles.smallOptionPill, selected && { backgroundColor: palette.accent }]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: selected ? palette.onAccent : UI.fg(1),
                  }}
                >
                  {label}
                </Text>
              </Tap>
            );
          })}
        </View>
        <View style={styles.switchRow}>
          <Text style={[styles.rowTitle, { flex: 1, paddingRight: 10 }]}>
            {vi ? 'Ánh sáng nhịp theo nhạc' : 'Light breathes with the music'}
          </Text>
          <Switch
            value={prefs.ambientBreathing}
            onValueChange={(v) => updatePrefs({ ambientBreathing: v })}
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={[styles.rowTitle, { flex: 1, paddingRight: 10 }]}>
            {vi ? 'Lan sáng ra MiniPlayer & Trang chủ' : 'Spill light onto mini player & Home'}
          </Text>
          <Switch
            value={prefs.ambientSpill}
            onValueChange={(v) => updatePrefs({ ambientSpill: v })}
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
          />
        </View>
        {ambient.reduced && prefs.ambientLight !== 'off' && (
          <Text style={{ color: HOLYSIC_COLORS.aacAmber, fontSize: 12, marginBottom: 4 }}>
            {vi
              ? '⚡ Đang bật Tiết kiệm pin / Giảm chuyển động: ánh sáng được dịu bớt và không nhịp.'
              : '⚡ Low Power Mode / Reduce Motion is on: the light is toned down and steady.'}
          </Text>
        )}

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
                <Tap
                  key={id}
                  onPress={() => updatePrefs({ fontStyle: id })}
                  style={[styles.smallOptionPill, selected && { backgroundColor: palette.accent }]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: selected ? palette.onAccent : UI.fg(1),
                    }}
                  >
                    {label}
                  </Text>
                </Tap>
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
            ? 'Thứ tự ưu tiên khi HolySic tìm luồng nhạc chất lượng cao nhất cho bài hát:'
            : 'Module resolution priority when matching tracks:'}
        </Text>

        {prefs.moduleOrder.map((modId, idx) => {
          const enabled = prefs.enabledModules[modId];
          const labelMap: Record<typeof modId, string> = {
            monochrome: 'Monochrome · Lossless FLAC (16/24-bit)',
            jiosaavn: `JioSaavn · Full AAC (${prefs.preferredJioSaavnQuality} kbps)`,
            innertube: 'YouTube Music InnerTube (iOS / visionOS)',
            itunes: vi
              ? 'Apple · Preview 30s (chỉ khi cho phép)'
              : 'Apple · 30s preview (only if allowed)',
          };
          return (
            <View key={modId} style={styles.moduleRow}>
              <Tap
                disabled={idx === 0}
                onPress={() => moveModuleUp(idx)}
                style={[styles.upBtn, idx === 0 && { opacity: 0.25 }]}
              >
                <Ionicons name="arrow-up" size={16} color={UI.text} />
              </Tap>
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
                trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
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
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{vi ? 'Ưu tiên phát ngay' : 'Prefer instant start'}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Trên iPhone, FLAC Monochrome phải tải về 1 lần (~30 MB) mới phát được, nên chỉ dùng khi nguồn phát ngay (YouTube / JioSaavn) không có. Tắt nếu luôn muốn lossless.'
                : 'On iPhone, Monochrome FLAC needs a one-time ~30 MB download, so it is used after instant sources. Turn off to always prefer lossless.'}
            </Text>
          </View>
          <Switch
            value={prefs.preferInstantStart}
            onValueChange={(v) => updatePrefs({ preferInstantStart: v })}
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
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
            trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
          />
        </View>

        <Tap
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
        </Tap>

        {/* JioSaavn Bitrate Choice */}
        <Text style={[styles.inlineSubLabel, { marginTop: 12 }]}>JioSaavn Stream Bitrate</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['320', '160', '96'] as JioSaavnQuality[]).map((q) => {
            const active = prefs.preferredJioSaavnQuality === q;
            return (
              <Tap
                key={q}
                onPress={() => updatePrefs({ preferredJioSaavnQuality: q })}
                style={[styles.smallOptionPill, active && { backgroundColor: palette.accent }]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: active ? palette.onAccent : UI.fg(1),
                  }}
                >
                  AAC {q} kbps
                </Text>
              </Tap>
            );
          })}
        </View>

        {/* Monochrome Relay Server List */}
        <View style={styles.relaySection}>
          <View style={styles.relayTopRow}>
            <Text style={styles.inlineSubLabel}>Monochrome FLAC Servers</Text>
            <Tap
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
            </Tap>
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
                <Text style={{ color: UI.text, fontSize: 13, fontWeight: '600' }}>
                  {srv.name} ({srv.kind})
                </Text>
                {srv.lastMessage && (
                  <Text style={{ color: UI.text3, fontSize: 11 }}>{srv.lastMessage}</Text>
                )}
              </View>
              {!srv.builtIn && (
                <Tap onPress={() => removeMonochromeServer(srv.url)}>
                  <Ionicons name="trash-outline" size={17} color="#F87171" />
                </Tap>
              )}
            </View>
          ))}

          <View style={styles.addSrvRow}>
            <TextInput
              value={newServerUrl}
              onChangeText={setNewServerUrl}
              placeholder="https://your-relay.example.dev"
              placeholderTextColor={UI.text3}
              autoCapitalize="none"
              style={styles.srvInput}
            />
            <Tap
              onPress={() => setNewServerKind((k) => (k === 'relay' ? 'streamer' : 'relay'))}
              style={styles.kindToggle}
            >
              <Text style={{ color: UI.text, fontSize: 11, fontWeight: '700' }}>
                {newServerKind.toUpperCase()}
              </Text>
            </Tap>
            <Tap
              onPress={async () => {
                if (!newServerUrl.trim()) return;
                await addMonochromeServer(newServerUrl, newServerKind);
                setNewServerUrl('');
              }}
              style={[styles.addSrvBtn, { backgroundColor: palette.accent }]}
            >
              <Ionicons name="add" size={18} color={palette.onAccent} />
            </Tap>
          </View>
        </View>
      </View>

      {/* Merged features: Spotube · OpenSpot Music · Musike · Cog */}
      <MergedSettings />

      {/* iOS Installation Guide Card */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {t(prefs.language, 'iosInstallGuide')}
      </Text>
      <View style={styles.cardGroup}>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: UI.text }}>1. Expo Go (Nhanh nhất): </Text>
          {vi
            ? 'Cài Expo Go từ App Store, chạy npx expo start và quét mã QR bằng Camera iPhone.'
            : 'Install Expo Go from the App Store, run npx expo start, and scan the QR code.'}
        </Text>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: UI.text }}>
            2. Sideload file .ipa (AltStore / SideStore / TrollStore):{' '}
          </Text>
          {vi
            ? 'Mở tab GitHub Actions → chạy workflow "Build iOS IPA" để tải file HolySic-iOS-Unsigned.ipa cài trực tiếp lên iPhone mà không cần máy Mac!'
            : 'Run the included GitHub Actions "Build iOS IPA" workflow to download HolySic-iOS-Unsigned.ipa — no Mac required!'}
        </Text>
        <Text style={styles.guideStep}>
          <Text style={{ fontWeight: '800', color: UI.text }}>3. Safari PWA: </Text>
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
          <Tap
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
                <Text style={{ color: palette.accent, fontWeight: '600' }}>by {credit.author}</Text>
              </Text>
              <Text style={styles.creditDesc}>{vi ? credit.roleVi : credit.roleEn}</Text>
            </View>
            <Ionicons name="open-outline" size={17} color={UI.text2} />
          </Tap>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = themedSheet(() => ({
  themeBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  themeRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  themeChip: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: UI.fg(0.1),
    backgroundColor: UI.fg(0.04),
  },
  themePreview: {
    width: 54,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(128,128,140,0.35)',
  },
  themeHalf: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: '#F6F5FA',
  },
  themeLabel: { color: UI.text2, fontSize: 13, fontWeight: '700' },
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
    backgroundColor: UI.fg(0.05),
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
    color: UI.text,
    fontSize: 19,
    fontWeight: '800',
  },
  brandSub: {
    color: UI.text2,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 3,
  },
  bannerLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    backgroundColor: UI.fg(0.1),
  },
  widgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: UI.fg(0.05),
  },
  widgetIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickToolTitle2: {
    color: UI.text,
    fontSize: 14.5,
    fontWeight: '800',
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
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  quickToolTitle: {
    color: UI.text,
    fontSize: 14.5,
    fontWeight: '800',
    marginTop: 8,
  },
  quickToolSub: {
    color: UI.text3,
    fontSize: 11.5,
    marginTop: 2,
  },
  sectionTitle: {
    color: UI.text,
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
    backgroundColor: UI.fg(0.07),
    alignItems: 'center',
  },
  cardGroup: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI.fg(0.07),
    marginBottom: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  rowTitle: {
    color: UI.text,
    fontSize: 14.5,
    fontWeight: '700',
  },
  rowDesc: {
    color: UI.text2,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  inlineSubLabel: {
    color: UI.fg(0.88),
    fontSize: 13,
    fontWeight: '700',
  },
  smallOptionPill: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: UI.fg(0.08),
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  upBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: UI.fg(0.09),
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleLabel: {
    flex: 1,
    color: UI.text,
    fontSize: 13.5,
    fontWeight: '600',
  },
  relaySection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: UI.fg(0.1),
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
    backgroundColor: UI.fg(0.07),
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    color: UI.text,
    fontSize: 12.5,
  },
  kindToggle: {
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: UI.fg(0.1),
    justifyContent: 'center',
  },
  addSrvBtn: {
    width: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideStep: {
    color: UI.text2,
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
    borderColor: UI.fg(0.07),
    marginBottom: 8,
  },
  creditTitle: {
    color: UI.text,
    fontSize: 14,
    fontWeight: '800',
  },
  creditDesc: {
    color: UI.text2,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16.5,
  },
}));
