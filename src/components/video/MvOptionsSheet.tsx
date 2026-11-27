// The music video's own options, from the player: quality, auto-play, and "save for offline".
// Opened from the quality badge on the video, a long-press on the camera button, or the
// player's ⋯ menu › "Video âm nhạc…". Quality and auto-play are the same settings as
// Settings › Music video (changed here, they apply everywhere).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HolySicPreferences } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { MvCache, useMvCache } from '../../services/video/mvCache';
import { useVideoState } from '../../services/video/videoStore';
import { ToastStore } from '../../services/ui/toastStore';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Track } from '../../types/music';
import { Tap } from '../ui/Tap';

let target: Track | null = null;
const subs = new Set<() => void>();
export function openMvOptions(t: Track | null) {
  target = t;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useMvOptionsTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

const QUALITIES: HolySicPreferences['videoQuality'][] = [360, 480, 720, 1080];

const fmtMB = (b: number) =>
  b >= 1e9
    ? `${(b / 1e9).toFixed(2)} GB`
    : `${Math.max(0.1, b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB`;

export const MvOptionsSheet: React.FC = () => {
  const tg = useMvOptionsTarget();
  const [last, setLast] = useState(tg);
  useEffect(() => {
    if (tg) setLast(tg);
  }, [tg]);
  const shown = tg || last;
  if (!shown) return null;
  return (
    <Modal
      visible={!!tg}
      transparent
      animationType="slide"
      onRequestClose={() => openMvOptions(null)}
    >
      <Body track={shown} />
    </Modal>
  );
};

const Body: React.FC<{ track: Track }> = ({ track }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { prefs, updatePrefs, palette, haptic } = useHolySic();
  const vi = prefs.language === 'vi';
  useMvCache();
  const video = useVideoState();
  const quality = prefs.videoQuality || 720;
  const autoPlay = prefs.videoAutoPlay !== false;
  const saved =
    MvCache.byTrack(track.id) ||
    (video.trackId === track.id ? MvCache.byVideo(video.videoId) : undefined);
  const saving = MvCache.isSaving(track.id);
  const close = () => openMvOptions(null);
  const isThis = video.trackId === track.id;

  const status =
    !prefs.musicVideo && !track.id.startsWith('ytv-')
      ? vi
        ? 'Video âm nhạc đang tắt trong Cài đặt'
        : 'Music video is off in Settings'
      : !isThis
        ? ''
        : video.status === 'ready'
          ? `${video.label || 'MV'}${video.local ? (vi ? ' · bản đã lưu' : ' · saved copy') : ''}`
          : video.status === 'searching'
            ? vi
              ? 'Đang tìm video…'
              : 'Finding the video…'
            : video.status === 'loading'
              ? vi
                ? 'Đang tải video…'
                : 'Loading the video…'
              : video.status === 'idle'
                ? vi
                  ? 'Chưa tải — bấm nút máy quay để phát MV'
                  : 'Not loaded — tap the camera button to play it'
                : video.status === 'none'
                  ? vi
                    ? 'Bài này không có MV chính thức'
                    : 'No official video for this song'
                  : video.status === 'offline'
                    ? vi
                      ? 'Ngoại tuyến và chưa lưu MV này'
                      : 'Offline, and this video isn’t saved'
                    : video.status === 'wifi'
                      ? vi
                        ? 'Chờ Wi-Fi (Cài đặt › Chỉ tải qua Wi-Fi)'
                        : 'Waiting for Wi-Fi'
                      : video.status === 'error'
                        ? vi
                          ? 'Không mở được video'
                          : 'Couldn’t open the video'
                        : '';

  const save = () => {
    haptic('light');
    MvCache.save(track, quality).then((r) => {
      const name = `“${track.title}”`;
      if (r === 'saved') ToastStore.show(vi ? `Đã lưu MV ${name}` : `Saved the video ${name}`);
      else if (r === 'none')
        ToastStore.show(vi ? `Không tìm thấy MV cho ${name}` : `No music video for ${name}`);
      else if (r === 'hls')
        ToastStore.show(
          vi
            ? 'Nguồn video này chỉ phát trực tuyến, không lưu được'
            : 'This video can only stream, it can’t be saved'
        );
      else if (r === 'failed')
        ToastStore.show(vi ? `Không lưu được MV ${name}` : `Couldn’t save the video ${name}`);
    });
  };
  const remove = () => {
    if (!saved) return;
    haptic('medium');
    MvCache.remove([saved.videoId]);
    ToastStore.show(vi ? 'Đã xoá MV đã lưu' : 'Removed the saved video');
  };

  return (
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={close} accessibilityLabel={vi ? 'Đóng' : 'Close'} />
      <View style={s.wrap} pointerEvents="box-none">
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          <View style={s.head}>
            <View style={[s.headIcon, { backgroundColor: palette.accent + '26' }]}>
              <Ionicons name="videocam" size={20} color={palette.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{vi ? 'Video âm nhạc' : 'Music video'}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {track.title} · {track.artist}
              </Text>
            </View>
            <Tap feedback="opacity" hitSlop={10} onPress={close} accessibilityRole="button">
              <Text style={[s.done, { color: palette.accent }]}>{vi ? 'Xong' : 'Done'}</Text>
            </Tap>
          </View>
          {!!status && (
            <View style={s.statusRow}>
              <View
                style={[
                  s.statusDot,
                  {
                    backgroundColor: isThis && video.status === 'ready' ? palette.accent : c.text3,
                  },
                ]}
              />
              <Text style={s.statusText} numberOfLines={2}>
                {status}
              </Text>
            </View>
          )}

          <Text style={s.label}>{vi ? 'Chất lượng tối đa' : 'Max quality'}</Text>
          <View style={s.segments} accessibilityRole="radiogroup">
            {QUALITIES.map((q) => {
              const sel = q === quality;
              return (
                <Tap
                  key={q}
                  onPress={() => {
                    haptic('selection');
                    updatePrefs({ videoQuality: q });
                  }}
                  style={[s.segment, sel && { backgroundColor: palette.accent }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                >
                  <Text style={[s.segText, { color: sel ? palette.onAccent : c.text }]}>{q}p</Text>
                </Tap>
              );
            })}
          </View>
          <Text style={s.hint}>
            {vi
              ? 'Cao hơn nét hơn nhưng tốn dữ liệu, pin hơn. Áp dụng ngay cho video đang phát.'
              : 'Higher is sharper but uses more data and battery. Applies to the playing video now.'}
          </Text>

          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.icon, { backgroundColor: '#A3E63526' }]}>
                <Ionicons name="arrow-down-circle" size={17} color="#A3E635" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>
                  {saved
                    ? vi
                      ? 'Đã lưu để xem offline'
                      : 'Saved for offline'
                    : vi
                      ? 'Lưu để xem offline'
                      : 'Save for offline'}
                </Text>
                <Text style={s.rowDesc}>
                  {saved
                    ? `${saved.label.split(' · ')[0] || `${saved.height}p`} · ${fmtMB(saved.bytes)}${
                        saved.height < quality
                          ? vi
                            ? ' · thấp hơn mức đang chọn: khi có mạng sẽ phát trực tuyến'
                            : ' · below the chosen quality: streams when online'
                          : ''
                      }`
                    : saving
                      ? vi
                        ? 'Đang lưu… (một video mỗi lần, nhạc vẫn phát bình thường)'
                        : 'Saving… (one video at a time, the music keeps playing)'
                      : vi
                        ? `Tải MV ${quality}p về máy: xem khi mất mạng, mở tức thì`
                        : `Keep the ${quality}p video on this device: plays offline, opens at once`}
                  {Platform.OS === 'web' && !saved
                    ? vi
                      ? ' · trên web chỉ lưu được khi nguồn video cho phép'
                      : ' · on the web only when the video host allows it'
                    : ''}
                </Text>
              </View>
              {saved ? (
                <Tap
                  onPress={remove}
                  style={[s.smallBtn, { backgroundColor: c.danger + '22' }]}
                  accessibilityRole="button"
                  accessibilityLabel={vi ? 'Xoá MV đã lưu' : 'Delete the saved video'}
                >
                  <Text style={[s.smallBtnText, { color: c.danger }]}>{vi ? 'Xoá' : 'Delete'}</Text>
                </Tap>
              ) : saving ? (
                <ActivityIndicator color={palette.accent} />
              ) : (
                <Tap
                  onPress={save}
                  style={[s.smallBtn, { backgroundColor: palette.accent }]}
                  accessibilityRole="button"
                >
                  <Text style={[s.smallBtnText, { color: palette.onAccent }]}>
                    {vi ? 'Lưu' : 'Save'}
                  </Text>
                </Tap>
              )}
            </View>
            <View style={[s.row, s.divider]}>
              <View style={[s.icon, { backgroundColor: palette.accent + '22' }]}>
                <Ionicons name="play-circle" size={17} color={palette.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{vi ? 'Tự phát MV' : 'Play videos automatically'}</Text>
                <Text style={s.rowDesc}>
                  {autoPlay
                    ? vi
                      ? 'MV của mỗi bài tự tải và phát'
                      : 'Each song’s video loads and plays by itself'
                    : vi
                      ? 'MV chỉ tải khi bạn bấm nút máy quay'
                      : 'A video loads only when you tap the camera button'}
                </Text>
              </View>
              <Switch
                value={autoPlay}
                onValueChange={(v) => {
                  haptic('selection');
                  updatePrefs({ videoAutoPlay: v });
                }}
                trackColor={{ false: c.field, true: palette.accent }}
                accessibilityLabel={vi ? 'Tự phát MV' : 'Play videos automatically'}
              />
            </View>
          </View>
          <Text style={s.foot}>
            {vi
              ? 'Mọi MV đã lưu: Cài đặt › Dung lượng › MV đã lưu.'
              : 'All saved videos: Settings › Storage › Saved music videos.'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const makeStyles = (c: UiColors) => ({
  root: { flex: 1 },
  scrim: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.scrim,
  },
  wrap: { flex: 1, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 8,
    borderWidth: c.scheme === 'light' ? 0 : 1,
    borderColor: c.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center' as const,
    marginBottom: 12,
  },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: { color: c.text, fontSize: 17, fontWeight: '800' as const },
  sub: { color: c.text2, fontSize: 13, marginTop: 2 },
  done: { fontSize: 16, fontWeight: '700' as const },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 12,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: c.text2, fontSize: 12.5, flex: 1 },
  label: { color: c.text, fontSize: 13.5, fontWeight: '700' as const, marginTop: 16 },
  segments: {
    flexDirection: 'row' as const,
    gap: 4,
    padding: 3,
    borderRadius: 13,
    backgroundColor: c.field,
    marginTop: 8,
  },
  segment: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  segText: { fontSize: 13.5, fontWeight: '700' as const },
  hint: { color: c.text3, fontSize: 12, marginTop: 6, lineHeight: 16 },
  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: 14,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 11,
  },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowTitle: { color: c.text, fontSize: 14.5, fontWeight: '700' as const },
  rowDesc: { color: c.text2, fontSize: 12, marginTop: 2, lineHeight: 16 },
  smallBtn: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  smallBtnText: { fontSize: 13.5, fontWeight: '800' as const },
  foot: { color: c.text3, fontSize: 12, textAlign: 'center' as const, marginTop: 12 },
});
