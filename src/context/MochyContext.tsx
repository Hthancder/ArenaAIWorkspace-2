// Global Reactive State & Playback Controller for Mochy Music iOS

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
import { Platform } from 'react-native';
import {
  DEFAULT_PREFERENCES,
  MainTab,
  MochyPreferences,
  RepeatMode,
} from '../constants/preferences';
import { ArtworkPalette, buildArtworkPalette } from '../constants/theme';
import { AUTO_EQ_PRESETS, OFFLINE_SHOWCASE_TRACKS } from '../data/curatedCatalog';
import { audioEngine } from '../services/audio/audioEngine';
import { StreamFileCache } from '../services/audio/streamFileCache';
import { fetchLyricsForTrack } from '../services/lyrics/lyricsService';
import { searchInnerTubeTracks } from '../services/providers/innertubeProvider';
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
import { createStreamCandidateQueue } from '../services/providers/streamResolver';
import { DEFAULT_AUDIO_LAB, StorageService } from '../services/storage/storageService';
import {
  AlbumSummary,
  ArtistSummary,
  AudioLabSettings,
  DownloadedTrackMeta,
  ListeningEvent,
  LyricsData,
  ModuleServerConfig,
  MusicSourceId,
  Playlist,
  ResolvedStream,
  Track,
} from '../types/music';

export type CollectionTarget =
  | { kind: 'album'; id: string; summary?: AlbumSummary }
  | { kind: 'artist'; id: string; name: string; summary?: ArtistSummary }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'liked' }
  | { kind: 'offline' };

interface MochyContextValue {
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
  toastMessage: string | null;
  showToast: (msg: string) => void;

  // Preferences & Theme
  prefs: MochyPreferences;
  updatePrefs: (patch: Partial<MochyPreferences>) => void;
  palette: ArtworkPalette;

  // Discovery Feeds & Search
  quickPicks: Track[];
  vnTrending: Track[];
  globalTrending: Track[];
  featuredAlbums: AlbumSummary[];
  isLoadingHome: boolean;
  refreshHomeFeeds: () => Promise<void>;
  searchTracks: (
    query: string,
    sourceFilter?: 'all' | MusicSourceId
  ) => Promise<{ tracks: Track[]; albums: AlbumSummary[] }>;
  searchHistory: string[];
  addSearchHistory: (q: string) => void;
  clearSearchHistory: () => void;

  // Playback & Queue
  currentTrack: Track | null;
  resolvedStream: ResolvedStream | null;
  isPlaying: boolean;
  isBuffering: boolean;
  positionSec: number;
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
  jumpToQueueIndex: (index: number) => void;
  startInstantMix: (seedQuery?: string) => Promise<void>;

  // Lyrics
  lyrics: LyricsData | null;
  isLoadingLyrics: boolean;
  activeLyricIndex: number;

