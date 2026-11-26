// Volume normalisation, modelled on Cog's ReplayGain handling (track gain + clipping prevention,
// falling back to a neutral level when a file has no gain data). HolySic has no decoder tap on
// AVPlayer, so it uses the loudness each source already measures:
//   • YouTube: playerConfig.audioConfig.loudnessDb (how much louder than YouTube's reference)
//   • Monochrome / TIDAL: track ReplayGain (dB) and sample peak
// AVPlayer volume can only go down (≤ 1.0), so loud masters are brought down to the level of
// quiet ones instead of boosting quiet ones above 0 dBFS — the same no-clipping rule Cog follows.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ResolvedStream, Track } from '../../types/music';

const KEY = '@holysic/loudness_v1';
/** Reference headroom: tracks at/under this correction play at full volume */
const PREAMP_DB = 6;
const MAX_ENTRIES = 1500;

let loaded = false;
let memory: Record<string, { g: number; p?: number }> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const Loudness = {
  async load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) memory = JSON.parse(raw) || {};
    } catch {
      memory = {};
    }
  },

  /** Remembers the gain so the next play (e.g. from the FLAC cache) is normalised too */
  remember(track: Track, stream: ResolvedStream): void {
    if (typeof stream.gainDb !== 'number') return;
    memory[track.id] = { g: Math.round(stream.gainDb * 100) / 100, p: stream.peak };
    const keys = Object.keys(memory);
    if (keys.length > MAX_ENTRIES)
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete memory[k];
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(memory)).catch(() => undefined);
    }, 1500);
  },

  /** Linear volume multiplier for a stream (1 = unchanged) */
  multiplier(track: Track, stream: ResolvedStream | null, enabled: boolean): number {
    if (!enabled) return 1;
    const g = typeof stream?.gainDb === 'number' ? stream.gainDb : memory[track.id]?.g;
    const peak = typeof stream?.peak === 'number' ? stream.peak : memory[track.id]?.p;
    if (typeof g !== 'number' || !Number.isFinite(g)) return 1;
    let mult = Math.pow(10, (g + PREAMP_DB) / 20);
    // clipping prevention: never let gain × peak exceed full scale
    if (typeof peak === 'number' && peak > 0) mult = Math.min(mult, 1 / peak);
    return Math.max(0.12, Math.min(1, mult));
  },

  describe(track: Track, stream: ResolvedStream | null): string | null {
    const g = typeof stream?.gainDb === 'number' ? stream.gainDb : memory[track.id]?.g;
    if (typeof g !== 'number') return null;
    return `${g >= 0 ? '+' : ''}${g.toFixed(1)} dB`;
  },
};
