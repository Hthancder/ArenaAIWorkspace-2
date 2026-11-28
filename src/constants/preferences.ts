// HolySic Preferences & Enums — faithfully ported from PreferenceKeys.kt in realidkroo/Mochy-Music

import type { CrossfadeCurve } from '../services/audio/crossfadeCurves';
import type { BgMedia } from '../services/backdrop/backdropMedia';

export type MainTab = 'home' | 'search' | 'library' | 'settings';

export type PlayerStyle = 'FLAGSHIP' | 'TURNTABLE' | 'IPOD' | 'POSTER' | 'BEDSIDE';

export type PlayerBackgroundStyle =
  'APPLE_MUSIC' | 'COVER_GRADIENT' | 'AMBIENT' | 'DARK_GRADIENT' | 'SOLID';

export type IpodTheme = 'SILVER' | 'BLACK' | 'U2' | 'TRUE_DARK';

export type BedsideClockFace = 'BIG' | 'STACKED' | 'COVER';
export type BedsideNightTint = 'OFF' | 'ORANGE' | 'COVER';

export type LyricsPosition = 'LEFT' | 'CENTER' | 'RIGHT';

/** What sits behind the tabs (Home, Search, Library, HolySic) */
export type AppBackdrop = 'plain' | 'color' | 'artwork' | 'ambient' | 'visualizer' | 'media';
export type BackdropVisualizer = 'bars' | 'mirror' | 'wave';
export type DockVisualizer = 'off' | 'bars' | 'glow';
/** how the synced lyrics come alive */
export type LyricsEffect =
  | 'glow'
  | 'karaoke'
  | 'wave'
  | 'depth'
  | 'neon'
  | 'minimal'
  // Phase 20 — from lyric-video typography (focus pull, typewriter, marker, RGB split)
  | 'focus'
  | 'typewriter'
  | 'marker'
  | 'glitch';
export type LyricsSize = 'S' | 'M' | 'L';

/** Background colour presets for the 'color' backdrop (dark tone, light tone) */
export const BACKDROP_COLORS: {
  id: string;
  dark: string;
  light: string;
  vi: string;
  en: string;
}[] = [
  { id: 'midnight', dark: '#181240', light: '#ECE7FA', vi: 'Nửa đêm', en: 'Midnight' },
  { id: 'plum', dark: '#2C1030', light: '#F7E7F2', vi: 'Mận', en: 'Plum' },
  { id: 'ocean', dark: '#0B2440', light: '#E3EEF9', vi: 'Đại dương', en: 'Ocean' },
  { id: 'forest', dark: '#0D2A1B', light: '#E4F3E9', vi: 'Rừng', en: 'Forest' },
  { id: 'ember', dark: '#33160B', light: '#FBEBE2', vi: 'Hồng đào', en: 'Ember' },
  { id: 'gold', dark: '#2E2309', light: '#F9F0DA', vi: 'Hổ phách', en: 'Amber' },
  { id: 'graphite', dark: '#1E1F25', light: '#EBEBEF', vi: 'Than chì', en: 'Graphite' },
];

export type RepeatMode = 'OFF' | 'ALL' | 'ONE';

export type AppLanguage = 'vi' | 'en';

export type AppFontStyle = 'inter' | 'system' | 'rounded' | 'mono' | 'serif';

export type JioSaavnQuality = '320' | '160' | '96';

export type HomeSectionId =
  | 'greeting'
  | 'quickActions'
  | 'quickPicks'
  | 'charts'
  | 'vn'
  | 'global'
  | 'albums'
  | 'recent'
  | 'smartNew'
  | 'smartTop'
  | 'smartForgotten'
  | 'genres'
  | 'radio'
  | 'audius';

export interface BlacklistPref {
  artists: string[];
  tracks: { id: string; title: string; artist: string }[];
}

/** Accent presets (Musike: 8 presets + custom). 'dynamic' = HolySic's colours from the artwork */
export const ACCENT_PRESETS: { id: string; color: string; vi: string; en: string }[] = [
  { id: 'dynamic', color: 'dynamic', vi: 'Theo bìa', en: 'From artwork' },
  { id: 'rose', color: '#FB7185', vi: 'Hồng', en: 'Rose' },
  { id: 'violet', color: '#A78BFA', vi: 'Tím', en: 'Violet' },
  { id: 'sky', color: '#38BDF8', vi: 'Xanh trời', en: 'Sky' },
  { id: 'emerald', color: '#34D399', vi: 'Ngọc bích', en: 'Emerald' },
  { id: 'lime', color: '#A3E635', vi: 'Chanh', en: 'Lime' },
  { id: 'amber', color: '#FBBF24', vi: 'Vàng', en: 'Amber' },
  { id: 'orange', color: '#FB923C', vi: 'Cam', en: 'Orange' },
  { id: 'spotify', color: '#1ED760', vi: 'Xanh lá', en: 'Green' },
];

