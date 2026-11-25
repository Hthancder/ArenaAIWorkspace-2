// Mochy Music Preferences & Enums — faithfully ported from PreferenceKeys.kt in realidkroo/Mochy-Music

export type MainTab = 'home' | 'search' | 'library' | 'settings';

export type PlayerStyle =
  | 'FLAGSHIP'
  | 'TURNTABLE'
  | 'IPOD'
  | 'POSTER'
  | 'BEDSIDE';

export type PlayerBackgroundStyle =
  | 'APPLE_MUSIC'
  | 'COVER_GRADIENT'
  | 'AMBIENT'
  | 'DARK_GRADIENT'
  | 'SOLID';

export type IpodTheme = 'SILVER' | 'BLACK' | 'U2' | 'TRUE_DARK';

export type BedsideClockFace = 'BIG' | 'STACKED' | 'COVER';
export type BedsideNightTint = 'OFF' | 'ORANGE' | 'COVER';

export type LyricsPosition = 'LEFT' | 'CENTER' | 'RIGHT';

export type RepeatMode = 'OFF' | 'ALL' | 'ONE';

export type AppLanguage = 'vi' | 'en';

export type AppFontStyle = 'inter' | 'system' | 'rounded' | 'mono' | 'serif';

export type JioSaavnQuality = '320' | '160' | '96';

export interface MochyPreferences {
  language: AppLanguage;
  pureBlack: boolean;
  enableBlur: boolean;
  animationSpeed: number; // 0.6x .. 1.8x
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
  preferredJioSaavnQuality: JioSaavnQuality;
  moduleOrder: ('monochrome' | 'jiosaavn' | 'innertube' | 'itunes')[];
  enabledModules: {
    monochrome: boolean;
    jiosaavn: boolean;
    innertube: boolean;
    itunes: boolean;
  };
}

export const DEFAULT_PREFERENCES: MochyPreferences = {
  language: 'vi',
  pureBlack: false,
  enableBlur: true,
  animationSpeed: 1.0,
  fontStyle: 'inter',
  playerStyle: 'FLAGSHIP',
  playerBackground: 'APPLE_MUSIC',
  ipodTheme: 'BLACK',
  bedsideClockFace: 'BIG',
  bedsideNightTint: 'ORANGE',
  lyricsPosition: 'LEFT',
  showMiniLyricsTicker: true,
  showRemainingTime: false,
  autoPlaySimilar: true,
  preferredJioSaavnQuality: '320',
  moduleOrder: ['monochrome', 'jiosaavn', 'innertube', 'itunes'],
  enabledModules: {
    monochrome: true,
    jiosaavn: true,
    innertube: true,
    itunes: true,
  },
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
    descVi: 'Mặt kính mờ, chuyển màu động theo bìa đĩa & thanh điều khiển chuẩn Mochy',
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
    titleEn: 'Poster Stage',
    descVi: 'Ảnh bìa tràn viền kết hợp dải sóng nhạc đồng bộ nhịp điệu',
    descEn: 'Full-bleed poster artwork with reactive audio spectrum bars',
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