  // Sleep Timer
  sleepRemainingSec: number | null;
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

const MochyContext = createContext<MochyContextValue | null>(null);

export function triggerHaptic(kind: 'light' | 'medium' | 'selection' = 'light'): void {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'selection') {
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

export const MochyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [collectionTarget, setCollectionTarget] = useState<CollectionTarget | null>(null);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isAudioLabOpen, setIsAudioLabOpen] = useState(false);
  const [isRecapOpen, setIsRecapOpen] = useState(false);
  const [actionTrack, setActionTrack] = useState<Track | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<MochyPreferences>(DEFAULT_PREFERENCES);
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
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(OFFLINE_SHOWCASE_TRACKS[0].durationSec);
  const [volume, setVolumeState] = useState(0.9);
  const [queue, setQueue] = useState<Track[]>(OFFLINE_SHOWCASE_TRACKS);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('OFF');

  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);

  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
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

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const repeatRef = useRef(repeatMode);
  const shuffleRef = useRef(shuffle);
  const sleepEndTrackRef = useRef(sleepEndOfTrack);
  const prefsRef = useRef(prefs);
  const serversRef = useRef(monochromeServers);
  const downloadsRef = useRef(downloads);
  const volumeRef = useRef(volume);

  queueRef.current = queue;
  queueIndexRef.current = queueIndex;
  repeatRef.current = repeatMode;
  shuffleRef.current = shuffle;
  sleepEndTrackRef.current = sleepEndOfTrack;
  prefsRef.current = prefs;
  serversRef.current = monochromeServers;
  downloadsRef.current = downloads;
  volumeRef.current = volume;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2600);
  }, []);

  const palette = useMemo(
    () =>
      buildArtworkPalette(
        currentTrack ? `${currentTrack.title}-${currentTrack.artist}` : 'mochy-default'
      ),
    [currentTrack]
  );

  // Hydrate persistent storage
  useEffect(() => {
    (async () => {
      const [
        savedPrefs,
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
      ]);

      setPrefs(savedPrefs);
      setLikedTracks(savedLiked);
      if (savedPlaylists.length > 0) {
        setPlaylists(savedPlaylists);
      } else {
        const starter: Playlist = {
          id: 'pl-late-night',
          name: 'Đêm Hà Nội Chill >_<',
          description: 'Giai điệu êm dịu nghe lúc nửa đêm trên Mochy',
          coverTint: '#6366F1',
          trackIds: OFFLINE_SHOWCASE_TRACKS.map((t) => t.id),
          tracks: OFFLINE_SHOWCASE_TRACKS,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setPlaylists([starter]);
      }
      setHistory(savedHistory);
      setDownloads(savedDownloads);
      setAudioLab(savedLab);
      audioEngine.applyAudioLab(savedLab);
      setMonochromeServers(savedServers);
      if (savedSearches.length > 0) setSearchHistory(savedSearches);
    })();
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

      if (picksSongs.length > 0) {
        setQuickPicks([...picksSongs.slice(0, 10), ...OFFLINE_SHOWCASE_TRACKS]);
      }
      if (vnSongs.length > 0) setVnTrending(vnSongs);
      if (globalSongs.length > 0) setGlobalTrending(globalSongs);
      if (albums.length > 0) setFeaturedAlbums(albums);

      if (picksSongs.length > 0 && currentTrack?.id === OFFLINE_SHOWCASE_TRACKS[0].id && !isPlaying) {
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

  // Load lyrics whenever currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      return;
    }
    let cancelled = false;
    setIsLoadingLyrics(true);
    fetchLyricsForTrack(currentTrack)
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
  }, [currentTrack]);

  const activeLyricIndex = useMemo(() => {
    if (!lyrics || lyrics.lines.length === 0) return -1;
    let active = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (positionSec + 0.15 >= lyrics.lines[i].startSec) {
        active = i;
      } else {
        break;
      }
    }
    return active;
  }, [lyrics, positionSec]);

  const playTokenRef = useRef(0);

  const internalStartTrack = useCallback(
    async (track: Track) => {
      const token = ++playTokenRef.current;
      const isCurrent = () => token === playTokenRef.current;
      const vi = prefsRef.current.language === 'vi';

      setCurrentTrack(track);
      setPositionSec(0);
      setDurationSec(track.durationSec || 180);
      setIsPlaying(false);
      setIsBuffering(true);
      setResolvedStream(null);

      await SourceMemory.load();
      if (!isCurrent()) return;

      const offlineMeta = downloadsRef.current[track.id];
      const queue = createStreamCandidateQueue(
        track,
        prefsRef.current,
        serversRef.current,
        offlineMeta?.localUri
      );

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

          await audioEngine.loadAndPlay(playUrl, track, volumeRef.current, playHeaders);
          if (!isCurrent()) return;

          const local = cand.isOffline || cand.source === 'synth' || /^file:/i.test(playUrl);
          const timeoutMs = local ? 7000 : 12000;
          const result = await audioEngine.waitUntilAudible(timeoutMs);
          if (!isCurrent() || result === 'superseded') return;

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
            if (prefsRef.current.rememberSources) {
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
        if (lastTried) setResolvedStream({ ...lastTried, diagnostics: [...queue.diagnostics] });
        showToast(
          vi
            ? 'Không tìm được bản đầy đủ phát được cho bài này. Xem "Chẩn đoán luồng" trong trình phát để biết lý do.'
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

      // Log listening event for Mochy Recap & History
      setHistory((prev) => {
        const event: ListeningEvent = {
          id: `ev-${Date.now()}-${track.id}`,
          track,
          playedAt: Date.now(),
          listenedSec: Math.min(track.durationSec || 180, 180),
        };
        const updated = [
          event,
          ...prev.filter((e) => e.track.id !== track.id || Date.now() - e.playedAt > 60000),
        ].slice(0, 200);
        StorageService.saveHistory(updated);
        return updated;
      });
    },
    [showToast]
  );

  const playTrack = useCallback(
    async (track: Track, newQueue?: Track[]) => {
      triggerHaptic('light');
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
      await internalStartTrack(track);
    },
    [internalStartTrack]
  );

  const playNext = useCallback(() => {
    triggerHaptic('light');
    const q = queueRef.current;
    if (q.length === 0) return;

    if (shuffleRef.current && q.length > 1) {
      let rand = Math.floor(Math.random() * q.length);
      if (rand === queueIndexRef.current) rand = (rand + 1) % q.length;
      setQueueIndex(rand);
      internalStartTrack(q[rand]);
      return;
    }

    const nextIdx = queueIndexRef.current + 1;
    if (nextIdx < q.length) {
      setQueueIndex(nextIdx);
      internalStartTrack(q[nextIdx]);
    } else if (repeatRef.current === 'ALL') {
      setQueueIndex(0);
      internalStartTrack(q[0]);
    } else {
      audioEngine.pause();
      setIsPlaying(false);
    }
  }, [internalStartTrack]);

  const playPrevious = useCallback(() => {
    triggerHaptic('light');
    if (positionSec > 3.5) {
      audioEngine.seekTo(0);
      setPositionSec(0);
      return;
    }
    const q = queueRef.current;
    if (q.length === 0) return;
    const prevIdx = queueIndexRef.current > 0 ? queueIndexRef.current - 1 : q.length - 1;
    setQueueIndex(prevIdx);
    internalStartTrack(q[prevIdx]);
  }, [internalStartTrack, positionSec]);

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
      if (st.durationSec > 0) setDurationSec(st.durationSec);

      if (st.didJustFinish) {
        if (sleepEndTrackRef.current) {
          setSleepEndOfTrack(false);
          setSleepRemainingSec(null);
          audioEngine.pause();
          showToast(
            prefsRef.current.language === 'vi'
              ? 'Đã dừng nhạc theo hẹn giờ cuối bài'
              : 'Paused at end of track (Sleep Timer)'
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

  // Sleep Timer countdown
  useEffect(() => {
    if (sleepRemainingSec === null || sleepRemainingSec <= 0) return;
    const timer = setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          audioEngine.pause();
          setIsPlaying(false);
          showToast(
            prefsRef.current.language === 'vi'
              ? 'Hẹn giờ ngủ đã tắt nhạc chúc bạn ngủ ngon >_<'
              : 'Sleep timer paused playback — goodnight >_<'
          );
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sleepRemainingSec, showToast]);

  const togglePlay = useCallback(() => {
    triggerHaptic('light');
    if (!currentTrack) return;
    if (!resolvedStream || !audioEngine.hasActiveSource()) {
      internalStartTrack(currentTrack);
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
    setQueue((prev) => prev.filter((_, i) => i !== index));
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
        seedQuery ||
        (currentTrack ? `${currentTrack.artist} chill hits` : 'V-Pop Lo-Fi R&B hits');
      const results = await searchItunesTracks(query, 20, 'VN');
      const pool = results.length > 0 ? results : [...vnTrending, ...OFFLINE_SHOWCASE_TRACKS];
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

  const updatePrefs = useCallback((patch: Partial<MochyPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      StorageService.savePreferences(next);
      return next;
    });
  }, []);

  const searchTracks = useCallback(
    async (
      query: string,
      sourceFilter: 'all' | MusicSourceId = 'all'
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

      return { tracks: merged, albums };
    },
    [monochromeServers, prefs.enabledModules, prefs.preferredJioSaavnQuality]
  );

  const addSearchHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 12);
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
      if (val === null) {
        setSleepRemainingSec(null);
        setSleepEndOfTrack(false);
        showToast(prefs.language === 'vi' ? 'Đã tắt hẹn giờ ngủ' : 'Sleep timer off');
      } else if (val === 'end_of_track') {
        setSleepRemainingSec(null);
        setSleepEndOfTrack(true);
        showToast(
          prefs.language === 'vi'
            ? 'Sẽ dừng phát khi hết bài hiện tại'
            : 'Will stop after current song'
        );
      } else {
        setSleepEndOfTrack(false);
        setSleepRemainingSec(val * 60);
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
        name: name.trim() || 'Mochy Playlist',
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
      showToast(
        prefs.language === 'vi' ? `Đã tạo "${pl.name}"` : `Created "${pl.name}"`
      );
      return pl;
    },
    [playlists.length, prefs.language, showToast]
  );

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((prev) => {
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

  const importPlaylistText = useCallback(
    async (name: string, rawText: string): Promise<Playlist | null> => {
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.replace(/^\d+[.)\s-]+/, '').trim())
        .filter((l) => l.length >= 2 && !l.startsWith('#'))
        .slice(0, 20);
      if (lines.length === 0) return null;

      const matchedTracks: Track[] = [];
      for (const line of lines) {
        const hits = await searchItunesTracks(line, 1, 'VN');
        if (hits[0]) matchedTracks.push(hits[0]);
      }

      const pl: Playlist = {
        id: `pl-import-${Date.now()}`,
        name: name.trim() || 'Imported Playlist',
        description: `Imported ${matchedTracks.length} songs`,
        coverUrl: matchedTracks[0]?.artworkUrl,
        coverTint: '#10B981',
        trackIds: matchedTracks.map((t) => t.id),
        tracks: matchedTracks,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPlaylists((prev) => {
        const next = [pl, ...prev];
        StorageService.savePlaylists(next);
        return next;
      });
      showToast(
        prefs.language === 'vi'
          ? `Đã nhập ${matchedTracks.length} bài vào "${pl.name}"`
          : `Imported ${matchedTracks.length} tracks into "${pl.name}"`
      );
      return pl;
    },
    [prefs.language, showToast]
  );

  const downloadTrack = useCallback(
    async (track: Track) => {
      if (downloads[track.id] || downloadingIds[track.id]) return;
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
        showToast(
          prefs.language === 'vi'
            ? `Đã tải ngoại tuyến: ${track.title}`
            : `Downloaded offline: ${track.title}`
        );
      } catch {
        showToast(
          prefs.language === 'vi' ? 'Không thể tải bài hát này' : 'Download failed'
        );
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
      showToast(
        prefs.language === 'vi' ? 'Đã xoá bản tải ngoại tuyến' : 'Removed offline file'
      );
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

  const openCollection = useCallback((target: CollectionTarget | null) => {
    triggerHaptic('light');
    setCollectionTarget(target);
  }, []);

  const value = useMemo<MochyContextValue>(
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
      toastMessage,
      showToast,
      prefs,
      updatePrefs,
      palette,
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
      positionSec,
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
      jumpToQueueIndex,
      startInstantMix,
      lyrics,
      isLoadingLyrics,
      activeLyricIndex,
      sleepRemainingSec,
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
      toastMessage,
      showToast,
      prefs,
      updatePrefs,
      palette,
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
      positionSec,
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
      jumpToQueueIndex,
      startInstantMix,
      lyrics,
      isLoadingLyrics,
      activeLyricIndex,
      sleepRemainingSec,
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

  return <MochyContext.Provider value={value}>{children}</MochyContext.Provider>;
};

export function useMochy(): MochyContextValue {
  const ctx = useContext(MochyContext);
  if (!ctx) throw new Error('useMochy must be used inside MochyProvider');
  return ctx;
}
