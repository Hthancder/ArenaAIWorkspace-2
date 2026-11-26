// Cross-Platform HolySic Audio Engine:
// - Native iOS/Android: expo-audio (AVPlayer background session, silent switch override, native Lock Screen & Dynamic Island controls!)
// - Web: HTML5 Audio + WebAudio 10-Band Parametric EQ, Bass Boost, Reverb & 8D Spatial Panning + MediaSession Lock Screen API

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { AudioLabSettings, Track } from '../../types/music';

export interface SpectrumStatus {
  /** live = real samples flowing; waiting = arming the tap; unsupported = can't read this stream */
  state: 'idle' | 'waiting' | 'live' | 'unsupported';
  /** hls = Apple gives no PCM for HLS streams; cors = browser blocks a cross-origin stream; tap = iOS tap failed */
  reason?: 'hls' | 'cors' | 'tap';
}

/** In-place iterative radix-2 FFT (n must be a power of two) */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

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

class HolySicAudioEngine {
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
  private loadSeq = 0;
  private nativeSub: { remove: () => void } | null = null;

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

  /**
   * Loads a stream and starts playback. Optional HTTP headers (e.g. the InnerTube iOS User-Agent)
   * are forwarded to AVURLAsset on iOS.
   */
  async loadAndPlay(
    url: string,
    track: Track,
    volume = 1.0,
    headers?: Record<string, string>
  ): Promise<void> {
    await this.ensureInitialized();
    this.loadSeq += 1;
    this.userVolume = Math.max(0, Math.min(1, volume));
    volume = this.userVolume * this.gainMultiplier;

    if (Platform.OS !== 'web') {
      await this.loadNative(url, track, volume, headers);
    } else {
      await this.loadWeb(url, track, volume);
    }
  }

