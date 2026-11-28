// Settings › the front page: a short, grouped list of doors (iOS Settings style). Each row opens
// its own page; the everyday, personal things come first, the technical ones sit lower down.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { PLAYER_STYLE_META } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { T as UI, themedSheet } from '../../theme/ui';
import { LYRICS_EFFECTS } from '../player/LyricsView';
import { Tap } from '../ui/Tap';
import { storageDetail } from './StorageSettings';

export type SettingsPageId =
  | 'player'
  | 'look'
  | 'backdrop'
  | 'lyrics'
  | 'video'
  | 'icon'
  | 'playback'
  | 'controls'
  | 'sources'
  | 'scrobble'
  | 'library'
  | 'storage'
  | 'language'
  | 'credits';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const PAGES: Record<SettingsPageId, { vi: string; en: string; icon: IconName; tint: string }> = {
  player: { vi: 'Trình phát', en: 'Player', icon: 'disc', tint: '#F472B6' },
  look: { vi: 'Giao diện & màu sắc', en: 'Look & Colours', icon: 'color-palette', tint: '#A78BFA' },
  backdrop: { vi: 'Nền & hiệu ứng', en: 'Background & Effects', icon: 'sparkles', tint: '#60A5FA' },
  lyrics: { vi: 'Lời bài hát', en: 'Lyrics', icon: 'chatbubble-ellipses', tint: '#38BDF8' },
  video: { vi: 'Video âm nhạc', en: 'Music Video', icon: 'film', tint: '#FB7185' },
  icon: { vi: 'Biểu tượng ứng dụng', en: 'App Icon', icon: 'apps', tint: '#FBBF24' },
  playback: {
    vi: 'Phát nhạc & chất lượng',
    en: 'Playback & Quality',
    icon: 'musical-notes',
    tint: '#34D399',
  },
  controls: {
    vi: 'Điều khiển & tiện ích',
    en: 'Controls & Extras',
    icon: 'hand-left',
    tint: '#F59E0B',
  },
  sources: {
    vi: 'Nguồn nhạc & Modules',
    en: 'Sources & Modules',
    icon: 'git-network',
    tint: '#22D3EE',
  },
  scrobble: { vi: 'Scrobble', en: 'Scrobbling', icon: 'radio', tint: '#EF4444' },
  library: {
    vi: 'Sao lưu & danh sách chặn',
    en: 'Backup & Blocked',
    icon: 'archive',
    tint: '#94A3B8',
  },
  storage: { vi: 'Dung lượng', en: 'Storage', icon: 'pie-chart', tint: '#8E8E93' },
  language: { vi: 'Ngôn ngữ', en: 'Language', icon: 'language', tint: '#818CF8' },
  credits: { vi: 'Giới thiệu & ghi công', en: 'About & Credits', icon: 'heart', tint: '#F43F5E' },
};

export const pageTitle = (id: SettingsPageId, vi: boolean) => (vi ? PAGES[id].vi : PAGES[id].en);

