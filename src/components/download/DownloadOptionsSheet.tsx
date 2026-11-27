// "Tải để nghe offline": what comes along with the audio — the lyrics and / or the music
// video, each on its own. Shown when a download starts (song menu, Download all, Select ›
// Download) while Settings › Playback › "Hỏi mỗi lần tải" is on; the ticks start from the last
// choice. "Không hỏi lại" downloads straight away with that choice from then on.

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHolySic } from '../../context/HolySicContext';
import { isLocalTrack } from '../../services/local/localLibrary';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { Tap } from '../ui/Tap';

// ---------- open / close ----------

let target: { tracks: Track[] } | null = null;
const subs = new Set<() => void>();
export function openDownloadOptions(t: { tracks: Track[] } | null) {
  target = t;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useDownloadOptionsTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

/**
 * Start downloading songs: asks what to bring along (if the user wants to be asked), else
 * downloads at once with the saved choice. Songs already downloaded / on the device / live are
 * skipped. Returns how many will download.
 */
export function useDownloadRequest() {
  const { prefs, downloads, downloadTrack, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  return useCallback(
    (tracks: Track[]): number => {
      const todo = tracks.filter((t) => !downloads[t.id] && !t.isLive && !isLocalTrack(t));
      if (!todo.length) {
        showToast(vi ? 'Các bài này đã có sẵn offline' : 'These songs are already offline');
        return 0;
      }
      if (prefs.downloadAsk !== false) openDownloadOptions({ tracks: todo });
      else {
        todo.forEach((t) => downloadTrack(t));
        if (todo.length > 1)
          showToast(vi ? `Đang tải ${todo.length} bài…` : `Downloading ${todo.length} songs…`);
      }
      return todo.length;
    },
    [downloads, prefs.downloadAsk, downloadTrack, showToast, vi]
  );
}

// ---------- the sheet ----------

export const DownloadOptionsSheet: React.FC = () => {
  const tg = useDownloadOptionsTarget();
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
      onRequestClose={() => openDownloadOptions(null)}
    >
      <Body tracks={shown.tracks} key={shown.tracks.map((t) => t.id).join(',')} />
    </Modal>
  );
};

const Body: React.FC<{ tracks: Track[] }> = ({ tracks }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { prefs, updatePrefs, palette, haptic, downloadTrack, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  const [lyrics, setLyrics] = useState(prefs.downloadLyrics !== false);
  const [mv, setMv] = useState(!!prefs.downloadMv);
  const [remember, setRemember] = useState(false);
  const one = tracks.length === 1 ? tracks[0] : null;
  const q = prefs.videoQuality || 720;
  // rough H.264 sizes for a 4-minute music video (video only)
  const perMv = q >= 1080 ? '60–120' : q >= 720 ? '25–60' : q >= 480 ? '12–30' : '8–18';

  const close = () => openDownloadOptions(null);
  const start = () => {
    haptic('medium');
    updatePrefs({
      downloadLyrics: lyrics,
      downloadMv: mv,
      ...(remember ? { downloadAsk: false } : {}),
    });
    tracks.forEach((t) => downloadTrack(t, { lyrics, mv }));
    if (tracks.length > 1)
      showToast(vi ? `Đang tải ${tracks.length} bài…` : `Downloading ${tracks.length} songs…`);
    close();
  };

  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={(v) => {
        haptic('selection');
        onChange(v);
      }}
      trackColor={{ false: c.field, true: palette.accent }}
      accessibilityLabel={label}
    />
  );

  return (
    <View style={s.root}>
      <Pressable style={s.scrim} onPress={close} accessibilityLabel={vi ? 'Huỷ' : 'Cancel'} />
      <View style={s.wrap} pointerEvents="box-none">
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          <View style={s.head}>
            {one ? (
              <ArtworkImage
                source={{ uri: one.artworkUrl }}
                fallbackSeed={one.title}
                style={s.art}
              />
            ) : (
              <View style={[s.art, s.artMany, { backgroundColor: palette.accent + '26' }]}>
                <Ionicons name="albums" size={24} color={palette.accent} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{vi ? 'Tải để nghe offline' : 'Download for offline'}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {one
                  ? `${one.title} · ${one.artist}`
                  : vi
                    ? `${tracks.length} bài hát`
                    : `${tracks.length} songs`}
              </Text>
            </View>
          </View>

          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.icon, { backgroundColor: '#34D39926' }]}>
                <Ionicons name="musical-note" size={16} color="#34D399" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{vi ? 'Bài hát' : 'Song'}</Text>
                <Text style={s.rowDesc}>
                  {vi ? 'Luôn tải · chất lượng tốt nhất có thể' : 'Always · best quality available'}
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color={c.text3} />
            </View>
            <View style={[s.row, s.divider]}>
              <View style={[s.icon, { backgroundColor: '#60A5FA26' }]}>
                <Ionicons name="chatbox-ellipses" size={16} color="#60A5FA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{vi ? 'Kèm lời bài hát' : 'With lyrics'}</Text>
                <Text style={s.rowDesc}>
                  {vi
                    ? 'Vài KB mỗi bài · có lời khi mất mạng'
                    : 'A few KB per song · lyrics offline'}
                </Text>
              </View>
              {sw(lyrics, setLyrics, vi ? 'Kèm lời bài hát' : 'With lyrics')}
            </View>
            <View style={[s.row, s.divider]}>
              <View style={[s.icon, { backgroundColor: '#FB718526' }]}>
                <Ionicons name="film" size={16} color="#FB7185" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{vi ? 'Kèm MV' : 'With music video'}</Text>
                <Text style={s.rowDesc}>
                  {vi
                    ? `≈ ${perMv} MB mỗi bài (${q}p) · xem MV khi mất mạng`
                    : `≈ ${perMv} MB per song (${q}p) · watch offline`}
                  {!prefs.musicVideo
                    ? vi
                      ? ' · cần bật Video âm nhạc để xem'
                      : ' · needs Music video on to watch'
                    : ''}
                  {Platform.OS === 'web'
                    ? vi
                      ? ' · web: tuỳ nguồn video'
                      : ' · web: depends on the video host'
                    : ''}
                </Text>
              </View>
              {sw(mv, setMv, vi ? 'Kèm MV' : 'With music video')}
            </View>
          </View>

          <Tap
            feedback="opacity"
            onPress={() => {
              haptic('selection');
              setRemember((v) => !v);
            }}
            style={s.remember}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
          >
            <Ionicons
              name={remember ? 'checkbox' : 'square-outline'}
              size={20}
              color={remember ? palette.accent : c.text3}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.rememberText}>
                {vi ? 'Dùng lựa chọn này, không hỏi lại' : 'Use this choice, don’t ask again'}
              </Text>
              <Text style={s.rowDesc}>
                {vi
                  ? 'Đổi lại trong Cài đặt › Phát nhạc & chất lượng › Tải về'
                  : 'Change it in Settings › Playback & Quality › Downloads'}
              </Text>
            </View>
          </Tap>

          <View style={s.btns}>
            <Tap onPress={close} style={s.cancel} accessibilityRole="button">
              <Text style={s.cancelText}>{vi ? 'Huỷ' : 'Cancel'}</Text>
            </Tap>
            <Tap
              onPress={start}
              style={[s.go, { backgroundColor: palette.accent }]}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-down-circle" size={18} color={palette.onAccent} />
              <Text style={[s.goText, { color: palette.onAccent }]}>
                {tracks.length > 1
                  ? vi
                    ? `Tải ${tracks.length} bài`
                    : `Download ${tracks.length}`
                  : vi
                    ? 'Tải xuống'
                    : 'Download'}
              </Text>
            </Tap>
          </View>
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
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginBottom: 14 },
  art: { width: 52, height: 52, borderRadius: 12 },
  artMany: { alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { color: c.text, fontSize: 17, fontWeight: '800' as const },
  sub: { color: c.text2, fontSize: 13, marginTop: 2 },
  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.border,
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
  remember: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  rememberText: { color: c.text, fontSize: 14, fontWeight: '600' as const },
  btns: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
  cancel: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: c.field,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cancelText: { color: c.text, fontSize: 15, fontWeight: '700' as const },
  go: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  goText: { fontSize: 15, fontWeight: '800' as const },
});
