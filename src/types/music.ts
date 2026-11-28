// Core domain types for HolySic (ported from Mochy Music by realidkroo)

export type MusicSourceId =
  | 'innertube'
  | 'monochrome'
  | 'jiosaavn'
  | 'itunes'
  | 'offline'
  | 'local'
  | 'synth'
  | 'audius'
  | 'radio';

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
  /** YouTube id of the song's music video (found by the video service, or the video itself) */
  mvId?: string;
  /** Optional pre-resolved direct stream URL (e.g. AAC/FLAC/M4A) */
  streamUrl?: string;
  /** Optional synth chord recipe for offline zero-network showcase fallback */
  synthPreset?: string;
  source: MusicSourceId;
  /** Live stream (internet radio): no duration, no seeking, no lyrics/scrobbling */
  isLive?: boolean;
  qualityBadge?: string;
  genre?: string;
  releaseYear?: number;
  /** ReplayGain from the file's own tags (Local Files), in dB, and its sample peak */
  replayGainDb?: number;
  replayPeak?: number;
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
  /** every candidate failed — this only carries the diagnostics */
  failed?: boolean;
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
  /** who made it (shown as “by …”; editable, can be cleared) */
  creator?: string;
  /** pinned to the top of Library — the time it was pinned (newest pin first) */
  pinnedAt?: number;
  /** last time something was played from it (sort “Recently played”) */
  lastPlayedAt?: number;
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
  /** written without a time (lyrics editor): its start is spread between its timed neighbours */
  estimated?: boolean;
}

export interface LyricsData {
  trackId: string;
  /** LRCLib · YouLyPlus · NetEase · Kugou · Lyrics.ovh · Built-in · Local · None, or what the user
   *  typed / picked (see `origin`) */
  provider:
    | 'LRCLib'
    | 'YouLyPlus'
    | 'BetterLyrics'
    | 'NetEase'
    | 'Kugou'
    | 'Lyrics.ovh'
    | 'Built-in'
    | 'Local'
    | 'User'
    | 'None';
  /** override = chosen / written by the user; saved = the offline copy kept on the device */
  origin?: 'override' | 'saved';
  synced: boolean;
  wordSynced: boolean;
  lines: LyricLine[];
  plainText?: string;
  /** the user's own text exactly as written in the lyrics editor (lines not timed yet, order,
   *  tags) — the editor reopens on it, so nothing is lost between timing sessions */
  editText?: string;
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
  /** the user's own grouping inside Downloads ("Nhạc buồn", "Gym"…); none = ungrouped */
  folder?: string;
  /** chosen when downloading: the lyrics were kept with it (undefined = older download) */
  withLyrics?: boolean;
  /** chosen when downloading: its music video was saved too (removed along with it) */
  withMv?: boolean;
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
  /** stereo width 0..200 (100 = untouched) — native iOS DSP */
  stereoWidth?: number;
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
