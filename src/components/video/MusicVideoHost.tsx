// The one music-video player of the app (muted; the audio engine keeps playing the sound).
//
//  • finds the playing song's music video and loads a stream the phone decodes in hardware —
//    or its saved copy (MvCache) when offline / when the copy is at least the quality asked for
//  • "Tự phát MV" off: nothing loads until the camera button asks for this song
//  • follows the audio: play / pause, seeks (with the seek's own delay measured and allowed
//    for), drift (two gentle speed steps with hysteresis, a seek if far off), holds while the
//    audio buffers; 4 checks a second while a view shows it, 1 otherwise
//  • moves only while a "live" view shows it (the player's video / ambient); everywhere else —
//    menus, the app behind the player — the picture rests on the last scene
//  • looks up the next song's video ahead of time so the audio can start from it directly

import NetInfo from '@react-native-community/netinfo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Platform } from 'react-native';
import React, { useEffect, useRef } from 'react';
import { useHolySic } from '../../context/HolySicContext';
import { PlaybackClock } from '../../services/audio/playbackClock';
import {
  useVideoState,
  videoWanted,
  VideoLive,
  VideoState,
  VideoStore,
} from '../../services/video/videoStore';
import { MvCache, SavedMv } from '../../services/video/mvCache';
import {
  findMusicVideo,
  resolveVideoStream,
  warmVideoCache,
} from '../../services/video/videoService';
import { useAppActive } from '../../services/appActivity';

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
    isBuffering,
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
    // a seek may land within 0.1 s of the target: much faster than frame-exact (no decoding from
    // the previous keyframe), and the sync loop measures where it actually landed anyway
    try {
      p.seekTolerance = { toleranceBefore: 0.1, toleranceAfter: 0.1 };
      p.bufferOptions = { preferredForwardBufferDuration: 20, waitsToMinimizeStalling: true };
    } catch {
      // not on this platform
    }
  });
  VideoStore.player = player;
  const { videoId, requested } = useVideoState();

  const live = useRef({
    isPlaying,
    isBuffering,
    resolvedStream,
    switchToVideoAudio,
    prefs,
    audioRate,
  });
  live.current = { isPlaying, isBuffering, resolvedStream, switchToVideoAudio, prefs, audioRate };
  const switched = useRef<Set<string>>(new Set());

  useEffect(() => {
    warmVideoCache();
    MvCache.ready();
  }, []);

  const enabled = videoWanted(prefs.musicVideo, currentTrack);
  const appActive = useAppActive();
  const trackId = currentTrack?.id;
  const autoPlay = prefs.videoAutoPlay !== false;
  // auto-play off: only the song the camera button asked for loads
  const asked = autoPlay || (!!trackId && requested === trackId);

  // ── find + load the video for the playing song ──
  useEffect(() => {
    let cancelled = false;
    const tr = currentTrack;
    const off = (patch: Partial<VideoState>) => {
      VideoStore.set({ synced: false, local: false, height: undefined, ...patch });
      try {
        player.pause();
      } catch {
        // not loaded
      }
    };
    if (!enabled || !tr) {
      off({ status: 'off', trackId: tr?.id ?? null, videoId: null });
      return;
    }
    if (tr.isLive || tr.source === 'radio' || tr.source === 'synth') {
      off({ status: 'none', trackId: tr.id, videoId: null });
      return;
    }
    if (!asked) {
      off({ status: 'idle', trackId: tr.id, videoId: null });
      return;
    }
    const want = live.current.prefs.videoQuality || 720;
    const open = async (
      uri: string,
      opts: { headers?: Record<string, string>; hls?: boolean },
      meta: { label: string; height: number; local: boolean }
    ) => {
      try {
        await player.replaceAsync({
          uri,
          headers: opts.headers,
          contentType: opts.hls ? 'hls' : 'progressive',
        });
      } catch {
        if (!cancelled) VideoStore.set({ status: 'error' });
        return false;
      }
      if (cancelled) return false;
      VideoStore.set({ label: meta.label, height: meta.height, local: meta.local });
      try {
        player.currentTime = PlaybackClock.get();
      } catch {
        // not ready yet; the sync loop catches up
      }
      return true;
    };
    /** the saved copy, if it may be used: offline, or at least the quality asked for */
    const savedCopy = async (m: SavedMv | undefined, online: boolean) => {
      if (!m || (online && m.height < want)) return null;
      const uri = await MvCache.playableUri(m);
      return uri ? { m, uri } : null;
    };
    (async () => {
      await MvCache.ready();
      if (cancelled) return;
      // 1) a copy saved for this song: no lookup, no network
      const direct = await savedCopy(MvCache.byTrack(tr.id), isOnline);
      if (cancelled) return;
      if (direct) {
        VideoStore.set({
          status: 'loading',
          trackId: tr.id,
          videoId: direct.m.videoId,
          synced: false,
        });
        await open(direct.uri, {}, { label: direct.m.label, height: direct.m.height, local: true });
        return;
      }
      if (!isOnline) {
        off({ status: 'offline', trackId: tr.id, videoId: null });
        return;
      }
      if (live.current.prefs.videoWifiOnly) {
        const net = await NetInfo.fetch().catch(() => null);
        if (net && net.type !== 'wifi' && net.type !== 'ethernet' && net.type !== 'unknown') {
          if (!cancelled) off({ status: 'wifi', trackId: tr.id, videoId: null });
          return;
        }
      }
      if (cancelled) return;
      VideoStore.set({
        status: 'searching',
        trackId: tr.id,
        videoId: null,
        synced: false,
        local: false,
      });
      const id = await findMusicVideo(tr).catch(() => null);
      if (cancelled) return;
      if (!id) {
        off({ status: 'none' });
        return;
      }
      VideoStore.set({ status: 'loading', videoId: id });
      // 2) the same video saved for another song (a cover, a remaster…)
      const shared = await savedCopy(MvCache.byVideo(id), true);
      if (cancelled) return;
      if (shared) {
        await open(shared.uri, {}, { label: shared.m.label, height: shared.m.height, local: true });
        return;
      }
      // 3) stream it (resolved streams are reused for an hour)
      const stream = await resolveVideoStream(id, want).catch(() => null);
      if (cancelled) return;
      if (!stream) {
        VideoStore.set({ status: 'error' });
        return;
      }
      await open(
        stream.url,
        { headers: stream.headers, hls: stream.isHls },
        { label: stream.label, height: stream.height, local: false }
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, enabled, asked, isOnline, prefs.videoQuality, prefs.videoWifiOnly]);

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

  // ── follow the audio ── (only while the app is on screen: the picture is muted and unseen
  // in the background, so it rests instead of being kept in sync)
  useEffect(() => {
    if (!enabled) return;
    if (!appActive) {
      try {
        if (player.playing) player.pause();
      } catch {
        // not loaded
      }
      return;
    }
    let lastClock = PlaybackClock.get();
    let lastClockAt = Date.now();
    const unsubClock = PlaybackClock.subscribe(() => {
      lastClock = PlaybackClock.get();
      lastClockAt = Date.now();
    });
    let seekedAt = 0;
    // how long a seek takes to show (the video keeps moving meanwhile): learned from each seek
    // and added to the next one, so it lands where the music will be, not where it was
    let seekLead = 0.15;
    let checkSeekAt = 0;
    // iOS: when one of the views sharing the player goes (the card's picture, hidden by the
    // camera button), the views left behind — the blurred background — could stop on the last
    // frame although the music went on. A fresh seek a moment later makes every remaining layer
    // draw again, and a stalled clock (time not moving while it should) is caught the same way.
    let nudgeAt = 0;
    let stallT = -1;
    let stallSince = 0;
    // speed correction: 0 none, 1 gentle (±3 %), 2 firmer (±6 %) — with hysteresis, so the rate
    // isn't flipped back and forth (each change re-applies AVPlayer.rate)
    let level = 0;
    let dir = 0;
    const setRate = (r: number) => {
      if (Math.abs(player.playbackRate - r) > 0.001) player.playbackRate = r;
    };
    const seekTo = (t: number, moving: boolean, rate: number) => {
      player.currentTime = Math.max(0, t + (moving ? seekLead * rate : 0));
      seekedAt = Date.now();
      checkSeekAt = moving ? seekedAt + 450 : 0;
      level = 0;
    };
    const tick = () => {
      const st = VideoStore.get();
      if (st.status !== 'ready') return;
      const { isPlaying: playing, isBuffering: buffering, audioRate: rate } = live.current;
      const shown = VideoLive.get();
      // nobody sees it: nothing to do (it catches up the moment a view shows it)
      if (!shown) {
        if (player.playing) player.pause();
        stallT = -1;
        return;
      }
      const moving = playing && !buffering;
      // the clock reports 4×/s; between reports the music moves on (≤ 1 s: a stalled report
      // never runs the picture ahead)
      const target =
        lastClock + (moving ? Math.min(1, (Date.now() - lastClockAt) / 1000) * rate : 0);
      try {
        if (!moving) {
          stallT = -1;
          // (no playbackRate here: on iOS setting a rate starts AVPlayer again)
          if (player.playing) player.pause();
          // a resting picture still shows the right scene
          if (Math.abs(player.currentTime - target) > 0.5 && Date.now() - seekedAt > 800)
            seekTo(target, false, rate);
          return;
        }
        const dur = player.duration || 0;
        if (dur > 0 && target > dur - 0.2) {
          // the song runs past the video's end: hold the last frame
          if (player.playing) player.pause();
          return;
        }
        const now = Date.now();
        if (nudgeAt && now >= nudgeAt) {
          nudgeAt = 0;
          seekTo(target, true, rate);
          if (!player.playing) player.play();
          return;
        }
        // the picture's clock stuck while it should run (and no seek in flight)
        const ct = player.currentTime;
        if (Math.abs(ct - stallT) > 0.05 || player.status === 'loading') {
          stallT = ct;
          stallSince = now;
        } else if (
          now - stallSince > 1600 &&
          now - seekedAt > 6000 &&
          player.status === 'readyToPlay'
        ) {
          stallSince = now;
          try {
            player.pause();
          } catch {
            // ignore
          }
          seekTo(target, true, rate);
          player.play();
          return;
        }
        const drift = player.currentTime - target;
        // where did the last seek really land? learn its delay
        if (checkSeekAt && Date.now() >= checkSeekAt) {
          checkSeekAt = 0;
          if (Math.abs(drift) < 1.5) seekLead = Math.max(0, Math.min(1, seekLead - drift * 0.6));
        }
        const ad = Math.abs(drift);
        // video still buffering after a seek: give it time instead of seeking again
        const settling = Date.now() - seekedAt < 1200 || player.status === 'loading';
        if (ad > 0.6 && !(settling && ad < 3)) {
          seekTo(target, true, rate);
          setRate(rate);
        } else {
          const wanted = ad > 0.3 ? 2 : ad > 0.12 ? 1 : 0;
          // start past 0.12 s; once correcting, keep at it (gently) until within 0.04 s
          if (level === 0 || ad < 0.04 || Math.sign(drift) !== dir) level = wanted;
          else level = Math.max(wanted, 1);
          dir = Math.sign(drift);
          const k = level === 2 ? 0.06 : level === 1 ? 0.03 : 0;
          setRate(rate * (1 - dir * k));
        }
        if (!player.playing) player.play();
      } catch {
        // player busy loading
      }
    };
    // 4×/s while the picture moves on screen, once a second otherwise
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      tick();
      const fast = VideoLive.get() && live.current.isPlaying && VideoStore.get().status === 'ready';
      timer = setTimeout(loop, fast ? 250 : 1000);
    };
    loop();
    const unsubLive = VideoLive.subscribe(tick);
    const unsubDrop = VideoLive.onDrop(() => {
      nudgeAt = Date.now() + 250;
    });
    const unsubStore = VideoStore.subscribe(tick);
    return () => {
      if (timer) clearTimeout(timer);
      unsubClock();
      unsubLive();
      unsubDrop();
      unsubStore();
    };
  }, [enabled, player, appActive]);

  // pause / play at once when the audio does (and hold while the audio buffers)
  useEffect(() => {
    if (!enabled || VideoStore.get().status !== 'ready') return;
    try {
      if (!isPlaying || isBuffering) player.pause();
      else if (VideoLive.get()) player.play();
    } catch {
      // ignore
    }
  }, [isPlaying, isBuffering, enabled, player]);

  // ── look up the next song's video ahead of time ──
  const nextTrack = queue[queueIndex + 1];
  useEffect(() => {
    if (!enabled || !autoPlay || !isOnline || !nextTrack) return;
    const t = setTimeout(() => {
      findMusicVideo(nextTrack).catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, [enabled, autoPlay, isOnline, nextTrack]);

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
