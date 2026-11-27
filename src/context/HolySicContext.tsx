// Global Reactive State & Playback Controller for HolySic iOS

import * as Haptics from 'expo-haptics';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import { resolveScheme } from '../theme/ui';
import * as Battery from 'expo-battery';
import {
  DEFAULT_PREFERENCES,
  MainTab,
  HolySicPreferences,
  RepeatMode,
} from '../constants/preferences';
import {
  ArtworkPalette,
  buildArtworkPalette,
  buildPaletteFromArtColors,
  hexToHue,
  paletteForLightUi,
} from '../constants/theme';
import {
  ArtColors,
  cachedArtworkColors,
  extractArtworkColors,
} from '../services/artwork/artworkColors';
import { fetchTopSongs } from '../services/discovery/chartsService';
import {
  fetchSpotifyEntity,
  fetchYouTubePlaylist,
  matchTextItems,
  parseMusicLink,
  parseTextList,
  TextItem,
  youtubeVideoTrack,
} from '../services/import/linkImport';
import {
  BackupPreview,
  buildBackup,
  exportBackupFile,
  filterBlacklisted,
  isBlacklisted,
  LibraryBackup,
  mergeLibrary,
  parseBackup,
  pickBackupFile,
  previewBackup,
  rebaseDocumentUri,
} from '../services/library/libraryTools';
import { Loudness } from '../services/audio/loudness';
import { ScrobbleSettings, Scrobbler } from '../services/scrobble/scrobbler';
import { useConnectivity } from '../services/net/connectivity';
import { fetchNonMusicSegments, segmentAt } from '../services/discovery/sponsorBlock';
import { registerStationClick, searchStations } from '../services/discovery/radioBrowser';
import { searchAudiusTracks } from '../services/providers/audiusProvider';
import { exportDownloadToFiles, shareTrack as shareTrackSheet } from '../services/share/shareTools';
import { AUTO_EQ_PRESETS, OFFLINE_SHOWCASE_TRACKS } from '../data/curatedCatalog';
import { audioEngine } from '../services/audio/audioEngine';
import { StreamFileCache } from '../services/audio/streamFileCache';
import { loadLyrics } from '../services/lyrics/lyricsStore';
import {
  fetchInnerTubeSuggestions,
  refreshRemoteStreamClients,
  searchInnerTubeTracks,
} from '../services/providers/innertubeProvider';
import {
  fetchAlbumDetails,
  fetchArtistDetails,
  searchItunesAlbums,
  searchItunesTracks,
} from '../services/providers/itunesProvider';
import { searchJioSaavnTracks } from '../services/providers/jiosaavnProvider';
import {
  DEFAULT_MONOCHROME_SERVER,
  searchMonochromeCatalog,
  verifyMonochromeServer,
} from '../services/providers/monochromeProvider';
import { SourceMemory } from '../services/providers/sourceMemory';
import { resolvePlayableStream } from '../services/providers/streamResolver';
import { createStreamCandidateQueue } from '../services/providers/streamResolver';
import { AudioOutput, sourceFacts } from '../services/audio/audioOutput';
import { DEFAULT_AUDIO_LAB, StorageService } from '../services/storage/storageService';
import { PlaybackClock } from '../services/audio/playbackClock';
import { SleepClock } from '../services/audio/sleepClock';
import { peekMusicVideo, videoHitToTrack } from '../services/video/videoService';
import { searchYouTubeVideos } from '../services/providers/innertubeProvider';
import {
  AlbumSummary,
  ArtistSummary,
  AudioLabSettings,
  DiagnosticStep,
  DownloadedTrackMeta,
  ListeningEvent,
  LyricsData,
  ModuleServerConfig,
  MusicSourceId,
  Playlist,
  ResolvedStream,
  Track,
} from '../types/music';
import { isLocalTrack, LocalLibrary, taggedAlbumOf } from '../services/local/localLibrary';
import { perfCount } from '../services/perfProbe';
import { runLyricClock } from '../services/lyrics/lyricClock';
import { ToastStore } from '../services/ui/toastStore';

export type CollectionTarget =
  | { kind: 'album'; id: string; summary?: AlbumSummary }
  | { kind: 'artist'; id: string; name: string; summary?: ArtistSummary }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'liked' }
  | { kind: 'offline' };

export type LinkResult =
  | { kind: 'played'; title: string }
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'none'; message: string };

/** Features merged from Spotube, OpenSpot Music, Musike and Cog (see NOTICE) */
/** search source chips: a catalogue, or YouTube music videos */
export type SearchFilter = 'all' | MusicSourceId | 'video';

interface HolySicExtras {
  isOnline: boolean;
  /** saved settings are loaded — until then the UI waits (no first-run screen / theme flash) */
  prefsReady: boolean;
  importSheet: { mode: 'link' | 'list'; text: string } | null;
  openImport: (mode: 'link' | 'list', text?: string) => void;
  closeImport: () => void;
  chartsSheet: { genre: number | null } | null;
  openCharts: (genre?: number | null) => void;
  /** Live radio browser (Radio Browser directory) */
  radioOpen: boolean;
  openRadio: () => void;
  closeRadio: () => void;
  /** Saved radio stations */
  isFavoriteStation: (id: string) => boolean;
  toggleFavoriteStation: (station: Track) => void;
  closeCharts: () => void;
  /** Charts by country & genre (OpenSpot trending + Musike genre browse) */
  fetchChart: (country: string, genreId: number | null) => Promise<Track[]>;
  /** Paste a link: YouTube video plays; YouTube / Spotify playlist or album becomes a playlist */
  openMusicLink: (
    text: string,
    onProgress?: (done: number, total: number) => void
  ) => Promise<LinkResult>;
  /** "Search a list" (Musike): best match per line, returns tracks for review */
  matchSongList: (
    raw: string | TextItem[],
    onProgress?: (done: number, total: number) => void
  ) => Promise<Track[]>;
  savePlaylistFromTracks: (
    name: string,
    tracks: Track[],
    description?: string,
    coverUrl?: string
  ) => Playlist;
  searchSuggestions: (q: string) => Promise<string[]>;
  // multi-select bulk actions (Musike)
  addTracksToPlaylist: (playlistId: string, tracks: Track[]) => void;
  likeTracks: (tracks: Track[]) => void;
  queueTracks: (tracks: Track[], playNext?: boolean) => void;
  removeTracksFromPlaylist: (playlistId: string, trackIds: string[]) => void;
  /** rename / describe / re-cover a playlist (coverUrl null = back to the first song's cover) */
  updatePlaylist: (
    id: string,
    patch: { name?: string; description?: string; coverUrl?: string | null; tracks?: Track[] }
  ) => void;
  /** move one song inside a playlist */
  movePlaylistTrack: (id: string, from: number, to: number) => void;
  /** put downloads in one of your Downloads folders (null = take them out) */
  setDownloadsFolder: (trackIds: string[], folder: string | null) => void;
  /** music video found for the playing song: take the audio from that video (picture in sync) */
  switchToVideoAudio: (mvId: string) => void;
  /** delete several downloads at once */
  removeDownloads: (trackIds: string[]) => Promise<void>;
  /** turn downloads into Local Files in a folder (likes, playlists and history follow) */
  moveDownloadsToLocal: (trackIds: string[], dir: string) => Promise<number>;
  // blacklist (Spotube)
  isBlocked: (track: Track) => boolean;
  blockTrack: (track: Track) => void;
  blockArtist: (name: string) => void;
  unblockTrack: (id: string) => void;
  unblockArtist: (name: string) => void;
  // backup (Musike)
  exportLibrary: () => Promise<void>;
  pickLibraryBackup: () => Promise<{ backup: LibraryBackup; preview: BackupPreview } | null>;
  applyLibraryBackup: (
    backup: LibraryBackup,
    mode: 'merge' | 'replace',
    includeSettings: boolean
  ) => void;
  // Files app (Cog)
  importLocalFiles: () => Promise<number>;
  // scrobbling (Cog / Spotube)
  scrobble: ScrobbleSettings;
  connectLastfm: (
    apiKey: string,
    secret: string,
    user: string,
    password: string
  ) => Promise<string>;
  connectListenBrainz: (token: string) => Promise<string>;
  disconnectScrobbler: (service: 'lastfm' | 'listenbrainz') => Promise<void>;
  setScrobbleEnabled: (enabled: boolean) => void;
  // playback extras
  seekBy: (deltaSec: number) => void;
  loudnessLabel: string | null;
}

interface HolySicContextValue extends HolySicExtras {
  // Navigation & UI overlays
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
  collectionTarget: CollectionTarget | null;
  openCollection: (target: CollectionTarget | null) => void;
  isPlayerOpen: boolean;
  setIsPlayerOpen: (open: boolean) => void;
  isAudioLabOpen: boolean;
  setIsAudioLabOpen: (open: boolean) => void;
  isRecapOpen: boolean;
  setIsRecapOpen: (open: boolean) => void;
  actionTrack: Track | null;
  setActionTrack: (track: Track | null) => void;
  showToast: (msg: string) => void;

  // Preferences & Theme
  prefs: HolySicPreferences;
  updatePrefs: (patch: Partial<HolySicPreferences>) => void;
  palette: ArtworkPalette;
  /** the palette tuned for dark surfaces (full player, lyrics, Recap) whatever the UI scheme */
  darkPalette: ArtworkPalette;
  /** Real colours sampled from the current cover (null until read / unreadable) */
  artColors: ArtColors | null;
  /** Ambient light state: strength 0..1 (0 = off), breathing on/off, spill behind mini player */
  ambient: {
    level: number;
    breathing: boolean;
    spill: boolean;
    /** iOS Low Power Mode — the light is dimmed and steady to save GPU */
    lowPower: boolean;
    /** Accessibility › Reduce Motion — no zoom / scale, opacity-only breathing */
    reduceMotion: boolean;
  };

  // Discovery Feeds & Search
  quickPicks: Track[];
  vnTrending: Track[];
  globalTrending: Track[];
  featuredAlbums: AlbumSummary[];
  isLoadingHome: boolean;
  refreshHomeFeeds: () => Promise<void>;
  searchTracks: (
    query: string,
    sourceFilter?: SearchFilter
  ) => Promise<{ tracks: Track[]; albums: AlbumSummary[] }>;
  searchHistory: string[];
  addSearchHistory: (q: string) => void;
  clearSearchHistory: () => void;

  // Playback & Queue
  currentTrack: Track | null;
  resolvedStream: ResolvedStream | null;
  isPlaying: boolean;
  isBuffering: boolean;
  durationSec: number;
  volume: number;
  queue: Track[];
  queueIndex: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
  togglePlay: () => void;
  playNext: () => void;
  playPrevious: () => void;
  seekTo: (sec: number) => void;
  setVolume: (vol: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track, playNext?: boolean) => void;
  removeFromQueue: (index: number) => void;
  /** Reorder the queue (Spotube / Musike); the playing song keeps playing */
  moveInQueue: (from: number, to: number) => void;
  /** Remove every song after the current one */
  clearUpcoming: () => void;
  jumpToQueueIndex: (index: number) => void;
  shareTrack: (track: Track) => Promise<void>;
  exportDownload: (trackId: string) => Promise<void>;
  startInstantMix: (seedQuery?: string) => Promise<void>;

  // Lyrics
  lyrics: LyricsData | null;
  isLoadingLyrics: boolean;
  /** Search the lyrics providers again for the current song (after a miss / offline) */
  reloadLyrics: () => void;
  /** Lyrics delay for the current song, seconds */
  lyricsOffsetSec: number;
  nudgeLyricsOffset: (deltaMs: number | 'reset') => void;

  // Sleep Timer
  /** a minutes countdown is running (the seconds left: useSleepRemaining()) */
  sleepActive: boolean;
  sleepEndOfTrack: boolean;
  setSleepTimer: (minutes: number | 'end_of_track' | null) => void;

  // Library, Likes, Playlists, Offline & History
  likedTracks: Track[];
  isLiked: (trackId: string) => boolean;
  toggleLike: (track: Track) => void;
  playlists: Playlist[];
  createPlaylist: (name: string, description?: string) => Playlist;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  importPlaylistText: (name: string, rawText: string) => Promise<Playlist | null>;
  downloads: Record<string, DownloadedTrackMeta>;
  downloadingIds: Record<string, boolean>;
  downloadTrack: (track: Track) => Promise<void>;
  removeDownload: (trackId: string) => Promise<void>;
  history: ListeningEvent[];

  // Audio Lab & Source Modules
  audioLab: AudioLabSettings;
  updateAudioLab: (patch: Partial<AudioLabSettings>) => void;
  applyEqPreset: (presetId: string) => void;
  monochromeServers: ModuleServerConfig[];
  addMonochromeServer: (url: string, kind: 'streamer' | 'relay') => Promise<boolean>;
  removeMonochromeServer: (url: string) => void;
  verifyAllServers: () => Promise<void>;

  // Haptics helper & detail fetchers
  haptic: (kind?: 'light' | 'medium' | 'selection') => void;
  loadAlbumFull: (id: string) => Promise<AlbumSummary | null>;
  loadArtistFull: (idOrName: string) => Promise<ArtistSummary | null>;
}

const HolySicContext = createContext<HolySicContextValue | null>(null);

/** Settings › Haptics: off · subtle (selection ticks only) · full */
let hapticsMode: 'off' | 'subtle' | 'full' = 'full';
export function triggerHaptic(kind: 'light' | 'medium' | 'selection' = 'light'): void {
  if (Platform.OS === 'web' || hapticsMode === 'off') return;
  try {
    if (kind === 'selection' || hapticsMode === 'subtle') {
      Haptics.selectionAsync();
    } else if (kind === 'medium') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // ignore
  }
}

