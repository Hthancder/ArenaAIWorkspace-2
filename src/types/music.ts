// Core domain types for Mochy Music iOS (ported from Mochy Music by realidkroo)

export type MusicSourceId =
  'innertube' | 'monochrome' | 'jiosaavn' | 'itunes' | 'offline' | 'local' | 'synth';

export interface Track {
  id: string;
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  albumId?: string;
  artistId?: string;
  artworkUrl: string;
  durationSec: number;
  explicit?: boolean;
  isrc?: string;
  videoId?: string;
  /** Optional pre-resolved direct stream URL (e.g. AAC/FLAC/M4A) */
  streamUrl?: string;
  /** Optional synth chord recipe for offline zero-network showcase fallback */
  synthPreset?: string;
  source: MusicSourceId;
  qualityBadge?: string;
  genre?: string;
  releaseYear?: number;
}

export interface ResolvedStream {
  url: string;
  source: MusicSourceId;
  sourceLabel: string;
  qualityLabel: string;
  codec: string;
  sampleRateHz?: number;
  headers?: Record<string, string>;
  isPreview?: boolean;
  isOffline?: boolean;
  /** Key for the on-device stream file cache (Monochrome FLAC on iOS) */
  cacheKey?: string;
  /** Candidate came from Source Memory (played successfully before) */
  fromMemory?: boolean;
  /** Loudness correction reported by the source (YouTube loudnessDb, TIDAL ReplayGain), in dB */
  gainDb?: number;
  /** Sample peak (0..1+) for clipping prevention */
  peak?: number;
  diagnostics: DiagnosticStep[];
}

export interface DiagnosticStep {
  module: string;
  step: string;
  ok: boolean | null;
  detail: string;
  latencyMs?: number;
}

export interface AlbumSummary {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  year?: number;
  trackCount?: number;
  genre?: string;
  description?: string;
  tracks?: Track[];
}

export interface ArtistSummary {
  id: string;
  name: string;
  artworkUrl: string;
  genre?: string;
  subscribersLabel?: string;
  monthlyListenersLabel?: string;
  bio?: string;
  topTracks?: Track[];
  albums?: AlbumSummary[];
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  coverTint?: string;
  trackIds: string[];
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
  isSystem?: boolean;
}

export interface LyricWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface LyricLine {
  id: string;
  startSec: number;
  endSec?: number;
  text: string;
  words?: LyricWord[];
  /** Duet voice marker e.g. 'v1' | 'v2' from YouLyPlus / BetterLyrics */
  agent?: string;
  /** Background vocal line {bg} */
  isBackground?: boolean;
  romanization?: string;
}

export interface LyricsData {
  trackId: string;
  provider: 'LRCLib' | 'YouLyPlus' | 'BetterLyrics' | 'Built-in' | 'None';
  synced: boolean;
  wordSynced: boolean;
  lines: LyricLine[];
  plainText?: string;
}

export interface ListeningEvent {
  id: string;
  track: Track;
  playedAt: number;
  listenedSec: number;
}

export interface DownloadedTrackMeta {
  track: Track;
  localUri: string;
  sizeBytes: number;
  downloadedAt: number;
  qualityLabel: string;
}

export interface EqualizerBand {
  freqHz: number;
  label: string;
  gainDb: number; // -12 to +12 dB
}

export interface AudioLabSettings {
  enabled: boolean;
  presetId: string;
  bands: EqualizerBand[];
  bassBoost: number; // 0..100
  reverbMix: number; // 0..100
  eightDEnabled: boolean;
  eightDSpeedSec: number; // 4..16s rotation
  playbackRate: number; // 0.75..1.5
  preservePitch: boolean;
}

export interface ModuleServerConfig {
  url: string;
  name: string;
  builtIn: boolean;
  kind: 'streamer' | 'relay';
  lastStatus?: 'ok' | 'down' | 'unknown';
  lastCheckedAt?: number;
  lastMessage?: string;
}
