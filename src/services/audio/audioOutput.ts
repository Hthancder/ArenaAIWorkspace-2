// Audio output & bit-perfect signal path.
//
// iOS (IPA builds): the local HolySicAudioSession module reports the output route (speaker,
// headphones, USB DAC, Bluetooth, AirPlay) and the hardware sample rate, and asks the hardware to
// run at the song's own rate. Web / Expo Go: no route info — the checks say so honestly.

import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import type {
  HolySicAudioSessionNative,
  NativeRouteInfo,
} from '../../../modules/holysic-audio-session';
import type { ResolvedStream, Track } from '../../types/music';

let native: HolySicAudioSessionNative | null | undefined;
function mod(): HolySicAudioSessionNative | null {
  if (native !== undefined) return native;
  native = null;
  if (Platform.OS !== 'ios') return null;
  try {
    native = require('../../../modules/holysic-audio-session').HolySicAudioSessionModule ?? null;
  } catch {
    native = null;
  }
  return native ?? null;
}

export interface OutputState {
  /** the native module is in this build (IPA / dev client) */
  supported: boolean;
  route: NativeRouteInfo | null;
  /** the rate HolySic asked the hardware for (0 = none) */
  requestedRate: number;
  /** iPhone (hardware) volume 0…1 — null when this build can't read it (web / Expo Go) */
  systemVolume: number | null;
}

let state: OutputState = { supported: false, route: null, requestedRate: 0, systemVolume: null };
const subs = new Set<() => void>();
const set = (patch: Partial<OutputState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};

let started = false;
function start() {
  if (started) return;
  started = true;
  const m = mod();
  if (!m) return;
  try {
    set({ supported: true, route: m.getRoute() });
    m.addListener('onRouteChange', (route) => set({ route }));
  } catch {
    set({ supported: false });
    return;
  }
  try {
    set({ systemVolume: m.getSystemVolume() });
    m.addListener('onSystemVolume', ({ volume }) => {
      // ignore the echo of our own writes while the user is dragging
      if (Date.now() - lastVolumeWrite < 400) return;
      set({ systemVolume: volume });
    });
    // volume can change while HolySic is in the background (Control Center, other apps)
    AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      try {
        set({ systemVolume: m.getSystemVolume(), route: m.getRoute() });
      } catch {
        // ignore
      }
    });
  } catch {
    // older native build without the volume functions
  }
}

