// Keeps the iOS widget in sync with playback and handles its buttons (holysic://widget/…).

import { PlaybackClock, usePositionStep } from '../audio/playbackClock';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { PlayerPaneBus } from '../ui/playerPaneBus';
import {
  parseWidgetUrl,
  publishArtwork,
  publishLyrics,
  publishNowPlaying,
  WidgetAction,
  WidgetLyricLine,
  widgetSupported,
} from './nowPlayingWidget';
import type { LyricLine } from '../../types/music';

/** how long the widget trusts "playing" without hearing from the app (renewed every 20 s) */
const LEASE_SEC = 50;
const LEASE_RENEW_MS = 20_000;

/** true once `value` has stayed true for `ms` */
function useLongTrue(value: boolean, ms: number): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!value) {
      setLong(false);
      return;
    }
    const t = setTimeout(() => setLong(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value && long;
}

/** ticks every LEASE_RENEW_MS while playing, and when the app returns to the front */
function useLeaseTick(playing: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setTick((n) => n + 1), LEASE_RENEW_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setTick((n) => n + 1);
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [playing]);
  return tick;
}

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

const r2 = (n: number) => Math.max(0, Math.round(n * 100) / 100);

/**
 * One lyric line for the widget, with per-word start times so it can light the words one by one
 * (as the player does). Real word timings are used when the lyrics have them; otherwise the
 * words are spread across the line by length — a gentle karaoke sweep that ends a little before
 * the next line, never racing ahead of a slow line.
 */
