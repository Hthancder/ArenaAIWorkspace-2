// Persistent Storage & Offline File Download Manager for HolySic iOS
// Uses AsyncStorage + Expo FileSystem (iOS native Document directory) + Web Cache API

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  DEFAULT_PREFERENCES,
  HolySicPreferences,
  liveLyricsEffect,
} from '../../constants/preferences';
import { DEFAULT_EQ_BANDS } from '../../data/curatedCatalog';
import {
  AudioLabSettings,
  DownloadedTrackMeta,
  ListeningEvent,
  ModuleServerConfig,
  Playlist,
  Track,
} from '../../types/music';
import { DEFAULT_MONOCHROME_SERVER } from '../providers/monochromeProvider';

const KEYS = {
  PREFS: '@holysic/preferences_v1',
  LIKED: '@holysic/liked_tracks_v1',
  PLAYLISTS: '@holysic/playlists_v1',
  HISTORY: '@holysic/history_v1',
  DOWNLOADS: '@holysic/downloads_v1',
  AUDIOLAB: '@holysic/audiolab_v1',
  MONOCHROME_SERVERS: '@holysic/monochrome_servers_v1',
  SEARCH_HISTORY: '@holysic/search_history_v1',
  SESSION: '@holysic/playback_session_v1',
};

export interface PlaybackSession {
  queue: Track[];
  index: number;
  positionSec: number;
  shuffle: boolean;
  repeat: 'OFF' | 'ALL' | 'ONE';
  savedAt: number;
}

