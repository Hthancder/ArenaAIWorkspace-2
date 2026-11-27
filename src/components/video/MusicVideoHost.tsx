// The one music-video player of the app (muted; the audio engine keeps playing the sound).
//
//  • finds the playing song's music video and loads a stream the phone decodes in hardware
//  • follows the audio: play / pause, seeks, and drift (gentle speed nudges, a seek if far off)
//  • moves only while a "live" view shows it (the player's video / ambient); everywhere else —
//    menus, the app behind the player — the picture rests on the last scene
//  • looks up the next song's video ahead of time so the audio can start from it directly

import NetInfo from '@react-native-community/netinfo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Platform } from 'react-native';
import React, { useEffect, useRef } from 'react';
import { useHolySic } from '../../context/HolySicContext';
import { PlaybackClock } from '../../services/audio/playbackClock';
import { useVideoState, videoWanted, VideoLive, VideoStore } from '../../services/video/videoStore';
import {
  findMusicVideo,
  resolveVideoStream,
  warmVideoCache,
} from '../../services/video/videoService';

export const MusicVideoHost: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    prefs,
    isOnline,
    queue,
    queueIndex,
    resolvedStream,
    switchToVideoAudio,
    audioLab,
  } = useHolySic();
  // Audio Lab speed (0.75–1.5×) and bit-perfect mode, so the picture runs at the music's pace
  const audioRate =
    audioLab.enabled && !prefs.bitPerfect && audioLab.playbackRate > 0 ? audioLab.playbackRate : 1;
  const player = useVideoPlayer(null, (p) => {
    p.muted = true;
    // picture only: never take the audio session from the music engine
    p.audioMixingMode = 'mixWithOthers';
    p.loop = false;
    p.showNowPlayingNotification = false;
    p.staysActiveInBackground = false;
    p.preservesPitch = true;
    p.timeUpdateEventInterval = 0;
  });
  VideoStore.player = player;
  const videoId = useVideoState().videoId;

  const live = useRef({ isPlaying, resolvedStream, switchToVideoAudio, prefs, audioRate });
  live.current = { isPlaying, resolvedStream, switchToVideoAudio, prefs, audioRate };
  const switched = useRef<Set<string>>(new Set());

  useEffect(() => {
    warmVideoCache();
  }, []);

  const enabled = videoWanted(prefs.musicVideo, currentTrack);
  const trackId = currentTrack?.id;

  // ── find + load the video for the playing song ──
  useEffect(() => {
    let cancelled = false;
    const tr = currentTrack;
    if (!enabled || !tr) {
      VideoStore.set({ status: 'off', trackId: tr?.id ?? null, videoId: null, synced: false });
      try {
        player.pause();
      } catch {
        // not loaded
      }
      return;
    }
    if (tr.isLive || tr.source === 'radio' || tr.source === 'synth') {
      VideoStore.set({ status: 'none', trackId: tr.id, videoId: null, synced: false });
      return;
    }
    if (!isOnline) {
      VideoStore.set({ status: 'offline', trackId: tr.id, videoId: null, synced: false });
      return;
    }
    (async () => {
      if (live.current.prefs.videoWifiOnly) {
        const net = await NetInfo.fetch().catch(() => null);
        if (net && net.type !== 'wifi' && net.type !== 'ethernet' && net.type !== 'unknown') {
          if (!cancelled)
            VideoStore.set({ status: 'wifi', trackId: tr.id, videoId: null, synced: false });
          return;
        }
      }
      VideoStore.set({ status: 'searching', trackId: tr.id, videoId: null, synced: false });
      const id = await findMusicVideo(tr).catch(() => null);
      if (cancelled) return;
      if (!id) {
        VideoStore.set({ status: 'none' });
        try {
          player.pause();
        } catch {
          // ignore
        }
        return;
      }
      VideoStore.set({ status: 'loading', videoId: id });
      const stream = await resolveVideoStream(id, live.current.prefs.videoQuality).catch(
        () => null
      );
      if (cancelled) return;
      if (!stream) {
        VideoStore.set({ status: 'error' });
        return;
      }
      try {
        await player.replaceAsync({
          uri: stream.url,
          headers: stream.headers,
          contentType: stream.isHls ? 'hls' : 'progressive',
        });
      } catch {
        if (!cancelled) VideoStore.set({ status: 'error' });
        return;
      }
      if (cancelled) return;
      VideoStore.set({ label: stream.label });
      try {
        player.currentTime = PlaybackClock.get();
      } catch {
        // not ready yet; the sync loop catches up
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, enabled, isOnline, prefs.videoQuality, prefs.videoWifiOnly]);

  // ready / failed / picture size
  useEffect(() => {
    const subs = [
      player.addListener('statusChange', ({ status }) => {
        const st = VideoStore.get();
        if (status === 'readyToPlay' && (st.status === 'loading' || st.status === 'error'))
          VideoStore.set({ status: 'ready' });
        else if (status === 'error' && st.status === 'loading') VideoStore.set({ status: 'error' });
      }),
      player.addListener('videoTrackChange', ({ videoTrack }) => {
        const w = videoTrack?.size?.width || 0;
        const h = videoTrack?.size?.height || 0;
        if (w > 0 && h > 0) VideoStore.set({ aspect: w / h });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // ── audio from the same video (exact sync) ──
  const mvId = currentTrack?.mvId;
  const streamLabel = resolvedStream?.sourceLabel;
  useEffect(() => {
    const st = VideoStore.get();
    const tr = currentTrack;
    if (!tr || !st.videoId || st.trackId !== tr.id) return;
    const fromVideo =
      streamLabel === 'YouTube MV' ||
      (resolvedStream?.source === 'innertube' && tr.videoId === st.videoId);
    VideoStore.set({ synced: fromVideo });
    if (
      fromVideo ||
      !prefs.videoAudio ||
      !resolvedStream ||
      resolvedStream.isOffline ||
      tr.source === 'local' ||
      switched.current.has(tr.id)
    )
      return;
    // switch once per song, only while it plays (so a paused song isn't started)
    if (!isPlaying) return;
    switched.current.add(tr.id);
    switchToVideoAudio(st.videoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamLabel, mvId, prefs.videoAudio, isPlaying, videoId]);

  // ── follow the audio ──
  useEffect(() => {
    if (!enabled) return;
    let lastClock = PlaybackClock.get();
    let lastClockAt = Date.now();
    const unsubClock = PlaybackClock.subscribe(() => {
      lastClock = PlaybackClock.get();
      lastClockAt = Date.now();
    });
    let seekedAt = 0;
    // only touch the rate when it changes (each set re-applies AVPlayer.rate)
    const setRate = (r: number) => {
      if (Math.abs(player.playbackRate - r) > 0.001) player.playbackRate = r;
    };
    const tick = () => {
      const st = VideoStore.get();
      if (st.status !== 'ready') return;
      const playing = live.current.isPlaying;
      const want = playing && VideoLive.get();
      const rate = live.current.audioRate;
      const target = lastClock + (playing ? ((Date.now() - lastClockAt) / 1000) * rate : 0);
      try {
        if (!want) {
          // (no playbackRate here: on iOS setting a rate starts AVPlayer again)
          if (player.playing) player.pause();
          // a resting picture still shows the right scene
          if (Math.abs(player.currentTime - target) > 1.5 && Date.now() - seekedAt > 1500) {
            player.currentTime = target;
            seekedAt = Date.now();
          }
          return;
        }
        const dur = player.duration || 0;
        if (dur > 0 && target > dur - 0.2) {
          // the song runs past the video's end: hold the last frame
          if (player.playing) player.pause();
          return;
        }
        const drift = player.currentTime - target;
        if (Math.abs(drift) > 0.75) {
          if (Date.now() - seekedAt > 1200) {
            player.currentTime = target;
            seekedAt = Date.now();
          }
          setRate(rate);
        } else if (Math.abs(drift) > 0.12) {
          // small drift: catch up smoothly instead of a jump
          setRate(rate * (drift > 0 ? 0.94 : 1.06));
        } else {
          setRate(rate);
        }
        if (!player.playing) player.play();
      } catch {
        // player busy loading
      }
    };
    const iv = setInterval(tick, 500);
    const unsubLive = VideoLive.subscribe(tick);
    const unsubStore = VideoStore.subscribe(tick);
    tick();
    return () => {
      clearInterval(iv);
      unsubClock();
      unsubLive();
      unsubStore();
    };
  }, [enabled, player]);

  // pause / play at once when the audio does
  useEffect(() => {
    if (!enabled || VideoStore.get().status !== 'ready') return;
    try {
      if (!isPlaying) player.pause();
      else if (VideoLive.get()) player.play();
    } catch {
      // ignore
    }
  }, [isPlaying, enabled, player]);

  // ── look up the next song's video ahead of time ──
  const nextTrack = queue[queueIndex + 1];
  useEffect(() => {
    if (!enabled || !isOnline || !nextTrack) return;
    const t = setTimeout(() => {
      findMusicVideo(nextTrack).catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, [enabled, isOnline, nextTrack]);

  // web: the browser player only loads into an attached <video>, so keep a hidden 1px one
  if (Platform.OS === 'web' && enabled)
    return (
      <VideoView
        player={player}
        nativeControls={false}
        pointerEvents="none"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 }}
      />
    );
  return null;
};
