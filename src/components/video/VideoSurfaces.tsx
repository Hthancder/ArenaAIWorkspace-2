// Views of the shared music video:
//   <MusicVideoStage>   the picture itself, in place of the cover (player)
//   <VideoAmbient>      the scenes, blurred and dimmed, lighting the background
//                       (`live` = it moves; otherwise it rests on the last scene)

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useVideoState, VideoLive, VideoStore } from '../../services/video/videoStore';

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
}> = ({ width, accent, vi, style }) => {
  const st = useVideoState();
  const ready = st.status === 'ready' && !!VideoStore.player;
  useLive(ready);
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
  return (
    <View style={[styles.stage, { width, height: h }, style]}>
      {ready ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
          <VideoView
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
      {!ready && (
        <View style={styles.wait}>
          <ActivityIndicator color={accent} />
          <Text style={styles.waitText}>
            {st.status === 'searching'
              ? vi
                ? 'Đang tìm video…'
                : 'Finding the video…'
              : vi
                ? 'Đang tải video…'
                : 'Loading video…'}
          </Text>
        </View>
      )}
      {ready && st.synced && (
        <View style={[styles.badge, { borderColor: accent + '66' }]}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={styles.badgeText}>MV</Text>
        </View>
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
              : ['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.7)']
          }
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
};

/** Behind the tabs: the last scene, still (menus never move). Fades in; off while the full player
 *  covers the app, so the blur isn't drawn twice. */
export const AppVideoAmbient: React.FC<{ hidden: boolean; level: number; light?: boolean }> = ({
  hidden,
  level,
  light,
}) => {
  const st = useVideoState();
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
  waitText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 },
});