export interface HolySicPreferences {
  /** 'dynamic' or a #RRGGBB colour (readability is auto-adjusted for the dark UI) */
  accentColor: string;
  hiddenHomeSections: HomeSectionId[];
  /** Loudness normalisation from source ReplayGain / loudness data, with clipping prevention */
  normalizeVolume: boolean;
  /** Restore the last queue & position on launch (paused) */
  resumeQueue: boolean;
  /** Songs & artists never played in mixes, charts, search or autoplay */
  blacklist: BlacklistPref;
  /** Country for the charts / trending section */
  chartCountry: string;
  /** Live search suggestions while typing */
  searchSuggestions: boolean;
  /** Skip talking intros/outros in YouTube music videos (SponsorBlock music_offtopic) */
  skipNonMusic: boolean;
  /** Ambient light (YouTube-style glow from the cover): strength */
  ambientLight: 'off' | 'low' | 'medium' | 'high';
  /** Glow breathes with the music (bass) */
  ambientBreathing: boolean;
  /** Spill the cover's light behind the mini player and the top of Home */
  ambientSpill: boolean;
  /** One-time switch of old default backgrounds to the new ambient backdrop */
  ambientIntroduced: boolean;
  /** Saved live radio stations (as live tracks) */
  favoriteStations: import('../types/music').Track[];
  /** Per-song lyrics delay in ms (positive = lyrics later) */
  lyricsOffsets: Record<string, number>;
  /** Welcome tour finished */
  onboarded: boolean;
  /** Mini player look: HolySic card or OpenSpot-style floating capsule */
  miniPlayerStyle: 'card' | 'capsule';
  language: AppLanguage;
  /** App appearance: dark, light, or follow the system (Auto) */
  themeMode: 'dark' | 'light' | 'auto';
  pureBlack: boolean;
  enableBlur: boolean;
  fontStyle: AppFontStyle;
  playerStyle: PlayerStyle;
  playerBackground: PlayerBackgroundStyle;
  ipodTheme: IpodTheme;
  bedsideClockFace: BedsideClockFace;
  bedsideNightTint: BedsideNightTint;
  lyricsPosition: LyricsPosition;
  showMiniLyricsTicker: boolean;
  showRemainingTime: boolean;
  autoPlaySimilar: boolean;
  /** Crossfade between songs, in seconds (0 = off) */
  crossfadeSec: number;
  /** Shape of the crossfade (see services/audio/crossfadeCurves) */
  crossfadeCurve: CrossfadeCurve;
  /**
   * Bit-perfect: no DSP at all (EQ, normalisation, crossfade, speed), software volume fixed at
   * 100 %, lossless sources first and the output sample rate matched to the song (USB DACs)
   */
  bitPerfect: boolean;
  preferredJioSaavnQuality: JioSaavnQuality;
  moduleOrder: ('monochrome' | 'jiosaavn' | 'innertube' | 'itunes')[];
  /** Fall back to Apple's 30-second preview when no full-length source plays (off = never) */
  allowPreviewFallback: boolean;
  /** Remember the source that played each song and try it first next time */
  rememberSources: boolean;
  /** iOS: prefer sources that start instantly; Monochrome FLAC (needs a one-time download) goes after them */
  preferInstantStart: boolean;
  enabledModules: {
    monochrome: boolean;
    jiosaavn: boolean;
    innertube: boolean;
    itunes: boolean;
  };

  // ── Background & effects (behind the tabs) ──
  appBackdrop: AppBackdrop;
  /** 'color' backdrop: #RRGGBB, or a BACKDROP_COLORS id (follows light / dark) */
  appBgColor: string;
  /** second colour → a top-to-bottom gradient ('' = solid) */
  appBgColor2: string;
  appBgStrength: 'low' | 'medium' | 'high';
  /** artwork / ambient / visualizer backgrounds move with the music */
  appBgReactive: boolean;
  appBgVisualizer: BackdropVisualizer;
  /** 'media' backdrop: your photo / GIF / video and how it is framed and styled */
  appBgMedia: BgMedia | null;
  /** a page's own background (album / playlist / artist / liked / offline — see pageBgKey) */
  pageBackdrops: Record<string, BgMedia>;
  /** pages without their own background show the app's photo / video too */
  pagesUseAppBg: boolean;
  /** a visualizer inside the tab bar */
  dockVisualizer: DockVisualizer;
  /** spectrum frame rate (30 saves battery) */
  visualizerFps: 30 | 60;

