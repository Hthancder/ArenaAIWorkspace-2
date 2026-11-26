// Settings › Widget: a live preview of the home-screen widget (same layout as the SwiftUI medium
// widget), whether this install can feed it, and how to add it.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { widgetLinked, widgetSupported } from '../../services/widget/nowPlayingWidget';
import { T as UI, themedSheet } from '../../theme/ui';
import { ArtworkImage } from '../ArtworkImage';

const clock = (s: number) => {
  const v = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

function shade(hex: string | undefined, k: number, fallback: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const c = (v: number) =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export const WidgetSettingsCard: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const {
    prefs,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    palette,
    darkPalette,
    artColors,
    isLiked,
    togglePlay,
    playNext,
    playPrevious,
    toggleLike,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const [help, setHelp] = useState(false);

  const status = useMemo(() => {
    if (Platform.OS !== 'ios') return 'preview' as const;
    if (!widgetSupported()) return 'expoGo' as const;
    return widgetLinked() ? ('linked' as const) : ('noGroup' as const);
  }, []);

  const top = shade(artColors?.primary, 0.55, '#2A1452');
  const bottom = shade(artColors?.dark, 0.6, '#06050B');
  const accent = darkPalette.accent;
  const dur = currentTrack?.isLive ? 0 : durationSec || currentTrack?.durationSec || 0;
  const pct = dur > 0 ? Math.min(1, Math.max(0, positionSec / dur)) : 0;
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const badge = currentTrack?.qualityBadge?.split(' · ').slice(0, 2).join(' · ');

  const statusLine = {
    linked: {
      icon: 'checkmark-circle' as const,
      color: '#34D399',
      text: vi
        ? 'Đã kết nối — widget cập nhật theo bài đang phát'
        : 'Connected — the widget follows what is playing',
    },
    noGroup: {
      icon: 'alert-circle' as const,
      color: '#FBBF24',
      text: vi
        ? 'Widget đã cài nhưng chưa nhận được dữ liệu: công cụ sideload đã bỏ quyền App Group khi ký lại'
        : 'Widget installed but it can’t receive data: the sideloading tool dropped the App Group entitlement',
    },
    expoGo: {
      icon: 'information-circle' as const,
      color: UI.text3,
      text: vi
        ? 'Widget có trong bản IPA (không có trong Expo Go)'
        : 'The widget ships in the IPA build (not in Expo Go)',
    },
    preview: {
      icon: 'information-circle' as const,
      color: UI.text3,
      text: vi
        ? 'Xem trước — widget thật có trên iPhone (bản IPA)'
        : 'Preview — the real widget is on iPhone (IPA build)',
    },
  }[status];

  return (
    <>
      <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
        {vi ? 'Widget màn hình chính' : 'Home Screen widget'}
      </Text>
      <View style={styles.card}>
        {/* live preview, same layout as the medium SwiftUI widget */}
        <View style={styles.widget} accessibilityLabel={vi ? 'Xem trước widget' : 'Widget preview'}>
          <LinearGradient
            colors={[top, bottom]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fill}
          />
          <LinearGradient
            colors={[accent + '48', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 0.8 }}
            style={styles.fill}
          />
          <LinearGradient colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.42)']} style={styles.fill} />
          <View style={styles.wRow}>
            <View style={styles.coverWrap}>
              <ArtworkImage
                source={{ uri: currentTrack?.artworkUrl }}
                fallbackSeed={currentTrack?.title}
                style={styles.cover}
              />
            </View>
            <View style={styles.wInfo}>
              <View style={styles.badgeRow}>
                <View style={styles.stateBadge}>
                  <Ionicons
                    name={currentTrack?.isLive ? 'radio' : isPlaying ? 'pulse' : 'pause'}
                    size={9}
                    color={accent}
                  />
                  <Text style={[styles.stateText, { color: accent }]}>
                    {currentTrack?.isLive
                      ? 'LIVE'
                      : isPlaying
                        ? vi
                          ? 'ĐANG PHÁT'
                          : 'NOW PLAYING'
                        : vi
                          ? 'TẠM DỪNG'
                          : 'PAUSED'}
                  </Text>
                </View>
                {!!badge && (
                  <Text style={styles.quality} numberOfLines={1}>
                    {badge}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }} />
              <Text style={styles.wTitle} numberOfLines={1}>
                {currentTrack?.title || (vi ? 'Chưa phát bài nào' : 'Nothing playing')}
              </Text>
              <Text style={styles.wArtist} numberOfLines={1}>
                {currentTrack?.artist || 'HolySic'}
              </Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.trackFill,
                    { width: `${Math.max(3, pct * 100)}%`, backgroundColor: accent },
                  ]}
                />
              </View>
              {dur > 0 && (
                <View style={styles.times}>
                  <Text style={styles.time}>{clock(positionSec)}</Text>
                  <Text style={styles.time}>{clock(dur)}</Text>
                </View>
              )}
              <View style={styles.controls}>
                <Pressable onPress={playPrevious} hitSlop={8} accessibilityLabel="Widget previous">
                  <Ionicons name="play-back" size={17} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  onPress={togglePlay}
                  style={styles.playBtn}
                  accessibilityLabel="Widget play pause"
                >
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={16}
                    color="#111"
                    style={!isPlaying ? { marginLeft: 2 } : undefined}
                  />
                </Pressable>
                <Pressable onPress={playNext} hitSlop={8} accessibilityLabel="Widget next">
                  <Ionicons name="play-forward" size={17} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  onPress={() => currentTrack && toggleLike(currentTrack)}
                  hitSlop={8}
                  accessibilityLabel="Widget like"
                >
                  <Ionicons name={liked ? 'heart' : 'heart-outline'} size={17} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.sizes}>
          {[
            { icon: 'square' as const, vi: 'Nhỏ', en: 'Small' },
            { icon: 'tablet-landscape' as const, vi: 'Vừa', en: 'Medium' },
            { icon: 'tablet-portrait' as const, vi: 'Lớn · hàng chờ', en: 'Large · up next' },
            { icon: 'lock-closed' as const, vi: 'Màn hình khoá', en: 'Lock Screen' },
          ].map((s) => (
            <View key={s.en} style={styles.sizeChip}>
              <Ionicons name={s.icon} size={11} color={UI.text2} />
              <Text style={styles.sizeText}>{vi ? s.vi : s.en}</Text>
            </View>
          ))}
        </View>

        <View style={styles.statusRow}>
          <Ionicons name={statusLine.icon} size={16} color={statusLine.color} />
          <Text style={styles.statusText}>{statusLine.text}</Text>
        </View>

        <Pressable onPress={() => setHelp((h) => !h)} style={styles.helpBtn}>
          <Text style={[styles.helpBtnText, { color: palette.accent }]}>
            {vi ? 'Cách thêm widget' : 'How to add the widget'}
          </Text>
          <Ionicons name={help ? 'chevron-up' : 'chevron-down'} size={14} color={palette.accent} />
        </Pressable>
        {help && (
          <View style={styles.helpBox}>
            <Text style={styles.helpText}>
              {vi
                ? '1. Giữ ngón tay trên màn hình chính đến khi biểu tượng rung\n2. Chạm + ở góc trên → tìm “HolySic”\n3. Chọn cỡ Nhỏ / Vừa / Lớn → Thêm widget\nMàn hình khoá (iOS 16+): giữ màn hình khoá → Tuỳ chỉnh → Thêm tiện ích → HolySic\n\nNút trên widget (phát, chuyển bài, thích) mở HolySic và thực hiện ngay. Thanh tiến độ tự chạy trên iOS 16+, iOS 15 cập nhật mỗi ~10 giây.'
                : '1. Touch and hold the Home Screen until the icons jiggle\n2. Tap + in the corner → search “HolySic”\n3. Pick Small / Medium / Large → Add Widget\nLock Screen (iOS 16+): hold the Lock Screen → Customize → Add Widgets → HolySic\n\nWidget buttons (play, skip, like) open HolySic and act right away. The progress bar runs live on iOS 16+, about every 10 s on iOS 15.'}
            </Text>
            {status === 'noGroup' && (
              <Text style={[styles.helpText, { marginTop: 8 }]}>
                {vi
                  ? 'Để widget nhận dữ liệu: cài bằng TrollStore (giữ nguyên quyền), hoặc SideStore / AltStore (tự đăng ký App Group với Apple ID). Một số công cụ ký bằng Apple ID miễn phí không hỗ trợ App Group.'
                  : 'To feed the widget: install with TrollStore (keeps entitlements) or SideStore / AltStore (registers the App Group with your Apple ID). Some free-account signers don’t support App Groups.'}
              </Text>
            )}
          </View>
        )}
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
  widget: {
    height: 158,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#120A24',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  wRow: { flex: 1, flexDirection: 'row', padding: 14, gap: 14 },
  coverWrap: {
    width: 130,
    height: 130,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 0.6,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cover: { width: '100%', height: '100%' },
  wInfo: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  stateText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  quality: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '900' },
  wTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  wArtist: { color: 'rgba(255,255,255,0.68)', fontSize: 12, fontWeight: '500', marginTop: 1 },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 8,
    overflow: 'hidden',
  },
  trackFill: { height: 4, borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  time: { color: 'rgba(255,255,255,0.62)', fontSize: 10, fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingRight: 4,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  sizeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: UI.fg(0.06),
  },
  sizeText: { color: UI.text2, fontSize: 11.5, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  statusText: { flex: 1, color: UI.text2, fontSize: 12.5, lineHeight: 17 },
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  helpBtnText: { fontSize: 13, fontWeight: '700' },
  helpBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: UI.fg(0.05),
  },
  helpText: { color: UI.text2, fontSize: 12.5, lineHeight: 18 },
}));
