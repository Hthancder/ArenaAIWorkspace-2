// Library → Playlists: pin to top, sort (recently played / recently added / A–Z / creator /
// your own order) and three layouts (list, compact, grid). Pinned playlists always lead.

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, LayoutAnimation, Platform, Text, useWindowDimensions, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { PlaylistSort, PlaylistView } from '../../constants/preferences';
import { resolveFontFamily } from '../../constants/theme';
import { compareNames, isLocalTrack, playlistCoverOf } from '../../services/local/localLibrary';
import { T as UI, themedSheet } from '../../theme/ui';
import { ListeningEvent, Playlist, Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { NativeMenu, nativeMenuAvailable, MenuItem } from '../ui/NativeMenu';
import { Tap } from '../ui/Tap';
import { openPlaylistEditor } from './PlaylistEditor';

const SORTS: { id: PlaylistSort; vi: string; en: string; icon: string; sf: string }[] = [
  { id: 'recent', vi: 'Nghe gần đây', en: 'Recently played', icon: 'time-outline', sf: 'clock' },
  {
    id: 'added',
    vi: 'Mới thêm gần đây',
    en: 'Recently added',
    icon: 'sparkles-outline',
    sf: 'plus.circle',
  },
  { id: 'alpha', vi: 'Theo tên (A–Z)', en: 'Alphabetical', icon: 'text-outline', sf: 'textformat' },
  { id: 'creator', vi: 'Theo người tạo', en: 'Creator', icon: 'person-outline', sf: 'person' },
  {
    id: 'custom',
    vi: 'Thứ tự của bạn',
    en: 'Your order',
    icon: 'reorder-three-outline',
    sf: 'line.3.horizontal',
  },
];

const VIEWS: { id: PlaylistView; icon: keyof typeof Ionicons.glyphMap; vi: string; en: string }[] =
  [
    { id: 'list', icon: 'list', vi: 'Danh sách', en: 'List' },
    { id: 'compact', icon: 'reorder-four', vi: 'Gọn', en: 'Compact' },
    { id: 'grid', icon: 'grid', vi: 'Lưới', en: 'Grid' },
  ];

/** Last time any song of each playlist was heard — used until a playlist is played as a whole */
function heardIndex(history: ListeningEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of history) {
    const prev = m.get(h.track.id) || 0;
    if (h.playedAt > prev) m.set(h.track.id, h.playedAt);
  }
  return m;
}

export function sortPlaylists(
  list: Playlist[],
  sort: PlaylistSort,
  heard?: Map<string, number>
): Playlist[] {
  const pinned = list
    .filter((p) => p.pinnedAt)
    .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
  const rest = list.filter((p) => !p.pinnedAt);
  const recentOf = (p: Playlist) => {
    if (p.lastPlayedAt) return p.lastPlayedAt;
    let best = 0;
    if (heard) for (const id of p.trackIds) best = Math.max(best, heard.get(id) || 0);
    return best;
  };
  switch (sort) {
    case 'recent': {
      const r = new Map(rest.map((p) => [p.id, recentOf(p)]));
      rest.sort((a, b) => r.get(b.id)! - r.get(a.id)! || b.updatedAt - a.updatedAt);
      break;
    }
    case 'added':
      rest.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'alpha':
      rest.sort((a, b) => compareNames(a.name, b.name));
      break;
    case 'creator':
      rest.sort((a, b) => {
        const ca = (a.creator || '').trim();
        const cb = (b.creator || '').trim();
        if (!ca !== !cb) return ca ? -1 : 1; // no creator → last
        return compareNames(ca, cb) || compareNames(a.name, b.name);
      });
      break;
    case 'custom':
      break;
  }
  return [...pinned, ...rest];
}

