// Cross-Platform Mochy Audio Engine:
// - Native iOS/Android: expo-audio (AVPlayer background session, silent switch override, native Lock Screen & Dynamic Island controls!)
// - Web: HTML5 Audio + WebAudio 10-Band Parametric EQ, Bass Boost, Reverb & 8D Spatial Panning + MediaSession Lock Screen API

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { AudioLabSettings, Track } from '../../types/music';

export interface EngineStatus {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTimeSec: number;
  durationSec: number;
  didJustFinish: boolean;
  error: string | null;
}

type StatusCallback = (status: EngineStatus) => void;
type RemoteActionCallback = (action: 'next' | 'prev' | 'toggle') => void;

class MochyAudioEngine {
  private nativePlayer: AudioPlayer | null = null;
  private webAudio: HTMLAudioElement | null = null;
  private webPollTimer: ReturnType<typeof setInterval> | null = null;

  // WebAudio DSP nodes (active whenever CORS permits MediaElementSource)
  private audioCtx: AudioContext | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassNode: BiquadFilterNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private eightDTimer: ReturnType<typeof setInterval> | null = null;
  private dspAttachedElements = new WeakSet<HTMLAudioElement>();

  private statusListeners = new Set<StatusCallback>();
  private remoteActionListener: RemoteActionCallback | null = null;
  private currentLab: AudioLabSettings | null = null;
  private initializedMode = false;

