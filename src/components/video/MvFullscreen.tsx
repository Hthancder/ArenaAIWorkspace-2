// The music video, full screen.
//
// A layer inside the player (same modal), so it turns with the player and closes back into it.
//   • the picture: whole ('contain') or filling the screen ('cover') — the choice is remembered
//   • tap: show / hide the controls (they hide by themselves after a few seconds of playing)
//   • double-tap the left / right side: −10 s / +10 s
//   • swipe down or the chevron: back to the player
//   • a wide video turns the screen to landscape (the lock button keeps it upright instead);
//     on iPhone the status bar steps aside in landscape by itself
//   • lyrics as subtitles in the chosen lyrics effect (switch in the top bar)
//   • the screen stays on while it is up
// Song changes keep the layer: the next song's video loads into it; a song without one shows
// its cover with the lyrics, so it works as a full-screen "now playing" too.

import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHolySic } from '../../context/HolySicContext';
import { usePositionSec } from '../../services/audio/playbackClock';
import { Orientation } from '../../services/ui/orientation';
import { useVideoState, VideoLive, VideoStore } from '../../services/video/videoStore';
import { ArtworkImage } from '../ArtworkImage';
import { formatTimeSec } from '../HolySicIcons';
import { LyricsStrip } from '../player/LyricsView';
import { ScrubBar } from '../player/ScrubBar';
import { MorphIcon } from '../ui/MorphIcon';
import { Tap } from '../ui/Tap';
import { openMvOptions } from './MvOptionsSheet';

const HIDE_AFTER_MS = 3500;
const DOUBLE_TAP_MS = 260;

type Lock = 'landscape' | 'portrait' | 'auto';

export const MvFullscreen: React.FC<{ visible: boolean; onClose: () => void }> = ({
  visible,
  onClose,
}) => {
  if (!visible) return null;
  return <Body onClose={onClose} />;
};