function widgetLine(
  l: LyricLine,
  nextStart: number | undefined,
  offset: number,
  songSec: number
): WidgetLyricLine {
  const t = r2(l.startSec + offset);
  const words = (l.words || []).filter((w) => (w.text || '').trim());
  if (words.length > 1) {
    const ws: number[] = [];
    const wt: string[] = [];
    words.forEach((w, i) => {
      const txt = w.text.replace(/\s+/g, ' ');
      const next = words[i + 1]?.text || '';
      const gap = i < words.length - 1 && !/\s$/.test(txt) && !/^\s/.test(next) ? ' ' : '';
      ws.push(r2(Math.max(l.startSec, w.startSec) + offset));
      wt.push(txt + gap);
    });
    const x = wt.join('').trim();
    if (x.length <= 200) return { t, x, ws, wt };
  }
  const x = (l.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const parts = x.match(/\S+\s*/g) || [];
  if (parts.length < 2) return { t, x };
  // the time this line owns: until the next line (or its own end), at most ~0.42 s per word
  const end = l.endSec ?? nextStart ?? Math.min(songSec || l.startSec + 6, l.startSec + 6);
  const span = Math.max(0.6, Math.min((end - l.startSec) * 0.85, parts.length * 0.42 + 0.6));
  const total = parts.reduce((n, p) => n + p.trim().length + 1, 0);
  let acc = 0;
  const ws = parts.map((p) => {
    const at = l.startSec + (acc / total) * span;
    acc += p.trim().length + 1;
    return r2(at + offset);
  });
  return { t, x, ws, wt: parts };
}

export function useWidgetBridge() {
  const {
    currentTrack,
    isPlaying,
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
    lyrics,
    isLoadingLyrics,
    lyricsOffsetSec,
    setIsPlayerOpen,
    isBuffering,
    prefsReady,
  } = useHolySic();
  // what the widget calls "playing": sound is actually coming out. A stream that has stalled for
  // more than a moment counts as paused, so the widget's lyrics don't run ahead of silence.
  const stalled = useLongTrue(isPlaying && isBuffering, 1500);
  const playingNow = isPlaying && !stalled;
  // lease: renewed every 20 s while playing (and when the app comes back to the front)
  const leaseTick = useLeaseTick(playingNow);
  // coarse trigger on purpose (the widget extrapolates the time itself, only drift matters) —
  // but what's published is the exact position: a floored one started the widget's lyrics up
  // to 2 s late
  const positionStep = usePositionStep(2);

  const enabled = Platform.OS === 'ios' && widgetSupported();
  const last = useRef<{ key: string; pos: number; at: number; playing: boolean } | null>(null);

  // cover
  useEffect(() => {
    if (!enabled) return;
    publishArtwork(currentTrack?.artworkUrl);
  }, [enabled, currentTrack?.artworkUrl]);

  // lyrics: the whole timed pack once per song (and when the lyrics delay changes)
  const songLyrics = lyrics && currentTrack && lyrics.trackId === currentTrack.id ? lyrics : null;
  const synced = !!songLyrics?.synced && songLyrics.lines.length > 0;
  const lyricsId = synced ? `${currentTrack!.id}@${Math.round(lyricsOffsetSec * 1000)}` : undefined;
  const lyricsState = !currentTrack
    ? undefined
    : synced
      ? 'synced'
      : isLoadingLyrics
        ? 'loading'
        : songLyrics && (songLyrics.lines.length > 0 || songLyrics.plainText)
          ? 'plain'
          : 'none';
  useEffect(() => {
    if (!enabled) return;
    if (!lyricsId || !songLyrics) {
      publishLyrics(null);
      return;
    }
    const main = songLyrics.lines.filter((l) => !l.isBackground).slice(0, 600);
    publishLyrics({
      id: lyricsId,
      synced: true,
      lines: main.map((l, i) =>
        widgetLine(
          l,
          main[i + 1]?.startSec,
          lyricsOffsetSec,
          durationSec || currentTrack!.durationSec
        )
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lyricsId, songLyrics]);

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
      playingNow,
      leaseTick,
      liked,
      upKey,
      Math.round(durationSec),
      darkPalette.accent,
      artColors?.primary,
      prefs.language,
      lyricsId,
      lyricsState,
    ].join('·');
    const positionSec = PlaybackClock.now(playingNow);
    const prev = last.current;
    if (prev && prev.key === key) {
      const expected = prev.playing ? prev.pos + (now - prev.at) : prev.pos;
      if (Math.abs(expected - positionSec) < 1.5) return; // the widget is extrapolating fine
    }
    last.current = { key, pos: positionSec, at: now, playing: playingNow };
    const top = artColors ? shade(artColors.primary, 0.55) : undefined;
    const bottom = artColors ? shade(artColors.dark, 0.6) : undefined;
    publishNowPlaying({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      isPlaying: playingNow,
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
      lyricsId,
      lyricsState,
      liveUntil: playingNow ? Math.round(now + LEASE_SEC) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    currentTrack,
    playingNow,
    leaseTick,
    positionStep,
    durationSec,
    liked,
    upKey,
    darkPalette.accent,
    artColors,
    prefs.language,
    lyricsId,
    lyricsState,
  ]);

  // widget buttons
  const runRef = useRef<(a: WidgetAction | null) => void>(() => undefined);
  const actions = useRef({
    togglePlay,
    playNext,
    playPrevious,
    toggleLike,
    currentTrack,
    setIsPlayerOpen,
  });
  actions.current = {
    togglePlay,
    playNext,
    playPrevious,
    toggleLike,
    currentTrack,
    setIsPlayerOpen,
  };
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const run = (a: WidgetAction | null) => {
      const x = actions.current;
      if (!a || a === 'open') return;
      if (a === 'lyrics') {
        if (!x.currentTrack) return;
        PlayerPaneBus.request('lyrics');
        x.setIsPlayerOpen(true);
      } else if (a === 'toggle') x.togglePlay();
      else if (a === 'next') x.playNext();
      else if (a === 'prev') x.playPrevious();
      else if (a === 'like' && x.currentTrack) x.toggleLike(x.currentTrack);
    };
    runRef.current = run;
    const sub = Linking.addEventListener('url', (e) => run(parseWidgetUrl(e.url)));
    return () => sub.remove();
  }, []);
  // cold start from a widget button: act once the restored queue / likes are loaded
  const initialDone = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web' || !prefsReady || initialDone.current) return;
    initialDone.current = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    Linking.getInitialURL()
      .then((u) => {
        const a = parseWidgetUrl(u);
        if (a) t = setTimeout(() => runRef.current(a), 250);
      })
      .catch(() => undefined);
    return () => clearTimeout(t);
  }, [prefsReady]);
}