// What lives on each page, so the search finds a setting by what it does, not only by page name.
const KEYWORDS: Record<SettingsPageId, string[]> = {
  player: [
    'kiểu trình phát',
    'player style',
    'flagship',
    'turntable',
    'đĩa than',
    'ipod',
    'poster',
    'bedside',
    'đồng hồ',
    'clock',
    'nền trình phát',
    'player background',
  ],
  look: [
    'giao diện',
    'sáng',
    'tối',
    'light',
    'dark',
    'màu nhấn',
    'accent',
    'font',
    'phông chữ',
    'oled',
    'đen tuyệt đối',
    'pure black',
    'theme',
    'chủ đề',
  ],
  backdrop: [
    'nền',
    'background',
    'hiệu ứng chuyển động',
    'motion effects',
    'con quay',
    'gyroscope',
    'nghiêng',
    'tilt',
    'parallax',
    '3d',
    'đĩa than',
    'vinyl',
    'hạt bụi',
    'dust',
    'ảnh nền',
    'wallpaper',
    'hình nền',
    'video nền',
    'gif',
    'ảnh riêng',
    'photo',
    'ambient',
    'visualizer',
    'màu nền',
    'thanh tab',
    'tab bar',
    'mờ',
    'blur',
  ],
  lyrics: [
    'lời',
    'lyrics',
    'karaoke',
    'hiệu ứng lời',
    'cỡ chữ',
    'size',
    'nguồn lời',
    'offline lyrics',
    'giữ màn hình',
    'keep awake',
    'pip',
    'picture in picture',
    'cửa sổ nổi',
    'thanh lời',
    'bìa vuông',
    'lời dọc',
  ],
  video: [
    'mv',
    'music video',
    'video',
    '720p',
    'chất lượng video',
    'ambient video',
    'tự phát',
    'autoplay',
    'lưu mv',
    'lời dưới mv',
    'lời mv',
    'phụ đề',
    'subtitles',
    'toàn màn hình',
    'full screen',
  ],
  icon: ['biểu tượng', 'icon', 'app icon', 'skin'],
  playback: [
    'midi',
    'piano',
    'dương cầm',
    'nhạc cụ',
    'instrument',
    'soundfont',
    'generaluser',
    'chất lượng',
    'quality',
    'lossless',
    'flac',
    'bit-perfect',
    'crossfade',
    'gapless',
    'chuyển bài',
    'âm lượng',
    'normalize',
    'preview',
    '30 giây',
    'bộ nhớ đệm',
    'cache',
    'tải xuống',
    'download',
    'tải kèm lời',
    'tải kèm mv',
    'hỏi khi tải',
  ],
  controls: [
    'lắc',
    'shake',
    'rung',
    'haptic',
    'vuốt',
    'swipe',
    'hẹn giờ',
    'sleep timer',
    'nhãn tab',
    'tab labels',
    'ngoại tuyến',
    'offline',
    'mở trình phát',
    'xoay',
    'xoay ngang',
    'màn hình ngang',
    'rotate',
    'landscape',
    'phím tắt',
    'shortcuts',
  ],
  sources: [
    'nguồn',
    'source',
    'module',
    'monochrome',
    'jiosaavn',
    'innertube',
    'youtube',
    'itunes',
    'netease',
    'kugou',
    'soundcloud',
    'bandcamp',
    'deezer',
    'spotify',
    'drm',
    'thứ tự nguồn',
  ],
  scrobble: ['scrobble', 'last.fm', 'lastfm', 'listenbrainz'],
  library: [
    'sao lưu',
    'backup',
    'khôi phục',
    'restore',
    'chặn',
    'block',
    'xuất',
    'export',
    'nhập',
    'import',
    'xoá dữ liệu',
  ],
  storage: [
    'dung lượng',
    'storage',
    'bộ nhớ',
    'bộ nhớ đệm',
    'cache',
    'dọn dẹp',
    'xoá',
    'clean',
    'giải phóng',
    'free space',
    'tệp tạm',
    'temp',
    'bài đã tải',
    'downloads',
    'nhạc cụ',
    'instruments',
    'tải dở',
    'mv đã lưu',
    'saved videos',
  ],
  language: ['ngôn ngữ', 'language', 'tiếng việt', 'english'],
  credits: [
    'giới thiệu',
    'about',
    'ghi công',
    'credits',
    'giấy phép',
    'license',
    'gpl',
    'phiên bản',
    'version',
  ],
};

/** lower-case, no accents (đ → d): "Nen" finds "Nền" */
const fold = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();

export function searchSettings(q: string, vi: boolean): { id: SettingsPageId; hit?: string }[] {
  const n = fold(q);
  if (!n) return [];
  const out: { id: SettingsPageId; hit?: string; score: number }[] = [];
  (Object.keys(PAGES) as SettingsPageId[]).forEach((id) => {
    const title = fold(vi ? PAGES[id].vi : PAGES[id].en);
    const other = fold(vi ? PAGES[id].en : PAGES[id].vi);
    if (title.startsWith(n)) out.push({ id, score: 0 });
    else if (title.includes(n) || other.includes(n)) out.push({ id, score: 1 });
    else {
      const k = KEYWORDS[id].find((w) => fold(w).includes(n));
      if (k) out.push({ id, hit: k, score: fold(k).startsWith(n) ? 2 : 3 });
    }
  });
  return out.sort((a, b) => a.score - b.score).map(({ id, hit }) => ({ id, hit }));
}