/** Next song simply continues the same album (crossfade would break a gapless transition) */
function continuesAlbum(cur: Track, next: Track | undefined): boolean {
  if (!next) return false;
  const a = taggedAlbumOf(cur);
  if (!a || a !== taggedAlbumOf(next)) return false;
  return next.artist === cur.artist || next.source === cur.source;
}

export const HolySicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  perfCount('render:Provider');
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [collectionTarget, setCollectionTarget] = useState<CollectionTarget | null>(null);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isAudioLabOpen, setIsAudioLabOpen] = useState(false);
  const [isRecapOpen, setIsRecapOpen] = useState(false);
  const [actionTrack, setActionTrack] = useState<Track | null>(null);

  const [prefs, setPrefs] = useState<HolySicPreferences>(DEFAULT_PREFERENCES);
  const [quickPicks, setQuickPicks] = useState<Track[]>(OFFLINE_SHOWCASE_TRACKS);
  const [vnTrending, setVnTrending] = useState<Track[]>(OFFLINE_SHOWCASE_TRACKS);
  const [globalTrending, setGlobalTrending] = useState<Track[]>(OFFLINE_SHOWCASE_TRACKS);
  const [featuredAlbums, setFeaturedAlbums] = useState<AlbumSummary[]>([]);
  const [isLoadingHome, setIsLoadingHome] = useState(true);
  const [searchHistory, setSearchHistory] = useState<string[]>([
    'tlinh',
    'Sơn Tùng M-TP',
    'Vũ.',
    'The Weeknd',
    'YOASOBI',
  ]);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(OFFLINE_SHOWCASE_TRACKS[0]);
  const [resolvedStream, setResolvedStream] = useState<ResolvedStream | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  // the position lives in PlaybackClock (not React state): see services/audio/playbackClock.ts
  const setPositionSec = PlaybackClock.set;
  const [durationSec, setDurationSec] = useState(OFFLINE_SHOWCASE_TRACKS[0].durationSec);
  const [volume, setVolumeState] = useState(0.9);
  const [queue, setQueue] = useState<Track[]>(OFFLINE_SHOWCASE_TRACKS);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('OFF');

  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [lyricsAttempt, setLyricsAttempt] = useState(0);
  const reloadLyrics = useCallback(() => setLyricsAttempt((n) => n + 1), []);

  const [sleepActive, setSleepActive] = useState(false);
  const sleepEndAtRef = useRef<number | null>(null);
  const [sleepEndOfTrack, setSleepEndOfTrack] = useState(false);

  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadedTrackMeta>>({});
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<ListeningEvent[]>([]);
  const [audioLab, setAudioLab] = useState<AudioLabSettings>(DEFAULT_AUDIO_LAB);
  const [monochromeServers, setMonochromeServers] = useState<ModuleServerConfig[]>([
    DEFAULT_MONOCHROME_SERVER,
  ]);

  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const repeatRef = useRef(repeatMode);
  const shuffleRef = useRef(shuffle);
  const sleepEndTrackRef = useRef(sleepEndOfTrack);
  const prefsRef = useRef(prefs);
  const serversRef = useRef(monochromeServers);
  const downloadsRef = useRef(downloads);
  const volumeRef = useRef(volume);
  const resumeAtRef = useRef(0);
  const sessionRestoredRef = useRef(false);
  const hydratedRef = useRef(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const prefsHydratedRef = useRef(false);
  /** the saved settings have been read (or failed to): updatePrefs may save */
  const prefsLoadedRef = useRef(false);
  const pendingPrefsRef = useRef<Partial<HolySicPreferences> | null>(null);
  const adoptLoadedPrefs = useCallback((loaded: HolySicPreferences) => {
    const pending = pendingPrefsRef.current;
    pendingPrefsRef.current = null;
    prefsLoadedRef.current = true;
    if (!pending) return loaded;
    const merged = { ...loaded, ...pending };
    StorageService.savePreferences(merged).catch(() => undefined);
    return merged;
  }, []);
  const [scrobbleState, setScrobbleState] = useState<ScrobbleSettings>(Scrobbler.get());
  /** Listening tracker for scrobbles: wall-clock listened seconds of the current play */
  const playLogRef = useRef<{
    track: Track;
    startedAt: number;
    listened: number;
    lastPos: number;
    scrobbled: boolean;
    /** History event this play writes its REAL listened time into (Recap minutes) */
    eventId?: string;
    flushed?: number;
  } | null>(null);
  // Local Files moved/renamed in the app → keep likes, playlists, history and queue pointing at them
  const applyTrackRemap = useCallback((map: Record<string, Track>) => {
    if (!Object.keys(map).length) return;
    const fix = (t: Track) => map[t.id] || t;
    setLikedTracks((prev) => {
      if (!prev.some((t) => map[t.id])) return prev;
      const next = prev.map(fix);
      StorageService.saveLikedTracks(next);
      return next;
    });
    setPlaylists((prev) => {
      if (!prev.some((pl) => pl.tracks.some((t) => map[t.id]))) return prev;
      const next = prev.map((pl) =>
        pl.tracks.some((t) => map[t.id])
          ? {
              ...pl,
              tracks: pl.tracks.map(fix),
              trackIds: pl.trackIds.map((id) => map[id]?.id || id),
            }
          : pl
      );
      StorageService.savePlaylists(next);
      return next;
    });
    setHistory((prev) => {
      if (!prev.some((e) => map[e.track.id])) return prev;
      const next = prev.map((e) => (map[e.track.id] ? { ...e, track: fix(e.track) } : e));
      StorageService.saveHistory(next);
      return next;
    });
    setQueue((prev) => (prev.some((t) => map[t.id]) ? prev.map(fix) : prev));
  }, []);
  useEffect(() => LocalLibrary.onRemap(applyTrackRemap), [applyTrackRemap]);

  /** Write the real listened seconds of the current play into its history event */
  const flushListenTime = useCallback(() => {
    const log = playLogRef.current;
    if (!log?.eventId) return;
    const sec = Math.round(log.listened);
    if (sec === log.flushed) return;
    log.flushed = sec;
    const id = log.eventId;
    setHistory((prev) => {
      const i = prev.findIndex((e) => e.id === id);
      if (i < 0 || prev[i].listenedSec === sec) return prev;
      const updated = [...prev];
      updated[i] = { ...updated[i], listenedSec: sec };
      StorageService.saveHistory(updated);
      return updated;
    });
  }, []);
  /** Next-track preload (Musike): a resolved stream ready before the current song ends */
  const preloadRef = useRef<{ trackId: string; stream: ResolvedStream; at: number } | null>(null);
  const preloadingRef = useRef<string | null>(null);
  const isOnline = useConnectivity();
  hapticsMode = prefs.haptics || 'full';
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  queueRef.current = queue;
  const currentTrackRef = useRef<Track | null>(null);
  currentTrackRef.current = currentTrack;
  /** SponsorBlock non-music segments for the song playing now (YouTube audio only) */
  const skipSegsRef = useRef<{ trackId: string; segs: [number, number][]; skipped: number }>({
    trackId: '',
    segs: [],
    skipped: -1,
  });
  queueIndexRef.current = queueIndex;
  repeatRef.current = repeatMode;
  shuffleRef.current = shuffle;
  sleepEndTrackRef.current = sleepEndOfTrack;
  prefsRef.current = prefs;
  serversRef.current = monochromeServers;
  downloadsRef.current = downloads;
  volumeRef.current = volume;

  // the pill reads ToastStore directly — a toast no longer re-renders the app
  const showToast = useCallback((msg: string) => ToastStore.show(msg), []);

  // Real cover colours (ambient light + accent). Cached per artwork URL.
  const [artColors, setArtColors] = useState<ArtColors | null>(null);
  useEffect(() => {
    const url = currentTrack?.artworkUrl;
    const hit = cachedArtworkColors(url);
    if (hit !== undefined) {
      setArtColors(hit);
      return;
    }
    let cancelled = false;
    extractArtworkColors(url)
      .then((c) => !cancelled && setArtColors(c))
      .catch(() => !cancelled && setArtColors(null));
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.artworkUrl]);

  // Low Power Mode dims the ambient light; Reduce Motion only removes zooming. Each flag is read
  // strictly (=== true) so an unknown / undefined answer never claims battery saver is on.
  const [lowPower, setLowPower] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let rm: { remove: () => void } | null = null;
    if (Platform.OS !== 'web') {
      Battery.isLowPowerModeEnabledAsync()
        .then((on) => setLowPower(on === true))
        .catch(() => undefined);
      try {
        sub = Battery.addLowPowerModeListener((e) => setLowPower(e?.lowPowerMode === true));
      } catch {
        sub = null;
      }
    }
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => setReduceMotion(on === true))
      .catch(() => undefined);
    try {
      rm = AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) =>
        setReduceMotion(on === true)
      ) as any;
    } catch {
      rm = null;
    }
    return () => {
      sub?.remove();
      rm?.remove();
    };
  }, []);
  const ambient = useMemo(() => {
    const base = { off: 0, low: 0.5, medium: 0.8, high: 1 }[prefs.ambientLight] ?? 0.8;
    return {
      level: lowPower ? Math.min(base, 0.45) : base,
      breathing: prefs.ambientBreathing && !lowPower && base > 0,
      spill: prefs.ambientSpill && base > 0,
      lowPower,
      reduceMotion,
    };
  }, [prefs.ambientLight, prefs.ambientBreathing, prefs.ambientSpill, lowPower, reduceMotion]);

  const darkPalette = useMemo(() => {
    const seed = currentTrack ? `${currentTrack.title}-${currentTrack.artist}` : 'holysic-default';
    // Fixed accent (Musike-style presets / custom colour): the hue is kept, lightness is
    // re-derived by the tonal palette so text on it always stays readable on the dark UI
    const hue =
      prefs.accentColor && prefs.accentColor !== 'dynamic'
        ? hexToHue(prefs.accentColor)
        : undefined;
    // Dynamic accent follows the cover's real colours once they've been read
    if (artColors && currentTrack) return buildPaletteFromArtColors(artColors, hue ?? undefined);
    return buildArtworkPalette(seed, hue ?? undefined);
  }, [currentTrack, prefs.accentColor, artColors]);
  // Light / dark UI: deeper accent & soft containers on the light UI (screens that always stay
  // dark — the full player, lyrics, Recap — use darkPalette)
  const systemScheme = useColorScheme();
  const uiScheme = resolveScheme(prefs.themeMode || 'dark', systemScheme);
  const palette = useMemo(
    () => (uiScheme === 'light' ? paletteForLightUi(darkPalette) : darkPalette),
    [darkPalette, uiScheme]
  );

  // Hydrate persistent storage
  useEffect(() => {
    // never keep the UI waiting on slow storage
    const fallback = setTimeout(() => setPrefsReady(true), 2500);
    // ready when the settings AND the library (likes, playlists, history…) are in — anything the
    // user does before that could save over them
    let parts = 0;
    const partDone = () => {
      if (++parts < 2) return;
      clearTimeout(fallback);
      setPrefsReady(true);
    };
    // settings first: the UI only waits for these
    StorageService.loadPreferences()
      .then((p) => {
        if (!prefsHydratedRef.current) setPrefs(adoptLoadedPrefs(p));
      })
      .catch(() => undefined)
      .finally(partDone);
    (async () => {
      const [
        loadedPrefs,
        savedLiked,
        savedPlaylists,
        savedHistory,
        savedDownloads,
        savedLab,
        savedServers,
        savedSearches,
      ] = await Promise.all([
        StorageService.loadPreferences(),
        StorageService.loadLikedTracks(),
        StorageService.loadPlaylists(),
        StorageService.loadHistory(),
        StorageService.loadDownloads(),
        StorageService.loadAudioLab(),
        StorageService.loadMonochromeServers(),
        StorageService.loadSearchHistory(),
        SourceMemory.load(),
        Loudness.load(),
      ]);
      Scrobbler.load().then((s) => {
        setScrobbleState(s);
        Scrobbler.flush().catch(() => undefined);
      });
      refreshRemoteStreamClients().catch(() => undefined);

      const savedPrefs = loadedPrefs;
      // One-time: old default background → the new ambient-light backdrop
      const migrate = (p: HolySicPreferences): HolySicPreferences =>
        p.ambientIntroduced
          ? p
          : {
              ...p,
              ambientIntroduced: true,
              playerBackground:
                p.playerBackground === 'APPLE_MUSIC' ? 'AMBIENT' : p.playerBackground,
            };
      prefsHydratedRef.current = true;
      if (!prefsLoadedRef.current) {
        const next = migrate(adoptLoadedPrefs(loadedPrefs));
        if (next !== loadedPrefs) StorageService.savePreferences(next).catch(() => undefined);
        setPrefs(next);
      } else {
        // the quick read already set them (and maybe the user changed something since)
        setPrefs((cur) => {
          const next = migrate(cur);
          if (next !== cur) StorageService.savePreferences(next).catch(() => undefined);
          return next;
        });
      }
      setLikedTracks(savedLiked);
      if (savedPlaylists.length > 0) {
        setPlaylists(savedPlaylists);
      } else {
        const starter: Playlist = {
          id: 'pl-late-night',
          name: 'Đêm Hà Nội Chill >_<',
          description: 'Giai điệu êm dịu nghe lúc nửa đêm trên HolySic',
          coverTint: '#6366F1',
          trackIds: OFFLINE_SHOWCASE_TRACKS.map((t) => t.id),
          tracks: OFFLINE_SHOWCASE_TRACKS,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setPlaylists([starter]);
      }
      setHistory(savedHistory);
      // iOS gives the app a new container path on every IPA update — re-point saved files
      const rebased: Record<string, DownloadedTrackMeta> = {};
      for (const [k, m] of Object.entries(savedDownloads))
        rebased[k] = { ...m, localUri: rebaseDocumentUri(m.localUri) };
      setDownloads(rebased);

      // Resume the last queue (Musike), paused at the saved position
      if (savedPrefs.resumeQueue) {
        const session = await StorageService.loadSession();
        if (session && session.queue.length > 0) {
          const idx = Math.max(0, Math.min(session.index, session.queue.length - 1));
          const t = session.queue[idx];
          setQueue(session.queue);
          setQueueIndex(idx);
          setCurrentTrack(t);
          setDurationSec(t.durationSec || 180);
          setPositionSec(session.positionSec || 0);
          setShuffle(session.shuffle);
          setRepeatMode(session.repeat);
          resumeAtRef.current = session.positionSec > 5 ? session.positionSec : 0;
          sessionRestoredRef.current = true;
        }
      }
      hydratedRef.current = true;
      setAudioLab(savedLab);
      audioEngine.applyAudioLab(savedLab);
      setMonochromeServers(savedServers);
      if (savedSearches.length > 0) setSearchHistory(savedSearches);
    })()
      .catch(() => undefined)
      .finally(partDone);
    return () => clearTimeout(fallback);
  }, []);

  const refreshHomeFeeds = useCallback(async () => {
    setIsLoadingHome(true);
    try {
      const [vnSongs, globalSongs, picksSongs, albums] = await Promise.all([
        searchItunesTracks('tlinh Vũ HIEUTHUHAI Sơn Tùng Đen', 16, 'VN'),
        searchItunesTracks('The Weeknd Billie Eilish YOASOBI Kendrick Lamar', 16, 'US'),
        searchItunesTracks('MONO Wren Evans Joji NewJeans Fujii Kaze', 14, 'VN'),
        searchItunesAlbums('V-Pop Indie Chill R&B', 10, 'VN'),
      ]);

      const bl = prefsRef.current.blacklist;
      if (picksSongs.length > 0) {
        setQuickPicks([
          ...filterBlacklisted(picksSongs, bl).slice(0, 10),
          ...OFFLINE_SHOWCASE_TRACKS,
        ]);
      }
      if (vnSongs.length > 0) setVnTrending(filterBlacklisted(vnSongs, bl));
      if (globalSongs.length > 0) setGlobalTrending(filterBlacklisted(globalSongs, bl));
      if (albums.length > 0) setFeaturedAlbums(albums);

      if (
        picksSongs.length > 0 &&
        !sessionRestoredRef.current &&
        currentTrack?.id === OFFLINE_SHOWCASE_TRACKS[0].id &&
        !isPlaying
      ) {
        setCurrentTrack(picksSongs[0]);
        setDurationSec(picksSongs[0].durationSec);
        setQueue([...picksSongs.slice(0, 10), ...OFFLINE_SHOWCASE_TRACKS]);
        setQueueIndex(0);
      }
    } catch {
      // Keep built-in showcase catalog seamlessly
    } finally {
      setIsLoadingHome(false);
    }
  }, [currentTrack?.id, isPlaying]);

  useEffect(() => {
    refreshHomeFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load lyrics when the song changes (by id: a refreshed track object must not re-fetch and
  // re-mount the lyrics list), or when asked to (retry / the user changed this song's lyrics)
  const lyricsTrackId = currentTrack?.id;
  const lyricsTrackRef = useRef(currentTrack);
  lyricsTrackRef.current = currentTrack;
  const lyricsLoadedRef = useRef<{ id?: string; attempt: number }>({ attempt: 0 });
  useEffect(() => {
    const track = lyricsTrackRef.current;
    if (!track) {
      setLyrics(null);
      return;
    }
    if (track.isLive) {
      setLyrics(null);
      setIsLoadingLyrics(false);
      return;
    }
    const prev = lyricsLoadedRef.current;
    const refresh = prev.id === track.id && prev.attempt !== lyricsAttempt;
    lyricsLoadedRef.current = { id: track.id, attempt: lyricsAttempt };
    let cancelled = false;
    setIsLoadingLyrics(true);
    if (!refresh) setLyrics((cur) => (cur && cur.trackId === track.id ? cur : null));
    const p = prefsRef.current;
    loadLyrics(track, {
      refresh,
      keepOffline:
        p.lyricsKeepOffline !== false && (!!downloadsRef.current[track.id] || isLocalTrack(track)),
      sources: p.lyricsSources,
      offline: !isOnlineRef.current,
    })
      .then((res) => {
        if (!cancelled) {
          setLyrics(res);
          setIsLoadingLyrics(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoadingLyrics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lyricsTrackId, lyricsAttempt]);
  // back online: songs that found no lyrics while offline try again by themselves
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const cameBack = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (cameBack && lyrics && lyrics.lines.length === 0 && lyrics.origin !== 'override')
      reloadLyrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const lyricsOffsetSec = currentTrack ? (prefs.lyricsOffsets?.[currentTrack.id] ?? 0) / 1000 : 0;
  // the active line lives in LyricClock (not here): a line change re-renders only the lyrics
  const isPlayingLyricRef = useRef(isPlaying);
  isPlayingLyricRef.current = isPlaying;
  const lyricStarts = useMemo(
    () =>
      // untimed lyrics have no current line (their spread-out times are only a layout aid)
      lyrics && lyrics.synced && lyrics.lines.length ? lyrics.lines.map((l) => l.startSec) : null,
    [lyrics]
  );
  useEffect(
    () => runLyricClock(lyricStarts, lyricsOffsetSec, () => isPlayingLyricRef.current),
    [lyricStarts, lyricsOffsetSec, isPlaying]
  );

  // Spotube's "skip non-music segments": only when the audio is the YouTube video itself
  useEffect(() => {
    skipSegsRef.current = { trackId: '', segs: [], skipped: -1 };
    if (!prefs.skipNonMusic || !currentTrack || resolvedStream?.source !== 'innertube') return;
    const vid = currentTrack.videoId || currentTrack.id;
    const trackId = currentTrack.id;
    let cancelled = false;
    fetchNonMusicSegments(vid).then((segs) => {
      if (!cancelled && segs.length) skipSegsRef.current = { trackId, segs, skipped: -1 };
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack, resolvedStream?.source, prefs.skipNonMusic]);

  const playTokenRef = useRef(0);

  const internalStartTrack = useCallback(
    async (track: Track, startAtSec = 0) => {
      const token = ++playTokenRef.current;
      // music video mode: a video found earlier (prefetched) lets the audio come from it at once
      if (prefsRef.current.musicVideo && prefsRef.current.videoAudio && !track.mvId) {
        const mv = peekMusicVideo(track);
        if (mv) track = { ...track, mvId: mv };
      }
      flushListenTime();
      playLogRef.current = null;
      const isCurrent = () => token === playTokenRef.current;
      const vi = prefsRef.current.language === 'vi';

      setCurrentTrack(track);
      setPositionSec(0);
      setDurationSec(track.isLive ? 0 : track.durationSec || 180);
      setIsPlaying(false);
      setIsBuffering(true);
      setResolvedStream(null);

      await SourceMemory.load();
      if (!isCurrent()) return;

      let offlineMeta: DownloadedTrackMeta | undefined = downloadsRef.current[track.id];
      const preSteps: DiagnosticStep[] = [];
      // Local Files: play straight from the app folder (follows the file if it was moved, even
      // before the first library scan has finished)
      const isLocal = isLocalTrack(track);
      const located = isLocal ? await LocalLibrary.locate(track) : undefined;
      if (!isCurrent()) return;
      const localUri = located?.uri;
      if (located) {
        preSteps.push({
          module: vi ? 'Tệp trên máy' : 'On this device',
          step: located.uri
            ? located.how === 'moved'
              ? vi
                ? 'Tìm thấy ở chỗ mới'
                : 'Found in a new place'
              : vi
                ? 'Tìm thấy tệp'
                : 'File found'
            : vi
              ? 'Không thấy tệp'
              : 'File not found',
          ok: !!located.uri,
          detail: located.detail,
          latencyMs: 1,
        });
        if (!located.uri)
          showToast(
            vi
              ? 'Không tìm thấy tệp trên máy — đang thử tìm bài này trực tuyến'
              : 'File not found on device — trying to find it online'
          );
      }
      // Downloads: the file may have been moved into a folder of the on-device library
      if (offlineMeta && Platform.OS !== 'web' && /^file:/i.test(offlineMeta.localUri)) {
        const facts = StreamFileCache.sniffLocal(offlineMeta.localUri);
        if (facts && !facts.exists) {
          const name = decodeURIComponent(offlineMeta.localUri.split('/').pop() || '');
          const found = name ? await LocalLibrary.locate({ ...track, id: 'lf:' + name }) : null;
          if (!isCurrent()) return;
          preSteps.push({
            module: vi ? 'Bài đã tải' : 'Download',
            step: found?.uri
              ? vi
                ? 'Tệp đã bị chuyển chỗ'
                : 'File was moved'
              : vi
                ? 'Mất tệp'
                : 'File missing',
            ok: found?.uri ? true : false,
            detail: found?.uri ? found.detail : name || offlineMeta.localUri,
          });
          offlineMeta = found?.uri ? { ...offlineMeta, localUri: found.uri } : undefined;
        }
      }
      const baseQueue = createStreamCandidateQueue(
        track,
        prefsRef.current,
        serversRef.current,
        offlineMeta?.localUri || localUri
      );
      baseQueue.diagnostics.unshift(...preSteps);
      // A stream preloaded while the previous song played goes first (unless offline exists)
      const pre = preloadRef.current;
      let preloaded: ResolvedStream | null =
        !offlineMeta && pre && pre.trackId === track.id && Date.now() - pre.at < 20 * 60 * 1000
          ? pre.stream
          : null;
      if (preloaded) preloadRef.current = null;
      const queue = {
        diagnostics: baseQueue.diagnostics,
        async next(): Promise<ResolvedStream | null> {
          if (preloaded) {
            const p = preloaded;
            preloaded = null;
            baseQueue.diagnostics.push({
              module: p.sourceLabel,
              step: 'Preloaded',
              ok: true,
              detail: 'Resolved while the previous song was playing',
              latencyMs: 0,
            });
            return { ...p, diagnostics: [...baseQueue.diagnostics] };
          }
          return baseQueue.next();
        },
      };

      let played: ResolvedStream | null = null;
      let lastTried: ResolvedStream | null = null;
      const startedAt = Date.now();

      try {
        // Try every candidate in priority order until one actually produces audio
        for (let attempt = 0; attempt < 8; attempt++) {
          const cand = await queue.next();
          if (!isCurrent()) return;
          if (!cand) break;

          lastTried = cand;
          setResolvedStream(cand);

          // iOS: Monochrome FLAC comes as octet-stream without an extension, which AVPlayer cannot
          // open — fetch it once into the stream cache as <id>.flac and play the file.
          let playUrl = cand.url;
          let playHeaders = cand.headers;
          let localUri: string | undefined;
          if (StreamFileCache.needsLocalFile(cand.codec, cand.url)) {
            const key = cand.cacheKey || `${cand.source}-${track.id}`;
            const cachedAlready = StreamFileCache.cachedUri(key);
            if (!cachedAlready) {
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: 'Download FLAC for iOS',
                ok: null,
                detail: 'AVPlayer cannot stream this FLAC — caching it once…',
              });
              setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
            }
            const t0 = Date.now();
            try {
              localUri = await StreamFileCache.ensureLocal(key, cand.url, cand.headers, 45000);
              if (!isCurrent()) return;
              if (!cachedAlready) {
                queue.diagnostics.push({
                  module: cand.sourceLabel,
                  step: 'Download FLAC for iOS',
                  ok: true,
                  detail: 'Cached — next plays start instantly',
                  latencyMs: Date.now() - t0,
                });
              }
              playUrl = localUri;
              playHeaders = undefined;
            } catch {
              if (!isCurrent()) return;
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: 'Download FLAC for iOS',
                ok: false,
                detail: 'Too slow — finishing in the background, trying next source',
                latencyMs: Date.now() - t0,
              });
              setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
              continue;
            }
          }

          // Files on the device: check what they really are first — a misnamed file (AAC saved as
          // .mp3, FLAC behind an ID3 block) is played from a correctly named copy
          const facts = /^file:/i.test(playUrl) ? StreamFileCache.sniffLocal(playUrl) : null;
          if (facts) {
            if (!facts.exists) {
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: vi ? 'Kiểm tra tệp' : 'File check',
                ok: false,
                detail: vi
                  ? 'Tệp không còn ở đường dẫn đã lưu'
                  : 'The file is no longer at its saved path',
              });
              setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
              continue;
            }
            const real = facts.real;
            if (real && !real.playable) {
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: vi ? 'Định dạng không hỗ trợ' : 'Unsupported format',
                ok: false,
                detail: vi
                  ? `${real.label} — iOS (AVPlayer) không phát được định dạng này`
                  : `${real.label} — iOS (AVPlayer) can't play this format`,
              });
              setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
              continue;
            }
            const misnamed =
              !!real &&
              real.ext !== facts.ext &&
              !(real.ext === 'm4a' && /^(m4a|mp4|m4b|aac|alac|mov)$/.test(facts.ext)) &&
              !(real.ext === 'aiff' && facts.ext === 'aif');
            const fixLabel = real
              ? `${real.label}${misnamed ? ` (.${facts.ext || '?'})` : ''}`
              : `.${facts.ext || '?'}`;
            if (misnamed || real?.label === 'FLAC + ID3') {
              const copy = StreamFileCache.playableCopy(playUrl, real!.ext);
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: vi ? 'Sửa tên định dạng' : 'Fix format name',
                ok: copy ? true : false,
                detail: copy
                  ? vi
                    ? `Thực chất là ${fixLabel} — phát từ bản sao đúng đuôi`
                    : `Actually ${fixLabel} — playing a correctly named copy`
                  : vi
                    ? `Thực chất là ${fixLabel} — không tạo được bản sao`
                    : `Actually ${fixLabel} — couldn't make a copy`,
              });
              if (copy) playUrl = copy;
            } else {
              queue.diagnostics.push({
                module: cand.sourceLabel,
                step: vi ? 'Kiểm tra tệp' : 'File check',
                ok: true,
                detail: `${fixLabel} · ${(facts.size / 1048576).toFixed(1)} MB`,
              });
            }
          }

          // Loudness normalisation (ReplayGain-style, from Cog) — applied before audio starts
          audioEngine.setGainMultiplier(
            Loudness.multiplier(track, cand, prefsRef.current.normalizeVolume)
          );
          // Bit-perfect: ask the output to run at this song's sample rate (USB DACs follow)
          if (prefsRef.current.bitPerfect)
            await AudioOutput.matchSampleRate(sourceFacts(track, cand).rateHz);
          await audioEngine.loadAndPlay(playUrl, track, volumeRef.current, playHeaders);
          if (!isCurrent()) return;

          const local = cand.isOffline || cand.source === 'synth' || /^file:/i.test(playUrl);
          const timeoutMs = local ? 7000 : 12000;
          let result = await audioEngine.waitUntilAudible(timeoutMs);
          if (!isCurrent() || result === 'superseded') return;

          // A device file AVPlayer refused: one more go from a plain-named copy in Caches (odd
          // characters in the name, a file still being written by the Files app, permissions…)
          if (
            result !== 'ok' &&
            facts?.exists &&
            Platform.OS !== 'web' &&
            !/\/holysic-stream-cache\//.test(playUrl)
          ) {
            const copy = StreamFileCache.playableCopy(
              playUrl,
              facts.real?.ext || facts.ext || 'm4a'
            );
            queue.diagnostics.push({
              module: cand.sourceLabel,
              step: vi ? 'Thử lại từ bản sao' : 'Retry from a copy',
              ok: null,
              detail:
                result === 'timeout'
                  ? vi
                    ? `Không có tiếng sau ${Math.round(timeoutMs / 1000)} giây`
                    : `No audio after ${Math.round(timeoutMs / 1000)}s`
                  : vi
                    ? 'AVPlayer từ chối tệp gốc'
                    : 'AVPlayer rejected the original file',
            });
            setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
            if (copy) {
              await audioEngine.loadAndPlay(copy, track, volumeRef.current);
              if (!isCurrent()) return;
              result = await audioEngine.waitUntilAudible(timeoutMs);
              if (!isCurrent() || result === 'superseded') return;
            }
          }

          if (result === 'ok') {
            queue.diagnostics.push({
              module: cand.sourceLabel,
              step: 'Playback started',
              ok: true,
              detail: `${cand.qualityLabel}${cand.fromMemory ? ' · remembered source' : ''}`,
              latencyMs: Date.now() - startedAt,
            });
            played = { ...cand, diagnostics: [...queue.diagnostics] };
            setResolvedStream(played);
            Loudness.remember(track, cand);
            if (startAtSec > 5) {
              audioEngine.seekTo(startAtSec);
              setPositionSec(startAtSec);
            }
            if (prefsRef.current.rememberSources && !track.isLive && track.source !== 'audius') {
              SourceMemory.rememberSuccess(track, cand, Date.now() - startedAt, localUri);
            }
            break;
          }

          SourceMemory.rememberFailure(track, cand);
          queue.diagnostics.push({
            module: cand.sourceLabel,
            step: 'Player check',
            ok: false,
            detail:
              result === 'timeout'
                ? `No audio after ${Math.round(timeoutMs / 1000)}s — trying next source`
                : 'Stream rejected by the player — trying next source',
          });
          setResolvedStream({ ...cand, diagnostics: [...queue.diagnostics] });
        }
      } catch {
        // handled below as "no playable source"
      }

      if (!isCurrent()) return;

      if (!played) {
        audioEngine.stop();
        setIsPlaying(false);
        setIsBuffering(false);
        // Diagnostics must always explain the failure — even when no module produced a single
        // candidate (that used to leave the pane on "Resolving modules…" forever)
        if (!queue.diagnostics.some((d) => d.ok === false)) {
          queue.diagnostics.push({
            module: 'HolySic',
            step: vi ? 'Không có nguồn phát' : 'No source',
            ok: false,
            detail: !isOnlineRef.current
              ? vi
                ? 'Đang ngoại tuyến và bài này chưa được tải về máy'
                : 'Offline, and this song is not downloaded'
              : vi
                ? 'Không mô-đun nào tìm thấy bài này (kiểm tra Cài đặt → Mô-đun nguồn)'
                : 'No module found this song (check Settings → Source modules)',
          });
        }
        setResolvedStream({
          ...(lastTried || {
            url: '',
            source: track.source,
            sourceLabel: vi ? 'Không phát được' : 'Unplayable',
            qualityLabel: '—',
            codec: '—',
          }),
          failed: true,
          diagnostics: [...queue.diagnostics],
        });
        showToast(
          isLocal
            ? vi
              ? 'Không phát được tệp này trên máy. Mở “Chẩn đoán luồng” trong trình phát để xem lý do.'
              : "This file couldn't be played. Open Stream Diagnostics in the player to see why."
            : vi
              ? 'Không tìm được bản đầy đủ phát được cho bài này. Xem “Chẩn đoán luồng” trong trình phát để biết lý do.'
              : 'No full-length source could play this track. Check Stream Diagnostics in the player.'
        );
        return;
      }

      if (played.isPreview) {
        showToast(
          vi
            ? 'Không tìm được bản đầy đủ — đang phát bản preview 30 giây (Apple)'
            : 'Full track unavailable — playing 30s Apple preview'
        );
      }

      const eventId = `ev-${Date.now()}-${track.id}`;
      playLogRef.current = {
        track,
        startedAt: Date.now(),
        listened: 0,
        lastPos: startAtSec,
        scrobbled: played.isPreview === true || track.isLive === true,
        eventId,
        flushed: 0,
      };
      if (track.isLive) registerStationClick(track.id);
      else if (!played.isPreview) Scrobbler.nowPlaying(track).catch(() => undefined);

      // Log listening event for HolySic Recap & History
      setHistory((prev) => {
        const event: ListeningEvent = {
          id: eventId,
          track,
          playedAt: Date.now(),
          // real time is filled in as the song actually plays (flushListenTime)
          listenedSec: 0,
        };
        const updated = [
          event,
          ...prev.filter((e) => e.track.id !== track.id || Date.now() - e.playedAt > 60000),
        ].slice(0, 600); // Recap + Home shelves (Most played, Not played in a while)
        StorageService.saveHistory(updated);
        return updated;
      });
    },
    [showToast]
  );

  /** Offline, a swipe / skip lands only on songs that can play without the network */
  const playableNow = useCallback(
    (t: Track) =>
      isOnlineRef.current ||
      isLocalTrack(t) ||
      !!downloadsRef.current[t.id] ||
      t.source === 'synth' ||
      !!t.synthPreset,
    []
  );

  const playTrack = useCallback(
    async (track: Track, newQueue?: Track[]) => {
      triggerHaptic('light');
      // offline in a mixed list: an online-only song can't start — take the next one that can
      if (!playableNow(track)) {
        const list = newQueue && newQueue.length ? newQueue : queueRef.current;
        const at = Math.max(
          0,
          list.findIndex((t) => t.id === track.id)
        );
        const order = [...list.slice(at + 1), ...list.slice(0, at)];
        const alt = order.find(playableNow);
        const vi = prefsRef.current.language === 'vi';
        if (!alt) {
          showToast(
            vi
              ? 'Đang ngoại tuyến — bài này cần mạng. Hãy tải về để nghe offline.'
              : 'You’re offline — this song needs the internet. Download it to play offline.'
          );
          return;
        }
        showToast(
          vi ? 'Đang ngoại tuyến — phát bài có sẵn trên máy' : 'Offline — playing a saved song'
        );
        track = alt;
      }
      if (newQueue && newQueue.length > 0) {
        const idx = newQueue.findIndex((t) => t.id === track.id);
        setQueue(newQueue);
        setQueueIndex(idx >= 0 ? idx : 0);
      } else {
        const existingIdx = queueRef.current.findIndex((t) => t.id === track.id);
        if (existingIdx >= 0) {
          setQueueIndex(existingIdx);
        } else {
          const nextQ = [track, ...queueRef.current];
          setQueue(nextQ);
          setQueueIndex(0);
        }
      }
      if (prefsRef.current.openPlayerOnPlay) setIsPlayerOpen(true);
      await internalStartTrack(track);
    },
    [internalStartTrack, playableNow, showToast]
  );

  const playNext = useCallback(() => {
    triggerHaptic('light');
    const q = queueRef.current;
    if (q.length === 0) return;

    if (shuffleRef.current && q.length > 1) {
      const pool = q
        .map((t, i) => i)
        .filter((i) => i !== queueIndexRef.current && playableNow(q[i]));
      if (pool.length === 0) return;
      const rand = pool[Math.floor(Math.random() * pool.length)];
      setQueueIndex(rand);
      internalStartTrack(q[rand]);
      return;
    }

    let nextIdx = queueIndexRef.current + 1;
    const bl = prefsRef.current.blacklist;
    while (nextIdx < q.length && (isBlacklisted(q[nextIdx], bl) || !playableNow(q[nextIdx])))
      nextIdx += 1;
    if (nextIdx >= q.length && repeatRef.current === 'ALL' && !isOnlineRef.current) {
      // offline + repeat all: wrap to the first song that can play
      const first = q.findIndex((t) => playableNow(t) && !isBlacklisted(t, bl));
      if (first >= 0 && first !== queueIndexRef.current) {
        setQueueIndex(first);
        internalStartTrack(q[first]);
        return;
      }
    }
    if (nextIdx < q.length) {
      setQueueIndex(nextIdx);
      internalStartTrack(q[nextIdx]);
    } else if (repeatRef.current === 'ALL') {
      setQueueIndex(0);
      internalStartTrack(q[0]);
    } else if (prefsRef.current.autoPlaySimilar && isOnlineRef.current && q.length > 0) {
      // Autoplay radio (Musike): keep the music going with songs like the last one
      const seed = q[queueIndexRef.current] || q[q.length - 1];
      continueWithSimilarRef.current?.(seed);
    } else {
      audioEngine.pause();
      setIsPlaying(false);
    }
  }, [internalStartTrack, playableNow]);
  const continueWithSimilarRef = useRef<((seed: Track) => void) | null>(null);
  /** play token of the song whose crossfade has already started */
  const crossfadeFiredRef = useRef(-1);

  const playPrevious = useCallback(() => {
    triggerHaptic('light');
    if (PlaybackClock.get() > 3.5 && !currentTrackRef.current?.isLive) {
      audioEngine.seekTo(0);
      setPositionSec(0);
      return;
    }
    const q = queueRef.current;
    if (q.length === 0) return;
    let prevIdx = queueIndexRef.current > 0 ? queueIndexRef.current - 1 : q.length - 1;
    for (let n = 0; n < q.length && !playableNow(q[prevIdx]); n++)
      prevIdx = prevIdx > 0 ? prevIdx - 1 : q.length - 1;
    if (!playableNow(q[prevIdx])) return;
    setQueueIndex(prevIdx);
    internalStartTrack(q[prevIdx]);
  }, [internalStartTrack, playableNow]);

  // Subscribe to AudioEngine playback updates & Lock Screen remote commands
  useEffect(() => {
    audioEngine.onRemoteAction((action) => {
      if (action === 'next') playNext();
      else if (action === 'prev') playPrevious();
    });

    const unsub = audioEngine.onStatus((st) => {
      setIsPlaying(st.isPlaying);
      setIsBuffering(st.isBuffering);
      setPositionSec(st.currentTimeSec);
      if (st.durationSec > 0 && Number.isFinite(st.durationSec) && !currentTrackRef.current?.isLive)
        setDurationSec(st.durationSec);
      trackListeningRef.current?.(st.currentTimeSec, st.durationSec, st.isPlaying);

      // Crossfade: start the next song while this one is still playing — except between
      // consecutive songs of the same album (live sets, DJ mixes, concept albums stay gapless)
      const cf = prefsRef.current.bitPerfect ? 0 : prefsRef.current.crossfadeSec || 0;
      const cur = currentTrackRef.current;
      if (
        cf > 0 &&
        st.isPlaying &&
        cur &&
        !cur.isLive &&
        st.durationSec > cf * 2 + 5 &&
        st.currentTimeSec >= st.durationSec - cf - 0.4 &&
        crossfadeFiredRef.current !== playTokenRef.current &&
        repeatRef.current !== 'ONE' &&
        !sleepEndTrackRef.current &&
        (queueIndexRef.current + 1 < queueRef.current.length ||
          repeatRef.current === 'ALL' ||
          prefsRef.current.autoPlaySimilar)
      ) {
        crossfadeFiredRef.current = playTokenRef.current;
        const upcoming = !shuffleRef.current
          ? queueRef.current[queueIndexRef.current + 1]
          : undefined;
        if (!continuesAlbum(cur, upcoming)) {
          audioEngine.beginCrossfade(cf, prefsRef.current.crossfadeCurve);
          playNext();
          return;
        }
      }

      if (st.didJustFinish) {
        if (sleepEndTrackRef.current) {
          setSleepEndOfTrack(false);
          sleepEndAtRef.current = null;
          SleepClock.set(null);
          setSleepActive(false);
          audioEngine.pause();
          setTimeout(() => audioEngine.setSleepFade(1), 400);
          showToast(
            prefsRef.current.language === 'vi'
              ? 'Đã dừng nhạc theo hẹn giờ cuối bài'
              : 'Sleep timer: paused at the end of the track'
          );
          return;
        }
        if (repeatRef.current === 'ONE') {
          audioEngine.seekTo(0);
          audioEngine.play();
        } else {
          playNext();
        }
      }
    });
    return unsub;
  }, [playNext, playPrevious, showToast]);

  // Scrobble accounting + next-track preload, driven by playback status
  const trackListeningRef = useRef<((pos: number, dur: number, playing: boolean) => void) | null>(
    null
  );
  trackListeningRef.current = (pos, dur, playing) => {
    const sk = skipSegsRef.current;
    if (playing && sk.segs.length && sk.trackId === currentTrackRef.current?.id) {
      const seg = segmentAt(sk.segs, pos);
      if (seg && sk.skipped !== seg[0]) {
        sk.skipped = seg[0];
        const total0 = dur > 0 ? dur : currentTrackRef.current?.durationSec || 0;
        const target = total0 > 0 ? Math.min(seg[1], total0 - 0.25) : seg[1];
        setPositionSec(target);
        audioEngine.seekTo(target);
        showToast(
          prefsRef.current.language === 'vi'
            ? `Đã bỏ qua ${Math.round(seg[1] - seg[0])} giây không phải nhạc`
            : `Skipped ${Math.round(seg[1] - seg[0])}s of non-music`
        );
      }
    }
    const log = playLogRef.current;
    if (!log) return;
    const delta = pos - log.lastPos;
    log.lastPos = pos;
    // count only real forward progress (seeks jump by more than a few seconds)
    if (playing && delta > 0 && delta < 3) log.listened += delta;
    if (log.listened - (log.flushed || 0) >= 15) flushListenTime();
    const total = dur > 0 ? dur : log.track.durationSec;
    if (!log.scrobbled && Scrobbler.qualifies(total, log.listened)) {
      log.scrobbled = true;
      Scrobbler.scrobble({ ...log.track, durationSec: Math.round(total) }, log.startedAt).catch(
        () => undefined
      );
    }
    // preload the next song once this one is well under way
    if (playing && log.listened > 20 && total > 0 && pos > Math.min(total * 0.5, total - 25)) {
      const q = queueRef.current;
      const nextTrack =
        !shuffleRef.current && repeatRef.current !== 'ONE'
          ? q[queueIndexRef.current + 1]
          : undefined;
      if (
        nextTrack &&
        !nextTrack.isLive &&
        !isLocalTrack(nextTrack) &&
        !log.track.isLive &&
        preloadingRef.current !== nextTrack.id &&
        !downloadsRef.current[nextTrack.id]
      ) {
        preloadingRef.current = nextTrack.id;
        resolvePlayableStream(nextTrack, prefsRef.current, serversRef.current)
          .then(async (stream) => {
            if (!stream || stream.isPreview || stream.source === 'synth') return;
            if (StreamFileCache.needsLocalFile(stream.codec, stream.url)) {
              // iOS FLAC: download it now so the next song starts instantly from the cache
              await StreamFileCache.ensureLocal(
                stream.cacheKey || `${stream.source}-${nextTrack.id}`,
                stream.url,
                stream.headers,
                180000
              ).catch(() => undefined);
              return;
            }
            preloadRef.current = { trackId: nextTrack.id, stream, at: Date.now() };
          })
          .catch(() => undefined);
      }
    }
  };

  // Persist the playback session for "resume queue" (throttled)
  const lastSessionSaveRef = useRef(0);
  const saveSessionNow = () => {
    lastSessionSaveRef.current = Date.now();
    StorageService.saveSession({
      queue: queueRef.current,
      index: queueIndexRef.current,
      positionSec: PlaybackClock.get(),
      shuffle: shuffleRef.current,
      repeat: repeatRef.current,
      savedAt: lastSessionSaveRef.current,
    });
  };
  useEffect(() => {
    if (!hydratedRef.current || !prefs.resumeQueue) return;
    if (isPlaying && Date.now() - lastSessionSaveRef.current < 10000) return;
    saveSessionNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, queueIndex, isPlaying, shuffle, repeatMode, prefs.resumeQueue]);
  // while playing, the position is saved every ~10 s straight from the clock (no re-render)
  useEffect(() => {
    if (!isPlaying || !prefs.resumeQueue) return;
    return PlaybackClock.subscribe(() => {
      if (hydratedRef.current && Date.now() - lastSessionSaveRef.current >= 10000) saveSessionNow();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, prefs.resumeQueue]);

  // Sleep Timer — counts against the wall clock (a throttled background timer can't drift it),
  // and the final 20 s fade the music out gently instead of cutting it mid-phrase
  useEffect(() => {
    if (!sleepActive) return;
    const FADE_SEC = Math.max(0, prefsRef.current.sleepFadeSec ?? 20);
    const tick = () => {
      const end = sleepEndAtRef.current;
      if (!end) return;
      const left = (end - Date.now()) / 1000;
      if (left <= 0) {
        sleepEndAtRef.current = null;
        audioEngine.pause();
        setIsPlaying(false);
        SleepClock.set(null);
        setSleepActive(false);
        // restore the level once silent, so the next Play starts at the normal volume
        setTimeout(() => audioEngine.setSleepFade(1), 400);
        showToast(
          prefsRef.current.language === 'vi'
            ? 'Đã tắt nhạc theo hẹn giờ. Ngủ ngon nhé 🌙'
            : 'Sleep timer paused playback. Goodnight 🌙'
        );
        return;
      }
      audioEngine.setSleepFade(
        FADE_SEC > 0 && left < FADE_SEC ? Math.max(0.04, left / FADE_SEC) : 1
      );
      const secs = Math.ceil(left);
      SleepClock.set(secs);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [sleepActive, showToast]);

  const togglePlay = useCallback(() => {
    triggerHaptic('light');
    if (!currentTrack) return;
    if (!resolvedStream || !audioEngine.hasActiveSource()) {
      const at = resumeAtRef.current;
      resumeAtRef.current = 0;
      internalStartTrack(currentTrack, at);
      return;
    }
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.play();
      setIsPlaying(true);
    }
  }, [currentTrack, internalStartTrack, isPlaying, resolvedStream]);

  const seekTo = useCallback((sec: number) => {
    setPositionSec(sec);
    audioEngine.seekTo(sec);
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    audioEngine.setVolume(clamped);
  }, []);

  const toggleShuffle = useCallback(() => {
    triggerHaptic('selection');
    setShuffle((s) => !s);
  }, []);

  const cycleRepeat = useCallback(() => {
    triggerHaptic('selection');
    setRepeatMode((m) => (m === 'OFF' ? 'ALL' : m === 'ALL' ? 'ONE' : 'OFF'));
  }, []);

  const addToQueue = useCallback(
    (track: Track, next = false) => {
      triggerHaptic('light');
      setQueue((prev) => {
        const copy = [...prev];
        if (next && copy.length > 0) {
          copy.splice(queueIndexRef.current + 1, 0, track);
        } else {
          copy.push(track);
        }
        return copy;
      });
      showToast(
        prefs.language === 'vi'
          ? next
            ? 'Đã thêm vào phát kế tiếp'
            : 'Đã thêm vào hàng chờ'
          : next
            ? 'Playing next'
            : 'Added to queue'
      );
    },
    [prefs.language, showToast]
  );

  const removeFromQueue = useCallback((index: number) => {
    if (index === queueIndexRef.current) return;
    setQueue((prev) => prev.filter((_, i) => i !== index));
    // removing an earlier song shifts the playing song up by one
    if (index < queueIndexRef.current) setQueueIndex((i) => Math.max(0, i - 1));
  }, []);

  const moveInQueue = useCallback((from: number, to: number) => {
    const len = queueRef.current.length;
    if (from === to || from < 0 || to < 0 || from >= len || to >= len) return;
    triggerHaptic('selection');
    setQueue((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    const cur = queueIndexRef.current;
    let next = cur;
    if (from === cur) next = to;
    else if (from < cur && to >= cur) next = cur - 1;
    else if (from > cur && to <= cur) next = cur + 1;
    if (next !== cur) setQueueIndex(next);
  }, []);

  const clearUpcoming = useCallback(() => {
    triggerHaptic('light');
    setQueue((prev) => prev.slice(0, queueIndexRef.current + 1));
  }, []);

  const jumpToQueueIndex = useCallback(
    (index: number) => {
      const target = queueRef.current[index];
      if (!target) return;
      setQueueIndex(index);
      internalStartTrack(target);
    },
    [internalStartTrack]
  );

  const startInstantMix = useCallback(
    async (seedQuery?: string) => {
      triggerHaptic('medium');
      const query =
        seedQuery || (currentTrack ? `${currentTrack.artist} chill hits` : 'V-Pop Lo-Fi R&B hits');
      const results = await searchItunesTracks(query, 20, 'VN');
      const pool = filterBlacklisted(
        results.length > 0 ? results : [...vnTrending, ...OFFLINE_SHOWCASE_TRACKS],
        prefsRef.current.blacklist
      );
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      if (shuffled.length > 0) {
        setShuffle(true);
        await playTrack(shuffled[0], shuffled);
        setIsPlayerOpen(true);
        showToast(
          prefs.language === 'vi'
            ? `Mix It: Đã trộn ${shuffled.length} bài hát!`
            : `Mix It: Spun ${shuffled.length} tracks!`
        );
      }
    },
    [currentTrack, playTrack, prefs.language, showToast, vnTrending]
  );

  const updatePrefs = useCallback((patch: Partial<HolySicPreferences>) => {
    // before the saved settings are read, saving would overwrite them with defaults (and bring the
    // first-run screen back): remember the change and merge it in once they are loaded
    if (!prefsLoadedRef.current) {
      pendingPrefsRef.current = { ...pendingPrefsRef.current, ...patch };
      setPrefs((prev) => ({ ...prev, ...patch }));
      return;
    }
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      StorageService.savePreferences(next);
      return next;
    });
  }, []);

  const searchTracks = useCallback(
    async (
      query: string,
      sourceFilter: SearchFilter = 'all'
    ): Promise<{ tracks: Track[]; albums: AlbumSummary[] }> => {
      const q = query.trim();
      if (!q) return { tracks: [], albums: [] };

      const tasks: Promise<Track[]>[] = [];
      if (sourceFilter === 'all' || sourceFilter === 'itunes') {
        tasks.push(searchItunesTracks(q, 20, 'VN'));
      }
      if (
        (sourceFilter === 'all' && prefs.enabledModules.jiosaavn) ||
        sourceFilter === 'jiosaavn'
      ) {
        tasks.push(searchJioSaavnTracks(q, prefs.preferredJioSaavnQuality, 14));
      }
      if (
        (sourceFilter === 'all' && prefs.enabledModules.monochrome) ||
        sourceFilter === 'monochrome'
      ) {
        tasks.push(searchMonochromeCatalog(q, monochromeServers, 10));
      }
      if (
        (sourceFilter === 'all' && prefs.enabledModules.innertube) ||
        sourceFilter === 'innertube'
      ) {
        tasks.push(searchInnerTubeTracks(q, 10));
      }
      // Catalog-only extras: Audius (artist uploads) and live radio stations
      if (sourceFilter === 'audius') tasks.push(searchAudiusTracks(q, 25));
      if (sourceFilter === 'radio') tasks.push(searchStations({ name: q, limit: 30 }));
      // music videos (YouTube): the picture plays in the player, the sound from the same video
      if (sourceFilter === 'video')
        tasks.push(searchYouTubeVideos(q, 24).then((hits) => hits.map(videoHitToTrack)));

      const [albums, ...trackGroups] = await Promise.all([
        sourceFilter === 'all' || sourceFilter === 'itunes'
          ? searchItunesAlbums(q, 8, 'VN')
          : Promise.resolve([]),
        ...tasks,
      ]);

      // Interleave & deduplicate by normalized title+artist when 'all'
      const seen = new Set<string>();
      const merged: Track[] = [];
      for (const group of trackGroups) {
        for (const item of group) {
          const sig =
            sourceFilter === 'all'
              ? `${item.title.toLowerCase().trim()}|${item.artist.toLowerCase().trim()}`
              : item.id;
          if (!seen.has(sig)) {
            seen.add(sig);
            merged.push(item);
          }
        }
      }

      return { tracks: filterBlacklisted(merged, prefsRef.current.blacklist), albums };
    },
    [monochromeServers, prefs.enabledModules, prefs.preferredJioSaavnQuality]
  );

  const searchTracksRef = useRef(searchTracks);
  searchTracksRef.current = searchTracks;

  const addSearchHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [
        trimmed,
        ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 12);
      StorageService.saveSearchHistory(next);
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    StorageService.saveSearchHistory([]);
  }, []);

  const setSleepTimer = useCallback(
    (val: number | 'end_of_track' | null) => {
      triggerHaptic('selection');
      audioEngine.setSleepFade(1);
      sleepEndAtRef.current = typeof val === 'number' ? Date.now() + val * 60_000 : null;
      if (val === null) {
        SleepClock.set(null);
        setSleepActive(false);
        setSleepEndOfTrack(false);
        showToast(prefs.language === 'vi' ? 'Đã tắt hẹn giờ ngủ' : 'Sleep timer off');
      } else if (val === 'end_of_track') {
        SleepClock.set(null);
        setSleepActive(false);
        setSleepEndOfTrack(true);
        showToast(
          prefs.language === 'vi'
            ? 'Sẽ dừng phát khi hết bài hiện tại'
            : 'Will stop after current song'
        );
      } else {
        setSleepEndOfTrack(false);
        SleepClock.set(val * 60);
        setSleepActive(true);
        showToast(
          prefs.language === 'vi'
            ? `Hẹn giờ tắt nhạc sau ${val} phút`
            : `Sleep timer set for ${val} min`
        );
      }
    },
    [prefs.language, showToast]
  );

  const isLiked = useCallback(
    (trackId: string) => likedTracks.some((t) => t.id === trackId),
    [likedTracks]
  );

  const toggleLike = useCallback(
    (track: Track) => {
      triggerHaptic('medium');
      setLikedTracks((prev) => {
        const exists = prev.some((t) => t.id === track.id);
        const next = exists ? prev.filter((t) => t.id !== track.id) : [track, ...prev];
        StorageService.saveLikedTracks(next);
        showToast(
          exists
            ? prefs.language === 'vi'
              ? 'Đã xoá khỏi Đã thích'
              : 'Removed from Liked Songs'
            : prefs.language === 'vi'
              ? 'Đã thêm vào Bài hát đã thích ♥'
              : 'Saved to Liked Songs ♥'
        );
        return next;
      });
    },
    [prefs.language, showToast]
  );

  const createPlaylist = useCallback(
    (name: string, description?: string): Playlist => {
      triggerHaptic('medium');
      const hues = ['#6366F1', '#EC4899', '#10B981', '#F59E0B', '#3B82F6', '#8B5CF6'];
      const pl: Playlist = {
        id: `pl-${Date.now()}`,
        name: name.trim() || 'HolySic Playlist',
        description: description?.trim(),
        coverTint: hues[playlists.length % hues.length],
        trackIds: [],
        tracks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPlaylists((prev) => {
        const next = [pl, ...prev];
        StorageService.savePlaylists(next);
        return next;
      });
      showToast(prefs.language === 'vi' ? `Đã tạo "${pl.name}"` : `Created "${pl.name}"`);
      return pl;
    },
    [playlists.length, prefs.language, showToast]
  );

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((prev) => {
      LocalLibrary.forgetImage(prev.find((p) => p.id === id)?.coverUrl);
      const next = prev.filter((p) => p.id !== id);
      StorageService.savePlaylists(next);
      return next;
    });
  }, []);

  const addTrackToPlaylist = useCallback(
    (playlistId: string, track: Track) => {
      triggerHaptic('light');
      setPlaylists((prev) => {
        const next = prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.trackIds.includes(track.id)) return pl;
          const updatedTracks = [...pl.tracks, track];
          return {
            ...pl,
            trackIds: updatedTracks.map((t) => t.id),
            tracks: updatedTracks,
            coverUrl: pl.coverUrl || track.artworkUrl,
            updatedAt: Date.now(),
          };
        });
        StorageService.savePlaylists(next);
        return next;
      });
      showToast(
        prefs.language === 'vi' ? 'Đã thêm bài hát vào Playlist' : 'Added track to playlist'
      );
    },
    [prefs.language, showToast]
  );

  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) => {
      const next = prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const updatedTracks = pl.tracks.filter((t) => t.id !== trackId);
        return {
          ...pl,
          trackIds: updatedTracks.map((t) => t.id),
          tracks: updatedTracks,
          updatedAt: Date.now(),
        };
      });
      StorageService.savePlaylists(next);
      return next;
    });
  }, []);

  // Best match per item across every enabled source (shared by text import, "Search a list",
  // Spotify / YouTube playlist import)
  const matchSongList = useCallback(
    async (
      raw: string | TextItem[],
      onProgress?: (done: number, total: number) => void
    ): Promise<Track[]> => {
      const items = typeof raw === 'string' ? parseTextList(raw) : raw;
      if (items.length === 0) return [];
      const found = await matchTextItems(
        items,
        async (q) => (await searchTracksRef.current(q)).tracks.slice(0, 8),
        onProgress
      );
      return filterBlacklisted(found, prefsRef.current.blacklist);
    },
    []
  );

  const savePlaylistFromTracks = useCallback(
    (name: string, tracks: Track[], description?: string, coverUrl?: string): Playlist => {
      const pl: Playlist = {
        id: `pl-import-${Date.now()}`,
        name: name.trim() || 'Imported Playlist',
        description:
          description ??
          `${tracks.length} ${prefsRef.current.language === 'vi' ? 'bài hát' : 'songs'}`,
        coverUrl: coverUrl || tracks[0]?.artworkUrl,
        coverTint: '#10B981',
        trackIds: tracks.map((t) => t.id),
        tracks,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPlaylists((prev) => {
        const next = [pl, ...prev];
        StorageService.savePlaylists(next);
        return next;
      });
      return pl;
    },
    []
  );

  const importPlaylistText = useCallback(
    async (name: string, rawText: string): Promise<Playlist | null> => {
      const matchedTracks = await matchSongList(rawText);
      if (matchedTracks.length === 0) return null;
      const pl = savePlaylistFromTracks(
        name,
        matchedTracks,
        `Imported ${matchedTracks.length} songs`
      );
      showToast(
        prefs.language === 'vi'
          ? `Đã nhập ${matchedTracks.length} bài vào "${pl.name}"`
          : `Imported ${matchedTracks.length} tracks into "${pl.name}"`
      );
      return pl;
    },
    [matchSongList, prefs.language, savePlaylistFromTracks, showToast]
  );

  const downloadTrack = useCallback(
    async (track: Track) => {
      if (downloads[track.id] || downloadingIds[track.id]) return;
      if (track.isLive) {
        showToast(
          prefsRef.current.language === 'vi'
            ? 'Không thể tải đài phát trực tiếp'
            : 'Live stations cannot be downloaded'
        );
        return;
      }
      triggerHaptic('medium');
      setDownloadingIds((prev) => ({ ...prev, [track.id]: true }));
      try {
        // Pick the first downloadable candidate (skip HLS manifests, previews & synth)
        await SourceMemory.load();
        // Downloads want the best quality, so FLAC is not pushed behind instant-start sources here
        const queue = createStreamCandidateQueue(
          track,
          { ...prefs, preferInstantStart: false },
          monochromeServers
        );
        let stream = await queue.next();
        while (
          stream &&
          (stream.isPreview ||
            stream.source === 'synth' ||
            stream.codec.startsWith('HLS') ||
            !/^https?:/i.test(stream.url))
        ) {
          stream = await queue.next();
        }
        if (!stream) throw new Error('No downloadable source');
        const meta = await StorageService.downloadTrackFile(
          track,
          stream.url,
          stream.qualityLabel,
          stream.headers
        );
        setDownloads((prev) => {
          const next = { ...prev, [track.id]: meta };
          StorageService.saveDownloads(next);
          return next;
        });
        // the lyrics come along, so the song is complete offline
        if (prefs.lyricsKeepOffline !== false)
          loadLyrics(track, { keepOffline: true, sources: prefs.lyricsSources }).catch(() => {});
        showToast(
          prefs.language === 'vi'
            ? `Đã tải ngoại tuyến: ${track.title}`
            : `Downloaded offline: ${track.title}`
        );
      } catch {
        showToast(prefs.language === 'vi' ? 'Không thể tải bài hát này' : 'Download failed');
      } finally {
        setDownloadingIds((prev) => {
          const copy = { ...prev };
          delete copy[track.id];
          return copy;
        });
      }
    },
    [downloadingIds, downloads, monochromeServers, prefs, showToast]
  );

  const removeDownload = useCallback(
    async (trackId: string) => {
      const existing = downloads[trackId];
      if (!existing) return;
      await StorageService.removeDownloadedFile(existing);
      setDownloads((prev) => {
        const copy = { ...prev };
        delete copy[trackId];
        StorageService.saveDownloads(copy);
        return copy;
      });
      showToast(prefs.language === 'vi' ? 'Đã xoá bản tải ngoại tuyến' : 'Removed offline file');
    },
    [downloads, prefs.language, showToast]
  );

  const updateAudioLab = useCallback((patch: Partial<AudioLabSettings>) => {
    setAudioLab((prev) => {
      const next = { ...prev, ...patch };
      audioEngine.applyAudioLab(next);
      StorageService.saveAudioLab(next);
      return next;
    });
  }, []);

  const applyEqPreset = useCallback((presetId: string) => {
    triggerHaptic('selection');
    const found = AUTO_EQ_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setAudioLab((prev) => {
      const next: AudioLabSettings = {
        ...prev,
        enabled: true,
        presetId: found.id,
        bands: prev.bands.map((b, idx) => ({ ...b, gainDb: found.gains[idx] ?? 0 })),
      };
      audioEngine.applyAudioLab(next);
      StorageService.saveAudioLab(next);
      return next;
    });
  }, []);

  const addMonochromeServer = useCallback(
    async (rawUrl: string, kind: 'streamer' | 'relay'): Promise<boolean> => {
      const clean = rawUrl.trim().replace(/\/+$/, '');
      if (!clean.startsWith('http')) return false;
      let hostName = clean.replace(/^https?:\/\//, '').split('/')[0];
      const candidate: ModuleServerConfig = {
        url: clean,
        name: hostName || clean,
        builtIn: false,
        kind,
        lastStatus: 'unknown',
      };
      const check = await verifyMonochromeServer(candidate);
      candidate.lastStatus = check.ok ? 'ok' : 'down';
      candidate.lastCheckedAt = Date.now();
      candidate.lastMessage = check.message;

      setMonochromeServers((prev) => {
        const filtered = prev.filter((s) => s.url !== clean);
        const next = [candidate, ...filtered];
        StorageService.saveMonochromeServers(next);
        return next;
      });
      showToast(check.message);
      return check.ok;
    },
    [showToast]
  );

  const removeMonochromeServer = useCallback((url: string) => {
    setMonochromeServers((prev) => {
      const next = prev.filter((s) => s.builtIn || s.url !== url);
      StorageService.saveMonochromeServers(next);
      return next;
    });
  }, []);

  const verifyAllServers = useCallback(async () => {
    const updated = await Promise.all(
      monochromeServers.map(async (srv) => {
        const check = await verifyMonochromeServer(srv);
        return {
          ...srv,
          lastStatus: check.ok ? ('ok' as const) : ('down' as const),
          lastCheckedAt: Date.now(),
          lastMessage: check.message,
        };
      })
    );
    setMonochromeServers(updated);
    StorageService.saveMonochromeServers(updated);
    showToast(
      prefs.language === 'vi' ? 'Đã kiểm tra máy chủ nguồn nhạc' : 'Verified module servers'
    );
  }, [monochromeServers, prefs.language, showToast]);

  // ───────────── Merged features: Spotube · OpenSpot Music · Musike · Cog ─────────────

  const fetchChart = useCallback(async (country: string, genreId: number | null) => {
    const list = await fetchTopSongs(country, genreId, 50);
    return filterBlacklisted(list, prefsRef.current.blacklist);
  }, []);

  // Autoplay radio: similar songs appended when the queue runs out
  continueWithSimilarRef.current = (seed: Track) => {
    (async () => {
      const recent = new Set(
        queueRef.current.slice(-60).map((t) => `${t.title}|${t.artist}`.toLowerCase())
      );
      const pools = await Promise.all([
        searchItunesTracks(seed.artist, 15, 'VN'),
        searchItunesTracks(
          `${seed.genre || ''} ${seed.artist.split(',')[0]} similar`.trim(),
          15,
          'VN'
        ),
      ]);
      const fresh = filterBlacklisted(
        pools.flat().filter((t) => !recent.has(`${t.title}|${t.artist}`.toLowerCase())),
        prefsRef.current.blacklist
      );
      const uniq = Array.from(new Map(fresh.map((t) => [t.id, t])).values())
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
      if (uniq.length === 0) {
        audioEngine.pause();
        setIsPlaying(false);
        return;
      }
      const start = queueRef.current.length;
      setQueue((prev) => [...prev, ...uniq]);
      setQueueIndex(start);
      internalStartTrack(uniq[0]);
      showToast(
        prefsRef.current.language === 'vi'
          ? 'Tự phát tiếp: bài tương tự ♪'
          : 'Autoplay: similar songs ♪'
      );
    })().catch(() => undefined);
  };

  const openMusicLink = useCallback(
    async (
      text: string,
      onProgress?: (done: number, total: number) => void
    ): Promise<LinkResult> => {
      const link = parseMusicLink(text);
      const isVi = prefsRef.current.language === 'vi';
      if (!link)
        return { kind: 'none', message: isVi ? 'Không nhận ra liên kết này' : 'Unrecognised link' };
      if (link.kind === 'youtube-video') {
        const t = await youtubeVideoTrack(link.id);
        await playTrack(t, [t]);
        setIsPlayerOpen(true);
        return { kind: 'played', title: t.title };
      }
      if (link.kind === 'youtube-playlist') {
        const pl = await fetchYouTubePlaylist(link.id);
        if (!pl || pl.tracks.length === 0) {
          return {
            kind: 'none',
            message: isVi
              ? Platform.OS === 'web'
                ? 'Playlist YouTube chỉ nhập được trên app iOS'
                : 'Không đọc được playlist (riêng tư hoặc bị chặn)'
              : 'Could not read this playlist',
          };
        }
        const tracks = filterBlacklisted(pl.tracks, prefsRef.current.blacklist);
        return {
          kind: 'playlist',
          playlist: savePlaylistFromTracks(pl.name, tracks, `YouTube · ${tracks.length}`),
        };
      }
      if (link.kind === 'spotify') {
        const ent = await fetchSpotifyEntity(link.type, link.id);
        if (!ent || ent.items.length === 0) {
          return {
            kind: 'none',
            message: isVi
              ? Platform.OS === 'web' && link.type !== 'track'
                ? 'Playlist Spotify chỉ nhập được trên app iOS (trình duyệt chặn CORS)'
                : 'Không đọc được liên kết Spotify (playlist phải công khai)'
              : 'Could not read this Spotify link (must be public)',
          };
        }
        const tracks = await matchSongList(ent.items, onProgress);
        if (tracks.length === 0)
          return {
            kind: 'none',
            message: isVi ? 'Không tìm thấy bài nào khớp' : 'No matches found',
          };
        if (link.type === 'track') {
          await playTrack(tracks[0], tracks);
          setIsPlayerOpen(true);
          return { kind: 'played', title: tracks[0].title };
        }
        return {
          kind: 'playlist',
          playlist: savePlaylistFromTracks(
            ent.name,
            tracks,
            `Spotify · ${tracks.length}/${ent.items.length} ${isVi ? 'bài khớp' : 'matched'}`,
            ent.coverUrl
          ),
        };
      }
      if (link.kind === 'apple') {
        if (link.type === 'song') {
          const album = await fetchAlbumDetails(link.id);
          const t = album?.tracks?.find((x) => x.id.endsWith(link.id)) || album?.tracks?.[0];
          if (t) {
            await playTrack(t, [t]);
            setIsPlayerOpen(true);
            return { kind: 'played', title: t.title };
          }
        } else if (link.type === 'album') {
          const album = await fetchAlbumDetails(link.id);
          if (album?.tracks?.length) {
            return {
              kind: 'playlist',
              playlist: savePlaylistFromTracks(
                album.title,
                album.tracks,
                `Apple Music · ${album.artist}`,
                album.artworkUrl
              ),
            };
          }
        }
        return {
          kind: 'none',
          message: isVi ? 'Chưa hỗ trợ liên kết Apple Music này' : 'Unsupported Apple Music link',
        };
      }
      return {
        kind: 'none',
        message: isVi
          ? 'Hỗ trợ: YouTube / YouTube Music (bài, playlist), Spotify (bài, playlist, album), Apple Music'
          : 'Supported: YouTube / YouTube Music, Spotify, Apple Music links',
      };
    },
    [matchSongList, playTrack, savePlaylistFromTracks]
  );

  const searchSuggestions = useCallback(
    async (q: string): Promise<string[]> => {
      const term = q.trim().toLowerCase();
      if (term.length < 2) return [];
      const local = searchHistory.filter((s) => s.toLowerCase().startsWith(term)).slice(0, 3);
      let remote: string[] = [];
      if (prefsRef.current.searchSuggestions) {
        remote = await fetchInnerTubeSuggestions(term).catch(() => []);
        if (remote.length === 0) {
          // browser preview: Apple catalog titles as hints (CORS-enabled)
          const hits = await searchItunesTracks(term, 6, 'VN').catch(() => [] as Track[]);
          remote = hits.map((t) => `${t.title} ${t.artist}`.trim());
        }
      }
      const seen = new Set<string>();
      return [...local, ...remote]
        .filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 8);
    },
    [searchHistory]
  );

  const addTracksToPlaylist = useCallback(
    (playlistId: string, tracks: Track[]) => {
      setPlaylists((prev) => {
        const next = prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          const have = new Set(pl.trackIds);
          const merged = [...pl.tracks, ...tracks.filter((t) => !have.has(t.id))];
          return {
            ...pl,
            tracks: merged,
            trackIds: merged.map((t) => t.id),
            coverUrl: pl.coverUrl || merged[0]?.artworkUrl,
            updatedAt: Date.now(),
          };
        });
        StorageService.savePlaylists(next);
        return next;
      });
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã thêm ${tracks.length} bài vào playlist`
          : `Added ${tracks.length} songs`
      );
    },
    [showToast]
  );

  const removeTracksFromPlaylist = useCallback((playlistId: string, trackIds: string[]) => {
    const drop = new Set(trackIds);
    setPlaylists((prev) => {
      const next = prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const kept = pl.tracks.filter((t) => !drop.has(t.id));
        return { ...pl, tracks: kept, trackIds: kept.map((t) => t.id), updatedAt: Date.now() };
      });
      StorageService.savePlaylists(next);
      return next;
    });
  }, []);

  const updatePlaylist = useCallback(
    (
      id: string,
      patch: { name?: string; description?: string; coverUrl?: string | null; tracks?: Track[] }
    ) => {
      setPlaylists((prev) => {
        const next = prev.map((pl) => {
          if (pl.id !== id) return pl;
          const out = { ...pl, updatedAt: Date.now() };
          if (patch.name !== undefined) out.name = patch.name.trim() || pl.name;
          if (patch.description !== undefined)
            out.description = patch.description.trim() || undefined;
          if (patch.coverUrl !== undefined && patch.coverUrl !== pl.coverUrl) {
            LocalLibrary.forgetImage(pl.coverUrl);
            out.coverUrl = patch.coverUrl || undefined;
          }
          if (patch.tracks) {
            out.tracks = patch.tracks;
            out.trackIds = patch.tracks.map((t) => t.id);
          }
          return out;
        });
        StorageService.savePlaylists(next);
        return next;
      });
    },
    []
  );

  const movePlaylistTrack = useCallback((id: string, from: number, to: number) => {
    setPlaylists((prev) => {
      const next = prev.map((pl) => {
        if (pl.id !== id || from === to) return pl;
        if (from < 0 || from >= pl.tracks.length) return pl;
        const tracks = [...pl.tracks];
        const [t] = tracks.splice(from, 1);
        tracks.splice(Math.max(0, Math.min(tracks.length, to)), 0, t);
        return { ...pl, tracks, trackIds: tracks.map((x) => x.id), updatedAt: Date.now() };
      });
      StorageService.savePlaylists(next);
      return next;
    });
  }, []);

  const switchToVideoAudio = useCallback(
    (mvId: string) => {
      const cur = currentTrackRef.current;
      if (!cur || cur.mvId === mvId) return;
      const next = { ...cur, mvId };
      setQueue((prev) => prev.map((t) => (t.id === cur.id ? next : t)));
      internalStartTrack(next, PlaybackClock.get());
    },
    [internalStartTrack]
  );

  const removeDownloads = useCallback(
    async (trackIds: string[]) => {
      const cur = downloadsRef.current;
      const metas = trackIds.map((id) => cur[id]).filter(Boolean);
      for (const m of metas) await StorageService.removeDownloadedFile(m);
      setDownloads((prev) => {
        const copy = { ...prev };
        trackIds.forEach((id) => delete copy[id]);
        StorageService.saveDownloads(copy);
        return copy;
      });
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã xoá ${metas.length} bản tải`
          : `Removed ${metas.length} downloads`
      );
    },
    [showToast]
  );

  const setDownloadsFolder = useCallback((trackIds: string[], folder: string | null) => {
    const name = folder?.trim() || undefined;
    setDownloads((prev) => {
      const copy = { ...prev };
      trackIds.forEach((id) => {
        if (copy[id]) copy[id] = { ...copy[id], folder: name };
      });
      StorageService.saveDownloads(copy);
      return copy;
    });
  }, []);

  const moveDownloadsToLocal = useCallback(
    async (trackIds: string[], dir: string) => {
      const cur = downloadsRef.current;
      const metas = trackIds.map((id) => cur[id]).filter(Boolean);
      if (!metas.length) return 0;
      const items = metas.map((m) => {
        const t = m.track;
        const ext = (
          m.localUri.match(/\.(m4a|flac|mp3|aac|mp4|wav)(?:$|\?)/i)?.[1] || 'm4a'
        ).toLowerCase();
        return {
          uri: m.localUri,
          name: `${t.artist ? `${t.artist} - ` : ''}${t.title}.${ext}`,
          edit: {
            title: t.title,
            artist: t.artist,
            album: t.album,
          },
          cover: /^https?:/i.test(t.artworkUrl || '') ? t.artworkUrl : undefined,
        };
      });
      const moved = await LocalLibrary.adopt(items, dir);
      const map: Record<string, Track> = {};
      const done: string[] = [];
      metas.forEach((m, i) => {
        const nt = moved[i];
        if (nt) {
          map[m.track.id] = nt;
          done.push(m.track.id);
        }
      });
      applyTrackRemap(map);
      // the files were moved, so only the records go
      setDownloads((prev) => {
        const copy = { ...prev };
        done.forEach((id) => delete copy[id]);
        StorageService.saveDownloads(copy);
        return copy;
      });
      return done.length;
    },
    [applyTrackRemap]
  );

  const likeTracks = useCallback(
    (tracks: Track[]) => {
      setLikedTracks((prev) => {
        const have = new Set(prev.map((t) => t.id));
        const next = [...tracks.filter((t) => !have.has(t.id)), ...prev];
        StorageService.saveLikedTracks(next);
        return next;
      });
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã thích ${tracks.length} bài ♥`
          : `Liked ${tracks.length} songs ♥`
      );
    },
    [showToast]
  );

  const queueTracks = useCallback(
    (tracks: Track[], next = false) => {
      setQueue((prev) => {
        const copy = [...prev];
        if (next && copy.length > 0) copy.splice(queueIndexRef.current + 1, 0, ...tracks);
        else copy.push(...tracks);
        return copy;
      });
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã thêm ${tracks.length} bài vào hàng chờ`
          : `Queued ${tracks.length} songs`
      );
    },
    [showToast]
  );

  const isBlocked = useCallback(
    (track: Track) => isBlacklisted(track, prefs.blacklist),
    [prefs.blacklist]
  );
  const blockTrack = useCallback(
    (track: Track) => {
      const bl = prefsRef.current.blacklist;
      if (bl.tracks.some((t) => t.id === track.id)) return;
      updatePrefs({
        blacklist: {
          ...bl,
          tracks: [...bl.tracks, { id: track.id, title: track.title, artist: track.artist }],
        },
      });
      setQueue((prev) => prev.filter((t, i) => i === queueIndexRef.current || t.id !== track.id));
      showToast(
        prefsRef.current.language === 'vi' ? `Đã chặn "${track.title}"` : `Blocked "${track.title}"`
      );
    },
    [showToast, updatePrefs]
  );
  const blockArtist = useCallback(
    (name: string) => {
      const bl = prefsRef.current.blacklist;
      const clean = name.split(/,|&| feat\.?| ft\./i)[0].trim();
      if (!clean || bl.artists.some((a) => a.toLowerCase() === clean.toLowerCase())) return;
      updatePrefs({ blacklist: { ...bl, artists: [...bl.artists, clean] } });
      showToast(
        prefsRef.current.language === 'vi' ? `Đã chặn nghệ sĩ ${clean}` : `Blocked artist ${clean}`
      );
    },
    [showToast, updatePrefs]
  );
  const unblockTrack = useCallback(
    (id: string) => {
      const bl = prefsRef.current.blacklist;
      updatePrefs({ blacklist: { ...bl, tracks: bl.tracks.filter((t) => t.id !== id) } });
    },
    [updatePrefs]
  );
  const unblockArtist = useCallback(
    (name: string) => {
      const bl = prefsRef.current.blacklist;
      updatePrefs({ blacklist: { ...bl, artists: bl.artists.filter((a) => a !== name) } });
    },
    [updatePrefs]
  );

  const exportLibrary = useCallback(async () => {
    try {
      const { onboarded: _o, ...prefsToSave } = prefsRef.current;
      const name = await exportBackupFile(
        buildBackup({
          likedTracks,
          playlists,
          history,
          searchHistory,
          prefs: prefsToSave,
          audioLab,
        })
      );
      showToast(prefsRef.current.language === 'vi' ? `Đã xuất ${name}` : `Exported ${name}`);
    } catch (e: any) {
      showToast(String(e?.message || 'Export failed'));
    }
  }, [audioLab, history, likedTracks, playlists, searchHistory, showToast]);

  const pickLibraryBackup = useCallback(async () => {
    const text = await pickBackupFile();
    if (!text) return null;
    const backup = parseBackup(text);
    return { backup, preview: previewBackup(backup, { likedTracks, playlists }) };
  }, [likedTracks, playlists]);

  const applyLibraryBackup = useCallback(
    (backup: LibraryBackup, mode: 'merge' | 'replace', includeSettings: boolean) => {
      const merged = mergeLibrary({ likedTracks, playlists, history, searchHistory }, backup, mode);
      setLikedTracks(merged.likedTracks);
      StorageService.saveLikedTracks(merged.likedTracks);
      setPlaylists(merged.playlists);
      StorageService.savePlaylists(merged.playlists);
      setHistory(merged.history);
      StorageService.saveHistory(merged.history);
      setSearchHistory(merged.searchHistory);
      StorageService.saveSearchHistory(merged.searchHistory);
      if (includeSettings && backup.prefs) {
        const { onboarded: _o, ...rest } = backup.prefs;
        updatePrefs({ ...rest, onboarded: true } as Partial<HolySicPreferences>);
      }
      if (includeSettings && backup.audioLab) {
        const lab = { ...DEFAULT_AUDIO_LAB, ...backup.audioLab };
        setAudioLab(lab);
        StorageService.saveAudioLab(lab);
        audioEngine.applyAudioLab(lab);
      }
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã khôi phục (${mode === 'merge' ? 'gộp' : 'thay thế'}): ${merged.likedTracks.length} bài thích, ${merged.playlists.length} playlist`
          : `Restored (${mode}): ${merged.likedTracks.length} liked, ${merged.playlists.length} playlists`
      );
    },
    [history, likedTracks, playlists, searchHistory, showToast, updatePrefs]
  );

  const importLocalFiles = useCallback(async () => {
    try {
      // copies the picked songs (original names) into the Local Files library folder
      const n = await LocalLibrary.importFromPicker('');
      if (n === 0) return 0;
      showToast(
        prefsRef.current.language === 'vi'
          ? `Đã thêm ${n} tệp vào Nhạc trên máy`
          : `Added ${n} files to Local Files`
      );
      return n;
    } catch (e: any) {
      showToast(String(e?.message || 'Import failed'));
      return 0;
    }
  }, [showToast]);

  const connectLastfm = useCallback(async (k: string, s: string, u: string, pw: string) => {
    const name = await Scrobbler.connectLastfm(k, s, u, pw);
    setScrobbleState(Scrobbler.get());
    return name;
  }, []);
  const connectListenBrainz = useCallback(async (token: string) => {
    const name = await Scrobbler.connectListenBrainz(token);
    setScrobbleState(Scrobbler.get());
    return name;
  }, []);
  const disconnectScrobbler = useCallback(async (service: 'lastfm' | 'listenbrainz') => {
    await Scrobbler.disconnect(service);
    setScrobbleState(Scrobbler.get());
  }, []);
  const setScrobbleEnabled = useCallback((enabled: boolean) => {
    Scrobbler.update({ enabled }).then(setScrobbleState);
  }, []);

  const seekBy = useCallback((deltaSec: number) => {
    const target = Math.max(0, PlaybackClock.get() + deltaSec);
    setPositionSec(target);
    audioEngine.seekTo(target);
  }, []);

  // Bit-perfect: engine bypass + output sample rate follows the song (back to normal when off)
  useEffect(() => {
    audioEngine.setBitPerfect(prefs.bitPerfect);
    if (!prefs.bitPerfect) {
      AudioOutput.reset();
      return;
    }
    const facts = sourceFacts(currentTrack, resolvedStream);
    if (facts.rateHz) {
      AudioOutput.matchSampleRate(facts.rateHz);
      return;
    }
    // rate not in the metadata: use the one measured from the PCM tap once audio flows
    const t = setTimeout(() => {
      const measured = audioEngine.measuredSampleRate();
      if (measured) AudioOutput.matchSampleRate(measured);
    }, 3500);
    return () => clearTimeout(t);
  }, [prefs.bitPerfect, currentTrack, resolvedStream]);

  // Re-apply normalisation immediately when the switch changes
  useEffect(() => {
    if (currentTrack)
      audioEngine.setGainMultiplier(
        Loudness.multiplier(currentTrack, resolvedStream, prefs.normalizeVolume)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.normalizeVolume]);

  const loudnessLabel = useMemo(
    () =>
      currentTrack && prefs.normalizeVolume && !prefs.bitPerfect
        ? Loudness.describe(currentTrack, resolvedStream)
        : null,
    [currentTrack, prefs.normalizeVolume, prefs.bitPerfect, resolvedStream]
  );

  const [importSheet, setImportSheet] = useState<{ mode: 'link' | 'list'; text: string } | null>(
    null
  );
  const [chartsSheet, setChartsSheet] = useState<{ genre: number | null } | null>(null);
  const openImport = useCallback(
    (mode: 'link' | 'list', text = '') => setImportSheet({ mode, text }),
    []
  );
  const closeImport = useCallback(() => setImportSheet(null), []);
  const openCharts = useCallback((genre: number | null = null) => setChartsSheet({ genre }), []);
  const closeCharts = useCallback(() => setChartsSheet(null), []);
  const [radioOpen, setRadioOpen] = useState(false);
  const openRadio = useCallback(() => setRadioOpen(true), []);
  const closeRadio = useCallback(() => setRadioOpen(false), []);
  const isFavoriteStation = useCallback(
    (id: string) => (prefs.favoriteStations || []).some((x) => x.id === id),
    [prefs.favoriteStations]
  );
  const toggleFavoriteStation = useCallback(
    (station: Track) => {
      const list = prefsRef.current.favoriteStations || [];
      const has = list.some((x) => x.id === station.id);
      triggerHaptic('light');
      updatePrefs({
        favoriteStations: has
          ? list.filter((x) => x.id !== station.id)
          : [station, ...list].slice(0, 60),
      });
      showToast(
        prefsRef.current.language === 'vi'
          ? has
            ? 'Đã bỏ lưu đài'
            : 'Đã lưu đài radio'
          : has
            ? 'Station removed'
            : 'Station saved'
      );
    },
    [showToast, updatePrefs]
  );

  // Per-song lyrics delay (Spotube) — kept for the 300 most recent songs
  const nudgeLyricsOffset = useCallback(
    (delta: number | 'reset') => {
      const tr = currentTrackRef.current;
      if (!tr) return;
      triggerHaptic('selection');
      const map = { ...(prefsRef.current.lyricsOffsets || {}) };
      const cur = map[tr.id] ?? 0;
      const next = delta === 'reset' ? 0 : Math.max(-10000, Math.min(10000, cur + delta));
      delete map[tr.id];
      if (next !== 0) map[tr.id] = next;
      const keys = Object.keys(map);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete map[k];
      updatePrefs({ lyricsOffsets: map });
    },
    [updatePrefs]
  );

  const shareTrack = useCallback(
    async (track: Track) => {
      try {
        await shareTrackSheet(track);
        if (Platform.OS === 'web' && !(globalThis as any).navigator?.share) {
          showToast(prefsRef.current.language === 'vi' ? 'Đã sao chép liên kết' : 'Link copied');
        }
      } catch {
        /* user cancelled */
      }
    },
    [showToast]
  );

  const exportDownload = useCallback(
    async (trackId: string) => {
      const meta = downloadsRef.current[trackId];
      const vi = prefsRef.current.language === 'vi';
      if (!meta) {
        showToast(vi ? 'Bài này chưa được tải xuống' : 'This song is not downloaded');
        return;
      }
      const ok = await exportDownloadToFiles(meta).catch(() => false);
      if (!ok)
        showToast(vi ? 'Không xuất được tệp trên thiết bị này' : 'Could not export the file here');
    },
    [showToast]
  );

  const extras = useMemo<HolySicExtras>(
    () => ({
      isOnline,
      prefsReady,
      importSheet,
      openImport,
      closeImport,
      chartsSheet,
      openCharts,
      radioOpen,
      openRadio,
      closeRadio,
      isFavoriteStation,
      toggleFavoriteStation,
      closeCharts,
      fetchChart,
      openMusicLink,
      matchSongList,
      savePlaylistFromTracks,
      searchSuggestions,
      addTracksToPlaylist,
      likeTracks,
      queueTracks,
      removeTracksFromPlaylist,
      updatePlaylist,
      movePlaylistTrack,
      removeDownloads,
      switchToVideoAudio,
      setDownloadsFolder,
      moveDownloadsToLocal,
      isBlocked,
      blockTrack,
      blockArtist,
      unblockTrack,
      unblockArtist,
      exportLibrary,
      pickLibraryBackup,
      applyLibraryBackup,
      importLocalFiles,
      scrobble: scrobbleState,
      connectLastfm,
      connectListenBrainz,
      disconnectScrobbler,
      setScrobbleEnabled,
      seekBy,
      loudnessLabel,
    }),
    [
      isOnline,
      prefsReady,
      importSheet,
      openImport,
      closeImport,
      chartsSheet,
      openCharts,
      radioOpen,
      openRadio,
      closeRadio,
      isFavoriteStation,
      toggleFavoriteStation,
      closeCharts,
      fetchChart,
      openMusicLink,
      matchSongList,
      savePlaylistFromTracks,
      searchSuggestions,
      addTracksToPlaylist,
      likeTracks,
      queueTracks,
      removeTracksFromPlaylist,
      updatePlaylist,
      movePlaylistTrack,
      removeDownloads,
      switchToVideoAudio,
      setDownloadsFolder,
      moveDownloadsToLocal,
      isBlocked,
      blockTrack,
      blockArtist,
      unblockTrack,
      unblockArtist,
      exportLibrary,
      pickLibraryBackup,
      applyLibraryBackup,
      importLocalFiles,
      scrobbleState,
      connectLastfm,
      connectListenBrainz,
      disconnectScrobbler,
      setScrobbleEnabled,
      seekBy,
      loudnessLabel,
    ]
  );

  const openCollection = useCallback((target: CollectionTarget | null) => {
    triggerHaptic('light');
    setCollectionTarget(target);
  }, []);

  const baseValue = useMemo<Omit<HolySicContextValue, keyof HolySicExtras>>(
    () => ({
      activeTab,
      setActiveTab,
      collectionTarget,
      openCollection,
      isPlayerOpen,
      setIsPlayerOpen,
      isAudioLabOpen,
      setIsAudioLabOpen,
      isRecapOpen,
      setIsRecapOpen,
      actionTrack,
      setActionTrack,
      showToast,
      prefs,
      updatePrefs,
      palette,
      darkPalette,
      artColors,
      ambient,
      quickPicks,
      vnTrending,
      globalTrending,
      featuredAlbums,
      isLoadingHome,
      refreshHomeFeeds,
      searchTracks,
      searchHistory,
      addSearchHistory,
      clearSearchHistory,
      currentTrack,
      resolvedStream,
      isPlaying,
      isBuffering,
      durationSec,
      volume,
      queue,
      queueIndex,
      shuffle,
      repeatMode,
      playTrack,
      togglePlay,
      playNext,
      playPrevious,
      seekTo,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearUpcoming,
      shareTrack,
      exportDownload,
      jumpToQueueIndex,
      startInstantMix,
      lyrics,
      isLoadingLyrics,
      reloadLyrics,
      lyricsOffsetSec,
      nudgeLyricsOffset,
      sleepActive,
      sleepEndOfTrack,
      setSleepTimer,
      likedTracks,
      isLiked,
      toggleLike,
      playlists,
      createPlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      importPlaylistText,
      downloads,
      downloadingIds,
      downloadTrack,
      removeDownload,
      history,
      audioLab,
      updateAudioLab,
      applyEqPreset,
      monochromeServers,
      addMonochromeServer,
      removeMonochromeServer,
      verifyAllServers,
      haptic: triggerHaptic,
      loadAlbumFull: fetchAlbumDetails,
      loadArtistFull: fetchArtistDetails,
    }),
    [
      activeTab,
      collectionTarget,
      openCollection,
      isPlayerOpen,
      isAudioLabOpen,
      isRecapOpen,
      actionTrack,
      showToast,
      prefs,
      updatePrefs,
      palette,
      darkPalette,
      artColors,
      ambient,
      quickPicks,
      vnTrending,
      globalTrending,
      featuredAlbums,
      isLoadingHome,
      refreshHomeFeeds,
      searchTracks,
      searchHistory,
      addSearchHistory,
      clearSearchHistory,
      currentTrack,
      resolvedStream,
      isPlaying,
      isBuffering,
      durationSec,
      volume,
      queue,
      queueIndex,
      shuffle,
      repeatMode,
      playTrack,
      togglePlay,
      playNext,
      playPrevious,
      seekTo,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearUpcoming,
      shareTrack,
      exportDownload,
      jumpToQueueIndex,
      startInstantMix,
      lyrics,
      isLoadingLyrics,
      reloadLyrics,
      lyricsOffsetSec,
      nudgeLyricsOffset,
      sleepActive,
      sleepEndOfTrack,
      setSleepTimer,
      likedTracks,
      isLiked,
      toggleLike,
      playlists,
      createPlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      importPlaylistText,
      downloads,
      downloadingIds,
      downloadTrack,
      removeDownload,
      history,
      audioLab,
      updateAudioLab,
      applyEqPreset,
      monochromeServers,
      addMonochromeServer,
      removeMonochromeServer,
      verifyAllServers,
    ]
  );

  const value = useMemo<HolySicContextValue>(
    () => ({ ...baseValue, ...extras }),
    [baseValue, extras]
  );

  return <HolySicContext.Provider value={value}>{children}</HolySicContext.Provider>;
};

export function useHolySic(): HolySicContextValue {
  const ctx = useContext(HolySicContext);
  if (!ctx) throw new Error('useHolySic must be used inside HolySicProvider');
  return ctx;
}