  async ensureInitialized(): Promise<void> {
    if (this.initializedMode) return;
    this.initializedMode = true;

    if (Platform.OS !== 'web') {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
        });
      } catch {
        // ignore if simulator lacks audio hardware
      }
    }
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  onRemoteAction(cb: RemoteActionCallback): void {
    this.remoteActionListener = cb;
  }

  private emit(status: EngineStatus): void {
    this.statusListeners.forEach((cb) => cb(status));
  }

  async loadAndPlay(url: string, track: Track, volume = 1.0): Promise<void> {
    await this.ensureInitialized();

    if (Platform.OS !== 'web') {
      await this.loadNative(url, track, volume);
    } else {
      await this.loadWeb(url, track, volume);
    }
  }

  private async loadNative(url: string, track: Track, volume: number): Promise<void> {
    try {
      if (!this.nativePlayer) {
        this.nativePlayer = createAudioPlayer(url, {
          updateInterval: 200,
          keepAudioSessionActive: true,
          preferredForwardBufferDuration: 12,
        });
        this.nativePlayer.addListener('playbackStatusUpdate', (st) => {
          this.emit({
            isPlaying: st.playing,
            isBuffering: st.isBuffering,
            currentTimeSec: st.currentTime || 0,
            durationSec: st.duration > 0 ? st.duration : track.durationSec || 0,
            didJustFinish: st.didJustFinish,
            error:
              st.playbackState === 'failed' || st.playbackState === 'error'
                ? 'Native playback failed'
                : null,
          });
        });
      } else {
        this.nativePlayer.replace(url);
      }

      this.nativePlayer.volume = Math.max(0, Math.min(1, volume));
      if (this.currentLab) {
        this.nativePlayer.shouldCorrectPitch = this.currentLab.preservePitch;
        this.nativePlayer.setPlaybackRate(
          this.currentLab.playbackRate || 1.0,
          'high'
        );
      }

      this.nativePlayer.setActiveForLockScreen(
        true,
        {
          title: track.title,
          artist: track.artist,
          albumTitle: track.album || 'Mochy Music',
          artworkUrl: track.artworkUrl.startsWith('http') ? track.artworkUrl : undefined,
        },
        {
          // expo-audio SDK 55 (iOS 15.1+) exposes seek forward/backward lock-screen buttons
          showSeekForward: true,
          showSeekBackward: true,
        }
      );

      this.nativePlayer.play();
    } catch (err: any) {
      this.emit({
        isPlaying: false,
        isBuffering: false,
        currentTimeSec: 0,
        durationSec: track.durationSec || 0,
        didJustFinish: false,
        error: err?.message || 'Playback error on iOS',
      });
    }
  }

  private setupWebMediaSession(track: Track): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const artwork = track.artworkUrl.startsWith('http')
        ? [{ src: track.artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Mochy Music',
        artwork,
      });
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () =>
        this.remoteActionListener?.('prev')
      );
      navigator.mediaSession.setActionHandler('nexttrack', () =>
        this.remoteActionListener?.('next')
      );
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') this.seekTo(details.seekTime);
      });
    } catch {
      // ignore unsupported MediaSession handlers
    }
  }

  private tryAttachWebDsp(el: HTMLAudioElement): void {
    if (typeof window === 'undefined' || this.dspAttachedElements.has(el)) return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;

    try {
      if (!this.audioCtx) {
        this.audioCtx = new Ctx();
      }
      const ctx = this.audioCtx!;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaElementSource(el);
      this.dspAttachedElements.add(el);

      // Bass shelf
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 95;
      bass.gain.value = 0;
      this.bassNode = bass;

      // 10-band EQ
      const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      this.eqFilters = freqs.map((f, idx) => {
        const node = ctx.createBiquadFilter();
        node.type = idx === 0 ? 'lowshelf' : idx === freqs.length - 1 ? 'highshelf' : 'peaking';
        node.frequency.value = f;
        node.Q.value = 1.2;
        node.gain.value = 0;
        return node;
      });

      // 8D Stereo Panner
      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;
      this.pannerNode = panner;

      // Space Reverb (feedback delay network)
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const delay = ctx.createDelay(0.5);
      const feedback = ctx.createGain();
      const damp = ctx.createBiquadFilter();
      delay.delayTime.value = 0.085;
      feedback.gain.value = 0.36;
      damp.type = 'lowpass';
      damp.frequency.value = 3400;
      dry.gain.value = 1.0;
      wet.gain.value = 0.0;
      this.dryGain = dry;
      this.wetGain = wet;

      // Chain: source -> bass -> eq[0..9] -> panner -> dry/wet -> destination
      let prev: AudioNode = source;
      prev.connect(bass);
      prev = bass;
      for (const fNode of this.eqFilters) {
        prev.connect(fNode);
        prev = fNode;
      }
      prev.connect(panner);

      panner.connect(dry);
      dry.connect(ctx.destination);

      panner.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);
      damp.connect(wet);
      wet.connect(ctx.destination);

      if (this.currentLab) {
        this.applyAudioLab(this.currentLab);
      }
    } catch {
      // Ignore if already connected or restricted
    }
  }

  private async loadWeb(url: string, track: Track, volume: number): Promise<void> {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    if (this.webAudio) {
      this.webAudio.pause();
      this.webAudio.removeAttribute('src');
      this.webAudio.load();
    }
    if (this.webPollTimer) {
      clearInterval(this.webPollTimer);
      this.webPollTimer = null;
    }

    const canUseCorsDsp =
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.includes('itunes.apple.com') ||
      url.includes('mzstatic.com');

    const el = new Audio();
    if (canUseCorsDsp) {
      el.crossOrigin = 'anonymous';
    }
    el.preload = 'auto';
    el.src = url;
    el.volume = Math.max(0, Math.min(1, volume));

    if (this.currentLab) {
      el.playbackRate = this.currentLab.playbackRate || 1.0;
      (el as any).preservesPitch = this.currentLab.preservePitch;
    }

    this.webAudio = el;
    this.setupWebMediaSession(track);

    if (canUseCorsDsp) {
      this.tryAttachWebDsp(el);
    }

    const pushCurrent = (didJustFinish = false, error: string | null = null) => {
      if (this.webAudio !== el) return;
      const rawDur = el.duration;
      const durationSec =
        Number.isFinite(rawDur) && rawDur > 0 ? rawDur : track.durationSec || 0;
      this.emit({
        isPlaying: !el.paused && !el.ended,
        isBuffering: el.readyState < 2 && !el.paused,
        currentTimeSec: el.currentTime || 0,
        durationSec,
        didJustFinish,
        error,
      });
    };

    el.addEventListener('playing', () => pushCurrent(false));
    el.addEventListener('pause', () => pushCurrent(false));
    el.addEventListener('waiting', () => pushCurrent(false));
    el.addEventListener('ended', () => pushCurrent(true));
    el.addEventListener('error', () => {
      // Retry without crossOrigin if a CDN rejected anonymous CORS
      if (el.crossOrigin) {
        el.crossOrigin = null;
        const retry = new Audio(url);
        retry.volume = el.volume;
        this.webAudio = retry;
        retry.addEventListener('ended', () =>
          this.emit({
            isPlaying: false,
            isBuffering: false,
            currentTimeSec: retry.duration || 0,
            durationSec: retry.duration || track.durationSec || 0,
            didJustFinish: true,
            error: null,
          })
        );
        retry.play().catch(() => {});
        return;
      }
      pushCurrent(false, 'Audio stream unavailable');
    });

    this.webPollTimer = setInterval(() => {
      if (this.webAudio && !this.webAudio.paused) {
        pushCurrent(false);
      }
    }, 200);

    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      await el.play();
      pushCurrent(false);
    } catch {
      // Autoplay blocked until user gesture; keep ready to play
      pushCurrent(false);
    }
  }

  play(): void {
    if (Platform.OS !== 'web') {
      this.nativePlayer?.play();
    } else if (this.webAudio) {
      if (this.audioCtx?.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.webAudio.play().catch(() => {});
    }
  }

  pause(): void {
    if (Platform.OS !== 'web') {
      this.nativePlayer?.pause();
    } else {
      this.webAudio?.pause();
    }
  }

  seekTo(seconds: number): void {
    const clamped = Math.max(0, seconds);
    if (Platform.OS !== 'web') {
      this.nativePlayer?.seekTo(clamped).catch(() => {});
    } else if (this.webAudio) {
      try {
        this.webAudio.currentTime = clamped;
      } catch {
        // ignore before metadata loaded
      }
    }
  }

  setVolume(vol: number): void {
    const v = Math.max(0, Math.min(1, vol));
    if (Platform.OS !== 'web') {
      if (this.nativePlayer) this.nativePlayer.volume = v;
    } else if (this.webAudio) {
      this.webAudio.volume = v;
    }
  }

  applyAudioLab(lab: AudioLabSettings): void {
    this.currentLab = lab;
    const rate = lab.enabled ? lab.playbackRate : 1.0;

    if (Platform.OS !== 'web') {
      if (this.nativePlayer) {
        this.nativePlayer.shouldCorrectPitch = lab.preservePitch;
        this.nativePlayer.setPlaybackRate(rate, 'high');
      }
      return;
    }

    if (this.webAudio) {
      this.webAudio.playbackRate = rate;
      (this.webAudio as any).preservesPitch = lab.preservePitch;
    }

    if (this.bassNode) {
      this.bassNode.gain.value = lab.enabled ? (lab.bassBoost / 100) * 10 : 0;
    }

    if (this.eqFilters.length === 10) {
      this.eqFilters.forEach((node, idx) => {
        node.gain.value = lab.enabled ? lab.bands[idx]?.gainDb || 0 : 0;
      });
    }

    if (this.dryGain && this.wetGain) {
      const wet = lab.enabled ? (lab.reverbMix / 100) * 0.55 : 0;
      this.wetGain.gain.value = wet;
      this.dryGain.gain.value = 1 - wet * 0.25;
    }

    if (this.eightDTimer) {
      clearInterval(this.eightDTimer);
      this.eightDTimer = null;
    }

    if (lab.enabled && lab.eightDEnabled && this.pannerNode) {
      const periodMs = Math.max(3000, (lab.eightDSpeedSec || 8) * 1000);
      this.eightDTimer = setInterval(() => {
        if (!this.pannerNode) return;
        const phase = ((Date.now() % periodMs) / periodMs) * 2 * Math.PI;
        this.pannerNode.pan.value = Math.sin(phase) * 0.85;
      }, 60);
    } else if (this.pannerNode) {
      this.pannerNode.pan.value = 0;
    }
  }
}

export const audioEngine = new MochyAudioEngine();
