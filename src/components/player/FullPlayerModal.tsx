// Full-Screen HolySic Player Modal — Flagship, Turntable, iPod, Poster & Bedside Presets + Queue, Lyrics, Sleep Timer & Diagnostics

import { SignalPathList } from '../audio/SignalPathList';
import { useSignalPath } from '../audio/useSignalPath';
import { PlayerPaneBus } from '../../services/ui/playerPaneBus';
import { usePositionSec } from '../../services/audio/playbackClock';
import { formatSleepLeft, SleepClock, useSleepRemaining } from '../../services/audio/sleepClock';
import { formatSleepLength, SleepCustomPicker } from './SleepCustomPicker';
import { audioEngine } from '../../services/audio/audioEngine';
import * as Clipboard from 'expo-clipboard';
import { FitStage } from './FitStage';
import { ScrubBar } from './ScrubBar';
import { AudioOutput, useAudioOutput } from '../../services/audio/audioOutput';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import {
  AmbientBackdrop,
  CoverGlow,
  useAmbientColors,
  useAmbientEnergy,
} from '../ambient/AmbientLight';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { PLAYER_STYLE_META, PlayerStyle } from '../../constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { formatTimeSec } from '../HolySicIcons';
import { useHoldSeek } from '../../hooks/useHoldSeek';
import { QueuePane } from './QueuePane';
import { SpectrumBars } from './SpectrumBars';
import { BedsideClockView } from './BedsidePlayer';
import { IpodClassicView } from './IpodPlayer';
import { LyricsStrip, LyricsView, lyricsStripHeight } from './LyricsView';
import { TurntableVinylStage } from './TurntablePlayer';
import { SheetSlot, useModalLayer, usePresentGate } from '../overlay/ModalLayers';
import { LikeHeart } from '../ui/LikeHeart';
import { Tap } from '../ui/Tap';
import { NativeMenu, nativeMenuAvailable, MenuItem } from '../ui/NativeMenu';
import { useTrackMenu } from '../menu/useTrackMenu';
import { MorphIcon, NudgeIcon } from '../ui/MorphIcon';
import { PlayerStack } from '../../services/ui/playerStack';
import { MusicVideoStage, VideoAmbient } from '../video/VideoSurfaces';
import {
  useVideoHidden,
  useVideoState,
  VideoHidden,
  videoWanted,
  VideoStore,
} from '../../services/video/videoStore';
import { openMvOptions } from '../video/MvOptionsSheet';
import { MvFullscreen } from '../video/MvFullscreen';
import { Orientation } from '../../services/ui/orientation';
import { perfCount } from '../../services/perfProbe';
import { TiltCard, useTilt } from '../motion/TiltLayers';
import { DustField } from '../motion/DustField';
import { openLyricsEditor } from './LyricsEditor';
import { PipButton } from './PipButton';

type SubPane = 'artwork' | 'lyrics' | 'queue' | 'sleep' | 'diagnostics' | 'styles';

/** gap between the two landscape columns */
const LAND_GAP = 20;
const PLAYER_ORIENTATIONS: ('portrait' | 'landscape' | 'landscape-left' | 'landscape-right')[] = [
  'portrait',
  'landscape',
  'landscape-left',
  'landscape-right',
];

