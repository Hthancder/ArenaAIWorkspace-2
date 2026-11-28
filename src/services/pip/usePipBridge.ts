// Keeps Picture in Picture in sync with playback and handles its buttons.
//
// Cheap on purpose: the song / lyrics are sent once per change, the play state on play / pause /
// seek only — the iOS module reads the time straight from the AVPlayer (and the web canvas
// extrapolates), so nothing here runs per position tick except a comparison.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { liveLyricsEffect } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { audioEngine } from '../audio/audioEngine';
import { PlaybackClock } from '../audio/playbackClock';
import { PlayerPaneBus } from '../ui/playerPaneBus';
import { Pip, usePipState } from './pip';
import { useAmbientColors } from '../../components/ambient/AmbientLight';

const hex6 = (c: string | undefined, fallback: string) =>
  c && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : fallback;

export function usePipBridge(): void {
  const {
    currentTrack,
    isPlaying,
    durationSec,
    darkPalette,
    prefs,
    lyrics,
    lyricsOffsetSec,
    queue,
    queueIndex,
    togglePlay,
    seekTo,
    setIsPlayerOpen,
    playNext,
    playPrevious,
    ambient,
  } = useHolySic();
  const ambientColors = useAmbientColors();
  const { supported, active } = usePipState();
  const vi = prefs.language === 'vi';
  const showLyrics = prefs.pipLyrics !== false;
  const style = prefs.pipStyle || 'lyrics';
  const auto = !!prefs.pipAuto;
  // the floating window follows the Lyrics screen's effect unless the user picked its own
  const effect =
    liveLyricsEffect(
      !prefs.pipEffect || prefs.pipEffect === 'app' ? prefs.lyricsEffect : prefs.pipEffect
    ) || 'glow';
  // the same light as the player: its colours, at the user's ambient strength
  const ambientList =
    ambient.level > 0 && !prefs.pureBlack
      ? [
          hex6(ambientColors.primary, '#8B5CF6'),
          hex6(ambientColors.dark, '#0A0A12'),
          ...ambientColors.corners.map((c) => hex6(c, '#8B5CF6')),
        ]
      : [];
  const ambientKey = ambientList.join(',');

  // the AVPlayer that times the lyrics natively
  useEffect(() => {
    if (!supported || Platform.OS !== 'ios') return;
    const push = () => Pip.setPlayer(audioEngine.currentNativePlayer());
    push();
    return audioEngine.subscribePlayer(push);
  }, [supported]);

  // song + look
  const nextUp = queue[queueIndex + 1];
  const upNext = nextUp
    ? `${vi ? 'Tiếp theo' : 'Up next'} · ${nextUp.title}${nextUp.artist ? ` — ${nextUp.artist}` : ''}`
    : '';
  const duration = currentTrack?.isLive
    ? 0
    : Math.max(0, durationSec || currentTrack?.durationSec || 0);
  useEffect(() => {
    if (!supported) return;
    Pip.setMeta({
      title: currentTrack?.title || 'HolySic',
      artist: currentTrack?.artist || '',
      artwork: currentTrack?.artworkUrl || '',
      accent: /^#[0-9a-f]{6}/i.test(darkPalette.accent)
        ? darkPalette.accent.slice(0, 7)
        : '#8B5CF6',
      style,
      showLyrics,
      duration,
      noLyrics: vi ? 'Bài này chưa có lời đồng bộ' : 'No synced lyrics for this song',
      upNext,
      effect,
      ambient: ambientKey ? ambientKey.split(',') : [],
      ambientLevel: ambient.level,
    });
  }, [
    supported,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.artworkUrl,
    darkPalette.accent,
    style,
    showLyrics,
    duration,
    vi,
    upNext,
    effect,
    ambientKey,
    ambient.level,
  ]);

  // the timed lines (main voice only), once per song / lyrics delay
  const songLyrics = lyrics && currentTrack && lyrics.trackId === currentTrack.id ? lyrics : null;
  useEffect(() => {
    if (!supported) return;
    if (!songLyrics || !songLyrics.synced || !songLyrics.lines.length) {
      Pip.setLyrics([], [], 0, false);
      return;
    }
    const main = songLyrics.lines.filter((l) => !l.isBackground && (l.text || '').trim());
    Pip.setLyrics(
      main.map((l) => l.startSec),
      main.map((l) => l.text.replace(/\s+/g, ' ').trim()),
      lyricsOffsetSec,
      true
    );
    // real word timing where the lyrics have it (karaoke, typewriter… follow the voice exactly)
    const has = main.some((l) => l.words && l.words.length);
    Pip.setWords(
      main.map((l) => (has && l.words ? l.words.map((w) => w.text) : [])),
      main.map((l) => (has && l.words ? l.words.map((w) => w.startSec) : [])),
      main.map((l) => (has && l.words ? l.words.map((w) => w.endSec) : []))
    );
  }, [supported, songLyrics, lyricsOffsetSec]);

  // play state: on play / pause, and when the position jumps (seek, next song)
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  useEffect(() => {
    if (!supported) return;
    Pip.setPlayback(PlaybackClock.now(isPlaying), isPlaying);
    let last = { pos: PlaybackClock.get(), at: Date.now() };
    return PlaybackClock.subscribe(() => {
      const pos = PlaybackClock.get();
      const now = Date.now();
      const expected = playingRef.current ? last.pos + (now - last.at) / 1000 : last.pos;
      if (Math.abs(expected - pos) < 1.2) return;
      last = { pos, at: now };
      Pip.setPlayback(pos, playingRef.current);
    });
  }, [supported, isPlaying, currentTrack?.id]);

  // iOS: float by itself on leaving the app (only while there is something playing)
  useEffect(() => {
    if (!supported) return;
    Pip.setAutoStart(auto && !!currentTrack);
  }, [supported, auto, !!currentTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  // nothing left to show: close the window
  useEffect(() => {
    if (active && !currentTrack) Pip.stop();
  }, [active, currentTrack]);

  // the floating window's buttons
  const lyricsOn = showLyrics && !!songLyrics?.lines.length;
  const actions = useRef({
    togglePlay,
    seekTo,
    setIsPlayerOpen,
    playNext,
    playPrevious,
    duration,
    isPlaying,
    lyricsOn,
  });
  actions.current = {
    togglePlay,
    seekTo,
    setIsPlayerOpen,
    playNext,
    playPrevious,
    duration,
    isPlaying,
    lyricsOn,
  };
  useEffect(
    () =>
      Pip.onCommand((c) => {
        const a = actions.current;
        if (c.type === 'play' || c.type === 'pause') {
          if ((c.type === 'play') !== a.isPlaying) a.togglePlay();
        } else if (c.type === 'seek') {
          const cur = PlaybackClock.now(a.isPlaying);
          const max = a.duration > 0 ? a.duration - 0.5 : Number.POSITIVE_INFINITY;
          a.seekTo(Math.max(0, Math.min(max, cur + c.delta)));
        } else if (c.type === 'seekTo') {
          const max = a.duration > 0 ? a.duration - 0.5 : Number.POSITIVE_INFINITY;
          a.seekTo(Math.max(0, Math.min(max, c.position)));
        } else if (c.type === 'next') {
          a.playNext();
        } else if (c.type === 'previous') {
          a.playPrevious();
        } else if (c.type === 'restore') {
          // back in the app: land where the window was looking
          if (a.lyricsOn) PlayerPaneBus.request('lyrics');
          a.setIsPlayerOpen(true);
        }
      }),
    []
  );
}