  /**
   * Resolves once audio is actually progressing ('ok'), the engine reports an error ('error'),
   * a newer load supersedes this one ('superseded'), or the timeout elapses ('timeout').
   *
   * Needed because AVPlayer never surfaces AVPlayerItem failures (HTTP 403, unsupported codec,
   * data: URIs...) through expo-audio — without this the UI would spin forever.
   */
  waitUntilAudible(timeoutMs: number): Promise<'ok' | 'error' | 'timeout' | 'superseded'> {
    const seq = this.loadSeq;
    return new Promise((resolve) => {
      let done = false;
      let firstTime: number | null = null;
      const finish = (r: 'ok' | 'error' | 'timeout' | 'superseded') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(seqWatch);
        unsub();
        resolve(r);
      };
      const unsub = this.onStatus((st) => {
        if (seq !== this.loadSeq) return finish('superseded');
        if (st.error) return finish('error');
        if (st.currentTimeSec > 0) {
          if (firstTime === null) firstTime = st.currentTimeSec;
          if (st.currentTimeSec - firstTime > 0.2 || st.currentTimeSec > 0.6) finish('ok');
        }
      });
      const seqWatch = setInterval(() => {
        if (seq !== this.loadSeq) finish('superseded');
      }, 250);
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
    });
  }

  /** True when a player with a loaded source exists (false after stop() or before first load). */
  hasActiveSource(): boolean {
    return Platform.OS !== 'web' ? !!this.nativePlayer : !!this.webAudio;
  }

  /** Stops and tears down the current player (used when every stream candidate failed). */
  stop(): void {
    this.loadSeq += 1;
    if (Platform.OS !== 'web') {
      this.releaseNativePlayer();
    } else if (this.webAudio) {
      this.webAudio.pause();
      this.webAudio.removeAttribute('src');
      this.webAudio = null;
      if (this.webPollTimer) {
        clearInterval(this.webPollTimer);
        this.webPollTimer = null;
      }
    }
  }

  // ───── Spectrum visualizer (Cog) — real PCM on iOS, AnalyserNode on web ─────
  // iOS: expo-audio installs an MTAudioProcessingTap on the AVPlayerItem and hands us PCM frames;
  // we run a real FFT and fold it into 32 log-spaced bands. Apple's tap only works for
  // progressive files (MP3/AAC/M4A/FLAC, downloads, local files) — HLS streams expose no audio
  // track, so for those the status says so honestly instead of animating fake bars.
  private spectrumListeners = new Set<(bands: number[]) => void>();
  private spectrumStatusListeners = new Set<(s: SpectrumStatus) => void>();
  private spectrumStatus: SpectrumStatus = { state: 'idle' };
  private sampleSub: { remove: () => void } | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserEl: HTMLAudioElement | null = null;
  private spectrumTimer: ReturnType<typeof setInterval> | null = null;
  private tapWatchdog: ReturnType<typeof setInterval> | null = null;
  private lastSpectrumAt = 0;
  private lastSampleAt = 0;
  private tapAttempts = 0;
  private tapEnabledAt = 0;
  private nativePlaying = false;
  private currentIsHls = false;
  private srFrames = 0;
  private srSince = 0;
  private sampleRate = 44100;
  static readonly SPECTRUM_BANDS = 32;
  private static bandEdges(sr: number, n: number): [number, number][] {
    const lo = 40;
    const hi = Math.min(16000, sr / 2 - 100);
    const N = HolySicAudioEngine.SPECTRUM_BANDS;
    const out: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const f0 = lo * Math.pow(hi / lo, i / N);
      const f1 = lo * Math.pow(hi / lo, (i + 1) / N);
      const k0 = Math.max(1, Math.floor((f0 * n) / sr));
      const k1 = Math.max(k0, Math.min(n / 2 - 1, Math.ceil((f1 * n) / sr) - 1));
      out.push([k0, k1]);
    }
    return out;
  }
  /** Gentle +3 dB/octave tilt around 1 kHz so highs are visible next to the bass */
  private static tilt(i: number): number {
    const N = HolySicAudioEngine.SPECTRUM_BANDS;
    const fc = 40 * Math.pow(16000 / 40, (i + 0.5) / N);
    return 3 * Math.log2(fc / 1000);
  }

  /** Live 32-band spectrum (0..1). Sampling only runs while someone listens. */
  subscribeSpectrum(cb: (bands: number[]) => void): () => void {
    this.spectrumListeners.add(cb);
    this.updateSampling();
    return () => {
      this.spectrumListeners.delete(cb);
      this.updateSampling();
    };
  }

  /** Whether the spectrum is real right now, and if not, why. */
  subscribeSpectrumStatus(cb: (s: SpectrumStatus) => void): () => void {
    this.spectrumStatusListeners.add(cb);
    cb(this.spectrumStatus);
    return () => {
      this.spectrumStatusListeners.delete(cb);
    };
  }

  private setSpectrumStatus(next: SpectrumStatus): void {
    if (next.state === this.spectrumStatus.state && next.reason === this.spectrumStatus.reason)
      return;
    this.spectrumStatus = next;
    this.spectrumStatusListeners.forEach((l) => l(next));
  }

  private emitSpectrum(bands: number[]): void {
    this.setSpectrumStatus({ state: 'live' });
    this.spectrumListeners.forEach((l) => l(bands));
  }

  private enableNativeTap(p: AudioPlayer): void {
    try {
      if (!this.sampleSub) {
        this.sampleSub = p.addListener('audioSampleUpdate', (smp) =>
          this.onPcmSample(smp.channels)
        );
      }
      p.setAudioSamplingEnabled(true);
      this.tapEnabledAt = Date.now();
    } catch {
      /* not supported on this build */
    }
  }

  private updateSampling(): void {
    const want = this.spectrumListeners.size > 0;
    if (Platform.OS !== 'web') {
      const p = this.nativePlayer;
      if (!p) return;
      if (want && this.currentIsHls) {
        this.setSpectrumStatus({ state: 'unsupported', reason: 'hls' });
        return;
      }
      try {
        if (want && !this.sampleSub && p.isAudioSamplingSupported) {
          if (this.spectrumStatus.state !== 'live') this.setSpectrumStatus({ state: 'waiting' });
          this.enableNativeTap(p);
        } else if (!want && this.sampleSub) {
          this.sampleSub.remove();
          this.sampleSub = null;
          p.setAudioSamplingEnabled(false);
        }
      } catch {
        this.sampleSub = null;
      }
      // Watchdog: expo-audio installs the tap once at readyToPlay; if the item's audio track
      // wasn't ready yet the tap silently fails. Re-arm it a few times while music is playing.
      if (want && !this.tapWatchdog) {
        this.tapWatchdog = setInterval(() => this.checkTap(), 1000);
      } else if (!want && this.tapWatchdog) {
        clearInterval(this.tapWatchdog);
        this.tapWatchdog = null;
      }
      return;
    }
    if (want && !this.spectrumTimer) {
      this.spectrumTimer = setInterval(() => this.pollWebAnalyser(), 40);
    } else if (!want && this.spectrumTimer) {
      clearInterval(this.spectrumTimer);
      this.spectrumTimer = null;
    }
  }

  private checkTap(): void {
    const p = this.nativePlayer;
    if (!p || this.currentIsHls || !this.nativePlaying) return;
    const now = Date.now();
    if (now - this.lastSampleAt < 1500) return;
    // samples stopped / never started
    if (this.spectrumStatus.state === 'live') this.setSpectrumStatus({ state: 'waiting' });
    if (now - this.tapEnabledAt < 1600 + this.tapAttempts * 900) return;
    if (this.tapAttempts >= 5) {
      this.setSpectrumStatus({ state: 'unsupported', reason: 'tap' });
      return;
    }
    this.tapAttempts += 1;
    try {
      p.setAudioSamplingEnabled(false);
    } catch {
      /* ignore */
    }
    this.enableNativeTap(p);
  }

  private pollWebAnalyser(): void {
    const a = this.analyser;
    const ctx = this.audioCtx;
    if (!this.webAudio) return;
    if (!a || !ctx || this.analyserEl !== this.webAudio) {
      // cross-origin stream without CORS: the browser won't let us read its samples
      this.setSpectrumStatus({ state: 'unsupported', reason: 'cors' });
      return;
    }
    if (this.webAudio.paused) return;
    const bins = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(bins);
    const n = a.fftSize;
    const edges = HolySicAudioEngine.bandEdges(ctx.sampleRate, n);
    const bands = edges.map(([k0, k1], i) => {
      let m = -140;
      for (let k = k0; k <= k1; k++) if (bins[k] > m) m = bins[k];
      // AnalyserNode dB is relative to a full-scale sine of amplitude 1 (≈ +6 dB vs our FFT)
      const db = m - 6 + HolySicAudioEngine.tilt(i);
      return Math.max(0, Math.min(1, (db + 64) / 56));
    });
    this.emitSpectrum(bands);
  }

  /** Real FFT over the newest PCM frames → 32 log bands */
  private onPcmSample(channels: { frames: number[] }[]): void {
    const now = Date.now();
    if (!channels?.length || !channels[0]?.frames?.length) return;
    const a = channels[0].frames;
    const b = channels[1]?.frames;
    this.lastSampleAt = now;
    this.tapAttempts = 0;
    // estimate the real sample rate from how many frames arrive per second
    if (!this.srSince) this.srSince = now;
    this.srFrames += a.length;
    if (now - this.srSince > 2000) {
      const est = (this.srFrames * 1000) / (now - this.srSince);
      const rates = [22050, 32000, 44100, 48000, 88200, 96000];
      this.sampleRate = rates.reduce((best, r) =>
        Math.abs(r - est) < Math.abs(best - est) ? r : best
      );
      this.srFrames = 0;
      this.srSince = now;
    }
    if (now - this.lastSpectrumAt < 33) return;
    this.lastSpectrumAt = now;
    let n = 1;
    while (n * 2 <= Math.min(a.length, 4096)) n *= 2;
    if (n < 256) return;
    const off = a.length - n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = b ? (a[off + i] + b[off + i]) * 0.5 : a[off + i];
      re[i] = x * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    fftInPlace(re, im);
    const norm = n / 4; // Hann coherent gain: a full-scale sine peaks at n/4
    const edges = HolySicAudioEngine.bandEdges(this.sampleRate, n);
    const bands = edges.map(([k0, k1], i) => {
      let pow = 0;
      for (let k = k0; k <= k1; k++) {
        const m = Math.hypot(re[k], im[k]) / norm;
        if (m * m > pow) pow = m * m;
      }
      const db = 10 * Math.log10(pow + 1e-12) + HolySicAudioEngine.tilt(i);
      return Math.max(0, Math.min(1, (db + 64) / 56));
    });
    this.emitSpectrum(bands);
  }

  private releaseNativePlayer(): void {
    try {
      this.nativeSub?.remove();
    } catch {
      // ignore
    }
    this.nativeSub = null;
    try {
      this.sampleSub?.remove();
    } catch {
      // ignore
    }
    this.sampleSub = null;
    if (this.nativePlayer) {
      const old = this.nativePlayer;
      this.nativePlayer = null;
      try {
        old.pause();
      } catch {
        // ignore
      }
      try {
        old.remove();
      } catch {
        // ignore
      }
    }
  }

  private async loadNative(
    url: string,
    track: Track,
    volume: number,
    headers?: Record<string, string>
  ): Promise<void> {
    try {
      // A fresh AVPlayer per track guarantees status events never leak from the previous item.
      this.releaseNativePlayer();
      const seq = this.loadSeq;

      const source =
        headers && Object.keys(headers).length > 0 ? { uri: url, headers } : { uri: url };
      this.currentIsHls = /\.m3u8|\/manifest\/hls|hls_variant|hls_playlist/i.test(url);
      this.tapAttempts = 0;
      this.lastSampleAt = 0;
      this.nativePlaying = false;
      this.srFrames = 0;
      this.srSince = 0;
      if (this.spectrumListeners.size > 0)
        this.setSpectrumStatus(
          this.currentIsHls ? { state: 'unsupported', reason: 'hls' } : { state: 'waiting' }
        );
      const player = createAudioPlayer(source, {
        updateInterval: 250,
        keepAudioSessionActive: true,
        preferredForwardBufferDuration: 10,
      });
      this.nativePlayer = player;

      this.nativeSub = player.addListener('playbackStatusUpdate', (st) => {
        if (seq !== this.loadSeq || this.nativePlayer !== player) return;
        this.nativePlaying = !!st.playing;
        this.emit({
          isPlaying: st.playing,
          isBuffering: st.isBuffering || (!st.isLoaded && st.playing),
          currentTimeSec: st.currentTime || 0,
          durationSec: st.duration > 0 ? st.duration : track.durationSec || 0,
          didJustFinish: st.didJustFinish,
          error: st.playbackState === 'failed' ? 'Native playback failed' : null,
        });
      });

      player.volume = Math.max(0, Math.min(1, volume));
      if (this.spectrumListeners.size > 0) this.updateSampling();
      if (this.currentLab) {
        player.shouldCorrectPitch = this.currentLab.preservePitch;
        player.setPlaybackRate(
          this.currentLab.enabled ? this.currentLab.playbackRate || 1.0 : 1.0,
          'high'
        );
      }

      try {
        player.setActiveForLockScreen(
          true,
          {
            title: track.title,
            artist: track.artist,
            albumTitle: track.album || 'HolySic',
            // http covers + on-device ones (Local Files art, folder covers): MediaController loads
            // them with URLSession, which reads file:// URLs too
            artworkUrl: /^(https?|file):/.test(track.artworkUrl) ? track.artworkUrl : undefined,
          },
          {
            showSeekForward: true,
            showSeekBackward: true,
          }
        );
      } catch {
        // Lock screen metadata is best-effort
      }

      player.play();
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
      const artwork = /^(https?|blob):/.test(track.artworkUrl)
        ? [{ src: track.artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'HolySic',
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

      // Spectrum tap (read-only branch)
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      panner.connect(analyser);
      this.analyser = analyser;
      this.analyserEl = el;

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
      const durationSec = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : track.durationSec || 0;
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
      // Retry on the same element without crossOrigin if a CDN rejected anonymous CORS
      if (el.crossOrigin) {
        el.crossOrigin = null;
        el.src = url;
        el.load();
        el.play().catch(() => {});
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

  /** User volume × loudness-normalisation gain (ReplayGain-style, idea from Cog) */
  private userVolume = 1;
  private gainMultiplier = 1;

  setGainMultiplier(mult: number): void {
    this.gainMultiplier = Math.max(0.05, Math.min(1, Number.isFinite(mult) ? mult : 1));
    this.setVolume(this.userVolume);
  }

  setVolume(vol: number): void {
    this.userVolume = Math.max(0, Math.min(1, vol));
    const v = this.userVolume * this.gainMultiplier;
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

export const audioEngine = new HolySicAudioEngine();