export const FullPlayerModal: React.FC = () => {
  perfCount('render:FullPlayer');
  const insets = useSafeAreaInsets();
  const {
    isPlayerOpen,
    setIsPlayerOpen,
    currentTrack,
    resolvedStream,
    isPlaying,
    isBuffering,
    durationSec,
    volume,
    togglePlay,
    playNext,
    playPrevious,
    seekTo,
    setVolume,
    shuffle,
    toggleShuffle,
    repeatMode,
    cycleRepeat,
    isLiked,
    toggleLike,
    setActionTrack,
    setIsAudioLabOpen,
    audioLab,
    sleepActive,
    showToast,
    sleepEndOfTrack,
    setSleepTimer,
    darkPalette: palette,
    prefs,
    updatePrefs,
    seekBy,
    loudnessLabel,
    ambient,
    haptic,
  } = useHolySic();
  const bitPath = useSignalPath();
  const playerVisible = usePresentGate(isPlayerOpen, 'player');
  useModalLayer('player', playerVisible);
  const ambientColors = useAmbientColors();
  // Hooks must run before the early return below
  const ambientOn = ambient.level > 0 && prefs.playerStyle !== 'BEDSIDE' && !prefs.pureBlack;
  const energy = useAmbientEnergy(isPlayerOpen && ambientOn, ambient.breathing, isPlaying);
  const ff = useHoldSeek(seekBy, 1);
  const rw = useHoldSeek(seekBy, -1);
  const trackMenu = useTrackMenu();
  const [nudge, setNudge] = useState({ back: 0, fwd: 0 });

  const [pane, setPane] = useState<SubPane>('artwork');
  // sleep pane: the custom hours/minutes picker replaces the presets while open
  const [sleepCustom, setSleepCustom] = useState(false);
  useEffect(() => {
    if (pane !== 'sleep') setSleepCustom(false);
  }, [pane]);
  const { width: winW, height: winH } = useWindowDimensions();
  // phone turned sideways (or a wide window / iPad in landscape): two columns
  const landscape = winW > winH * 1.15;
  // short landscape (phones): tighter controls so the right column fits without scrolling
  const landTight = landscape && winH < 520;
  // the nightstand clock goes wide instead (like StandBy): one column, its own buttons
  const twoCol = landscape && !(prefs.playerStyle === 'BEDSIDE' && pane === 'artwork');
  // narrow phones (SE / mini / 375pt): stack the deck icon over its label so nothing wraps;
  // landscape's right column is always narrow
  const compactDeck = winW < 400 || twoCol;
  const tinyDeck = winW < 350; // iPhone SE 1st gen / 320pt
  // 4" screens: while lyrics/queue/sleep are open, drop the volume row to give the pane room
  // (landscape: panes open on the left, so the right column only drops it when really short)
  const roomyPane = landscape ? winH < 350 : winH < 640 && pane !== 'artwork';
  // the music video, full screen (a layer over the player)
  const [mvFull, setMvFull] = useState(false);
  useEffect(() => {
    if (!isPlayerOpen) setMvFull(false);
  }, [isPlayerOpen]);
  // the player may turn with the phone while it is open; the rest of the app stays portrait
  const rotate = isPlayerOpen && prefs.playerRotate !== false;
  useEffect(() => {
    Orientation.setBase(rotate ? 'auto' : 'portrait');
  }, [rotate]);
  // widget "lyrics" deep link → open on the lyrics pane
  useEffect(
    () =>
      PlayerPaneBus.subscribe((p) => {
        setPane(p);
        PlayerPaneBus.consume();
      }),
    []
  );
  const output = useAudioOutput();
  // IPA builds: the volume slider drives the real iPhone volume (synced with the side buttons)
  const systemVol = output.systemVolume;
  const outName = output.route?.outputs?.[0];
  const outIsExternal = !!outName && !/Speaker|Receiver/i.test(outName.type);

  // ── swipe down to close (the player follows the finger, the app shows through behind it) ──
  const { height: screenH } = useWindowDimensions();
  // shared with App.tsx: the app behind recedes / returns as the sheet is dragged (card stack)
  const dragY = PlayerStack.drag;
  // the sheet only becomes a moving (transformed, rounded) layer while it's being dragged
  const [dragging, setDragging] = useState(false);
  const swipeRef = useRef({
    close: () => setIsPlayerOpen(false),
    h: screenH,
    next: playNext,
    prev: playPrevious,
    haptic,
    pane,
    skip: prefs.swipeToSkip !== false,
  });
  swipeRef.current = {
    close: () => setIsPlayerOpen(false),
    h: screenH,
    next: playNext,
    prev: playPrevious,
    haptic,
    pane,
    skip: prefs.swipeToSkip !== false,
  };
  useEffect(() => {
    if (isPlayerOpen) dragY.setValue(0);
    PlayerStack.setOpen(isPlayerOpen);
  }, [isPlayerOpen, dragY]);
  // only the full-size bars (Poster style, cover pane) get every frame; the ambient glow, tab bar
  // and backdrop look the same at half the rate — half the events crossing to JS
  const bigBars = isPlayerOpen && prefs.playerStyle === 'POSTER' && pane === 'artwork';
  useEffect(() => {
    audioEngine.setSpectrumFps(bigBars ? prefs.visualizerFps || 60 : 30);
  }, [bigBars, prefs.visualizerFps]);
  // motion effects: the sensor runs only while the cover / backdrop that uses it is on screen
  const coverTilt = useTilt(
    isPlayerOpen &&
      pane === 'artwork' &&
      (prefs.playerStyle === 'TURNTABLE'
        ? prefs.motionVinyl !== false
        : prefs.motionCover !== false &&
          (prefs.playerStyle === 'FLAGSHIP' || prefs.playerStyle === 'POSTER'))
  );
  // dust floats over every backdrop except the self-contained iPod / bedside looks
  const dustTilt = useTilt(
    isPlayerOpen &&
      prefs.motionDust !== false &&
      prefs.playerStyle !== 'IPOD' &&
      prefs.playerStyle !== 'BEDSIDE'
  );
  const backTilt = useTilt(
    isPlayerOpen &&
      prefs.motionBackdrop !== false &&
      ambientOn &&
      prefs.playerBackground === 'AMBIENT' &&
      prefs.playerStyle !== 'IPOD'
  );
  // Settings › keep the screen on while reading lyrics
  const keepAwake = isPlayerOpen && pane === 'lyrics' && !!prefs.keepAwakeLyrics;
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync('holysic-lyrics').catch(() => {});
    return () => {
      deactivateKeepAwake('holysic-lyrics').catch(() => {});
    };
  }, [keepAwake]);
  const dismissPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 130 || (g.dy > 40 && g.vy > 0.9)) {
          swipeRef.current.haptic('light');
          Animated.timing(dragY, {
            toValue: swipeRef.current.h,
            duration: 220,
            useNativeDriver: true,
          }).start(() => {
            swipeRef.current.close();
            setDragging(false);
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(() =>
            setDragging(false)
          );
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(() =>
          setDragging(false)
        ),
    })
  ).current;
  // ── swipe the cover left / right to change song ──
  const coverX = useRef(new Animated.Value(0)).current;
  // the cover settles back a little on pause and springs forward on play (Apple Music)
  const coverScale = useRef(new Animated.Value(isPlaying ? 1 : 0.94)).current;
  // the cover's own movement (swipe + its lean + the pause scale) — the 3D edge follows it too
  const coverFollow = useRef([
    { translateX: coverX },
    {
      rotate: coverX.interpolate({
        inputRange: [-400, 0, 400],
        outputRange: ['-6deg', '0deg', '6deg'],
      }),
    },
    { scale: coverScale },
  ]).current;
  const coverPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        swipeRef.current.skip && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => coverX.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        const go = Math.abs(g.dx) > 90 || (Math.abs(g.dx) > 30 && Math.abs(g.vx) > 0.7);
        if (go) {
          const dir = g.dx < 0 ? -1 : 1;
          swipeRef.current.haptic('medium');
          Animated.timing(coverX, {
            toValue: dir * 420,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            if (dir < 0) swipeRef.current.next();
            else swipeRef.current.prev();
            coverX.setValue(-dir * 260);
            Animated.spring(coverX, { toValue: 0, useNativeDriver: true, bounciness: 5 }).start();
          });
        } else {
          Animated.spring(coverX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(coverX, { toValue: 0, useNativeDriver: true }).start(),
    })
  ).current;

  // ── music video (Settings › Music video) ──
  const video = useVideoState();
  // "show the cover instead" survives closing / re-opening the player (this app session)
  const videoHidden = useVideoHidden();
  const lastShowVideoRef = useRef(false);

  // the stage's height minus everything under the video (lyrics strip, poster bars) — measured
  const [mvFit, setMvFit] = useState({ room: 0 });
  const mvFitRef = useRef({ videoH: 0 });
  const onStageMeasure = useCallback(
    (box: { w: number; h: number }, content: { w: number; h: number }) => {
      const vh = mvFitRef.current.videoH;
      if (!vh) return;
      const room = Math.floor(box.h - 10 - (content.h - vh));
      setMvFit((p) => (Math.abs(p.room - room) < 2 ? p : { room }));
    },
    []
  );
  const [mvOnCard, setMvOnCard] = useState(false);
  // a music video never settles back on pause: a scaled video (and the buttons on it) is
  // resampled, which reads as soft — it stays at 1:1 on the pixel grid
  useEffect(() => {
    const big = isPlaying || mvOnCard;
    Animated.spring(coverScale, {
      toValue: big ? 1 : 0.94,
      useNativeDriver: true,
      speed: 10,
      bounciness: big ? 7 : 2,
    }).start();
  }, [isPlaying, mvOnCard, coverScale]);
  if (!currentTrack) return null;
  const vi = prefs.language === 'vi';

  const setVideoHidden = (v: boolean) => VideoHidden.set(v);
  const videoMode = videoWanted(prefs.musicVideo, currentTrack);
  const videoReady = videoMode && video.status === 'ready' && video.trackId === currentTrack?.id;
  // "Tự phát MV" off and not asked for yet
  const videoIdle = videoMode && video.status === 'idle' && video.trackId === currentTrack?.id;
  const mvLook = prefs.playerStyle === 'FLAGSHIP' || prefs.playerStyle === 'POSTER';
  // while the video is on, its card keeps the video's shape: between songs, while this song's
  // video is still being found, and when there is none (a notice in the card) — the card never
  // jumps back to the big square cover and then shrinks again
  const videoPending =
    videoMode &&
    !videoReady &&
    !videoIdle &&
    !currentTrack.isLive &&
    currentTrack.source !== 'radio' &&
    currentTrack.source !== 'synth' &&
    video.status !== 'off' &&
    video.status !== 'idle';
  const showVideo = (videoReady || videoPending) && !videoHidden && mvLook;
  // (render-time sync of a value the effect above needs; set before the early return)
  if (mvOnCard !== showVideo) setMvOnCard(showVideo);
  const videoAspect = Math.max(1, Math.min(2.4, video.aspect || 16 / 9));
  // lyrics under the video (Settings › Music video › Lyrics under the video)
  const mvLyricsOn = showVideo && prefs.mvLyrics !== false;
  const stripH = mvLyricsOn ? lyricsStripHeight(prefs.lyricsSize) + 10 : 0;
  // landscape geometry: safe-area sides (the notch), right column, what the left column holds
  const padL = landscape ? Math.max(insets.left, 20) : 20;
  const padR = landscape ? Math.max(insets.right, 20) : 20;
  const padT = landscape ? Math.max(insets.top, 10) : Math.max(insets.top, 14);
  const padB = landscape ? Math.max(insets.bottom, 10) : Math.max(insets.bottom, 16);
  const contentW = winW - padL - padR;
  // a playing video gets the bigger share: the panel shrinks to what the controls need
  const rightW = Math.round(
    Math.min(400, Math.max(280, contentW * (showVideo && pane === 'artwork' ? 0.36 : 0.44)))
  );
  const leftW = contentW - rightW - LAND_GAP;
  const leftH = winH - padT - padB - 12;
  let videoW = Math.min(winW - 36, 400);
  if (!landscape && showVideo && mvFit.room > 0) {
    // portrait: as wide as the stage has height for (FitStage would scale it down otherwise)
    videoW = Math.round(Math.max(200, Math.min(videoW, mvFit.room * videoAspect)));
  }
  if (landscape) {
    const posterExtra = prefs.playerStyle === 'POSTER' ? 100 : 0;
    const roomH = Math.max(120, leftH - stripH - posterExtra - 8);
    videoW = Math.round(Math.max(200, Math.min(leftW - 8, roomH * videoAspect, 1000)));
  }
  const videoH = Math.round(videoW / videoAspect);
  mvFitRef.current.videoH = showVideo ? videoH : 0;
  const hideMvLyrics = () => {
    haptic('selection');
    updatePrefs({ mvLyrics: false });
    showToast(
      vi
        ? 'Đã ẩn lời dưới MV — bật lại bằng nút lời trên MV'
        : 'Lyrics hidden — the lyrics button on the video brings them back'
    );
  };
  const toggleMvLyrics = () => {
    haptic('selection');
    updatePrefs({ mvLyrics: prefs.mvLyrics === false });
  };
  const openMvFull = () => {
    haptic('light');
    setMvFull(true);
  };
  const lastShowVideo = lastShowVideoRef;
  if (lastShowVideo.current !== showVideo) {
    lastShowVideo.current = showVideo;
    // cover ⇄ video: the card reshapes smoothly instead of jumping
    if (Platform.OS !== 'web')
      LayoutAnimation.configureNext(LayoutAnimation.create(320, 'easeInEaseOut', 'opacity'));
  }
  // Short on purpose: the song's own actions, then two doors to dedicated pages (lyrics editor,
  // player look). Lyrics / queue / sleep timer already have their buttons under the controls.
  const playerMenuItems = (): MenuItem[] => [
    ...trackMenu.itemsFor(currentTrack).filter((it) => it.id !== 'more'),
    {
      id: 'p:lyricsEdit',
      title: vi ? 'Lời bài hát…' : 'Lyrics…',
      subtitle: vi ? 'Chọn bản khác, sửa, gắn giờ' : 'Pick another, edit, time',
      icon: 'quote.bubble',
      section: 3,
    },
    ...(videoMode
      ? [
          {
            id: 'p:mv',
            title: vi ? 'Video âm nhạc…' : 'Music Video…',
            subtitle: vi ? 'Chất lượng, lưu offline, tự phát' : 'Quality, save offline, autoplay',
            icon: 'video',
            section: 3,
          },
        ]
      : []),
    {
      id: 'p:look',
      title: vi ? 'Kiểu trình phát…' : 'Player Style…',
      subtitle: vi ? 'Flagship, vinyl, iPod, Poster…' : 'Flagship, vinyl, iPod, Poster…',
      icon: 'paintpalette',
      section: 3,
    },
    {
      id: 'more',
      title: vi ? 'Tuỳ chọn khác…' : 'More Options…',
      icon: 'ellipsis.circle',
      section: 4,
    },
  ];
  const onPlayerMenu = (id: string) => {
    if (id === 'p:lyricsEdit') {
      setTimeout(() => openLyricsEditor(currentTrack), 380); // after the menu's close animation
      return;
    }
    if (id === 'p:look') return setPane('styles');
    if (id === 'p:mv') {
      const tr = currentTrack;
      setTimeout(() => openMvOptions(tr), 380);
      return;
    }
    trackMenu.select(currentTrack, id);
  };
  const liked = isLiked(currentTrack.id);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  // the music video's blurred scenes light the player: everything under that full-screen blur
  // is re-blurred whenever it changes, so the cover light beneath it rests (no breathing) and
  // the blur only redraws when a new video frame arrives — never between them, nor when paused
  const videoAmbientOn =
    videoMode &&
    prefs.videoAmbient &&
    isPlayerOpen &&
    !prefs.pureBlack &&
    video.status === 'ready' &&
    // the camera button hid the picture: its light stays only if the user wants it to
    (!videoHidden || prefs.videoAmbientWhenHidden !== false);
  const ambientBackdrop =
    ambientOn && prefs.playerBackground === 'AMBIENT' && prefs.playerStyle !== 'IPOD';
  const gradientColors: readonly [string, string, ...string[]] = ambientBackdrop
    ? ['#050507', '#050507']
    : prefs.playerStyle === 'BEDSIDE' || prefs.playerBackground === 'SOLID' || prefs.pureBlack
      ? ['#050508', '#020204', '#000000']
      : prefs.playerBackground === 'APPLE_MUSIC'
        ? palette.appleMesh
        : prefs.playerBackground === 'DARK_GRADIENT'
          ? [palette.surface, '#0A0A0F', '#040406']
          : palette.gradient;

  const volValue = systemVol ?? volume;
  const changeVolume = (v: number) =>
    systemVol != null ? AudioOutput.setSystemVolume(v) : setVolume(v);

  // ── the four parts of the player; portrait stacks them, landscape puts them in two columns ──
  const topBarEl = (
    <>
      {/* Top Bar — also the grab area for swipe-down-to-close */}
      <View style={styles.topBar} {...dismissPan.panHandlers}>
        <Tap hitSlop={10} onPress={() => setIsPlayerOpen(false)} style={styles.topIconBtn}>
          <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
        </Tap>

        {/* Interactive Stream Quality Pill -> Opens HolySic Diagnostics */}
        <Tap
          onPress={() => setPane((p) => (p === 'diagnostics' ? 'artwork' : 'diagnostics'))}
          style={[styles.qualityBadgeBtn, { borderColor: palette.accent + '40' }]}
        >
          <Ionicons
            name={
              prefs.bitPerfect
                ? bitPath.perfect
                  ? 'checkmark-circle'
                  : 'pulse'
                : resolvedStream?.isOffline
                  ? 'arrow-down-circle'
                  : 'sparkles'
            }
            size={12}
            color={palette.accent}
          />
          <Text numberOfLines={1} style={[styles.qualityBadgeLabel, { color: palette.accent }]}>
            {prefs.bitPerfect ? 'Bit-perfect · ' : ''}
            {resolvedStream?.qualityLabel || currentTrack.qualityBadge || 'HolySic Stream'}
            {loudnessLabel ? ` · RG ${loudnessLabel}` : ''}
          </Text>
        </Tap>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {videoMode && (
            <Tap
              hitSlop={8}
              onPress={() => {
                if (pane !== 'artwork') setPane('artwork');
                // auto-play off: the first tap loads this song's video (and shows it)
                if (videoIdle) {
                  haptic('light');
                  VideoStore.request(currentTrack.id);
                  setVideoHidden(false);
                  return;
                }
                setVideoHidden(pane !== 'artwork' ? false : !videoHidden);
              }}
              onLongPress={() => {
                haptic('medium');
                openMvOptions(currentTrack);
              }}
              delayLongPress={350}
              accessibilityLabel={
                videoIdle
                  ? vi
                    ? 'Phát MV'
                    : 'Play the music video'
                  : videoHidden
                    ? vi
                      ? 'Hiện video'
                      : 'Show video'
                    : vi
                      ? 'Hiện ảnh bìa'
                      : 'Show cover'
              }
              accessibilityHint={vi ? 'Giữ để mở tuỳ chọn MV' : 'Hold for music video options'}
              style={[
                styles.styleChipBtn,
                showVideo && pane === 'artwork' && { backgroundColor: palette.accent },
              ]}
            >
              {video.status === 'searching' || video.status === 'loading' ? (
                <ActivityIndicator
                  size="small"
                  color="#FFFFFF"
                  style={{ transform: [{ scale: 0.7 }] }}
                />
              ) : (
                <Ionicons
                  name={
                    videoReady
                      ? showVideo && pane === 'artwork'
                        ? 'videocam'
                        : 'videocam-outline'
                      : videoIdle
                        ? 'play-circle-outline'
                        : 'videocam-off-outline'
                  }
                  size={16}
                  color={showVideo && pane === 'artwork' ? palette.onAccent : '#FFFFFF'}
                />
              )}
            </Tap>
          )}
          <Tap
            hitSlop={8}
            onPress={() => setPane((p) => (p === 'styles' ? 'artwork' : 'styles'))}
            accessibilityLabel={vi ? 'Kiểu trình phát' : 'Player style'}
            style={[styles.styleChipBtn, pane === 'styles' && { backgroundColor: palette.accent }]}
          >
            <Ionicons
              name="color-wand-outline"
              size={16}
              color={pane === 'styles' ? palette.onAccent : '#FFFFFF'}
            />
          </Tap>

          {nativeMenuAvailable ? (
            // native pull-down: the song menu + the player's own doors (lyrics editor,
            // music video, player style); lyrics / queue / sleep have buttons below
            <NativeMenu
              items={playerMenuItems()}
              onSelect={onPlayerMenu}
              title={`${currentTrack.title} · ${currentTrack.artist}`}
              label={vi ? 'Tuỳ chọn bài hát' : 'Song options'}
              style={styles.topIconBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={21} color="#FFFFFF" />
            </NativeMenu>
          ) : (
            <Tap
              hitSlop={8}
              onPress={() => setActionTrack(currentTrack)}
              style={styles.topIconBtn}
              accessibilityLabel={vi ? 'Tuỳ chọn bài hát' : 'Song options'}
            >
              <Ionicons name="ellipsis-horizontal" size={21} color="#FFFFFF" />
            </Tap>
          )}
        </View>
      </View>
    </>
  );
  const stageEl = (
    <>
      {/* Center Stage */}
      <View style={styles.stageArea} {...(pane === 'artwork' ? dismissPan.panHandlers : null)}>
        {pane === 'lyrics' ? (
          <LyricsView />
        ) : pane === 'queue' ? (
          <QueuePane onDone={() => setPane('artwork')} />
        ) : pane === 'sleep' ? (
          // sized to its content and centred on the stage (a floating card, not a blank page)
          <View style={styles.centerStage}>
            <View style={styles.sleepCard}>
              <View>
                <View style={styles.paneHeaderRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Ionicons name="moon" size={18} color={palette.accent} />
                    <Text style={[styles.paneTitle, { fontFamily }]}>
                      {vi ? 'Hẹn giờ tắt nhạc' : 'Sleep Timer'}
                    </Text>
                  </View>
                  <Tap
                    feedback="opacity"
                    hitSlop={10}
                    onPress={() => setPane('artwork')}
                    accessibilityLabel={vi ? 'Đóng' : 'Close'}
                  >
                    <Ionicons name="close" size={22} color="#FFF" />
                  </Tap>
                </View>
                <Text style={styles.subHelper}>
                  {sleepEndOfTrack
                    ? vi
                      ? 'Đang bật: Tự dừng khi hết bài hiện tại'
                      : 'Active: Stops after current song'
                    : sleepActive
                      ? vi
                        ? 'Đang đếm ngược'
                        : 'Counting down'
                      : vi
                        ? 'Chọn thời gian để HolySic tự động dừng phát nhạc'
                        : 'Choose when HolySic gently pauses playback'}
                </Text>
                {sleepActive && (
                  <View style={styles.sleepLive}>
                    <SleepCountdown big />
                    <Tap
                      onPress={() => setSleepTimer(Math.ceil((SleepClock.get() || 0) / 60) + 10)}
                      style={[styles.sleepExtend, { borderColor: palette.accent + '66' }]}
                      accessibilityLabel={vi ? 'Thêm 10 phút' : 'Add 10 minutes'}
                    >
                      <Ionicons name="add" size={15} color="#FFF" />
                      <Text style={styles.sleepOptionText}>{vi ? '10 phút' : '10 min'}</Text>
                    </Tap>
                  </View>
                )}
                {sleepCustom ? (
                  <SleepCustomPicker
                    vi={vi}
                    accent={palette.accent}
                    onAccent={palette.onAccent}
                    initialMin={prefs.sleepCustomMin || 90}
                    onBack={() => setSleepCustom(false)}
                    onStart={(mins) => {
                      updatePrefs({ sleepCustomMin: mins });
                      setSleepTimer(mins);
                      setSleepCustom(false);
                      setPane('artwork');
                    }}
                  />
                ) : (
                  <View style={styles.sleepGrid}>
                    {[5, 15, 30, 45, 60, 90].map((mins) => (
                      <Tap
                        key={mins}
                        onPress={() => {
                          setSleepTimer(mins);
                          setPane('artwork');
                        }}
                        style={[styles.sleepOption, { borderColor: palette.accent + '44' }]}
                      >
                        <Text style={styles.sleepOptionText}>{formatSleepLength(mins, vi)}</Text>
                      </Tap>
                    ))}
                    <Tap
                      onPress={() => {
                        setSleepTimer('end_of_track');
                        setPane('artwork');
                      }}
                      style={[
                        styles.sleepOption,
                        styles.sleepOptionWide,
                        { borderColor: palette.accent + '44' },
                      ]}
                    >
                      <Ionicons name="musical-note" size={14} color="#FFF" />
                      <Text style={styles.sleepOptionText}>
                        {vi ? 'Hết bài này' : 'End of Song'}
                      </Text>
                    </Tap>
                    <Tap
                      onPress={() => {
                        haptic('selection');
                        setSleepCustom(true);
                      }}
                      style={[
                        styles.sleepOption,
                        styles.sleepOptionWide,
                        { borderColor: palette.accent + '44' },
                      ]}
                      accessibilityLabel={vi ? 'Tuỳ chỉnh giờ và phút' : 'Custom hours and minutes'}
                    >
                      <Ionicons name="time-outline" size={14} color="#FFF" />
                      <Text style={styles.sleepOptionText}>{vi ? 'Tuỳ chỉnh…' : 'Custom…'}</Text>
                    </Tap>
                  </View>
                )}
                {(sleepActive || sleepEndOfTrack) && (
                  <Tap onPress={() => setSleepTimer(null)} style={styles.turnOffSleepBtn}>
                    <Text style={{ color: '#F87171', fontWeight: '700' }}>
                      {vi ? 'Tắt hẹn giờ' : 'Turn Off Timer'}
                    </Text>
                  </Tap>
                )}
              </View>
            </View>
          </View>
        ) : pane === 'diagnostics' ? (
          <View style={styles.overlayCard}>
            <View style={styles.paneHeaderRow}>
              <Text style={[styles.paneTitle, { fontFamily }]}>
                {vi ? 'Chẩn đoán luồng phát' : 'Stream Source Diagnostics'}
              </Text>
              <Tap onPress={() => setPane('artwork')}>
                <Ionicons name="close" size={22} color="#FFF" />
              </Tap>
            </View>
            <Text style={[styles.subHelper, resolvedStream?.failed && { color: '#FCA5A5' }]}>
              {resolvedStream?.failed
                ? vi
                  ? 'Không phát được — lý do ở các bước đỏ bên dưới'
                  : "Couldn't play — the red steps below say why"
                : resolvedStream
                  ? `${resolvedStream.sourceLabel} · ${resolvedStream.qualityLabel} (${resolvedStream.codec})`
                  : isBuffering
                    ? vi
                      ? 'Đang tìm nguồn phát…'
                      : 'Finding a source…'
                    : vi
                      ? 'Chưa có luồng nào — bấm phát để bắt đầu'
                      : 'Nothing loaded yet — press play'}
            </Text>
            {!!resolvedStream?.diagnostics.length && (
              <View style={styles.diagActions}>
                {resolvedStream.failed && (
                  <Tap
                    onPress={() => {
                      haptic('light');
                      togglePlay();
                    }}
                    style={[styles.diagBtn, { backgroundColor: palette.accent }]}
                  >
                    <Ionicons name="refresh" size={14} color={palette.onAccent} />
                    <Text style={[styles.diagBtnText, { color: palette.onAccent }]}>
                      {vi ? 'Thử lại' : 'Retry'}
                    </Text>
                  </Tap>
                )}
                <Tap
                  onPress={() => {
                    const lines = resolvedStream.diagnostics.map(
                      (d) =>
                        `${d.ok === true ? '✓' : d.ok === false ? '✗' : '•'} ${d.module} · ${d.step}${d.latencyMs !== undefined ? ` (${d.latencyMs}ms)` : ''} — ${d.detail}`
                    );
                    Clipboard.setStringAsync(
                      `HolySic · ${currentTrack.title} — ${currentTrack.artist}\n${lines.join('\n')}`
                    ).catch(() => undefined);
                    haptic('selection');
                    showToast(vi ? 'Đã chép chẩn đoán' : 'Diagnostics copied');
                  }}
                  style={styles.diagBtn}
                >
                  <Ionicons name="copy-outline" size={14} color="#FFF" />
                  <Text style={styles.diagBtnText}>{vi ? 'Chép' : 'Copy'}</Text>
                </Tap>
              </View>
            )}
            <ScrollView style={{ marginTop: 12 }}>
              {prefs.bitPerfect && (
                <View style={styles.bpBox}>
                  <Text style={styles.bpBoxTitle}>
                    {bitPath.perfect
                      ? vi
                        ? 'Bit-perfect: tín hiệu đi nguyên vẹn'
                        : 'Bit-perfect: the signal is untouched'
                      : vi
                        ? 'Đường tín hiệu (Bit-perfect)'
                        : 'Signal path (bit-perfect)'}
                  </Text>
                  <SignalPathList
                    checks={bitPath.checks}
                    text="#FFFFFF"
                    text2="rgba(255,255,255,0.62)"
                    line="rgba(255,255,255,0.14)"
                  />
                </View>
              )}
              {(resolvedStream?.diagnostics || []).map((d, idx) => (
                <View key={idx} style={styles.diagRow}>
                  <Ionicons
                    name={
                      d.ok === true
                        ? 'checkmark-circle'
                        : d.ok === false
                          ? 'close-circle'
                          : 'ellipse-outline'
                    }
                    size={18}
                    color={d.ok ? '#34D399' : d.ok === false ? '#F87171' : '#94A3B8'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.diagTitle}>
                      {d.module} · {d.step}
                      {d.latencyMs !== undefined ? ` (${d.latencyMs}ms)` : ''}
                    </Text>
                    <Text style={styles.diagDetail}>{d.detail}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : pane === 'styles' ? (
          <View style={styles.overlayCard}>
            <View style={styles.paneHeaderRow}>
              <Text style={[styles.paneTitle, { fontFamily }]}>
                {vi ? 'Giao diện trình phát' : 'Player style'}
              </Text>
              <Tap onPress={() => setPane('artwork')}>
                <Ionicons name="close" size={22} color="#FFF" />
              </Tap>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {PLAYER_STYLE_META.map((meta) => {
                const selected = prefs.playerStyle === meta.id;
                return (
                  <Tap
                    key={meta.id}
                    onPress={() => {
                      updatePrefs({ playerStyle: meta.id as PlayerStyle });
                      setPane('artwork');
                    }}
                    style={[
                      styles.styleSelectCard,
                      selected && {
                        borderColor: palette.accent,
                        backgroundColor: palette.container + '66',
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.styleCardTitle}>{vi ? meta.titleVi : meta.titleEn}</Text>
                      <Text style={styles.styleCardDesc}>{vi ? meta.descVi : meta.descEn}</Text>
                    </View>
                    <View
                      style={[
                        styles.styleCardBadge,
                        {
                          backgroundColor: selected ? palette.accent : 'rgba(255,255,255,0.1)',
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '800',
                          color: selected ? palette.onAccent : '#FFF',
                        }}
                      >
                        {meta.badge}
                      </Text>
                    </View>
                  </Tap>
                );
              })}
            </ScrollView>
          </View>
        ) : prefs.playerStyle === 'IPOD' ? (
          <FitStage>
            <IpodClassicView />
          </FitStage>
        ) : prefs.playerStyle === 'BEDSIDE' ? (
          // swipe the clock ← next · → previous (it slides and fades, no tilt)
          <Animated.View
            {...coverPan.panHandlers}
            style={{
              flex: 1,
              alignSelf: 'stretch',
              opacity: coverX.interpolate({
                inputRange: [-420, 0, 420],
                outputRange: [0.2, 1, 0.2],
              }),
              transform: [{ translateX: Animated.multiply(coverX, 0.5) }],
            }}
          >
            <BedsideClockView wide={landscape} />
          </Animated.View>
        ) : prefs.playerStyle === 'TURNTABLE' ? (
          <FitStage>
            <CoverGlow
              colors={ambientColors}
              level={ambientOn ? ambient.level * 0.8 : 0}
              energy={energy}
              still={ambient.reduceMotion}
              size={300}
              drift={coverTilt.on ? 10 : 0}
            >
              {/* the deck turns with the phone; swipe it ← next · → previous */}
              <TiltCard on={coverTilt.on} maxDeg={7} float={3}>
                <Animated.View
                  {...coverPan.panHandlers}
                  style={{ transform: [{ translateX: coverX }] }}
                >
                  <TurntableVinylStage motion={coverTilt.on} />
                </Animated.View>
              </TiltCard>
            </CoverGlow>
          </FitStage>
        ) : (
          /* Flagship & Poster Cover Stage — wrapped in the ambient glow */
          <FitStage onMeasure={onStageMeasure}>
            <View style={styles.flagshipCoverCenter}>
              <CoverGlow
                colors={ambientColors}
                level={ambientOn ? ambient.level : 0}
                energy={energy}
                still={ambient.reduceMotion}
                size={prefs.playerStyle === 'POSTER' ? 270 : 300}
                drift={coverTilt.on ? 12 : 0}
              >
                {/* turns with the phone (outside the swipe view: the two never share a node) */}
                {/* a playing video doesn't turn: a layer in 3D is resampled every frame (soft
                    picture and buttons) and its straight edges stair-step on iOS, which doesn't
                    antialias them — the depth comes from the light and the page behind it */}
                <TiltCard
                  on={coverTilt.on && !showVideo}
                  maxDeg={prefs.playerStyle === 'POSTER' ? 8 : 9}
                  depth={prefs.motionCoverEdge !== false ? 7 : 0}
                  radius={prefs.playerStyle === 'POSTER' ? 30 : 26}
                  crisp
                  follow={coverFollow}
                >
                  {/* swipe the cover ← next · → previous */}
                  <Animated.View
                    {...coverPan.panHandlers}
                    accessibilityHint={
                      vi ? 'Vuốt trái / phải để chuyển bài' : 'Swipe left or right to change song'
                    }
                    style={[
                      styles.coverShadowWrap,
                      prefs.playerStyle === 'POSTER' && styles.posterCoverWrap,
                      showVideo && {
                        width: videoW,
                        height: videoH,
                        borderRadius: 20,
                        // the edge line is drawn over the picture instead (below): under it, its
                        // antialiased rim peeks out around the clipped video as a ragged fringe
                        borderWidth: 0,
                      },
                      { transform: coverFollow },
                    ]}
                  >
                    {showVideo ? (
                      <MusicVideoStage
                        trackId={currentTrack.id}
                        artworkUrl={currentTrack.artworkUrl}
                        width={videoW}
                        accent={palette.accent}
                        vi={vi}
                        style={styles.videoInCard}
                        onBadgePress={() => openMvOptions(currentTrack)}
                        onExpand={openMvFull}
                        lyricsOn={mvLyricsOn}
                        onToggleLyrics={toggleMvLyrics}
                      />
                    ) : (
                      <ArtworkImage
                        source={{ uri: currentTrack.artworkUrl }}
                        fallbackSeed={currentTrack.title}
                        style={styles.coverImage}
                      />
                    )}
                    {showVideo && <View pointerEvents="none" style={styles.videoEdge} />}
                  </Animated.View>
                </TiltCard>
              </CoverGlow>
              {/* the lyrics under the video, in the lyrics effect (tap: the lyrics page;
                      hold: hide — the lyrics button on the video brings them back) */}
              {mvLyricsOn && (
                <View style={styles.mvLyrics}>
                  <LyricsStrip
                    width={videoW}
                    onPress={() => setPane('lyrics')}
                    onLongPress={hideMvLyrics}
                  />
                </View>
              )}
              {/* Poster: a real 32-band spectrum of what's playing (FFT of the actual PCM) */}
              {prefs.playerStyle === 'POSTER' && (
                <View style={styles.posterVisualizer}>
                  <SpectrumBars
                    isPlaying={isPlaying}
                    color={palette.accent}
                    colorHigh={ambientColors.corners[1]}
                    height={64}
                    bars={32}
                    peaks
                    showStatus
                    language={prefs.language}
                  />
                </View>
              )}
            </View>
          </FitStage>
        )}
      </View>
    </>
  );
  const controlsEl = (
    <>
      {/* Hide standard Flagship controls when in self-contained iPod / Bedside view (unless user is on sub-pane) */}
      {((prefs.playerStyle !== 'IPOD' && prefs.playerStyle !== 'BEDSIDE') ||
        pane !== 'artwork' ||
        twoCol) && (
        <View style={styles.controlsBlock}>
          {/* Song Info + LikeBurst Heart */}
          <View
            style={[styles.songInfoRow, landTight && styles.songInfoTight]}
            {...dismissPan.panHandlers}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text
                numberOfLines={1}
                style={[styles.trackTitle, landTight && styles.trackTitleTight, { fontFamily }]}
              >
                {currentTrack.title}
              </Text>
              <Text numberOfLines={1} style={[styles.trackArtist, { fontFamily }]}>
                {currentTrack.artist}
                {currentTrack.album ? ` · ${currentTrack.album}` : ''}
              </Text>
            </View>

            <Tap
              hitSlop={10}
              onPress={() => toggleLike(currentTrack)}
              style={[styles.likeCircle, liked && { backgroundColor: 'rgba(255, 77, 121, 0.18)' }]}
              accessibilityRole="button"
              accessibilityState={{ selected: liked }}
              accessibilityLabel={vi ? 'Thích' : 'Love'}
            >
              <LikeHeart
                key={currentTrack.id}
                liked={liked}
                size={24}
                likedColor={HOLYSIC_COLORS.roseLike}
                color="#FFFFFF"
              />
            </Tap>
          </View>

          <SeekSection
            live={!!currentTrack.isLive}
            genre={currentTrack.genre}
            durationSec={durationSec}
            color={palette.accent}
            vi={vi}
            showRemaining={!!prefs.showRemainingTime}
            onToggleRemaining={() => updatePrefs({ showRemainingTime: !prefs.showRemainingTime })}
            seekTo={seekTo}
            onHaptic={() => haptic('selection')}
          />

          {/* Primary Transport Row */}
          <View style={[styles.transportRow, landTight && styles.transportTight]}>
            <Tap hitSlop={10} onPress={toggleShuffle} style={styles.sideCtrl}>
              <Ionicons
                name="shuffle"
                size={22}
                color={shuffle ? palette.accent : 'rgba(255,255,255,0.48)'}
              />
            </Tap>

            <Tap
              hitSlop={10}
              onPress={rw.guard(() => {
                setNudge((n) => ({ ...n, back: n.back + 1 }));
                playPrevious();
              })}
              onLongPress={rw.onLongPress}
              onPressOut={rw.onPressOut}
              delayLongPress={rw.delayLongPress}
              style={styles.skipBtn}
              accessibilityLabel={vi ? 'Bài trước' : 'Previous'}
            >
              <NudgeIcon
                name="play-skip-back"
                size={30}
                color="#FFFFFF"
                dir={-1}
                pulse={nudge.back}
              />
            </Tap>

            <Tap
              onPress={togglePlay}
              style={[
                styles.bigPlayBtn,
                landTight && styles.bigPlayTight,
                { backgroundColor: palette.accent },
              ]}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color={palette.onAccent} />
              ) : (
                <MorphIcon
                  on={isPlaying}
                  onIcon="pause"
                  offIcon="play"
                  size={32}
                  color={palette.onAccent}
                  offShiftX={3}
                />
              )}
            </Tap>

            <Tap
              hitSlop={10}
              onPress={ff.guard(() => {
                setNudge((n) => ({ ...n, fwd: n.fwd + 1 }));
                playNext();
              })}
              onLongPress={ff.onLongPress}
              onPressOut={ff.onPressOut}
              delayLongPress={ff.delayLongPress}
              style={styles.skipBtn}
              accessibilityLabel={vi ? 'Bài tiếp' : 'Next'}
            >
              <NudgeIcon
                name="play-skip-forward"
                size={30}
                color="#FFFFFF"
                dir={1}
                pulse={nudge.fwd}
              />
            </Tap>

            <Tap hitSlop={10} onPress={cycleRepeat} style={styles.sideCtrl}>
              <Ionicons
                name="repeat"
                size={22}
                color={repeatMode !== 'OFF' ? palette.accent : 'rgba(255,255,255,0.48)'}
              />
              {repeatMode === 'ONE' && (
                <Text style={[styles.repeatOneDot, { color: palette.accent }]}>1</Text>
              )}
            </Tap>
          </View>

          {/* Volume — IPA: the real iPhone volume (side buttons move it too); bit-perfect keeps
                the player at unity gain, so only the hardware volume is offered there */}
          {roomyPane ? null : prefs.bitPerfect && systemVol == null ? (
            <Tap
              onPress={() => setPane('diagnostics')}
              style={styles.volumeRow}
              accessibilityLabel="Bit-perfect volume"
            >
              <Ionicons name="lock-closed" size={14} color={palette.accent} />
              <Text style={styles.bpVolText} numberOfLines={1}>
                {prefs.language === 'vi'
                  ? 'Bit-perfect · âm lượng 100 % — chỉnh bằng nút âm lượng'
                  : 'Bit-perfect · volume 100 % — use the volume buttons'}
              </Text>
            </Tap>
          ) : (
            <View>
              <View style={styles.volumeRow}>
                <Ionicons name="volume-low" size={16} color="rgba(255,255,255,0.5)" />
                <ScrubBar
                  value={volValue}
                  onChange={changeVolume}
                  color="rgba(255,255,255,0.86)"
                  trackColor="rgba(255,255,255,0.18)"
                  thickness={4}
                  haptic={() => haptic('selection')}
                  accessibilityLabel={vi ? 'Âm lượng' : 'Volume'}
                  style={{ flex: 1, marginVertical: -12 }}
                />
                <Ionicons name="volume-high" size={16} color="rgba(255,255,255,0.5)" />
                <PipButton style={styles.airplayBtn} />
                {output.supported && (
                  <Tap
                    hitSlop={12}
                    onPress={() => {
                      haptic('light');
                      AudioOutput.showRoutePicker();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      vi
                        ? 'Chọn thiết bị phát (AirPlay, Bluetooth)'
                        : 'Output device (AirPlay, Bluetooth)'
                    }
                    style={styles.airplayBtn}
                  >
                    <MaterialIcons
                      name="airplay"
                      size={19}
                      color={outIsExternal ? palette.accent : 'rgba(255,255,255,0.6)'}
                    />
                  </Tap>
                )}
              </View>
              {(outIsExternal || prefs.bitPerfect) && !!outName && (
                <Tap onPress={() => setPane('diagnostics')} style={styles.routeRow}>
                  <Ionicons
                    name={
                      prefs.bitPerfect
                        ? 'lock-closed'
                        : /Bluetooth|AirPlay/i.test(outName.type)
                          ? 'bluetooth'
                          : 'headset'
                    }
                    size={11}
                    color={palette.accent}
                  />
                  <Text numberOfLines={1} style={[styles.routeText, { color: palette.accent }]}>
                    {prefs.bitPerfect ? 'Bit-perfect · ' : ''}
                    {outName.name}
                  </Text>
                </Tap>
              )}
            </View>
          )}
        </View>
      )}
    </>
  );
  const deckEl = (
    <>
      {/* Bottom HolySic Action Deck (Lyrics · Queue · Audio Lab · Sleep Timer) */}
      <View style={styles.bottomDeck}>
        <Tap
          onPress={() => setPane((p) => (p === 'lyrics' ? 'artwork' : 'lyrics'))}
          style={[
            styles.deckPill,
            compactDeck && styles.deckPillCompact,
            pane === 'lyrics' && { backgroundColor: palette.container },
          ]}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={18}
            color={pane === 'lyrics' ? palette.accent : '#FFFFFF'}
          />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.deckLabel,
              tinyDeck && styles.deckLabelTiny,
              pane === 'lyrics' && { color: palette.accent },
            ]}
          >
            {vi ? 'Lời nhạc' : 'Lyrics'}
          </Text>
        </Tap>

        <Tap
          onPress={() => setPane((p) => (p === 'queue' ? 'artwork' : 'queue'))}
          style={[
            styles.deckPill,
            compactDeck && styles.deckPillCompact,
            pane === 'queue' && { backgroundColor: palette.container },
          ]}
        >
          <Ionicons name="list" size={18} color={pane === 'queue' ? palette.accent : '#FFFFFF'} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.deckLabel,
              tinyDeck && styles.deckLabelTiny,
              pane === 'queue' && { color: palette.accent },
            ]}
          >
            {vi ? 'Hàng chờ' : 'Queue'}
          </Text>
        </Tap>

        <Tap
          onPress={() => setIsAudioLabOpen(true)}
          style={[
            styles.deckPill,
            compactDeck && styles.deckPillCompact,
            audioLab.enabled && { backgroundColor: palette.container },
          ]}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={audioLab.enabled ? palette.accent : '#FFFFFF'}
          />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              styles.deckLabel,
              tinyDeck && styles.deckLabelTiny,
              audioLab.enabled && { color: palette.accent },
            ]}
          >
            Audio Lab
          </Text>
        </Tap>

        <Tap
          onPress={() => setPane((p) => (p === 'sleep' ? 'artwork' : 'sleep'))}
          style={[
            styles.deckPill,
            compactDeck && styles.deckPillCompact,
            (sleepActive || sleepEndOfTrack || pane === 'sleep') && {
              backgroundColor: palette.container,
            },
          ]}
        >
          <Ionicons
            name="moon-outline"
            size={17}
            color={sleepActive || sleepEndOfTrack ? palette.accent : '#FFFFFF'}
          />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[styles.deckLabel, tinyDeck && styles.deckLabelTiny]}
          >
            {sleepActive ? <SleepCountdown /> : sleepEndOfTrack ? '1x' : vi ? 'Hẹn giờ' : 'Sleep'}
          </Text>
        </Tap>
      </View>
    </>
  );

  return (
    <Modal
      visible={playerVisible}
      animationType="slide"
      transparent
      statusBarTranslucent
      // iOS: a modal only turns to orientations listed here (Orientation decides when it may)
      supportedOrientations={PLAYER_ORIENTATIONS}
      onRequestClose={() => (mvFull ? setMvFull(false) : setIsPlayerOpen(false))}
    >
      {/* while swiping down, the app shows through (dimmed) behind the player */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#000',
            opacity: dragY.interpolate({
              inputRange: [0, Math.max(1, screenH)],
              outputRange: [0.55, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
      <Animated.View
        style={{
          flex: 1,
          overflow: 'hidden',
          ...(dragging
            ? {
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                transform: [{ translateY: dragY }],
              }
            : null),
          // web preview: drags must not turn into text selection
          ...(Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null),
        }}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[
            styles.root,
            {
              paddingTop: padT,
              paddingBottom: padB,
              paddingLeft: padL,
              paddingRight: padR,
            },
          ]}
        >
          {ambientBackdrop && (
            <AmbientBackdrop
              artworkUrl={currentTrack.artworkUrl}
              colors={ambientColors}
              level={ambient.level}
              energy={energy}
              still={ambient.reduceMotion}
              rest={videoAmbientOn}
              drift={backTilt.on ? 18 : 0}
            />
          )}
          {/* the music video's scenes light the player (moves with the picture — also with Reduce
              Motion and while the camera button hides the picture: the video is content, not a
              decorative animation) */}
          {videoAmbientOn && !mvFull && <VideoAmbient live level={prefs.videoAmbientLevel} />}
          <DustField on={dustTilt.on && !mvFull} colors={ambientColors.corners} energy={energy} />
          {twoCol ? (
            // landscape: the picture (or the open pane) on the left, everything you press on the
            // right — top bar at the top, deck at the bottom, the controls centred between
            <View style={styles.landRow}>
              <View style={styles.landLeft}>{stageEl}</View>
              <View style={[styles.landRight, { width: rightW }]}>
                {topBarEl}
                <View style={styles.landControls}>{controlsEl}</View>
                {deckEl}
              </View>
            </View>
          ) : (
            <>
              {topBarEl}
              {stageEl}
              {controlsEl}
              {deckEl}
            </>
          )}
        </LinearGradient>
        <MvFullscreen visible={mvFull} onClose={() => setMvFull(false)} />
      </Animated.View>
      <SheetSlot layer="player" />
    </Modal>
  );
};

/** Live sleep countdown — the only thing that re-renders every second while a timer runs */
const SleepCountdown: React.FC<{ big?: boolean }> = ({ big }) => {
  const left = useSleepRemaining();
  if (left === null) return null;
  return <Text style={big ? styles.sleepBig : undefined}>{formatSleepLeft(left)}</Text>;
};

/**
 * Seek bar + timestamps. The only part of the player that follows the playback clock, so the
 * position ticking 4×/s re-renders this strip instead of the whole player (cover, glow, SVG).
 */
const SeekSection: React.FC<{
  live: boolean;
  genre?: string;
  durationSec: number;
  color: string;
  vi: boolean;
  showRemaining: boolean;
  onToggleRemaining: () => void;
  seekTo: (sec: number) => void;
  onHaptic: () => void;
}> = React.memo(
  ({ live, genre, durationSec, color, vi, showRemaining, onToggleRemaining, seekTo, onHaptic }) => {
    const positionSec = usePositionSec();
    // while dragging, the timestamps preview the target and the seek happens on release
    const [seekPreview, setSeekPreview] = useState<number | null>(null);
    const progress =
      seekPreview != null && durationSec > 0
        ? Math.min(1, Math.max(0, seekPreview / durationSec))
        : durationSec > 0
          ? Math.min(1, Math.max(0, positionSec / durationSec))
          : 0;
    const shownPos = seekPreview ?? positionSec;
    return live ? (
      <View style={styles.seekSection}>
        <View style={[styles.seekTrack, { backgroundColor: 'rgba(239,68,68,0.25)' }]}>
          <View style={[styles.seekFill, { width: '100%', backgroundColor: '#EF4444' }]} />
        </View>
        <View style={styles.timestampRow}>
          <Text style={[styles.timestampText, { color: '#FCA5A5', fontWeight: '900' }]}>
            ● LIVE · {formatTimeSec(positionSec)}
          </Text>
          <Text style={styles.timestampText}>{genre || 'Radio'}</Text>
        </View>
      </View>
    ) : (
      <View style={styles.seekSection}>
        <ScrubBar
          value={progress}
          thumb
          thickness={5}
          color={color}
          trackColor="rgba(255,255,255,0.22)"
          disabled={durationSec <= 0}
          onChange={(r) => setSeekPreview(r * durationSec)}
          onCommit={(r) => {
            if (durationSec > 0) seekTo(r * durationSec);
            // keep the preview a beat so the bar doesn't flash back before the seek lands
            setTimeout(() => setSeekPreview(null), 250);
          }}
          haptic={onHaptic}
          step={durationSec > 0 ? Math.min(1, 10 / durationSec) : 0.05}
          accessibilityLabel={vi ? 'Tiến độ bài hát' : 'Song position'}
          accessibilityValueText={`${formatTimeSec(shownPos)} / ${formatTimeSec(durationSec)}`}
          style={{ marginVertical: -10 }}
        />

        <View style={styles.timestampRow}>
          <Text style={[styles.timestampText, seekPreview != null && { color: '#FFFFFF' }]}>
            {formatTimeSec(shownPos)}
          </Text>
          <Tap onPress={onToggleRemaining}>
            <Text style={styles.timestampText}>
              {showRemaining
                ? `-${formatTimeSec(Math.max(0, durationSec - shownPos))}`
                : formatTimeSec(durationSec)}
            </Text>
          </Tap>
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  topBar: {
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  topIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleChipBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    maxWidth: 210,
    flexShrink: 1,
    marginHorizontal: 8,
  },
  qualityBadgeLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  stageArea: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 6,
  },
  landRow: { flex: 1, flexDirection: 'row', gap: LAND_GAP },
  landLeft: { flex: 1 },
  landRight: { justifyContent: 'space-between' },
  landControls: { flex: 1, justifyContent: 'center' },
  mvLyrics: { marginTop: 10 },
  flagshipCoverCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverShadowWrap: {
    width: 300,
    height: 300,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#191922',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  posterCoverWrap: {
    width: 270,
    height: 270,
    borderRadius: 30,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  // the card's edge line over the video (a hairline, so the rim is clean on every scale)
  videoEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  videoInCard: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  posterVisualizer: {
    width: 310,
    marginTop: 18,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  visBar: {
    width: 6,
    borderRadius: 3,
  },
  centerStage: { flex: 1, justifyContent: 'center' },
  // its own style, not overlayCard + overrides: on iOS (Yoga) `flex: 1` with flexBasis 'auto' still
  // means a 0 basis, so with flexGrow 0 the card collapsed to nothing — the empty sleep pane
  sleepCard: {
    backgroundColor: 'rgba(12, 12, 18, 0.72)',
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sleepLive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sleepBig: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  sleepExtend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  overlayCard: {
    flex: 1,
    backgroundColor: 'rgba(12, 12, 18, 0.72)',
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  paneHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  paneTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  subHelper: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  sleepGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  sleepOption: {
    flexGrow: 1,
    minWidth: '28%',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sleepOptionWide: {
    minWidth: '40%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  sleepOptionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  turnOffSleepBtn: {
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(248, 113, 113, 0.14)',
    alignItems: 'center',
  },
  diagActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  diagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  diagBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12.5 },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  diagTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  diagDetail: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  styleSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 9,
  },
  styleCardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  styleCardDesc: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  styleCardBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  controlsBlock: {
    marginTop: 4,
  },
  songInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  songInfoTight: { marginBottom: 8 },
  trackTitleTight: { fontSize: 19 },
  transportTight: { marginVertical: 2 },
  bigPlayTight: { width: 60, height: 60, borderRadius: 30 },
  trackArtist: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 3,
  },
  likeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekSection: {
    marginBottom: 12,
  },
  seekTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginVertical: 7,
  },
  seekFill: {
    height: '100%',
    borderRadius: 3,
  },
  timestampRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timestampText: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '600',
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginVertical: 8,
  },
  sideCtrl: {
    padding: 8,
    position: 'relative',
  },
  repeatOneDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    fontSize: 9,
    fontWeight: '900',
  },
  skipBtn: {
    padding: 10,
  },
  bigPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
    paddingHorizontal: 6,
  },
  bpBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  bpBoxTitle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800', marginBottom: 10 },
  bpVolText: {
    flex: 1,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  airplayBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: -6,
    marginBottom: 6,
  },
  routeText: {
    fontSize: 11.5,
    fontWeight: '700',
    maxWidth: 260,
  },
  bottomDeck: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  deckPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deckPillCompact: {
    flexDirection: 'column',
    paddingHorizontal: 4,
    gap: 3,
    paddingVertical: 8,
    minHeight: 50,
  },
  deckLabel: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  deckLabelTiny: {
    fontSize: 10,
    letterSpacing: -0.2,
  },
});
