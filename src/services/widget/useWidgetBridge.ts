// Keeps the iOS widget in sync with playback and handles its buttons (holysic://widget/…).

import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import {
  parseWidgetUrl,
  publishArtwork,
  publishNowPlaying,
  WidgetAction,
  widgetSupported,
} from './nowPlayingWidget';

const BRAND_TOP = '#2A1452';
const BRAND_BOTTOM = '#06050B';

/** Darken a #rrggbb colour (0..1) so white text on it always reads */
function shade(hex: string | undefined, k: number): string | undefined {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const c = (v: number) =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export function useWidgetBridge() {
  const {
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    queue,
    queueIndex,
    darkPalette,
    artColors,
    isLiked,
    togglePlay,
    playNext,
    playPrevious,
    toggleLike,
    prefs,
  } = useHolySic();

  const enabled = Platform.OS === 'ios' && widgetSupported();
  const last = useRef<{ key: string; pos: number; at: number; playing: boolean } | null>(null);

  // cover
  useEffect(() => {
    if (!enabled) return;
    publishArtwork(currentTrack?.artworkUrl);
  }, [enabled, currentTrack?.artworkUrl]);

  // state (re-published on changes and position jumps only)
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const upNext = queue
    .slice(queueIndex + 1, queueIndex + 5)
    .map((t) => ({ title: t.title, artist: t.artist }));
  const upKey = upNext.map((t) => t.title).join('|');
  useEffect(() => {
    if (!enabled) return;
    if (!currentTrack) {
      last.current = null;
      publishNowPlaying(null);
      return;
    }
    const now = Date.now() / 1000;
    const key = [
      currentTrack.id,
      currentTrack.title,
      currentTrack.artist,
      currentTrack.artworkUrl,
      isPlaying,
      liked,
      upKey,
      Math.round(durationSec),
      darkPalette.accent,
      artColors?.primary,
      prefs.language,
    ].join('·');
    const prev = last.current;
    if (prev && prev.key === key) {
      const expected = prev.playing ? prev.pos + (now - prev.at) : prev.pos;
      if (Math.abs(expected - positionSec) < 3) return; // the widget is extrapolating fine
    }
    last.current = { key, pos: positionSec, at: now, playing: isPlaying };
    const top = artColors ? shade(artColors.primary, 0.55) : undefined;
    const bottom = artColors ? shade(artColors.dark, 0.6) : undefined;
    publishNowPlaying({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      isPlaying,
      position: Math.max(0, positionSec),
      duration: currentTrack.isLive ? 0 : Math.max(0, durationSec || currentTrack.durationSec || 0),
      updatedAt: now,
      accent: darkPalette.accent,
      bgTop: top || BRAND_TOP,
      bgBottom: bottom || BRAND_BOTTOM,
      badge: currentTrack.qualityBadge?.split(' · ').slice(0, 2).join(' · '),
      liked,
      isLive: !!currentTrack.isLive,
      upNext,
      lang: prefs.language,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    liked,
    upKey,
    darkPalette.accent,
    artColors,
    prefs.language,
  ]);

  // widget buttons
  const actions = useRef({ togglePlay, playNext, playPrevious, toggleLike, currentTrack });
  actions.current = { togglePlay, playNext, playPrevious, toggleLike, currentTrack };
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const run = (a: WidgetAction | null) => {
      const x = actions.current;
      if (!a || a === 'open') return;
      if (a === 'toggle') x.togglePlay();
      else if (a === 'next') x.playNext();
      else if (a === 'prev') x.playPrevious();
      else if (a === 'like' && x.currentTrack) x.toggleLike(x.currentTrack);
    };
    // cold start from a widget button: wait for the restored queue
    Linking.getInitialURL()
      .then((u) => {
        const a = parseWidgetUrl(u);
        if (a) setTimeout(() => run(a), 1200);
      })
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => run(parseWidgetUrl(e.url)));
    return () => sub.remove();
  }, []);
}