/** Search results: same rows as the front page, with what matched underneath. */
export const SettingsSearchResults: React.FC<{
  query: string;
  vi: boolean;
  open: (id: SettingsPageId) => void;
}> = ({ query, vi, open }) => {
  const results = searchSettings(query, vi);
  if (!results.length)
    return (
      <View style={styles.noResults}>
        <Ionicons name="search" size={28} color={UI.fg(0.3)} />
        <Text style={styles.noResultsText}>
          {vi
            ? `Không có cài đặt nào khớp “${query.trim()}”`
            : `No settings match “${query.trim()}”`}
        </Text>
      </View>
    );
  return (
    <View style={[styles.group, { marginTop: 14 }]}>
      {results.map((r, i) => {
        const m = PAGES[r.id];
        return (
          <Tap
            key={r.id}
            feedback="opacity"
            onPress={() => open(r.id)}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={vi ? m.vi : m.en}
          >
            <View style={[styles.iconBox, { backgroundColor: m.tint }]}>
              <Ionicons name={m.icon} size={16} color="#FFFFFF" />
            </View>
            <View style={[styles.rowBody, i > 0 && styles.rowDivider, { paddingVertical: 8 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { flex: 0 }]} numberOfLines={1}>
                  {vi ? m.vi : m.en}
                </Text>
                {r.hit ? (
                  <Text style={styles.hitText} numberOfLines={1}>
                    {r.hit}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={UI.fg(0.32)} />
            </View>
          </Tap>
        );
      })}
    </View>
  );
};

export const SettingsHome: React.FC<{
  vi: boolean;
  fontFamily?: string;
  open: (id: SettingsPageId) => void;
}> = ({ vi, fontFamily, open }) => {
  const { prefs } = useHolySic();
  const style = PLAYER_STYLE_META.find((m) => m.id === prefs.playerStyle);
  const effect = LYRICS_EFFECTS.find((e) => e.id === (prefs.lyricsEffect || 'glow'));
  const groups: { title: string; rows: { id: SettingsPageId; detail?: string }[] }[] = [
    {
      title: vi ? 'Cá nhân hoá' : 'Make it yours',
      rows: [
        { id: 'player', detail: style ? (vi ? style.titleVi : style.titleEn) : undefined },
        { id: 'look' },
        {
          id: 'backdrop',
          detail: prefs.pureBlack
            ? undefined
            : (
                {
                  plain: undefined,
                  color: vi ? 'Màu riêng' : 'Colour',
                  artwork: vi ? 'Bài hát' : 'Song',
                  ambient: 'Ambient',
                  visualizer: 'Visualizer',
                  media: prefs.appBgMedia
                    ? prefs.appBgMedia.kind === 'video'
                      ? 'Video'
                      : prefs.appBgMedia.kind === 'gif'
                        ? 'GIF'
                        : vi
                          ? 'Ảnh'
                          : 'Photo'
                    : undefined,
                } as Record<string, string | undefined>
              )[prefs.appBackdrop || 'plain'],
        },
        { id: 'lyrics', detail: effect ? (vi ? effect.vi : effect.en) : undefined },
        { id: 'video', detail: prefs.musicVideo ? (vi ? 'Bật' : 'On') : vi ? 'Tắt' : 'Off' },
        { id: 'icon' },
      ],
    },
    {
      title: vi ? 'Nghe nhạc' : 'Listening',
      rows: [{ id: 'playback' }, { id: 'controls' }],
    },
    {
      title: vi ? 'Nâng cao' : 'Advanced',
      rows: [
        { id: 'sources' },
        { id: 'scrobble' },
        { id: 'library' },
        { id: 'storage', detail: storageDetail(vi) },
        { id: 'language', detail: vi ? 'Tiếng Việt' : 'English' },
      ],
    },
    { title: '', rows: [{ id: 'credits' }] },
  ];
  return (
    <View>
      {groups.map((g, gi) => (
        <View key={gi}>
          {g.title ? <Text style={[styles.groupTitle, { fontFamily }]}>{g.title}</Text> : null}
          <View style={[styles.group, !g.title && { marginTop: 18 }]}>
            {g.rows.map((r, i) => {
              const m = PAGES[r.id];
              return (
                <Tap
                  key={r.id}
                  feedback="opacity"
                  onPress={() => open(r.id)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={vi ? m.vi : m.en}
                >
                  <View style={[styles.iconBox, { backgroundColor: m.tint }]}>
                    <Ionicons name={m.icon} size={16} color="#FFFFFF" />
                  </View>
                  <View style={[styles.rowBody, i > 0 && styles.rowDivider]}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {vi ? m.vi : m.en}
                    </Text>
                    {r.detail ? (
                      <Text style={styles.rowDetail} numberOfLines={1}>
                        {r.detail}
                      </Text>
                    ) : null}
                    <Ionicons name="chevron-forward" size={16} color={UI.fg(0.32)} />
                  </View>
                </Tap>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
};

/** the bar on top of a settings page: ‹ Settings, and the page's name */
export const PageHeader: React.FC<{
  title: string;
  back: string;
  onBack: () => void;
  accent: string;
  fontFamily?: string;
}> = ({ title, back, onBack, accent, fontFamily }) => (
  <View style={styles.header}>
    <Tap
      onPress={onBack}
      feedback="opacity"
      hitSlop={10}
      style={styles.backBtn}
      accessibilityRole="button"
      accessibilityLabel={back}
    >
      <Ionicons name="chevron-back" size={22} color={accent} />
      <Text style={[styles.backText, { color: accent }]} numberOfLines={1}>
        {back}
      </Text>
    </Tap>
    <Text style={[styles.headerTitle, { fontFamily }]} numberOfLines={1}>
      {title}
    </Text>
  </View>
);

const styles = themedSheet(() => ({
  groupTitle: {
    color: UI.fg(0.5),
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 16,
  },
  group: {
    borderRadius: 14,
    backgroundColor: UI.fg(0.06),
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
  },
  iconBox: {
    width: 29,
    height: 29,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 50,
    marginLeft: 14,
    paddingRight: 14,
  },
  rowDivider: {
    borderTopWidth: 0.5,
    borderTopColor: UI.fg(0.1),
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: UI.text,
    fontSize: 16,
    fontWeight: '500',
  },
  hitText: { color: UI.fg(0.5), fontSize: 13, marginTop: 2 },
  noResults: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  noResultsText: { color: UI.fg(0.55), fontSize: 15, textAlign: 'center' },
  rowDetail: {
    flexShrink: 1,
    maxWidth: '45%',
    color: UI.fg(0.5),
    fontSize: 15,
  },
  // a compact navigation bar: the page's own section headings stay the big titles below
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingTop: 2,
  },
  backBtn: {
    position: 'absolute',
    left: -6,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 8,
  },
  backText: {
    fontSize: 17,
    fontWeight: '500',
  },
  headerTitle: {
    color: UI.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: '52%',
  },
}));
