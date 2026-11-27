// Settings › Music video: the song's official video in the player, its scenes as ambient light.
// Everything is off until "Music video" is on; nothing is loaded otherwise.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { HolySicPreferences } from '../../constants/preferences';
import { HOLYSIC_COLORS } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { useVideoState } from '../../services/video/videoStore';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';

type Opt<T> = readonly (readonly [T, string])[];

export const VideoSettings: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic } = useHolySic();
  const vi = prefs.language === 'vi';
  const video = useVideoState();
  const on = !!prefs.musicVideo;

  const set = (patch: Partial<HolySicPreferences>) => {
    haptic('selection');
    updatePrefs(patch);
  };
  const sw = (value: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
      accessibilityLabel={label}
    />
  );
  const row = (title: string, desc: string, control: React.ReactNode, last = false) => (
    <View style={[styles.switchRow, last && { borderBottomWidth: 0 }, !on && { opacity: 0.45 }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!desc && <Text style={styles.rowDesc}>{desc}</Text>}
      </View>
      {control}
    </View>
  );
  function segments<T extends string | number>(
    value: T,
    options: Opt<T>,
    onPick: (v: T) => void,
    label: string
  ) {
    return (
      <View
        style={[styles.segments, !on && { opacity: 0.45 }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map(([id, text]) => {
          const sel = value === id;
          return (
            <Tap
              key={String(id)}
              disabled={!on}
              onPress={() => onPick(id)}
              style={[styles.segment, sel && { backgroundColor: palette.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel }}
            >
              <Text
                numberOfLines={1}
                style={[styles.segmentText, { color: sel ? palette.onAccent : UI.fg(0.9) }]}
              >
                {text}
              </Text>
            </Tap>
          );
        })}
      </View>
    );
  }

  const statusText = (() => {
    if (!on) return '';
    switch (video.status) {
      case 'searching':
        return vi ? 'Đang tìm video cho bài đang phát…' : 'Finding a video for this song…';
      case 'loading':
        return vi ? 'Đang tải video…' : 'Loading the video…';
      case 'ready':
        return `${vi ? 'Đang chiếu' : 'Showing'} · ${video.label || 'YouTube'}${
          video.local ? (vi ? ' · bản đã lưu' : ' · saved copy') : ''
        }${video.synced ? (vi ? ' · tiếng từ video' : ' · audio from video') : ''}`;
      case 'idle':
        return vi
          ? 'Chờ bạn bấm nút máy quay trên trình phát'
          : 'Waiting for you to tap the camera button in the player';
      case 'none':
        return vi ? 'Bài đang phát không có MV chính thức' : 'No official video for this song';
      case 'error':
        return vi
          ? 'Không mở được video — dùng ảnh bìa'
          : "Couldn't open the video — showing the cover";
      case 'offline':
        return vi ? 'Ngoại tuyến — dùng ảnh bìa' : 'Offline — showing the cover';
      case 'wifi':
        return vi ? 'Chờ Wi-Fi để tải video' : 'Waiting for Wi-Fi';
      default:
        return '';
    }
  })();

  const levels: Opt<number> = [
    [0.35, vi ? 'Nhẹ' : 'Soft'],
    [0.6, vi ? 'Vừa' : 'Medium'],
    [0.85, vi ? 'Rực' : 'Vivid'],
  ];
  const level = levels.reduce(
    (best, [v]) =>
      Math.abs(v - prefs.videoAmbientLevel) < Math.abs(best - prefs.videoAmbientLevel) ? v : best,
    0.6
  );

  return (
    <>
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Video âm nhạc' : 'Music video'}
      </Text>
      <View style={styles.card}>
        <View style={[styles.switchRow, { paddingTop: 0 }]}>
          <View style={[styles.icon, { backgroundColor: palette.accent + '22' }]}>
            <Ionicons name="videocam" size={17} color={palette.accent} />
          </View>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{vi ? 'Video âm nhạc' : 'Music video'}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tự tìm MV chính thức của bài đang phát và chiếu thay ảnh bìa (bấm nút máy quay trên trình phát để đổi lại).'
                : "Finds the playing song's official video and shows it instead of the cover (tap the camera button in the player to switch)."}
            </Text>
          </View>
          {sw(on, (v) => set({ musicVideo: v }), vi ? 'Video âm nhạc' : 'Music video')}
        </View>

        {row(
          vi ? 'Tự phát MV' : 'Play videos automatically',
          vi
            ? 'Tắt: MV chỉ tải khi bạn bấm nút máy quay trên trình phát (tiết kiệm dữ liệu và pin). MV đã lưu cũng chờ bạn bấm.'
            : 'Off: a video loads only when you tap the camera button in the player (saves data and battery). Saved videos wait too.',
          sw(prefs.videoAutoPlay !== false, (v) => set({ videoAutoPlay: v }), 'autoplay', !on)
        )}
        {row(
          vi ? 'Tiếng từ video' : 'Audio from the video',
          vi
            ? 'Phát tiếng của chính MV để hình và tiếng khớp tuyệt đối (bản MV có thể khác bản thu âm).'
            : 'Plays the video’s own sound so picture and audio match exactly (an MV cut can differ from the album version).',
          sw(prefs.videoAudio, (v) => set({ videoAudio: v }), 'audio', !on)
        )}
        {row(
          vi ? 'Ánh sáng từ video' : 'Video ambient light',
          vi
            ? 'Cảnh của video (làm mờ) chiếu sáng nền trình phát, đổi màu theo từng cảnh.'
            : "The video's scenes, blurred, light the player background scene by scene.",
          sw(prefs.videoAmbient, (v) => set({ videoAmbient: v }), 'ambient', !on)
        )}
        {row(
          vi ? 'Giữ cảnh ở nền ứng dụng' : 'Keep the scene behind the app',
          vi
            ? 'Ngoài trình phát, cảnh cuối đứng yên phía sau các menu (không chuyển động).'
            : 'Outside the player the last scene rests, still, behind the menus.',
          sw(prefs.videoAmbientApp, (v) => set({ videoAmbientApp: v }), 'app ambient', !on)
        )}
        {row(
          vi ? 'Chỉ tải qua Wi-Fi' : 'Wi-Fi only',
          vi ? 'Dùng ảnh bìa khi đang dùng dữ liệu di động.' : 'Show the cover on cellular data.',
          sw(prefs.videoWifiOnly, (v) => set({ videoWifiOnly: v }), 'wifi', !on),
          true
        )}

        <View style={styles.divider} />
        <Text style={[styles.subLabel, !on && { opacity: 0.45 }]}>
          {vi ? 'Độ sáng ambient' : 'Ambient strength'}
        </Text>
        {segments(level, levels, (v) => set({ videoAmbientLevel: v }), 'ambient level')}

        <Text style={[styles.subLabel, { marginTop: 14 }, !on && { opacity: 0.45 }]}>
          {vi ? 'Chất lượng tối đa' : 'Max quality'}
        </Text>
        {segments(
          prefs.videoQuality,
          [
            [360, '360p'],
            [480, '480p'],
            [720, '720p'],
            [1080, '1080p'],
          ] as Opt<HolySicPreferences['videoQuality']>,
          (v) => set({ videoQuality: v }),
          'quality'
        )}
        <Text style={styles.rowDesc}>
          {vi
            ? 'Video luôn tắt tiếng và giải mã bằng phần cứng (H.264); 720p cân bằng giữa nét và pin. Cũng là chất lượng khi lưu MV để xem offline; MV đã lưu được dùng khi mất mạng hoặc khi nét bằng mức này.'
            : 'The picture is muted and hardware-decoded (H.264); 720p balances sharpness and battery. Also the quality of saved videos; a saved video plays offline, or whenever it is at least this sharp.'}
        </Text>
        {!!statusText && (
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    video.status === 'ready'
                      ? palette.accent
                      : video.status === 'error'
                        ? HOLYSIC_COLORS.aacAmber
                        : UI.fg(0.35),
                },
              ]}
            />
            <Text style={styles.statusText} numberOfLines={2}>
              {statusText}
            </Text>
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
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: { color: UI.text, fontSize: 14.5, fontWeight: '700' },
  rowDesc: { color: UI.text2, fontSize: 12, lineHeight: 17, marginTop: 6 },
  subLabel: { color: UI.fg(0.88), fontSize: 13, fontWeight: '700', marginBottom: 0 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: UI.fg(0.1), marginVertical: 14 },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 13,
    backgroundColor: UI.fg(0.06),
    marginTop: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentText: { fontSize: 12.5, fontWeight: '700' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: UI.fg(0.05),
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, color: UI.text2, fontSize: 12, fontWeight: '600' },
}));