  // ── Controls ──
  haptics: 'off' | 'subtle' | 'full';
  /** swipe the mini player / cover to change songs */
  swipeToSkip: boolean;
  tabLabels: boolean;
  /** the floating "offline" pill */
  offlinePill: boolean;
  /** sleep timer fades out over the last N seconds (0 = stop at once) */
  sleepFadeSec: number;
  /** last custom sleep timer length (minutes), offered again in the picker */
  sleepCustomMin: number;
  /** screen stays on while the lyrics are open */
  keepAwakeLyrics: boolean;
  /** tapping a song also opens the full player */
  openPlayerOnPlay: boolean;

  // ── Lyrics & icon ──
  lyricsEffect: LyricsEffect;
  lyricsSize: LyricsSize;
  /** lyrics sources that may be asked (LyricsSourceId → on) */
  lyricsSources: Record<string, boolean>;
  /** keep lyrics on the device for downloaded and on-device songs (offline listening) */
  lyricsKeepOffline: boolean;
  /** Home Screen icon skin (APP_ICON_SKINS id) */
  appIcon: string;

  // ── Music video ──
  /** show the song's music video in the player instead of the cover */
  musicVideo: boolean;
  /** the video's scenes light the player background (blurred, follows the picture) */
  videoAmbient: boolean;
  /** outside the player the last scene stays (still) behind the app */
  videoAmbientApp: boolean;
  /** the scenes keep lighting the background after the camera button hides the picture */
  videoAmbientWhenHidden: boolean;
  /** ambient strength 0..1 */
  videoAmbientLevel: number;
  /** max picture height */
  videoQuality: 360 | 480 | 720 | 1080;
  /** play the audio from the same video, so picture and sound match exactly */
  videoAudio: boolean;
  /** only load videos on Wi-Fi */
  videoWifiOnly: boolean;
  /** load the video by itself when a song starts (off: only when the camera button is tapped) */
  videoAutoPlay: boolean;

  // ── Downloads ──
  /** ask what to bring along (lyrics / music video) each time a song is downloaded */
  downloadAsk: boolean;
  /** downloads bring the lyrics along (the default ticked in the sheet) */
  downloadLyrics: boolean;
  /** downloads bring the music video along (kept for offline viewing) */
  downloadMv: boolean;

  // ── Motion effects (gyroscope) ──
  /** strength of the tilt effects; 'off' never starts the motion sensor */
  motionFx: 'off' | 'low' | 'medium' | 'high';
  /** the player's cover turns in 3D with the phone and catches a sliding light */
  motionCover: boolean;
  /** backgrounds drift with the tilt (player backdrop, your photo / GIF / video background) */
  motionBackdrop: boolean;
  /** vinyl depth: the Turntable deck tilts and its grooves catch a light that follows the angle */
  motionVinyl: boolean;
  /** floating dust in the player, on three depths, glinting with the bass */
  motionDust: boolean;
  /** shake the phone (a quick back-and-forth) to skip to the next song */
  shakeSkip: boolean;

  // ── Library ──
  /** how the playlists list is ordered (pinned ones always stay on top) */
  playlistSort: PlaylistSort;
  playlistView: PlaylistView;
  /** creator name typed last time — pre-filled for the next new playlist */
  playlistCreator: string;

  // ── Picture in Picture ──
  /** PiP floating window shows the current lyric line */
  pipLyrics: boolean;
  /** open PiP by itself when you leave the app while music plays */
  pipAuto: boolean;
  /** what fills the PiP window */
  pipStyle: PipStyle;
  /** the lyrics effect in the floating window ('app' = same as the Lyrics screen) */
  pipEffect: 'app' | LyricsEffect;

  // ── MIDI ──
  /** 'sampled' = real instruments (GeneralUser GS sample bank), 'synth' = light procedural synth */
  midiSound: 'sampled' | 'synth';
  /** piano voice for GM program 0, "bank:program" in the sample bank (see MIDI_PIANOS) */
  midiPiano: string;
  /** download the instruments a MIDI song needs when it plays (else: synth until downloaded) */
  midiAutoDownload: boolean;
}

export type PlaylistSort = 'custom' | 'recent' | 'added' | 'alpha' | 'creator';
export type PlaylistView = 'list' | 'compact' | 'grid';
/** lyrics / card / minimal: 16:9 · square: cover-first 1:1 · bar: lyrics-only strip · stack: portrait */
export type PipStyle = 'lyrics' | 'card' | 'minimal' | 'square' | 'bar' | 'stack';

