// Draws a BgMedia (photo, GIF or video) as a background: framing, style, blur, veil and motion.
// Used behind the tabs, behind a page, and at a smaller size in the editor's live preview.
//
// Cost notes
//  • stills are blurred once by the image pipeline (blurRadius), not by a live blur view;
//  • GIF / video use one native blur view only when blur is actually on;
//  • a video is a muted, looping, hardware-decoded player that stops whenever the background
//    isn't seen (player open, app in background, page covered, Low Power Mode);
//  • motion is a transform on the native driver; nothing re-renders per frame.

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';
import {
  BgMedia,
  effectiveFit,
  frameFor,
  measureImage,
  Rect,
  resolveBgUri,
} from '../../services/backdrop/backdropMedia';
import { withAlpha } from '../../theme/colorMath';
import type { UiScheme } from '../../theme/ui';
import { Tilt } from '../../services/motion/tilt';

interface Props {
  media: BgMedia;
  /** seen & allowed to move (video plays, motion runs) */
  active: boolean;
  scheme: UiScheme;
  /** page colour (the veil) */
  bg: string;
  accent: string;
  /** bass energy 0…1 for the "pulse" motion */
  energy?: Animated.Value;
  isPlaying?: boolean;
  reduceMotion?: boolean;
  /** the editor preview draws the screen smaller: blur & actual-size follow the scale */
  previewScale?: number;
  /** report a size measured on first draw (editor stores it) */
  onMeasured?: (w: number, h: number) => void;
  /** motion effects: points the picture drifts with the tilt (0 / undefined = fixed) */
  parallax?: number;
}

export const MediaBackdrop: React.FC<Props> = React.memo((props) => {
  const { media, scheme, bg } = props;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const uri = useMemo(() => resolveBgUri(media.ref), [media.ref]);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  // stills / GIFs from Files arrive without a size: measure once
  useEffect(() => {
    setMeasured(null);
    if (media.w > 0 && media.h > 0) return;
    if (media.kind === 'video' || !uri) return;
    let off = false;
    measureImage(uri).then((s) => {
      if (off || !s) return;
      setMeasured(s);
      props.onMeasured?.(s.w, s.h);
    });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, media.w, media.h, media.kind]);

  const m: BgMedia =
    measured && !(media.w > 0 && media.h > 0) ? { ...media, w: measured.w, h: measured.h } : media;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: bg }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (!box || Math.abs(box.w - width) > 0.5 || Math.abs(box.h - height) > 0.5)
          setBox({ w: width, h: height });
      }}
    >
      {box && uri ? <Stage {...props} media={m} uri={uri} box={box} /> : null}
      <Veil media={m} scheme={scheme} bg={bg} accent={props.accent} />
    </View>
  );
});