const Body: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    togglePlay,
    playNext,
    playPrevious,
    seekTo,
    seekBy,
    durationSec,
    prefs,
    updatePrefs,
    darkPalette: palette,
    haptic,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const st = useVideoState();
  const ready =
    st.status === 'ready' &&
    !!VideoStore.player &&
    (!currentTrack || st.trackId === currentTrack.id);
  const loading =
    (st.status === 'searching' || st.status === 'loading') &&
    (!currentTrack || st.trackId === currentTrack.id);
  const fit = prefs.mvFullFit === 'cover' ? 'cover' : 'contain';
  const lyricsOn = prefs.mvFullLyrics !== false;
  const wide = (st.aspect || 16 / 9) > 1.05;

  // ── the picture keeps moving while this layer shows it ──
  useEffect(() => {
    if (!ready) return;
    return VideoLive.hold();
  }, [ready]);

  // ── screen stays on ──
  useEffect(() => {
    activateKeepAwakeAsync('holysic-mv-full').catch(() => undefined);
    return () => {
      deactivateKeepAwake('holysic-mv-full').catch(() => undefined);
    };
  }, []);

  // ── turn the screen: a wide video goes landscape; the lock button keeps it upright ──
  const [lock, setLock] = useState<Lock>(wide ? 'landscape' : 'auto');
  useEffect(() => {
    Orientation.setTop(lock);
  }, [lock]);
  useEffect(() => () => Orientation.setTop(null), []);

  // ── web: the browser's own full screen (hides the address bar; allows the landscape lock) ──
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>;
    };
    let entered = false;
    try {
      el.requestFullscreen?.()
        .then(() => {
          entered = true;
          if (wide) Orientation.setTop('landscape');
        })
        .catch(() => undefined);
    } catch {
      // not allowed here (iPhone Safari): the layer still fills the page
    }
    const onChange = () => {
      // Esc / the browser's own exit leaves the video too
      if (entered && !document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── controls: up on open, hide after a few seconds while playing ──
  const [controls, setControls] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reader, setReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled()
      .then(setReader)
      .catch(() => undefined);
  }, []);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  const readerRef = useRef(reader);
  readerRef.current = reader;
  const showControls = useCallback(
    (on: boolean) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (on && !readerRef.current)
        hideTimer.current = setTimeout(() => {
          if (playingRef.current) showControls(false);
        }, HIDE_AFTER_MS);
      setControls(on || readerRef.current);
      Animated.timing(fade, {
        toValue: on || readerRef.current ? 1 : 0,
        duration: on ? 160 : 320,
        useNativeDriver: true,
      }).start();
    },
    [fade]
  );
  useEffect(() => {
    showControls(true);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showControls]);
  // paused: the controls stay; playing again: they leave after a moment
  useEffect(() => {
    if (!isPlaying) showControls(true);
    else if (controls) showControls(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);
  const poke = () => showControls(true); // any button press keeps the controls up

  // ── taps on the picture: single = controls, double on a side = ∓10 s ──
  const lastTap = useRef({ t: 0, x: 0 });
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jump, setJump] = useState<{ dir: -1 | 1; n: number } | null>(null);
  const jumpOp = useRef(new Animated.Value(0)).current;
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (singleTimer.current) clearTimeout(singleTimer.current);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
    },
    []
  );
  const onSurfacePress = (x: number) => {
    const now = Date.now();
    const side = x < winW * 0.38 ? -1 : x > winW * 0.62 ? 1 : 0;
    if (now - lastTap.current.t < DOUBLE_TAP_MS && side !== 0) {
      if (singleTimer.current) clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = { t: now, x }; // a third tap keeps jumping
      const dir = side as -1 | 1;
      haptic('light');
      seekBy(dir * 10);
      setJump((j) => ({ dir, n: j && j.dir === dir ? j.n + 1 : 1 }));
      jumpOp.setValue(1);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
      jumpTimer.current = setTimeout(() => {
        Animated.timing(jumpOp, { toValue: 0, duration: 260, useNativeDriver: true }).start(() =>
          setJump(null)
        );
      }, 520);
      return;
    }
    lastTap.current = { t: now, x };
    if (singleTimer.current) clearTimeout(singleTimer.current);
    // the middle has no double-tap: answer at once
    if (side === 0) return showControls(!controls);
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      showControls(!controls);
    }, DOUBLE_TAP_MS);
  };

  // ── swipe down: back to the player ──
  const dragY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || (g.dy > 40 && g.vy > 0.9)) closeRef.current();
        else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
    })
  ).current;

  const close = () => {
    haptic('light');
    onClose();
  };
  const cycleFit = () => {
    haptic('selection');
    poke();
    updatePrefs({ mvFullFit: fit === 'contain' ? 'cover' : 'contain' });
  };
  const toggleLyrics = () => {
    haptic('selection');
    poke();
    updatePrefs({ mvFullLyrics: !lyricsOn });
  };
  const cycleLock = () => {
    haptic('selection');
    poke();
    // wide video: landscape ⇄ upright; tall video: follow the phone ⇄ upright
    setLock((l) => (l === 'portrait' ? (wide ? 'landscape' : 'auto') : 'portrait'));
  };

  const padL = Math.max(insets.left, 16);
  const padR = Math.max(insets.right, 16);
  const stripW = Math.min(winW - padL - padR - 24, landscape ? 760 : 520);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        {
          opacity: dragY.interpolate({
            inputRange: [0, 400],
            outputRange: [1, 0.35],
            extrapolate: 'clamp',
          }),
          transform: [
            { translateY: dragY },
            {
              scale: dragY.interpolate({
                inputRange: [0, 400],
                outputRange: [1, 0.86],
                extrapolate: 'clamp',
              }),
            },
          ],
        },
      ]}
      {...pan.panHandlers}
      accessibilityViewIsModal
    >
      {Platform.OS === 'android' && <StatusBar hidden animated />}

      {/* the picture (or the cover while there is none) */}
      {ready ? (
        <VideoView
          player={VideoStore.player!}
          // a <video> on web keeps its own size unless told: width / height, not just the edges
          style={styles.fill}
          contentFit={fit}
          nativeControls={false}
          allowsPictureInPicture={false}
          pointerEvents="none"
        />
      ) : currentTrack ? (
        <View style={styles.coverBox} pointerEvents="none">
          <ArtworkImage
            source={{ uri: currentTrack.artworkUrl }}
            fallbackSeed={currentTrack.title}
            style={{
              width: Math.min(winW, winH) * 0.62,
              height: Math.min(winW, winH) * 0.62,
              borderRadius: 18,
            }}
          />
          <View style={styles.waitRow}>
            {loading && <ActivityIndicator color="#fff" size="small" />}
            <Text style={styles.waitText}>
              {loading
                ? vi
                  ? 'Đang tải video…'
                  : 'Loading the video…'
                : vi
                  ? 'Bài này chưa có MV'
                  : 'No video for this song'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* tap / double-tap surface */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => onSurfacePress(e.nativeEvent.pageX)}
        accessibilityRole="button"
        accessibilityLabel={vi ? 'Hiện / ẩn điều khiển' : 'Show or hide the controls'}
      />

      {/* double-tap feedback */}
      {jump && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.jump,
            jump.dir < 0 ? { left: padL + 24 } : { right: padR + 24 },
            { opacity: jumpOp },
          ]}
        >
          <Ionicons name={jump.dir < 0 ? 'play-back' : 'play-forward'} size={22} color="#fff" />
          <Text style={styles.jumpText}>
            {jump.dir < 0 ? '−' : '+'}
            {jump.n * 10} s
          </Text>
        </Animated.View>
      )}

      {/* subtitles: above the seek bar while the controls are up, lower when they leave */}
      {lyricsOn && (
        <View
          pointerEvents="box-none"
          style={[
            styles.subs,
            {
              bottom: (controls ? (landscape ? 86 : 118) : 18) + Math.max(insets.bottom, 8),
            },
          ]}
        >
          <LyricsStrip
            width={stripW}
            variant="overlay"
            scale={landscape ? 0.84 : 1}
            onPress={() => showControls(!controls)}
          />
        </View>
      )}

      {/* the controls */}
      <Animated.View
        pointerEvents={controls ? 'box-none' : 'none'}
        style={[StyleSheet.absoluteFill, { opacity: fade }]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0)']}
          style={[styles.topShade, { height: 120 + insets.top }]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']}
          style={[styles.bottomShade, { height: 170 + insets.bottom }]}
        />

        {/* top: close · title · switches */}
        <View
          style={[
            styles.topBar,
            { paddingTop: Math.max(insets.top, 12), paddingLeft: padL, paddingRight: padR },
          ]}
        >
          <Tap
            hitSlop={10}
            onPress={close}
            style={styles.roundBtn}
            accessibilityLabel={vi ? 'Thu nhỏ' : 'Exit full screen'}
          >
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Tap>
          <View style={styles.titleBox}>
            <Text numberOfLines={1} style={styles.title}>
              {currentTrack?.title ?? ''}
            </Text>
            <Text numberOfLines={1} style={styles.artist}>
              {currentTrack?.artist ?? ''}
              {ready && st.height ? ` · ${st.height}p` : ''}
              {ready && st.local ? (vi ? ' · đã lưu' : ' · saved') : ''}
            </Text>
          </View>
          <Tap
            hitSlop={8}
            onPress={toggleLyrics}
            style={[styles.roundBtn, lyricsOn && { backgroundColor: palette.accent }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: lyricsOn }}
            accessibilityLabel={vi ? 'Phụ đề lời bài hát' : 'Lyrics subtitles'}
          >
            <Ionicons
              name={lyricsOn ? 'text' : 'text-outline'}
              size={17}
              color={lyricsOn ? palette.onAccent : '#fff'}
            />
          </Tap>
          <Tap
            hitSlop={8}
            onPress={cycleFit}
            disabled={!ready}
            style={[styles.roundBtn, !ready && { opacity: 0.4 }]}
            accessibilityLabel={
              fit === 'contain'
                ? vi
                  ? 'Phóng đầy màn hình'
                  : 'Fill the screen'
                : vi
                  ? 'Xem trọn khung hình'
                  : 'Fit the whole picture'
            }
          >
            <Ionicons
              name={fit === 'contain' ? 'scan-outline' : 'contract'}
              size={17}
              color="#fff"
            />
          </Tap>
          {Platform.OS !== 'web' && (
            <Tap
              hitSlop={8}
              onPress={cycleLock}
              style={[styles.roundBtn, lock === 'portrait' && { backgroundColor: palette.accent }]}
              accessibilityLabel={
                lock === 'portrait'
                  ? vi
                    ? 'Cho phép xoay màn hình'
                    : 'Allow rotation'
                  : vi
                    ? 'Giữ màn hình dọc'
                    : 'Keep upright'
              }
            >
              <Ionicons
                name={lock === 'portrait' ? 'phone-portrait' : 'phone-landscape-outline'}
                size={17}
                color={lock === 'portrait' ? palette.onAccent : '#fff'}
              />
            </Tap>
          )}
          {!!currentTrack && (
            <Tap
              hitSlop={8}
              onPress={() => {
                poke();
                openMvOptions(currentTrack);
              }}
              style={styles.roundBtn}
              accessibilityLabel={vi ? 'Tuỳ chọn MV' : 'Video options'}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
            </Tap>
          )}
        </View>

        {/* middle: previous · play / pause · next */}
        {/* landscape: a little above the middle, so the subtitles fit under the buttons */}
        <View
          pointerEvents="box-none"
          style={[styles.middle, landscape && { paddingBottom: winH * 0.2, gap: 56 }]}
        >
          <Tap
            hitSlop={12}
            onPress={() => {
              poke();
              playPrevious();
            }}
            style={styles.skipBtn}
            accessibilityLabel={vi ? 'Bài trước' : 'Previous'}
          >
            <Ionicons name="play-skip-back" size={30} color="#fff" />
          </Tap>
          <Tap
            onPress={() => {
              poke();
              togglePlay();
            }}
            style={styles.playBtn}
            accessibilityLabel={isPlaying ? (vi ? 'Tạm dừng' : 'Pause') : vi ? 'Phát' : 'Play'}
          >
            {isBuffering ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <MorphIcon
                on={isPlaying}
                onIcon="pause"
                offIcon="play"
                size={36}
                color="#fff"
                offShiftX={3}
              />
            )}
          </Tap>
          <Tap
            hitSlop={12}
            onPress={() => {
              poke();
              playNext();
            }}
            style={styles.skipBtn}
            accessibilityLabel={vi ? 'Bài tiếp' : 'Next'}
          >
            <Ionicons name="play-skip-forward" size={30} color="#fff" />
          </Tap>
        </View>

        {/* bottom: the seek bar */}
        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(insets.bottom, 14),
              paddingLeft: padL + 4,
              paddingRight: padR + 4,
            },
          ]}
        >
          <FullSeek
            live={!!currentTrack?.isLive}
            durationSec={durationSec}
            color={palette.accent}
            vi={vi}
            seekTo={seekTo}
            onTouch={poke}
            onHaptic={() => haptic('selection')}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
};

