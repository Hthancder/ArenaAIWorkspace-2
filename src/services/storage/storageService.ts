// Persistent Storage & Offline File Download Manager for Mochy Music iOS
// Uses AsyncStorage + Expo FileSystem (iOS native Document directory) + Web Cache API

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { DEFAULT_PREFERENCES, MochyPreferences } from '../../constants/preferences';
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
  PREFS: '@mochy/preferences_v1',
  LIKED: '@mochy/liked_tracks_v1',
  PLAYLISTS: '@mochy/playlists_v1',
  HISTORY: '@mochy/history_v1',
  DOWNLOADS: '@mochy/downloads_v1',
  AUDIOLAB: '@mochy/audiolab_v1',
  MONOCHROME_SERVERS: '@mochy/monochrome_servers_v1',
  SEARCH_HISTORY: '@mochy/search_history_v1',
};

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
  loadPreferences: async (): Promise<MochyPreferences> => {
    const saved = await readJson<Partial<MochyPreferences>>(KEYS.PREFS, {});
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      enabledModules: {
        ...DEFAULT_PREFERENCES.enabledModules,
        ...(saved.enabledModules || {}),
      },
    };
  },

  savePreferences: (prefs: MochyPreferences) => writeJson(KEYS.PREFS, prefs),

  loadLikedTracks: () => readJson<Track[]>(KEYS.LIKED, []),
  saveLikedTracks: (tracks: Track[]) => writeJson(KEYS.LIKED, tracks),

  loadPlaylists: () => readJson<Playlist[]>(KEYS.PLAYLISTS, []),
  savePlaylists: (playlists: Playlist[]) => writeJson(KEYS.PLAYLISTS, playlists),

  loadHistory: () => readJson<ListeningEvent[]>(KEYS.HISTORY, []),
  saveHistory: (events: ListeningEvent[]) => writeJson(KEYS.HISTORY, events.slice(0, 250)),

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

  loadDownloads: () => readJson<Record<string, DownloadedTrackMeta>>(KEYS.DOWNLOADS, {}),
  saveDownloads: (map: Record<string, DownloadedTrackMeta>) => writeJson(KEYS.DOWNLOADS, map),

  /**
   * Downloads a resolved stream to persistent device storage:
   * - iOS Native: Paths.document/mochy-offline/{id}.m4a via File.downloadFileAsync
   * - Web: Browser Cache API ('mochy-offline-audio-v1') + ObjectURL / cached reference
   */
  downloadTrackFile: async (
    track: Track,
    streamUrl: string,
    qualityLabel: string,
    headers?: Record<string, string>
  ): Promise<DownloadedTrackMeta> => {
    const safeId = track.id.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (Platform.OS !== 'web') {
      const offlineDir = new Directory(Paths.document, 'mochy-offline');
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
          const cache = await window.caches.open('mochy-offline-audio-v1');
          const cacheKey = `/__mochy_offline__/${safeId}`;
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
        const cache = await window.caches.open('mochy-offline-audio-v1');
        await cache.delete(`/__mochy_offline__/${safeId}`);
      } catch {
        // ignore
      }
    }
  },
};