const ago = (t: number, vi: boolean) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return vi ? 'vừa xong' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return vi ? `${m} phút trước` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return vi ? `${h} giờ trước` : `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return vi ? `${d} ngày trước` : `${d}d ago`;
  return new Date(t).toLocaleDateString(vi ? 'vi-VN' : undefined, {
    day: 'numeric',
    month: 'short',
  });
};

const animate = () => {
  if (Platform.OS !== 'web')
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
};

export const PlaylistShelf: React.FC<{ downloads: Record<string, unknown> }> = ({ downloads }) => {
  const {
    prefs,
    updatePrefs,
    palette,
    playlists,
    history,
    playTrack,
    setIsPlayerOpen,
    openCollection,
    deletePlaylist,
    togglePinPlaylist,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const sort = prefs.playlistSort || 'custom';
  const view = prefs.playlistView || 'list';
  const [sortOpen, setSortOpen] = useState(false);
  const width = useWindowDimensions().width;
  const cols = width >= 700 ? 4 : width >= 520 ? 3 : 2;
  const gridW = Math.floor((Math.min(width, 900) - 28 - (cols - 1) * 12) / cols);

  const heard = useMemo(
    () => (sort === 'recent' ? heardIndex(history) : undefined),
    [history, sort]
  );
  const sorted = useMemo(() => sortPlaylists(playlists, sort, heard), [playlists, sort, heard]);
  const sortMeta = SORTS.find((s) => s.id === sort) || SORTS[4];

  const offlineIn = (list: Track[]) =>
    list.reduce((n, x) => n + (downloads[x.id] || isLocalTrack(x) ? 1 : 0), 0);

  const setSort = (s: PlaylistSort) => {
    animate();
    setSortOpen(false);
    updatePrefs({ playlistSort: s });
  };
  const setView = (v: PlaylistView) => {
    animate();
    updatePrefs({ playlistView: v });
  };

  const sortItems: MenuItem[] = SORTS.map((s, i) => ({
    id: s.id,
    title: vi ? s.vi : s.en,
    icon: s.sf,
    checked: s.id === sort,
    section: i === 4 ? 1 : 0,
  }));

  const subLine = (pl: Playlist) => {
    const bits: string[] = [];
    if (pl.creator) bits.push(vi ? `bởi ${pl.creator}` : `by ${pl.creator}`);
    bits.push(`${pl.tracks.length} ${vi ? 'bài' : pl.tracks.length === 1 ? 'song' : 'songs'}`);
    if (sort === 'recent') {
      const t = pl.lastPlayedAt || 0;
      if (t) bits.push(ago(t, vi));
    } else if (sort === 'added') bits.push(ago(pl.createdAt, vi));
    else {
      const off = offlineIn(pl.tracks);
      if (off > 0) bits.push(`${off} offline`);
    }
    return bits.join(' · ');
  };

  const menuFor = (pl: Playlist): MenuItem[] => [
    {
      id: 'play',
      title: vi ? 'Phát' : 'Play',
      icon: 'play.fill',
      disabled: !pl.tracks.length,
      section: 0,
    },
    {
      id: 'shuffle',
      title: vi ? 'Trộn bài' : 'Shuffle',
      icon: 'shuffle',
      disabled: !pl.tracks.length,
      section: 0,
    },
    {
      id: 'pin',
      title: pl.pinnedAt ? (vi ? 'Bỏ ghim' : 'Unpin') : vi ? 'Ghim lên đầu' : 'Pin to Top',
      icon: pl.pinnedAt ? 'pin.slash' : 'pin',
      section: 1,
    },
    {
      id: 'open',
      title: vi ? 'Mở playlist' : 'Open Playlist',
      icon: 'music.note.list',
      section: 1,
    },
    ...(pl.isSystem
      ? []
      : [
          {
            id: 'edit',
            title: vi ? 'Sửa playlist…' : 'Edit Playlist…',
            subtitle: vi ? 'Tên, người tạo, thứ tự' : 'Name, creator, order',
            icon: 'pencil',
            section: 1,
          },
          { id: 'cover', title: vi ? 'Đổi ảnh bìa…' : 'Change Cover…', icon: 'photo', section: 1 },
          {
            id: 'delete',
            title: vi ? 'Xoá playlist' : 'Delete Playlist',
            icon: 'trash',
            destructive: true,
            section: 2,
          },
        ]),
  ];

  const onMenu = (pl: Playlist, id: string) => {
    if (id === 'play' && pl.tracks.length) {
      playTrack(pl.tracks[0], pl.tracks);
      setIsPlayerOpen(true);
    } else if (id === 'shuffle' && pl.tracks.length) {
      const list = [...pl.tracks].sort(() => Math.random() - 0.5);
      playTrack(list[0], list);
      setIsPlayerOpen(true);
    } else if (id === 'pin') {
      animate();
      togglePinPlaylist(pl.id);
    } else if (id === 'open') openCollection({ kind: 'playlist', playlistId: pl.id });
    else if (id === 'edit') setTimeout(() => openPlaylistEditor(pl.id), 350);
    else if (id === 'cover') setTimeout(() => openPlaylistEditor(pl.id, 'cover'), 350);
    else if (id === 'delete')
      setTimeout(
        () =>
          Alert.alert(
            vi ? `Xoá playlist “${pl.name}”?` : `Delete “${pl.name}”?`,
            vi ? 'Không thể hoàn tác.' : 'This can’t be undone.',
            [
              { text: vi ? 'Huỷ' : 'Cancel', style: 'cancel' },
              {
                text: vi ? 'Xoá' : 'Delete',
                style: 'destructive',
                onPress: () => deletePlaylist(pl.id),
              },
            ]
          ),
        350
      );
  };

  const cover = (pl: Playlist, size: number, radius: number) => {
    const uri = playlistCoverOf(pl);
    return uri ? (
      <ArtworkImage source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
    ) : (
      <View
        style={[
          styles.coverFallback,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: pl.coverTint || palette.container,
          },
        ]}
      >
        <Ionicons name="musical-notes" size={Math.round(size * 0.42)} color={UI.text} />
      </View>
    );
  };

  const pinBadge = (pl: Playlist) =>
    pl.pinnedAt ? (
      <Ionicons
        name="pin"
        size={12}
        color={palette.accent}
        style={{ transform: [{ rotate: '45deg' }], marginRight: 4 }}
      />
    ) : null;

  const row = (pl: Playlist) => {
    const compact = view === 'compact';
    const grid = view === 'grid';
    const open = () => openCollection({ kind: 'playlist', playlistId: pl.id });
    const a11y = `${pl.name}${pl.pinnedAt ? (vi ? ', đã ghim' : ', pinned') : ''}, ${subLine(pl)}`;
    const body = grid ? (
      <Tap
        onPress={open}
        onLongPress={nativeMenuAvailable ? () => {} : undefined}
        style={[styles.gridCard, { width: gridW }]}
        accessibilityLabel={a11y}
      >
        <View>
          {cover(pl, gridW - 16, 14)}
          {pl.pinnedAt ? (
            <View style={[styles.gridPin, { backgroundColor: palette.accent }]}>
              <Ionicons
                name="pin"
                size={11}
                color={palette.onAccent}
                style={{ transform: [{ rotate: '45deg' }] }}
              />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.gridName, { fontFamily }]}>
          {pl.name}
        </Text>
        <Text numberOfLines={1} style={styles.gridSub}>
          {subLine(pl)}
        </Text>
      </Tap>
    ) : (
      <Tap
        onPress={open}
        // a hold belongs to the native context menu (and must not open the page on release)
        onLongPress={nativeMenuAvailable ? () => {} : undefined}
        style={compact ? styles.compactRow : styles.card}
        accessibilityLabel={a11y}
      >
        {cover(pl, compact ? 40 : 58, compact ? 9 : 14)}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            {pinBadge(pl)}
            <Text
              numberOfLines={1}
              style={[compact ? styles.compactName : styles.name, { fontFamily }]}
            >
              {pl.name}
            </Text>
          </View>
          <Text numberOfLines={1} style={compact ? styles.compactSub : styles.sub}>
            {subLine(pl)}
            {!compact && pl.description ? ` · ${pl.description}` : ''}
          </Text>
        </View>
        {!nativeMenuAvailable ? (
          <>
            <Tap
              feedback="opacity"
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                animate();
                togglePinPlaylist(pl.id);
              }}
              style={[
                styles.iconBtn,
                pl.pinnedAt ? { backgroundColor: palette.accent + '26' } : null,
              ]}
              accessibilityLabel={
                pl.pinnedAt
                  ? vi
                    ? `Bỏ ghim ${pl.name}`
                    : `Unpin ${pl.name}`
                  : vi
                    ? `Ghim ${pl.name}`
                    : `Pin ${pl.name}`
              }
            >
              <Ionicons
                name={pl.pinnedAt ? 'pin' : 'pin-outline'}
                size={14}
                color={pl.pinnedAt ? palette.accent : UI.text2}
              />
            </Tap>
            {!pl.isSystem ? (
              <Tap
                feedback="opacity"
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation?.();
                  openPlaylistEditor(pl.id);
                }}
                style={styles.iconBtn}
                accessibilityLabel={vi ? `Sửa ${pl.name}` : `Edit ${pl.name}`}
              >
                <Ionicons name="pencil" size={14} color={UI.text2} />
              </Tap>
            ) : null}
          </>
        ) : null}
        {!compact && <Ionicons name="chevron-forward" size={18} color={UI.text3} />}
      </Tap>
    );
    return (
      <NativeMenu
        key={pl.id}
        trigger="longPress"
        previewRadius={grid ? 18 : 16}
        previewBackground={UI.surface('#14141B')}
        items={menuFor(pl)}
        onSelect={(id) => onMenu(pl, id)}
      >
        {body}
      </NativeMenu>
    );
  };

  const sortButton = (
    <View style={styles.sortBtn}>
      <Ionicons name="swap-vertical" size={14} color={UI.text} />
      <Text style={styles.sortText} numberOfLines={1}>
        {vi ? sortMeta.vi : sortMeta.en}
      </Text>
      <Ionicons name="chevron-down" size={12} color={UI.text2} />
    </View>
  );

  return (
    <View>
      <View style={styles.toolbar}>
        {nativeMenuAvailable ? (
          <NativeMenu
            items={sortItems}
            onSelect={(id) => setSort(id as PlaylistSort)}
            title={vi ? 'Sắp xếp theo' : 'Sort by'}
            label={vi ? `Sắp xếp: ${sortMeta.vi}` : `Sort: ${sortMeta.en}`}
          >
            {sortButton}
          </NativeMenu>
        ) : (
          <Tap
            onPress={() => setSortOpen((o) => !o)}
            accessibilityLabel={vi ? `Sắp xếp: ${sortMeta.vi}` : `Sort: ${sortMeta.en}`}
            accessibilityState={{ expanded: sortOpen }}
          >
            {sortButton}
          </Tap>
        )}
        <View style={{ flex: 1 }} />
        <View style={styles.segment} accessibilityRole="tablist">
          {VIEWS.map((v) => {
            const on = v.id === view;
            return (
              <Tap
                key={v.id}
                feedback="opacity"
                onPress={() => setView(v.id)}
                style={[styles.segBtn, on && { backgroundColor: palette.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={vi ? `Xem dạng ${v.vi}` : `${v.en} view`}
              >
                <Ionicons name={v.icon} size={14} color={on ? palette.onAccent : UI.text2} />
              </Tap>
            );
          })}
        </View>
      </View>

      {sortOpen && !nativeMenuAvailable ? (
        <View style={styles.sortSheet}>
          {SORTS.map((s) => {
            const on = s.id === sort;
            return (
              <Tap
                key={s.id}
                feedback="opacity"
                onPress={() => setSort(s.id)}
                style={styles.sortOption}
                accessibilityState={{ selected: on }}
              >
                <Ionicons
                  name={s.icon as keyof typeof Ionicons.glyphMap}
                  size={16}
                  color={on ? palette.accent : UI.text2}
                />
                <Text style={[styles.sortOptionText, on && { color: palette.accent }]}>
                  {vi ? s.vi : s.en}
                </Text>
                {on ? <Ionicons name="checkmark" size={16} color={palette.accent} /> : null}
              </Tap>
            );
          })}
        </View>
      ) : null}

      <View
        style={
          view === 'grid' ? styles.grid : view === 'compact' ? styles.compactList : styles.list
        }
      >
        {sorted.map(row)}
      </View>
    </View>
  );
};

const styles = themedSheet(() => ({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 8,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: UI.fg(0.07),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
    maxWidth: 220,
  },
  sortText: { color: UI.text, fontSize: 12.5, fontWeight: '700' },
  segment: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 16,
    backgroundColor: UI.fg(0.07),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
    gap: 2,
  },
  segBtn: {
    width: 32,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortSheet: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    paddingVertical: 4,
    backgroundColor: UI.surface('#1A1A24'),
    borderWidth: 1,
    borderColor: UI.fg(0.1),
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    height: 42,
  },
  sortOptionText: { flex: 1, color: UI.text, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 14, gap: 10 },
  compactList: { paddingHorizontal: 14, gap: 2 },
  grid: {
    paddingHorizontal: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    borderRadius: 18,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.07),
    gap: 13,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 12,
    gap: 11,
  },
  gridCard: {
    padding: 8,
    borderRadius: 18,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.07),
  },
  gridPin: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridName: { color: UI.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  gridSub: { color: UI.text2, fontSize: 11.5, marginTop: 2 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: UI.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  sub: { color: UI.text2, fontSize: 12.5, marginTop: 3 },
  compactName: { color: UI.text, fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  compactSub: { color: UI.text2, fontSize: 11.5, marginTop: 1 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.07),
  },
}));