export const DEFAULT_AUDIO_LAB: AudioLabSettings = {
  enabled: false,
  presetId: 'flat',
  bands: DEFAULT_EQ_BANDS,
  bassBoost: 0,
  reverbMix: 0,
  eightDEnabled: false,
  eightDSpeedSec: 8,
  playbackRate: 1.0,
  preservePitch: true,
  stereoWidth: 100,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export const StorageService = {
  loadPreferences: async (): Promise<HolySicPreferences> => {
    const saved = await readJson<Partial<HolySicPreferences>>(KEYS.PREFS, {});
    // modules added in an update join the saved order just before the Apple previews
    const known = DEFAULT_PREFERENCES.moduleOrder;
    let order = (saved.moduleOrder || known).filter((m) => known.includes(m));
    for (const m of known) {
      if (order.includes(m)) continue;
      const at = order.indexOf('itunes');
      order = at >= 0 ? [...order.slice(0, at), m, ...order.slice(at)] : [...order, m];
    }
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      moduleOrder: order,
      // a lyrics effect that was retired → its closest successor
      lyricsEffect: (liveLyricsEffect(saved.lyricsEffect) ||
        DEFAULT_PREFERENCES.lyricsEffect) as HolySicPreferences['lyricsEffect'],
      pipEffect: (liveLyricsEffect(saved.pipEffect) ||
        DEFAULT_PREFERENCES.pipEffect) as HolySicPreferences['pipEffect'],
      enabledModules: {
        ...DEFAULT_PREFERENCES.enabledModules,
        ...(saved.enabledModules || {}),
      },
    };
  },

  savePreferences: (prefs: HolySicPreferences) => writeJson(KEYS.PREFS, prefs),

  loadLikedTracks: () => readJson<Track[]>(KEYS.LIKED, []),
  saveLikedTracks: (tracks: Track[]) => writeJson(KEYS.LIKED, tracks),

  loadPlaylists: () => readJson<Playlist[]>(KEYS.PLAYLISTS, []),
  savePlaylists: (playlists: Playlist[]) => writeJson(KEYS.PLAYLISTS, playlists),

  loadHistory: () => readJson<ListeningEvent[]>(KEYS.HISTORY, []),
  saveHistory: (events: ListeningEvent[]) => writeJson(KEYS.HISTORY, events.slice(0, 600)),

  loadAudioLab: async (): Promise<AudioLabSettings> => {
    const saved = await readJson<Partial<AudioLabSettings>>(KEYS.AUDIOLAB, {});
    return {
      ...DEFAULT_AUDIO_LAB,
      ...saved,
      bands: saved.bands?.length === 10 ? saved.bands : DEFAULT_EQ_BANDS,
    };
  },
  saveAudioLab: (lab: AudioLabSettings) => writeJson(KEYS.AUDIOLAB, lab),

  loadMonochromeServers: async (): Promise<ModuleServerConfig[]> => {
    const saved = await readJson<ModuleServerConfig[]>(KEYS.MONOCHROME_SERVERS, []);
    if (!saved.some((s) => s.builtIn)) {
      return [DEFAULT_MONOCHROME_SERVER, ...saved];
    }
    return saved;
  },
  saveMonochromeServers: (servers: ModuleServerConfig[]) =>
    writeJson(KEYS.MONOCHROME_SERVERS, servers),

  loadSearchHistory: () => readJson<string[]>(KEYS.SEARCH_HISTORY, []),
  saveSearchHistory: (queries: string[]) => writeJson(KEYS.SEARCH_HISTORY, queries.slice(0, 15)),

  loadSession: () => readJson<PlaybackSession | null>(KEYS.SESSION, null),
  saveSession: (s: PlaybackSession) =>
    writeJson(KEYS.SESSION, {
      ...s,
      queue: s.queue.filter((t) => t.source !== 'synth').slice(0, 300),
    }),

  loadDownloads: () => readJson<Record<string, DownloadedTrackMeta>>(KEYS.DOWNLOADS, {}),
  saveDownloads: (map: Record<string, DownloadedTrackMeta>) => writeJson(KEYS.DOWNLOADS, map),

  /**
   * Downloads a resolved stream to persistent device storage:
   * - iOS Native: Paths.document/holysic-offline/{id}.m4a via File.downloadFileAsync
   * - Web: Browser Cache API ('holysic-offline-audio-v1') + ObjectURL / cached reference
   */
  downloadTrackFile: async (
    track: Track,
    streamUrl: string,
    qualityLabel: string,
    headers?: Record<string, string>
  ): Promise<DownloadedTrackMeta> => {
    const safeId = track.id.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (Platform.OS !== 'web') {
      const offlineDir = new Directory(Paths.document, 'holysic-offline');
      if (!offlineDir.exists) {
        offlineDir.create({ intermediates: true, idempotent: true });
      }
      const ext = qualityLabel.toLowerCase().includes('flac') ? 'flac' : 'm4a';
      const targetFile = new File(offlineDir, `${safeId}.${ext}`);
      const downloaded = await File.downloadFileAsync(streamUrl, targetFile, {
        idempotent: true,
        ...(headers ? { headers } : {}),
      });
      return {
        track,
        localUri: downloaded.uri,
        sizeBytes: downloaded.size || 3_400_000,
        downloadedAt: Date.now(),
        qualityLabel,
      };
    }

    // Web environment: store in CacheStorage if CORS allows, otherwise keep streamUrl reference
    let sizeBytes = 2_800_000;
    let localUri = streamUrl;
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const res = await fetch(streamUrl);
        if (res.ok) {
          const clone = res.clone();
          const blob = await res.blob();
          sizeBytes = blob.size || sizeBytes;
          const cache = await window.caches.open('holysic-offline-audio-v1');
          const cacheKey = `/__holysic_offline__/${safeId}`;
          await cache.put(cacheKey, clone);
          localUri = URL.createObjectURL(blob);
        }
      } catch {
        // Cross-origin CDN without CORS read access: bookmark direct stream URL cleanly
        localUri = streamUrl;
      }
    }

    return {
      track,
      localUri,
      sizeBytes,
      downloadedAt: Date.now(),
      qualityLabel,
    };
  },

  removeDownloadedFile: async (meta: DownloadedTrackMeta): Promise<void> => {
    if (Platform.OS !== 'web') {
      try {
        const f = new File(meta.localUri);
        if (f.exists) f.delete();
      } catch {
        // ignore
      }
    } else if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const safeId = meta.track.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const cache = await window.caches.open('holysic-offline-audio-v1');
        await cache.delete(`/__holysic_offline__/${safeId}`);
      } catch {
        // ignore
      }
    }
  },
};