/** the seek bar + times: the only part that follows the clock (4×/s) */
const FullSeek: React.FC<{
  live: boolean;
  durationSec: number;
  color: string;
  vi: boolean;
  seekTo: (s: number) => void;
  onTouch: () => void;
  onHaptic: () => void;
}> = React.memo(({ live, durationSec, color, vi, seekTo, onTouch, onHaptic }) => {
  const pos = usePositionSec();
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? pos;
  const ratio = durationSec > 0 ? Math.min(1, Math.max(0, shown / durationSec)) : 0;
  if (live)
    return (
      <View style={styles.timeRow}>
        <Text style={[styles.time, { color: '#FCA5A5' }]}>● LIVE · {formatTimeSec(pos)}</Text>
      </View>
    );
  return (
    <View>
      <ScrubBar
        value={ratio}
        thumb
        thickness={4}
        color={color}
        trackColor="rgba(255,255,255,0.25)"
        disabled={durationSec <= 0}
        onScrubStart={onTouch}
        onChange={(r) => {
          onTouch();
          setPreview(r * durationSec);
        }}
        onCommit={(r) => {
          if (durationSec > 0) seekTo(r * durationSec);
          setTimeout(() => setPreview(null), 250);
        }}
        haptic={onHaptic}
        step={durationSec > 0 ? Math.min(1, 10 / durationSec) : 0.05}
        accessibilityLabel={vi ? 'Tiến độ bài hát' : 'Song position'}
        accessibilityValueText={`${formatTimeSec(shown)} / ${formatTimeSec(durationSec)}`}
        style={{ marginVertical: -10 }}
      />
      <View style={styles.timeRow}>
        <Text style={[styles.time, preview != null && { color: '#fff' }]}>
          {formatTimeSec(shown)}
        </Text>
        <Text style={styles.time}>-{formatTimeSec(Math.max(0, durationSec - shown))}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 50, elevation: 50 },
  fill: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  coverBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitText: { color: 'rgba(255,255,255,0.7)', fontSize: 13.5, fontWeight: '600' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleBox: { flex: 1, marginHorizontal: 4 },
  title: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  artist: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  middle: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  skipBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  playBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  time: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  subs: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  jump: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  jumpText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