const Stage: React.FC<Props & { uri: string; box: { w: number; h: number } }> = ({
  media,
  uri,
  box,
  active,
  energy,
  isPlaying,
  reduceMotion,
  previewScale = 1,
  scheme,
  onMeasured,
  parallax = 0,
}) => {
  const fit = effectiveFit(media);
  const rect = frameFor(media, box.w, box.h, previewScale);
  const still = media.kind === 'image';
  // blur strength in screen points (the preview is a scaled-down screen)
  const blurPx = media.blur * 46 * previewScale;
  const style = media.style;
  const dreamy = style === 'dreamy';
  const frost = style === 'frosted';

  // fade the picture in once it has loaded (no pop)
  const shown = useRef(new Animated.Value(0)).current;
  const onReady = () =>
    Animated.timing(shown, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  useEffect(() => {
    shown.setValue(0);
    const t = setTimeout(onReady, 1500); // safety net for sources that never report "loaded"
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const moving = active && !reduceMotion;
  const motionStyle = useMotion(media.motion, moving, energy, isPlaying);
  // dreamy: a touch larger so the soft edges never show
  const extra = dreamy ? [{ scale: 1.08 }] : [];

  // tilt parallax: the picture sits far behind the page and drifts with the eye; it is scaled
  // just enough (gain ≤ 1.5 × amount per side) that its edges never come into view
  const minSide = Math.max(1, Math.min(box.w, box.h));
  const parallaxStyle = useMemo(
    () =>
      parallax > 0
        ? {
            transform: [
              { translateX: Animated.multiply(Tilt.x, parallax) },
              { translateY: Animated.multiply(Tilt.y, parallax) },
              { scale: 1 + (3 * parallax) / minSide },
            ],
          }
        : null,
    [parallax, minSide]
  );

  const playVideo = active && (!media.pauseWithMusic || !!isPlaying);
  const blurOverlay = !still && blurPx > 0.5;

  const picture = (r: Rect, key: string, blurRadius: number, contentOnly = false) =>
    media.kind === 'video' ? (
      <BgVideo
        key={key}
        uri={uri}
        rect={r}
        playing={playVideo}
        onReady={contentOnly ? undefined : onReady}
        onSize={(w, h) => {
          if (!(media.w > 0 && media.h > 0)) onMeasured?.(w, h);
        }}
      />
    ) : (
      <Image
        key={key}
        source={{ uri }}
        onLoad={contentOnly ? undefined : onReady}
        resizeMode={fit === 'tile' ? 'repeat' : 'stretch'}
        blurRadius={still && blurRadius > 0.5 ? blurRadius : undefined}
        fadeDuration={0}
        style={[styles.abs, r]}
      />
    );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
      <Animated.View style={[StyleSheet.absoluteFill, parallaxStyle]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            motionStyle,
            { transform: [...(motionStyle.transform || []), ...extra] },
          ]}
        >
          {/* "Fit": the whole picture over a blurred, darker copy of itself (like iOS wallpapers) */}
          {fit === 'fit' && (
            <>
              {picture(
                frameFor({ ...media, fit: 'fill', zoom: 1, fx: 0.5, fy: 0.5 }, box.w, box.h),
                'back',
                Math.max(blurPx, 30 * previewScale),
                true
              )}
              {!still && (
                <BlurView
                  intensity={70}
                  tint={scheme === 'light' ? 'light' : 'dark'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor:
                      scheme === 'light' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)',
                  },
                ]}
              />
            </>
          )}
          {picture(rect, 'main', blurPx)}
          {blurOverlay && (
            <BlurView
              intensity={Math.min(100, media.blur * 100)}
              tint={frost ? (scheme === 'light' ? 'light' : 'dark') : 'default'}
              style={StyleSheet.absoluteFill}
            />
          )}
          {frost && still && (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor:
                    scheme === 'light' ? 'rgba(255,255,255,0.32)' : 'rgba(30,30,40,0.38)',
                },
              ]}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

/** The style's own overlay + the user's veil (page colour over the picture, for legible text). */
const Veil: React.FC<{ media: BgMedia; scheme: UiScheme; bg: string; accent: string }> = ({
  media,
  scheme,
  bg,
  accent,
}) => {
  const v = Math.max(0, Math.min(1, media.veil));
  const light = scheme === 'light';
  const s = media.style;
  return (
    <>
      {s === 'tint' && (
        <View
          style={[
            StyleSheet.absoluteFill,
            // blend modes need the new architecture; without them it is a plain accent wash
            { backgroundColor: accent, opacity: 0.55, mixBlendMode: 'color' } as any,
          ]}
        />
      )}
      {s === 'dreamy' && (
        <LinearGradient
          colors={
            light
              ? ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.35)']
              : [withAlpha(accent, 0.28), 'rgba(255,255,255,0.06)', withAlpha(accent, 0.18)]
          }
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      )}
      {s === 'cinema' && (
        <LinearGradient
          colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
          locations={[0, 0.3, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      )}
      {s === 'fade' ? (
        <LinearGradient
          colors={[withAlpha(bg, v * 0.6), withAlpha(bg, 0.25 + v * 0.5), withAlpha(bg, 1)]}
          locations={[0, 0.32, 0.7]}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        v > 0.01 && (
          // a little lighter at the top (the picture shows), denser where the lists are
          <LinearGradient
            colors={[
              withAlpha(bg, v * 0.75),
              withAlpha(bg, v),
              withAlpha(bg, Math.min(1, v * 1.1 + 0.05)),
            ]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
        )
      )}
    </>
  );
};

/** Slow Ken Burns drift, or a gentle zoom with the bass. Only scales up from 1 (with a little
 *  translate inside that margin), so the edges of a filled picture never show. */
function useMotion(
  motion: BgMedia['motion'],
  on: boolean,
  energy?: Animated.Value,
  isPlaying?: boolean
): { transform?: any[] } {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (motion !== 'drift' || !on) {
      drift.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [motion, on, drift]);

  return useMemo(() => {
    if (motion === 'drift')
      return {
        transform: [
          { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1.16] }) },
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) },
          { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [6, -6] }) },
        ],
      };
    if (motion === 'pulse' && energy)
      return {
        transform: [
          {
            scale: energy.interpolate({
              inputRange: [0, 1],
              outputRange: [1.02, isPlaying && on ? 1.075 : 1.02],
              extrapolate: 'clamp',
            }),
          },
        ],
      };
    return {};
  }, [motion, drift, energy, isPlaying, on]);
}

/** A muted, looping background video that leaves the music's audio session alone. */
const BgVideo: React.FC<{
  uri: string;
  rect: Rect;
  playing: boolean;
  onReady?: () => void;
  onSize?: (w: number, h: number) => void;
}> = ({ uri, rect, playing, onReady, onSize }) => {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
    p.loop = true;
    p.audioMixingMode = 'mixWithOthers';
    p.showNowPlayingNotification = false;
    p.staysActiveInBackground = false;
    p.timeUpdateEventInterval = 0;
  });
  useEffect(() => {
    const sub = player.addListener('sourceLoad', (e) => {
      const s = e.availableVideoTracks?.[0]?.size;
      if (s?.width && s?.height) onSize?.(s.width, s.height);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);
  useEffect(() => {
    try {
      if (playing) player.play();
      else player.pause();
    } catch {
      // released
    }
  }, [playing, player]);
  return (
    <VideoView
      player={player}
      style={[styles.abs, rect, Platform.OS === 'web' && ({ objectFit: 'fill' } as any)]}
      contentFit="fill"
      nativeControls={false}
      allowsPictureInPicture={false}
      pointerEvents="none"
      onFirstFrameRender={onReady}
    />
  );
};

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  abs: { position: 'absolute' },
});