export const DEFAULT_PREFERENCES: HolySicPreferences = {
  accentColor: 'dynamic',
  hiddenHomeSections: [],
  normalizeVolume: true,
  resumeQueue: true,
  blacklist: { artists: [], tracks: [] },
  chartCountry: 'vn',
  searchSuggestions: true,
  skipNonMusic: true,
  lyricsOffsets: {},
  favoriteStations: [],
  ambientLight: 'medium',
  ambientBreathing: true,
  ambientSpill: true,
  ambientIntroduced: false,
  onboarded: false,
  miniPlayerStyle: 'card',
  language: 'vi',
  themeMode: 'dark',
  pureBlack: false,
  enableBlur: true,
  fontStyle: 'inter',
  playerStyle: 'FLAGSHIP',
  playerBackground: 'AMBIENT',
  ipodTheme: 'BLACK',
  bedsideClockFace: 'BIG',
  bedsideNightTint: 'ORANGE',
  lyricsPosition: 'LEFT',
  showMiniLyricsTicker: true,
  showRemainingTime: false,
  autoPlaySimilar: true,
  crossfadeSec: 0,
  crossfadeCurve: 'equalPower',
  bitPerfect: false,
  preferredJioSaavnQuality: '320',
  moduleOrder: ['monochrome', 'jiosaavn', 'innertube', 'itunes'],
  allowPreviewFallback: false,
  rememberSources: true,
  preferInstantStart: true,
  enabledModules: {
    monochrome: true,
    jiosaavn: true,
    innertube: true,
    itunes: true,
  },
  appBackdrop: 'plain',
  appBgColor: 'midnight',
  appBgColor2: '',
  appBgStrength: 'medium',
  appBgReactive: true,
  appBgVisualizer: 'mirror',
  appBgMedia: null,
  pageBackdrops: {},
  pagesUseAppBg: false,
  dockVisualizer: 'off',
  visualizerFps: 60,
  haptics: 'full',
  swipeToSkip: true,
  tabLabels: true,
  offlinePill: true,
  sleepFadeSec: 20,
  sleepCustomMin: 90,
  keepAwakeLyrics: false,
  openPlayerOnPlay: false,
  lyricsEffect: 'glow',
  lyricsSize: 'M',
  lyricsSources: {},
  lyricsKeepOffline: true,
  appIcon: 'default',
  musicVideo: false,
  videoAmbient: true,
  videoAmbientApp: true,
  videoAmbientWhenHidden: true,
  videoAmbientLevel: 0.6,
  videoQuality: 720,
  videoAudio: true,
  videoWifiOnly: false,
  videoAutoPlay: true,
  downloadAsk: true,
  downloadLyrics: true,
  downloadMv: false,
  motionFx: 'medium',
  motionCover: true,
  motionBackdrop: true,
  motionVinyl: true,
  motionDust: true,
  shakeSkip: false,
  playlistSort: 'custom',
  playlistView: 'list',
  playlistCreator: '',
  pipLyrics: true,
  pipAuto: false,
  pipStyle: 'lyrics',
  pipEffect: 'app',
  midiSound: 'sampled',
  midiPiano: '0:0',
  midiAutoDownload: true,
};

export const PLAYER_STYLE_META: {
  id: PlayerStyle;
  titleVi: string;
  titleEn: string;
  descVi: string;
  descEn: string;
  badge: string;
}[] = [
  {
    id: 'FLAGSHIP',
    titleVi: 'Flagship',
    titleEn: 'Flagship',
    descVi: 'Mặt kính mờ, chuyển màu động theo bìa đĩa & thanh điều khiển chuẩn HolySic',
    descEn: 'Frosted cover fade, moving cover colours & tonal artwork controls',
    badge: 'Mặc định',
  },
  {
    id: 'TURNTABLE',
    titleVi: 'Đầu đĩa than (Turntable)',
    titleEn: 'Turntable',
    descVi: 'Đĩa vinyl xoay thực tế với cần kim đọc nhạc theo thời gian bài hát',
    descEn: 'Spinning vinyl LP record with interactive tonearm seek indicator',
    badge: 'Vinyl',
  },
  {
    id: 'IPOD',
    titleVi: 'iPod Classic',
    titleEn: 'iPod Classic',
    descVi: 'Thân máy iPod cổ điển cùng vòng xoay Click Wheel duyệt nhạc & chỉnh âm',
    descEn: 'Classic iPod body & interactive Click Wheel right inside the player',
    badge: 'Retro',
  },
  {
    id: 'POSTER',
    titleVi: 'Poster & Visualizer',
    titleEn: 'Poster & Visualizer',
    descVi: 'Ảnh bìa + phổ âm thật 32 dải (FFT từ âm thanh đang phát), có vạch đỉnh',
    descEn: 'Artwork + a real 32-band spectrum (FFT of the playing audio) with peak caps',
    badge: 'Stage',
  },
  {
    id: 'BEDSIDE',
    titleVi: 'Đồng hồ đầu giường (Bedside)',
    titleEn: 'Bedside Clock',
    descVi: 'Đồng hồ OLED ban đêm dịu mắt kèm thẻ điều khiển nhạc tối giản',
    descEn: 'Quiet OLED nightstand clock with warm night tint & music tile',
    badge: 'OLED',
  },
];
