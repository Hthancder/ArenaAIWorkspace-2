// Settings › Widget: a live preview of the home-screen widget (same layout as the SwiftUI medium
// widget), whether this install can feed it, and how to add it.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import {
  widgetLinked,
  widgetStatus,
  widgetSupported,
  WidgetStatus,
} from '../../services/widget/nowPlayingWidget';
import { WidgetCardAnchor } from './widgetAnchor';
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
    lyrics,
    activeLyricIndex,
    isLoadingLyrics,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const [help, setHelp] = useState(false);
  const [kind, setKind] = useState<'player' | 'lyrics'>('player');
  const songLyrics =
    lyrics && currentTrack && lyrics.trackId === currentTrack.id && lyrics.synced
      ? lyrics.lines.filter((l) => !l.isBackground)
      : null;
  // the same index rule as the widget (background vocals are not sent to it)
  const lyricIdx = useMemo(() => {
    if (!songLyrics || !lyrics) return -1;
    const cur = lyrics.lines[activeLyricIndex];
    if (!cur) return -1;
    const i = songLyrics.indexOf(cur);
    if (i >= 0) return i;
    return songLyrics.findIndex((l) => l.startSec > cur.startSec) - 1;
  }, [songLyrics, lyrics, activeLyricIndex]);
  const lineAt = (i: number) => {
    const l = songLyrics?.[i];
    if (!l) return null;
    return l.text.trim() || '♪';
  };
  const lyricsMsg = currentTrack?.isLive
    ? vi
      ? 'Radio trực tiếp — không có lời'
      : 'Live radio — no lyrics'
    : isLoadingLyrics
      ? vi
        ? 'Đang tìm lời bài hát…'
        : 'Finding lyrics…'
      : lyrics && lyrics.trackId === currentTrack?.id && (lyrics.lines.length || lyrics.plainText)
        ? vi
          ? 'Bài này chỉ có lời không đồng bộ — chạm để xem'
          : 'Only unsynced lyrics — tap to read'
        : vi
          ? 'Không có lời — thưởng thức giai điệu nhé'
          : 'No lyrics — enjoy the music';

  // ask iOS itself: is the extension still inside the app, does the App Group work, and how many
  // HolySic widgets are on the Home / Lock Screen right now (re-checked when you come back)
  const [native, setNative] = useState<WidgetStatus | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !widgetSupported()) return;
    let alive = true;
    const load = () =>
      widgetStatus().then((st) => {
        if (alive) setNative(st);
      });
    load();
    const sub = AppState.addEventListener('change', (a) => a === 'active' && load());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const status = useMemo(() => {
    if (Platform.OS !== 'ios') return 'preview' as const;
    if (!widgetSupported()) return 'expoGo' as const;
    if (native && !native.extensionEmbedded) return 'noExtension' as const;
    const linked = native ? native.groupAvailable : widgetLinked();
    if (!linked) return 'noGroup' as const;
    if (native && native.placedCount === 0) return 'notPlaced' as const;
    return 'linked' as const;
  }, [native]);
  const placed = native?.placedCount ?? 0;
  useEffect(() => {
    // nothing on the Home Screen yet / something to fix → open the instructions straight away
    if (status === 'notPlaced' || status === 'noExtension' || status === 'noGroup') setHelp(true);
  }, [status]);

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
      text: native
        ? vi
          ? `Đang hoạt động — ${placed} widget HolySic trên màn hình, cập nhật theo bài đang phát`
          : `Working — ${placed} HolySic widget${placed === 1 ? '' : 's'} on screen, following what plays`
        : vi
          ? 'Đã kết nối — widget cập nhật theo bài đang phát'
          : 'Connected — the widget follows what is playing',
    },
    notPlaced: {
      icon: 'add-circle' as const,
      color: '#60A5FA',
      text: vi
        ? 'Widget đã sẵn sàng nhưng chưa được thêm ra màn hình chính — làm theo 3 bước bên dưới'
        : 'The widget is ready but not on your Home Screen yet — follow the 3 steps below',
    },
    noExtension: {
      icon: 'close-circle' as const,
      color: '#F87171',
      text: vi
        ? 'Trình cài đặt đã gỡ widget khỏi app khi ký lại, nên iOS không có widget HolySic để hiển thị'
        : 'The installer stripped the widget extension while re-signing, so iOS has no HolySic widget to show',
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
      <View ref={(v) => WidgetCardAnchor.set(v)} collapsable={false}>
        <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
          {vi ? 'Widget màn hình chính' : 'Home Screen widget'}
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.seg}>
          {(
            [
              ['player', vi ? 'Đang phát' : 'Now Playing', 'musical-notes'],
              ['lyrics', vi ? 'Lời bài hát' : 'Lyrics', 'chatbox-ellipses'],
            ] as const
          ).map(([id, label, icon]) => {
            const on = kind === id;
            return (
              <Pressable
                key={id}
                onPress={() => setKind(id)}
                style={[styles.segBtn, on && { backgroundColor: UI.fg(0.1) }]}
                accessibilityLabel={`Widget ${id}`}
              >
                <Ionicons name={icon} size={13} color={on ? palette.accent : UI.text2} />
                <Text style={[styles.segText, on && { color: UI.text }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {kind === 'lyrics' ? (
          <View
            style={styles.widget}
            accessibilityLabel={vi ? 'Xem trước widget lời bài hát' : 'Lyrics widget preview'}
          >
            <LinearGradient
              colors={[top, bottom]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fill}
            />
            <LinearGradient
              colors={[accent + '40', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.7, y: 0.8 }}
              style={styles.fill}
            />
            <LinearGradient colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.5)']} style={styles.fill} />
            <View style={styles.lyWrap}>
              <View style={styles.lyHead}>
                <View style={styles.lyCover}>
                  <ArtworkImage
                    source={{ uri: currentTrack?.artworkUrl }}
                    fallbackSeed={currentTrack?.title}
                    style={styles.cover}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lyTitle} numberOfLines={1}>
                    {currentTrack?.title || (vi ? 'Chưa phát bài nào' : 'Nothing playing')}
                  </Text>
                  <Text style={styles.lyArtist} numberOfLines={1}>
                    {currentTrack?.artist || 'HolySic'}
                  </Text>
                </View>
                <View style={styles.lyState}>
                  <Ionicons name={isPlaying ? 'pulse' : 'pause'} size={10} color={accent} />
                </View>
              </View>
              <View style={styles.lyBody}>
                {songLyrics ? (
                  <>
                    {lineAt(lyricIdx - 1) ? (
                      <Text style={styles.lyOther} numberOfLines={1}>
                        {lineAt(lyricIdx - 1)}
                      </Text>
                    ) : null}
                    <Text
                      style={[styles.lyCurrent, { textShadowColor: accent + '99' }]}
                      numberOfLines={2}
                      accessibilityLabel="Widget lyric line"
                    >
                      {lyricIdx >= 0 ? lineAt(lyricIdx) : '♪ ♪ ♪'}
                    </Text>
                    {lineAt(lyricIdx + 1) ? (
                      <Text style={[styles.lyOther, { opacity: 0.6 }]} numberOfLines={1}>
                        {lineAt(lyricIdx + 1)}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                    <Ionicons name="chatbox-ellipses" size={15} color={accent} />
                    <Text style={styles.lyMsg} numberOfLines={3}>
                      {currentTrack ? lyricsMsg : vi ? 'Chạm để mở HolySic' : 'Tap to open HolySic'}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[styles.track, { marginTop: 0 }]}>
                <View
                  style={[
                    styles.trackFill,
                    { width: `${Math.max(3, pct * 100)}%`, backgroundColor: accent },
                  ]}
                />
              </View>
            </View>
          </View>
        ) : (
          /* live preview, same layout as the medium SwiftUI widget */
          <View
            style={styles.widget}
            accessibilityLabel={vi ? 'Xem trước widget' : 'Widget preview'}
          >
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
                  <Pressable
                    onPress={playPrevious}
                    hitSlop={8}
                    accessibilityLabel="Widget previous"
                  >
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
        )}

        <View style={styles.sizes}>
          {(kind === 'lyrics'
            ? [
                { icon: 'square' as const, vi: 'Nhỏ', en: 'Small' },
                { icon: 'tablet-landscape' as const, vi: 'Vừa · 3 dòng', en: 'Medium · 3 lines' },
                { icon: 'tablet-portrait' as const, vi: 'Lớn · 7 dòng', en: 'Large · 7 lines' },
                { icon: 'lock-closed' as const, vi: 'Màn hình khoá', en: 'Lock Screen' },
              ]
            : [
                { icon: 'square' as const, vi: 'Nhỏ', en: 'Small' },
                { icon: 'tablet-landscape' as const, vi: 'Vừa', en: 'Medium' },
                { icon: 'tablet-portrait' as const, vi: 'Lớn · hàng chờ', en: 'Large · up next' },
                { icon: 'lock-closed' as const, vi: 'Màn hình khoá', en: 'Lock Screen' },
              ]
          ).map((s) => (
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
                ? 'Không thấy HolySic trong danh sách widget? Mở HolySic ít nhất một lần sau khi cài, rồi khởi động lại iPhone — iOS chỉ nạp widget của app sideload sau đó.\n\n1. Giữ ngón tay trên màn hình chính đến khi biểu tượng rung\n2. Chạm + ở góc trên → tìm “HolySic”\n3. Vuốt để chọn widget “Đang phát” hoặc “Lời bài hát”, chọn cỡ Nhỏ / Vừa / Lớn → Thêm widget\nMàn hình khoá (iOS 16+): giữ màn hình khoá → Tuỳ chỉnh → Thêm tiện ích → HolySic\n\nNút trên widget (phát, chuyển bài, thích) mở HolySic và thực hiện ngay. Thanh tiến độ tự chạy trên iOS 16+, iOS 15 cập nhật mỗi ~10 giây. Widget lời bài hát đổi dòng đúng lúc theo lời đồng bộ (cả khi app chạy nền); chạm vào để mở lời trong trình phát.'
                : 'Can’t find HolySic in the widget list? Open HolySic at least once after installing, then restart the iPhone — iOS only loads widgets of sideloaded apps after that.\n\n1. Touch and hold the Home Screen until the icons jiggle\n2. Tap + in the corner → search “HolySic”\n3. Swipe to “Now Playing” or “Lyrics”, pick Small / Medium / Large → Add Widget\nLock Screen (iOS 16+): hold the Lock Screen → Customize → Add Widgets → HolySic\n\nWidget buttons (play, skip, like) open HolySic and act right away. The progress bar runs live on iOS 16+, about every 10 s on iOS 15. The lyrics widget switches lines on time from synced lyrics (also while HolySic is in the background); tap it to open the lyrics in the player.'}
            </Text>
            {status === 'noExtension' && (
              <Text style={[styles.helpText, styles.fixText]}>
                {vi
                  ? 'Cách sửa:\n• SideStore / AltStore: cài lại IPA, khi được hỏi về “App Extensions” hãy chọn GIỮ (Keep App Extensions). Tài khoản Apple miễn phí chỉ có 3 App ID — gỡ bớt một app sideload khác nếu thiếu.\n• Sideloadly: tắt tuỳ chọn “Remove app extensions”.\n• TrollStore: giữ nguyên widget, không cần làm gì thêm.'
                  : 'How to fix:\n• SideStore / AltStore: reinstall the IPA and choose KEEP when asked about “App Extensions”. Free Apple IDs get 3 App IDs — remove another sideloaded app if you run out.\n• Sideloadly: turn off “Remove app extensions”.\n• TrollStore: keeps the widget as is.'}
              </Text>
            )}
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
  seg: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 12,
    backgroundColor: UI.fg(0.05),
    marginBottom: 12,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 9,
  },
  segText: { color: UI.text2, fontSize: 12.5, fontWeight: '700' },
  lyWrap: { flex: 1, padding: 14 },
  lyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lyCover: {
    width: 30,
    height: 30,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 0.6,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  lyTitle: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  lyArtist: { color: 'rgba(255,255,255,0.62)', fontSize: 10.5, fontWeight: '500' },
  lyState: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  lyBody: { flex: 1, justifyContent: 'center', gap: 5, paddingVertical: 4 },
  lyOther: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700' },
  lyCurrent: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 21,
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  lyMsg: { flex: 1, color: 'rgba(255,255,255,0.78)', fontSize: 13.5, fontWeight: '700' },
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
  fixText: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(248,113,113,0.08)',
    color: UI.text,
  },
}));
