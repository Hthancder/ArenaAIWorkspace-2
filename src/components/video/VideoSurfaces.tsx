// Views of the shared music video:
//   <MusicVideoStage>   the picture itself, in place of the cover (player)
//   <VideoAmbient>      the scenes, blurred and dimmed, lighting the background
//                       (`live` = it moves; otherwise it rests on the last scene)

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useVideoHidden,
  useVideoState,
  VideoLive,
  VideoStore,
} from '../../services/video/videoStore';
import { Tap } from '../ui/Tap';

/** registers a moving view while mounted & live */
function useLive(on: boolean) {
  useEffect(() => {
    if (!on) return;
    return VideoLive.hold();
  }, [on]);
}

export const MusicVideoStage: React.FC<{
  width: number;
  accent: string;
  vi: boolean;
  style?: StyleProp<ViewStyle>;
  /** the badge (quality · saved · exact sync) opens the video's options. It stays hidden while
   *  the video plays — a tap on the picture shows it for a few seconds (like a video app's
   *  controls), so nothing sits on top of the scenes */
  onBadgePress?: () => void;
  /** the full-screen button (bottom-right; always there, faint until the picture is tapped) */
  onExpand?: () => void;
  /** lyrics under the video: the quick switch shown with the badge */
  lyricsOn?: boolean;
  onToggleLyrics?: () => void;
  /** the song on screen: another song's video (between songs) is never shown for it */
  trackId?: string;
  /** dimmed behind the "no video" notice, so the card still belongs to the song */
  artworkUrl?: string;
}> = ({
  width,
  accent,
  vi,
  style,
  onBadgePress,
  onExpand,
  lyricsOn,
  onToggleLyrics,
  trackId,
  artworkUrl,
}) => {
  const st = useVideoState();
  const mine = !trackId || st.trackId === trackId;
  const ready = mine && st.status === 'ready' && !!VideoStore.player;
  // this song has no video to show: a notice in the card instead of the card turning into the
  // big cover (the camera button shows the cover)
  const notice: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string } | null = !mine
    ? null
    : st.status === 'none'
      ? {
          icon: 'videocam-off-outline',
          title: vi ? 'Không tìm thấy MV cho bài này' : 'No music video for this song',
          sub: vi ? 'Chạm nút camera để xem ảnh bìa' : 'Tap the camera button for the cover',
        }
      : st.status === 'error'
        ? {
            icon: 'alert-circle-outline',
            title: vi ? 'Không mở được MV' : 'The video could not be opened',
            sub: vi ? 'Nhạc vẫn phát bình thường' : 'The music keeps playing',
          }
        : st.status === 'offline'
          ? {
              icon: 'cloud-offline-outline',
              title: vi ? 'Đang ngoại tuyến' : 'You’re offline',
              sub: vi
                ? 'MV cần mạng (hoặc bản đã lưu)'
                : 'Videos need the internet (or a saved copy)',
            }
          : st.status === 'wifi'
            ? {
                icon: 'wifi-outline',
                title: vi ? 'MV chỉ tải qua Wi-Fi' : 'Videos load on Wi-Fi only',
                sub: vi
                  ? 'Đổi trong Cài đặt › Video âm nhạc'
                  : 'Change it in Settings › Music video',
              }
            : null;
  useLive(ready);
  // after a rotation the picture's layer can come back black on iOS (re-attached to the shared
  // player while the old layout's view is torn down): once the rotation settles, mount a fresh
  // view and have the host seek so it draws a frame
  const win = useWindowDimensions();
  const landscape = win.width > win.height;
  const [layerKey, setLayerKey] = useState(0);
  const firstOrientation = useRef(true);
  useEffect(() => {
    if (firstOrientation.current) {
      firstOrientation.current = false;
      return;
    }
    if (Platform.OS === 'web') return;
    const t = setTimeout(() => {
      setLayerKey((k) => k + 1);
      VideoLive.nudge();
    }, 450);
    return () => clearTimeout(t);
  }, [landscape]);
  const aspect = Math.max(0.5, Math.min(2.4, st.aspect || 16 / 9));
  const h = Math.round(width / aspect);
  // the picture fades in on its first frame (no black flash while the layer attaches)
  const shown = useRef(new Animated.Value(0)).current;
  const onFirstFrame = () =>
    Animated.timing(shown, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  useEffect(() => {
    if (!ready) return;
    // safety net: a layer that never reports its first frame still appears
    const t = setTimeout(onFirstFrame, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // the badge: hidden until the picture is tapped, then fades out again after a few seconds
  const [chrome, setChrome] = useState(false);
  const chromeOp = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showChrome = useCallback(
    (on: boolean) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = on ? setTimeout(() => showChrome(false), 3500) : null;
      setChrome(on);
      Animated.timing(chromeOp, {
        toValue: on ? 1 : 0,
        duration: on ? 160 : 280,
        useNativeDriver: true,
      }).start();
    },
    [chromeOp]
  );
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );
  // a new video starts clean; once it plays, the buttons show for a moment so they can be found
  useEffect(() => {
    showChrome(false);
    if (!ready || (!onExpand && !onToggleLyrics)) return;
    const t = setTimeout(() => showChrome(true), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showChrome]);
  return (
    <View style={[styles.stage, { width, height: h }, style]}>
      {ready ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
          <VideoView
            key={layerKey}
            player={VideoStore.player!}
            style={styles.fill}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
            pointerEvents="none"
            onFirstFrameRender={onFirstFrame}
          />
        </Animated.View>
      ) : null}
      {!ready && notice && (
        <View style={styles.wait}>
          {artworkUrl ? (
            <Image
              source={{ uri: artworkUrl }}
              style={[StyleSheet.absoluteFill, { opacity: 0.32 }]}
              resizeMode="cover"
              blurRadius={Platform.OS === 'web' ? 0 : 18}
            />
          ) : null}
          <View style={styles.noticeIcon}>
            <Ionicons name={notice.icon} size={20} color="#fff" />
          </View>
          <Text style={styles.noticeTitle} numberOfLines={2}>
            {notice.title}
          </Text>
          <Text style={styles.waitText} numberOfLines={2}>
            {notice.sub}
          </Text>
        </View>
      )}
      {!ready && !notice && (
        <View style={styles.wait}>
          <ActivityIndicator color={accent} />
          <Text style={styles.waitText}>
            {st.status === 'searching' || !mine
              ? vi
                ? 'Đang tìm video…'
                : 'Finding the video…'
              : vi
                ? 'Đang tải video…'
                : 'Loading video…'}
          </Text>
        </View>
      )}
      {ready && (
        <>
          {/* tap the picture: show / hide the badge (a swipe still changes the song) */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => showChrome(!chrome)}
            accessibilityRole="button"
            accessibilityLabel={vi ? 'Hiện thông tin MV' : 'Show video info'}
          />
          <Animated.View
            pointerEvents={chrome ? 'box-none' : 'none'}
            style={[styles.badgeWrap, { opacity: chromeOp }]}
          >
            <Tap
              feedback="opacity"
              hitSlop={10}
              disabled={!onBadgePress || !chrome}
              onPress={() => {
                showChrome(false);
                onBadgePress?.();
              }}
              style={[
                styles.badge,
                { borderColor: st.synced ? accent + '66' : 'rgba(255,255,255,0.18)' },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                (vi ? 'Tuỳ chọn MV: ' : 'Video options: ') +
                [
                  st.height ? `${st.height}p` : 'MV',
                  st.local ? (vi ? 'bản đã lưu' : 'saved copy') : '',
                  st.synced ? (vi ? 'tiếng từ video' : 'audio from the video') : '',
                ]
                  .filter(Boolean)
                  .join(', ')
              }
            >
              {st.synced && <View style={[styles.dot, { backgroundColor: accent }]} />}
              {st.local && <Ionicons name="arrow-down-circle" size={12} color="#fff" />}
              <Text style={styles.badgeText}>
                {st.height ? `MV · ${st.height >= 1080 ? '1080p' : `${st.height}p`}` : 'MV'}
              </Text>
              {onBadgePress && (
                <Ionicons name="chevron-down" size={11} color="rgba(255,255,255,0.85)" />
              )}
            </Tap>
          </Animated.View>
          {(onExpand || onToggleLyrics) && (
            <View pointerEvents="box-none" style={styles.cornerRow}>
              {onToggleLyrics && (
                <Animated.View
                  pointerEvents={chrome ? 'auto' : 'none'}
                  style={{ opacity: chromeOp }}
                >
                  <Tap
                    feedback="opacity"
                    hitSlop={8}
                    disabled={!chrome}
                    onPress={() => {
                      showChrome(true); // keep the controls up a little longer
                      onToggleLyrics();
                    }}
                    style={[styles.cornerBtn, lyricsOn && { backgroundColor: accent }]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !!lyricsOn }}
                    accessibilityLabel={vi ? 'Lời dưới MV' : 'Lyrics under the video'}
                  >
                    <Ionicons
                      name={lyricsOn ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
                      size={16}
                      color="#fff"
                    />
                  </Tap>
                </Animated.View>
              )}
              {onExpand && (
                <Animated.View
                  style={{
                    opacity: chromeOp.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }),
                  }}
                >
                  <Tap
                    feedback="opacity"
                    hitSlop={10}
                    onPress={() => {
                      showChrome(false);
                      onExpand();
                    }}
                    style={styles.cornerBtn}
                    accessibilityRole="button"
                    accessibilityLabel={vi ? 'Xem MV toàn màn hình' : 'Watch full screen'}
                  >
                    <Ionicons name="expand" size={16} color="#fff" />
                  </Tap>
                </Animated.View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
};

export const VideoAmbient: React.FC<{
  /** moves with the music (false = rests on the last scene) */
  live: boolean;
  level: number;
  /** extra darkening at the bottom (controls stay readable) */
  shade?: boolean;
  /** light appearance: a pale frost instead of the dark one */
  light?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ live, level, shade = true, light = false, style }) => {
  const st = useVideoState();
  const ready = st.status === 'ready' && !!VideoStore.player;
  useLive(ready && live);
  if (!ready) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: level }, style]}>
      <VideoView
        player={VideoStore.player!}
        // larger than the screen: the blur has no hard edges
        style={[styles.fill, { transform: [{ scale: 1.35 }] }]}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        pointerEvents="none"
      />
      <BlurView
        intensity={Platform.OS === 'ios' ? 70 : 60}
        tint={light ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
      />
      {shade && (
        <LinearGradient
          colors={
            light
              ? ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.8)']
              : ['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.32)', 'rgba(0,0,0,0.55)']
          }
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
};

/** Behind the tabs: the last scene, still (menus never move). Fades in; off while the full player
 *  covers the app, so the blur isn't drawn twice. */
export const AppVideoAmbient: React.FC<{
  hidden: boolean;
  level: number;
  light?: boolean;
  /** keep the light while the camera button hides the picture */
  whenHidden?: boolean;
}> = ({ hidden: hiddenIn, level, light, whenHidden = true }) => {
  const st = useVideoState();
  const userHid = useVideoHidden();
  const hidden = hiddenIn || (userHid && !whenHidden);
  const ready = st.status === 'ready';
  const fade = useRef(new Animated.Value(0)).current;
  const show = ready && !hidden;
  useEffect(() => {
    if (!show) {
      fade.setValue(0);
      return;
    }
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [show, fade]);
  if (!show) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <VideoAmbient live={false} level={level} light={light} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // a web <video> ignores left/right/top/bottom stretching: size it explicitly
  fill: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  stage: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  wait: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  waitText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  noticeTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  noticeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  badgeWrap: { position: 'absolute', top: 10, left: 10 },
  cornerRow: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Crisp controls over a moving picture (Phase 26): a solid, darker disc with a clean hairline
  // (no half-transparent wash that blurs into the video), icons drawn on whole pixel sizes
  cornerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,16,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(12,12,16,0.72)',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { color: '#fff', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.5 },
});