let lastVolumeWrite = 0;
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingVolume: number | null = null;
let volumeInFlight = false;
async function flushVolume() {
  const m = mod();
  if (!m || pendingVolume == null || volumeInFlight) return;
  const v = pendingVolume;
  pendingVolume = null;
  volumeInFlight = true;
  try {
    await m.setSystemVolume(v);
  } catch {
    // ignore
  }
  volumeInFlight = false;
  if (pendingVolume != null) flushVolume();
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const snapshot = () => state;

export function useAudioOutput(): OutputState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const AudioOutput = {
  /** The in-app slider can move the real iPhone volume (IPA builds) */
  hasSystemVolume(): boolean {
    start();
    return state.systemVolume != null;
  },

  /**
   * Set the iPhone volume. The UI updates at once; native writes are coalesced (one in flight,
   * the latest value wins) so a fast drag stays smooth.
   */
  setSystemVolume(v: number) {
    const value = Math.max(0, Math.min(1, v));
    lastVolumeWrite = Date.now();
    set({ systemVolume: value });
    pendingVolume = value;
    if (volumeTimer) return;
    volumeTimer = setTimeout(() => {
      volumeTimer = null;
      flushVolume();
    }, 16);
  },

  /** Native AirPlay / Bluetooth output picker. false = not available in this build */
  async showRoutePicker(): Promise<boolean> {
    const m = mod();
    if (!m) return false;
    try {
      return await m.showRoutePicker();
    } catch {
      return false;
    }
  },

  /** Ask the hardware to run at the song's sample rate (USB DACs follow; built-in stays 48 kHz) */
  async matchSampleRate(rateHz: number | undefined): Promise<void> {
    start();
    const m = mod();
    if (!m || !rateHz || rateHz < 8000) return;
    if (state.requestedRate === rateHz && state.route?.sampleRate === rateHz) return;
    try {
      const route = await m.setPreferredSampleRate(rateHz);
      set({ route, requestedRate: rateHz });
      // DACs switch clocks asynchronously — read the route again once it has settled
      setTimeout(() => {
        try {
          set({ route: m.getRoute() });
        } catch {
          // ignore
        }
      }, 700);
    } catch {
      // ignore
    }
  },

  /** Back to the rate the system used before (bit-perfect switched off) */
  async reset(): Promise<void> {
    const m = mod();
    if (!m || !state.requestedRate) return;
    try {
      const route = await m.resetPreferredSampleRate();
      set({ route, requestedRate: 0 });
    } catch {
      set({ requestedRate: 0 });
    }
  },
};

// ───────── Source facts ─────────

const LOSSLESS = /\b(FLAC|ALAC|WAV|WAVE|AIFF?|PCM|Lossless|Hi-?Res)\b/i;
const LOSSY = /\b(MP3|AAC|M4A|OPUS|OGG|Vorbis|HLS|kbps|InnerTube)\b/i;

export interface SourceFacts {
  label: string;
  lossless: boolean | null;
  rateHz?: number;
}

/** Codec / losslessness / sample rate of what is playing, from the stream and the song's badge */
export function sourceFacts(
  track: Track | null,
  stream: ResolvedStream | null,
  measuredRate?: number
): SourceFacts {
  const text = [stream?.codec, stream?.qualityLabel, track?.qualityBadge]
    .filter((x) => x && x !== 'Local')
    .join(' · ');
  const lossless = LOSSLESS.test(text) ? true : LOSSY.test(text) ? false : null;
  const m = /(\d+(?:[.,]\d+)?)\s*kHz/i.exec(text);
  const fromText = m ? Math.round(parseFloat(m[1].replace(',', '.')) * 1000) : undefined;
  const rateHz = stream?.sampleRateHz || fromText || measuredRate || undefined;
  const label =
    (stream?.codec && stream.codec !== 'Local' ? stream.codec : '') ||
    (track?.qualityBadge || '').split(' · ')[0] ||
    stream?.qualityLabel ||
    '—';
  return { label, lossless, rateHz };
}

// ───────── Signal path ─────────

export type CheckLevel = 'ok' | 'warn' | 'bad' | 'info';
export interface PathCheck {
  key: 'source' | 'dsp' | 'volume' | 'output';
  level: CheckLevel;
  title: string;
  detail: string;
}

const khz = (hz?: number) =>
  hz ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1).replace('.', ',')} kHz` : '?';

const BLUETOOTH = /^Bluetooth/i;
const DAC_PORTS = /^(USBAudio|LineOut|HDMIOutput|CarAudio)$/i;

/**
 * What stands between the file and the ears when bit-perfect is on. `perfect` = nothing touches
 * the samples (lossless source, no DSP, unity gain, output at the source rate on a wired DAC).
 */
export function signalPath(opts: {
  vi: boolean;
  bitPerfect: boolean;
  source: SourceFacts;
  output: OutputState;
  web: boolean;
}): { checks: PathCheck[]; perfect: boolean } {
  const { vi, bitPerfect, source, output, web } = opts;
  const checks: PathCheck[] = [];

  // 1. source
  checks.push({
    key: 'source',
    level: source.lossless === true ? 'ok' : source.lossless === false ? 'warn' : 'info',
    title: vi ? 'Nguồn' : 'Source',
    detail:
      source.lossless === true
        ? `${source.label}${source.rateHz ? ` · ${khz(source.rateHz)}` : ''} · ${vi ? 'lossless' : 'lossless'}`
        : source.lossless === false
          ? vi
            ? `${source.label} là định dạng nén — phát nguyên vẹn nhưng không lossless`
            : `${source.label} is lossy — played untouched, but not lossless`
          : vi
            ? 'Chưa rõ định dạng'
            : 'Format unknown',
  });

  // 2. processing
  checks.push({
    key: 'dsp',
    level: bitPerfect ? 'ok' : 'bad',
    title: vi ? 'Xử lý' : 'Processing',
    detail: bitPerfect
      ? vi
        ? 'Không EQ · không chuẩn hoá · không crossfade · tốc độ 1×'
        : 'No EQ · no normalisation · no crossfade · 1× speed'
      : vi
        ? 'EQ, chuẩn hoá âm lượng, crossfade có thể đổi tín hiệu'
        : 'EQ, normalisation and crossfade may alter the signal',
  });

  // 3. software volume
  checks.push({
    key: 'volume',
    level: bitPerfect ? 'ok' : 'warn',
    title: vi ? 'Âm lượng phần mềm' : 'Software volume',
    detail: bitPerfect
      ? vi
        ? 'Cố định 100 % — chỉnh bằng nút âm lượng / DAC'
        : 'Fixed at 100 % — use the volume buttons / DAC'
      : vi
        ? 'Thanh âm lượng trong app nhân tín hiệu'
        : 'The in-app slider scales the samples',
  });

  // 4. output
  const port = output.route?.outputs?.[0];
  const hw = output.route?.sampleRate || 0;
  const matches = !!source.rateHz && !!hw && Math.abs(hw - source.rateHz) < 1;
  let out: PathCheck;
  if (web) {
    out = {
      key: 'output',
      level: 'info',
      title: vi ? 'Đầu ra' : 'Output',
      detail: vi
        ? 'Trình duyệt tự trộn âm ra hệ thống — bit-perfect thật cần app iOS'
        : 'The browser mixes into the system — true bit-perfect needs the iOS app',
    };
  } else if (!output.supported || !port) {
    out = {
      key: 'output',
      level: 'info',
      title: vi ? 'Đầu ra' : 'Output',
      detail: vi
        ? 'Chưa đọc được thiết bị đầu ra (cần bản IPA, không có trong Expo Go)'
        : 'Output route unavailable (needs the IPA build, not Expo Go)',
    };
  } else if (BLUETOOTH.test(port.type)) {
    out = {
      key: 'output',
      level: 'bad',
      title: port.name,
      detail: vi
        ? 'Bluetooth luôn nén lại (AAC/SBC) — không thể bit-perfect, hãy dùng DAC có dây'
        : 'Bluetooth always re-encodes (AAC/SBC) — use a wired DAC for bit-perfect',
    };
  } else if (/^AirPlay$/i.test(port.type)) {
    out = {
      key: 'output',
      level: 'warn',
      title: port.name,
      detail: vi
        ? `AirPlay truyền ALAC 44,1 kHz${source.rateHz && source.rateHz !== 44100 ? ' — bài này sẽ bị đổi tần số' : ''}`
        : `AirPlay sends ALAC at 44.1 kHz${source.rateHz && source.rateHz !== 44100 ? ' — this song gets resampled' : ''}`,
    };
  } else if (DAC_PORTS.test(port.type)) {
    out = {
      key: 'output',
      level: matches ? 'ok' : 'warn',
      title: port.name,
      detail: matches
        ? vi
          ? `DAC chạy đúng ${khz(hw)} như bài — không đổi tần số`
          : `DAC runs at ${khz(hw)}, same as the song — no resampling`
        : vi
          ? `DAC đang ở ${khz(hw)}, bài ${khz(source.rateHz)} — DAC không nhận tần số này, iOS đổi tần số`
          : `DAC at ${khz(hw)}, song ${khz(source.rateHz)} — the DAC refused that rate, iOS resamples`,
    };
  } else {
    // built-in speaker / receiver / Lightning-USB-C headphone adapter: fixed hardware rate
    out = {
      key: 'output',
      level: matches ? 'ok' : 'warn',
      title: port.name,
      detail: matches
        ? vi
          ? `Phần cứng chạy ${khz(hw)} đúng như bài`
          : `Hardware at ${khz(hw)}, same as the song`
        : vi
          ? `Phần cứng cố định ${khz(hw)} — iOS đổi ${khz(source.rateHz)} → ${khz(hw)}. Cắm DAC USB để bit-perfect`
          : `Hardware fixed at ${khz(hw)} — iOS resamples ${khz(source.rateHz)} → ${khz(hw)}. Use a USB DAC`,
    };
  }
  checks.push(out);

  const perfect =
    bitPerfect &&
    source.lossless === true &&
    out.level === 'ok' &&
    checks.every((c) => c.level === 'ok');
  return { checks, perfect };
}
