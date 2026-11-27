// Library › Đã tải — the songs downloaded *by HolySic* (kept inside the app), managed like files:
// storage used, sort, group (your own folders / artist / album), select many → play, put in a
// folder, add to a playlist, move to "Trên máy" (Local Files) or delete. Device songs added via
// the Files app live in "Trên máy" — the card at the top keeps the two clearly apart.

import { Ionicons } from '@expo/vector-icons';
import React, { memo, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { HOLYSIC_COLORS } from '../../constants/theme';
import { LocalLibrary } from '../../services/local/localLibrary';
import { useLocalLibrary } from '../local/LocalLibraryScreen';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { DownloadedTrackMeta, Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { EmptyState } from '../ui/EmptyState';
import { NativeMenu, nativeMenuAvailable } from '../ui/NativeMenu';
import { Tap } from '../ui/Tap';
import { PickerItem, PickerSheet } from './PickerSheet';

type SortKey = 'recent' | 'title' | 'artist' | 'size';
type GroupKey = 'folder' | 'artist' | 'album' | 'none';
// remembered while the app runs (switching tabs keeps your view)
const view: { sort: SortKey; group: GroupKey } = { sort: 'recent', group: 'folder' };

export const formatBytes = (b: number) => {
  if (!b || b < 0) return '0 MB';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(b >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
};
const isLossless = (d: DownloadedTrackMeta) => /flac|alac|lossless|hi-?res/i.test(d.qualityLabel);
const UNGROUPED = '\u0000';

function confirmAsk(title: string, message: string, ok: string, cancel: string, run: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: ok, style: 'destructive', onPress: run },
  ]);
}

type Sheet =
  | { kind: 'group'; ids: string[] }
  | { kind: 'local'; ids: string[] }
  | { kind: 'playlist'; tracks: Track[] }
  | { kind: 'rename'; folder: string }
  | { kind: 'folderActions'; folder: string }
  | null;

export const DownloadsManager: React.FC = () => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const {
    prefs,
    palette,
    downloads,
    playTrack,
    setActionTrack,
    removeDownloads,
    setDownloadsFolder,
    moveDownloadsToLocal,
    playlists,
    addTracksToPlaylist,
    createPlaylist,
    showToast,
    haptic,
    setActiveTab,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const local = useLocalLibrary();
  const [sort, setSortState] = useState<SortKey>(view.sort);
  const [group, setGroupState] = useState<GroupKey>(view.group);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const setSort = (v: SortKey) => {
    view.sort = v;
    setSortState(v);
  };
  const setGroup = (v: GroupKey) => {
    view.group = v;
    setGroupState(v);
  };

  const all = useMemo(() => Object.values(downloads), [downloads]);
  const totalBytes = useMemo(() => all.reduce((n, d) => n + (d.sizeBytes || 0), 0), [all]);
  const losslessBytes = useMemo(
    () => all.filter(isLossless).reduce((n, d) => n + (d.sizeBytes || 0), 0),
    [all]
  );
  const folders = useMemo(
    () =>
      Array.from(new Set(all.map((d) => d.folder).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [all]
  );

  const sorted = useMemo(() => {
    const list = [...all];
    if (sort === 'recent') list.sort((a, b) => b.downloadedAt - a.downloadedAt);
    else if (sort === 'title') list.sort((a, b) => a.track.title.localeCompare(b.track.title));
    else if (sort === 'artist')
      list.sort(
        (a, b) =>
          a.track.artist.localeCompare(b.track.artist) || a.track.title.localeCompare(b.track.title)
      );
    else list.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
    return list;
  }, [all, sort]);

  const sections = useMemo(() => {
    if (group === 'none') return [{ key: 'all', title: '', items: sorted }];
    const map = new Map<string, DownloadedTrackMeta[]>();
    for (const d of sorted) {
      const k =
        group === 'folder'
          ? d.folder || UNGROUPED
          : group === 'artist'
            ? d.track.artist || '—'
            : d.track.album || (vi ? 'Không rõ album' : 'Unknown album');
      const arr = map.get(k);
      if (arr) arr.push(d);
      else map.set(k, [d]);
    }
    const keys = Array.from(map.keys()).sort((a, b) =>
      a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
    );
    return keys.map((k) => ({
      key: k,
      title: k === UNGROUPED ? (vi ? 'Chưa xếp thư mục' : 'Not in a folder') : k,
      items: map.get(k)!,
    }));
  }, [sorted, group, vi]);

  const chosenIds = Object.keys(selected).filter((id) => selected[id] && downloads[id]);
  const chosenBytes = chosenIds.reduce((n, id) => n + (downloads[id]?.sizeBytes || 0), 0);
  const chosenTracks = sorted.filter((d) => selected[d.track.id]).map((d) => d.track);

  const endSelect = () => {
    setSelecting(false);
    setSelected({});
  };
  const toggle = (id: string) => setSelected((p) => ({ ...p, [id]: !p[id] }));

  const askDelete = (ids: string[], label?: string) => {
    const bytes = ids.reduce((n, id) => n + (downloads[id]?.sizeBytes || 0), 0);
    confirmAsk(
      label ||
        (vi
          ? `Xoá ${ids.length} bản tải?`
          : `Delete ${ids.length} download${ids.length > 1 ? 's' : ''}?`),
      vi
        ? `Giải phóng ${formatBytes(bytes)}. Bài vẫn còn trong playlist và nghe online được.`
        : `Frees ${formatBytes(bytes)}. Songs stay in your playlists and can still stream.`,
      vi ? 'Xoá' : 'Delete',
      vi ? 'Huỷ' : 'Cancel',
      () => {
        removeDownloads(ids);
        endSelect();
      }
    );
  };

  const SORT_LABEL: Record<SortKey, string> = {
    recent: vi ? 'Mới tải' : 'Recent',
    title: vi ? 'Tên A–Z' : 'Title',
    artist: vi ? 'Nghệ sĩ' : 'Artist',
    size: vi ? 'Dung lượng' : 'Size',
  };
  const GROUP_LABEL: Record<GroupKey, string> = {
    folder: vi ? 'Thư mục' : 'Folders',
    artist: vi ? 'Nghệ sĩ' : 'Artist',
    album: 'Album',
    none: vi ? 'Không nhóm' : 'No groups',
  };
  const SORTS: SortKey[] = ['recent', 'title', 'artist', 'size'];
  const GROUPS: GroupKey[] = ['folder', 'artist', 'album', 'none'];

  // ---- sheets ----
  const sheetProps = (): React.ComponentProps<typeof PickerSheet> | null => {
    if (!sheet) return null;
    const base = {
      visible: true,
      accent: palette.accent,
      onAccent: palette.onAccent,
      onClose: () => setSheet(null),
    };
    if (sheet.kind === 'group') {
      const cur = sheet.ids.length === 1 ? downloads[sheet.ids[0]]?.folder : undefined;
      const items: PickerItem[] = folders.map((f) => ({
        key: f,
        label: f,
        sub: `${all.filter((d) => d.folder === f).length} ${vi ? 'bài' : 'songs'}`,
        icon: 'folder',
        selected: cur === f,
      }));
      if (sheet.ids.some((id) => downloads[id]?.folder))
        items.push({
          key: UNGROUPED,
          label: vi ? 'Bỏ khỏi thư mục' : 'Take out of folder',
          icon: 'folder-open-outline',
        });
      return {
        ...base,
        title: vi
          ? `Xếp ${sheet.ids.length} bài vào thư mục`
          : `Put ${sheet.ids.length} in a folder`,
        message: vi
          ? 'Thư mục giúp gom bài tải theo ý bạn (vd. “Gym”, “Nhạc ngủ”). Tệp vẫn nằm trong HolySic.'
          : 'Folders group your downloads your way (e.g. “Gym”, “Sleep”). Files stay inside HolySic.',
        items,
        newLabel: vi ? 'Tạo' : 'Create',
        newPlaceholder: vi ? 'Thư mục mới…' : 'New folder…',
        onNew: (name) => {
          setDownloadsFolder(sheet.ids, name);
          showToast(vi ? `Đã xếp vào “${name}”` : `Moved to “${name}”`);
          setSheet(null);
          endSelect();
        },
        onPick: (k) => {
          setDownloadsFolder(sheet.ids, k === UNGROUPED ? null : k);
          showToast(
            k === UNGROUPED
              ? vi
                ? 'Đã bỏ khỏi thư mục'
                : 'Taken out of folder'
              : vi
                ? `Đã xếp vào “${k}”`
                : `Moved to “${k}”`
          );
          setSheet(null);
          endSelect();
        },
      };
    }
    if (sheet.kind === 'local') {
      const run = async (dir: string) => {
        setSheet(null);
        setBusy(true);
        const n = await moveDownloadsToLocal(sheet.ids, dir);
        setBusy(false);
        endSelect();
        showToast(
          n
            ? vi
              ? `Đã chuyển ${n} bài sang Trên máy › ${dir || 'HolySic'}`
              : `Moved ${n} to Local Files › ${dir || 'HolySic'}`
            : vi
              ? 'Không chuyển được bài nào'
              : 'Nothing could be moved'
        );
      };
      return {
        ...base,
        title: vi
          ? `Chuyển ${sheet.ids.length} bài sang Trên máy`
          : `Move ${sheet.ids.length} to Local Files`,
        message: vi
          ? 'Tệp sẽ thành nhạc trên máy (hiện trong ứng dụng Tệp › HolySic), giữ nguyên tên bài, ảnh bìa, lượt thích và playlist.'
          : 'The files become Local Files (visible in Files › HolySic), keeping titles, covers, likes and playlists.',
        items: [
          {
            key: '',
            label: 'HolySic',
            sub: vi ? 'Thư mục gốc' : 'Top folder',
            icon: 'phone-portrait-outline',
          },
          ...LocalLibrary.allFolders().map((f) => ({
            key: f.path,
            label: f.name,
            sub: `${f.total} ${vi ? 'bài' : 'songs'}`,
            icon: 'folder' as const,
            depth: f.depth + 1,
          })),
        ],
        newLabel: vi ? 'Tạo' : 'Create',
        newPlaceholder: vi ? 'Thư mục mới…' : 'New folder…',
        onNew: async (name) => {
          try {
            const path = await LocalLibrary.createFolder('', name);
            run(path);
          } catch {
            showToast(vi ? 'Không tạo được thư mục' : 'Couldn’t create the folder');
          }
        },
        onPick: (k) => run(k),
      };
    }
    if (sheet.kind === 'playlist') {
      return {
        ...base,
        title: vi
          ? `Thêm ${sheet.tracks.length} bài vào playlist`
          : `Add ${sheet.tracks.length} to a playlist`,
        items: playlists.map((p) => ({
          key: p.id,
          label: p.name,
          sub: `${p.tracks.length} ${vi ? 'bài' : 'songs'}`,
          icon: 'musical-notes' as const,
        })),
        newLabel: vi ? 'Tạo' : 'Create',
        newPlaceholder: vi ? 'Playlist mới…' : 'New playlist…',
        onNew: (name) => {
          const pl = createPlaylist(name);
          addTracksToPlaylist(pl.id, sheet.tracks);
          setSheet(null);
          endSelect();
        },
        onPick: (id) => {
          addTracksToPlaylist(id, sheet.tracks);
          setSheet(null);
          endSelect();
        },
      };
    }
    if (sheet.kind === 'rename') {
      const ids = all.filter((d) => d.folder === sheet.folder).map((d) => d.track.id);
      return {
        ...base,
        title: vi ? 'Đổi tên thư mục' : 'Rename folder',
        items: [],
        initialText: sheet.folder,
        newLabel: vi ? 'Lưu' : 'Save',
        newPlaceholder: vi ? 'Tên thư mục' : 'Folder name',
        onNew: (name) => {
          setDownloadsFolder(ids, name);
          setSheet(null);
        },
        onPick: () => {},
      };
    }
    // folder actions (web; iOS uses the native menu)
    const f = sheet.folder;
    return {
      ...base,
      title: f,
      items: folderActions(f).map((a) => ({
        key: a.id,
        label: a.title,
        icon: a.ion,
        danger: a.destructive,
      })),
      onPick: (k) => {
        setSheet(null);
        setTimeout(() => onFolderAction(f, k), 50);
      },
    };
  };

  const folderActions = (_folder?: string) =>
    FOLDER_ACTIONS().filter((x) => Platform.OS !== 'web' || x.id !== 'local');
  const FOLDER_ACTIONS = () => [
    { id: 'rename', title: vi ? 'Đổi tên' : 'Rename', icon: 'pencil', ion: 'pencil' as const },
    {
      id: 'local',
      title: vi ? 'Chuyển cả thư mục sang Trên máy' : 'Move folder to Local Files',
      icon: 'iphone',
      ion: 'phone-portrait-outline' as const,
    },
    {
      id: 'ungroup',
      title: vi ? 'Bỏ thư mục (giữ bài)' : 'Remove folder (keep songs)',
      icon: 'folder.badge.minus',
      ion: 'folder-open-outline' as const,
    },
    {
      id: 'delete',
      title: vi ? 'Xoá thư mục và bài tải' : 'Delete folder & downloads',
      icon: 'trash',
      ion: 'trash-outline' as const,
      destructive: true,
    },
  ];
  const onFolderAction = (f: string, id: string) => {
    const ids = all.filter((d) => d.folder === f).map((d) => d.track.id);
    if (id === 'rename') setSheet({ kind: 'rename', folder: f });
    else if (id === 'local') setSheet({ kind: 'local', ids });
    else if (id === 'ungroup') setDownloadsFolder(ids, null);
    else if (id === 'delete') askDelete(ids, vi ? `Xoá thư mục “${f}”?` : `Delete folder “${f}”?`);
  };

  if (all.length === 0) {
    return (
      <View>
        <SplitCard
          vi={vi}
          count={0}
          bytes={0}
          losslessBytes={0}
          localCount={local.ready ? local.files.length : undefined}
        />
        <EmptyState
          icon="cloud-download-outline"
          accent={palette.accent}
          title={vi ? 'Chưa có bài tải về' : 'No downloads yet'}
          message={
            vi
              ? 'Mở menu ⋯ của một bài hát và chọn “Tải xuống để nghe offline”.'
              : 'Open a song’s ⋯ menu and choose “Download for offline”.'
          }
          actionLabel={vi ? 'Tìm nhạc' : 'Find music'}
          actionIcon="search"
          onAction={() => setActiveTab('search')}
        />
      </View>
    );
  }

  const sp = sheetProps();
  return (
    <View>
      <SplitCard
        vi={vi}
        count={all.length}
        bytes={totalBytes}
        losslessBytes={losslessBytes}
        localCount={local.ready ? local.files.length : undefined}
      />

      {/* toolbar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.toolbar}
      >
        <Tap
          onPress={() => {
            if (selecting) endSelect();
            else setSelecting(true);
          }}
          style={[s.tool, selecting && { backgroundColor: palette.accent }]}
          accessibilityLabel={vi ? 'Chọn bài tải' : 'Select downloads'}
        >
          <Ionicons
            name={selecting ? 'close' : 'checkmark-circle-outline'}
            size={15}
            color={selecting ? palette.onAccent : c.icon}
          />
          <Text style={[s.toolText, selecting && { color: palette.onAccent }]}>
            {selecting ? (vi ? 'Xong' : 'Done') : vi ? 'Chọn' : 'Select'}
          </Text>
        </Tap>
        <Tap
          onPress={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length])}
          style={s.tool}
          accessibilityLabel={vi ? 'Sắp xếp' : 'Sort'}
        >
          <Ionicons name="swap-vertical" size={15} color={c.icon} />
          <Text style={s.toolText}>{SORT_LABEL[sort]}</Text>
        </Tap>
        <Tap
          onPress={() => setGroup(GROUPS[(GROUPS.indexOf(group) + 1) % GROUPS.length])}
          style={s.tool}
          accessibilityLabel={vi ? 'Nhóm theo' : 'Group by'}
        >
          <Ionicons name="albums-outline" size={15} color={c.icon} />
          <Text style={s.toolText}>{GROUP_LABEL[group]}</Text>
        </Tap>
        <Tap
          onPress={() => {
            const list = sorted.map((d) => d.track);
            const sh = [...list].sort(() => Math.random() - 0.5);
            playTrack(sh[0], sh);
          }}
          style={s.tool}
          accessibilityLabel={vi ? 'Trộn bài tải' : 'Shuffle downloads'}
        >
          <Ionicons name="shuffle" size={15} color={c.icon} />
          <Text style={s.toolText}>{vi ? 'Trộn' : 'Shuffle'}</Text>
        </Tap>
      </ScrollView>

      {selecting && (
        <View style={s.selBar}>
          <Tap
            feedback="opacity"
            onPress={() =>
              setSelected(
                chosenIds.length === all.length
                  ? {}
                  : Object.fromEntries(all.map((d) => [d.track.id, true]))
              )
            }
          >
            <Text style={[s.selAll, { color: palette.accent }]}>
              {chosenIds.length === all.length
                ? vi
                  ? 'Bỏ chọn'
                  : 'None'
                : vi
                  ? 'Chọn tất cả'
                  : 'All'}
            </Text>
          </Tap>
          <Text style={s.selCount}>
            {chosenIds.length} {vi ? 'đã chọn' : 'selected'}
            {chosenIds.length ? ` · ${formatBytes(chosenBytes)}` : ''}
          </Text>
        </View>
      )}
      {selecting && chosenIds.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.bulkRow}
        >
          <Tap
            onPress={() => {
              playTrack(chosenTracks[0], chosenTracks);
              endSelect();
            }}
            style={[s.tool, { backgroundColor: palette.accent }]}
          >
            <Ionicons name="play" size={15} color={palette.onAccent} />
            <Text style={[s.toolText, { color: palette.onAccent }]}>{vi ? 'Phát' : 'Play'}</Text>
          </Tap>
          <Tap onPress={() => setSheet({ kind: 'group', ids: chosenIds })} style={s.tool}>
            <Ionicons name="folder-outline" size={15} color={c.icon} />
            <Text style={s.toolText}>{vi ? 'Vào thư mục' : 'To folder'}</Text>
          </Tap>
          <Tap onPress={() => setSheet({ kind: 'playlist', tracks: chosenTracks })} style={s.tool}>
            <Ionicons name="add-circle-outline" size={15} color={c.icon} />
            <Text style={s.toolText}>{vi ? 'Vào playlist' : 'To playlist'}</Text>
          </Tap>
          {Platform.OS !== 'web' && (
            <Tap onPress={() => setSheet({ kind: 'local', ids: chosenIds })} style={s.tool}>
              <Ionicons name="phone-portrait-outline" size={15} color={c.icon} />
              <Text style={s.toolText}>{vi ? 'Sang Trên máy' : 'To Local Files'}</Text>
            </Tap>
          )}
          <Tap onPress={() => askDelete(chosenIds)} style={s.tool}>
            <Ionicons name="trash-outline" size={15} color={c.danger} />
            <Text style={[s.toolText, { color: c.danger }]}>{vi ? 'Xoá' : 'Delete'}</Text>
          </Tap>
        </ScrollView>
      )}
      {busy && (
        <Text style={[s.hint, { color: palette.accent }]}>
          {vi ? 'Đang chuyển tệp…' : 'Moving files…'}
        </Text>
      )}

      {sections.map((sec) => {
        const isCollapsed = !!collapsed[sec.key];
        const secBytes = sec.items.reduce((n, d) => n + (d.sizeBytes || 0), 0);
        const isFolder = group === 'folder' && sec.key !== UNGROUPED;
        const queue = sec.items.map((d) => d.track);
        return (
          <View key={sec.key} style={{ marginBottom: 6 }}>
            {sec.title !== '' && (
              <View style={s.secHead}>
                <Tap
                  feedback="opacity"
                  onPress={() => setCollapsed((p) => ({ ...p, [sec.key]: !p[sec.key] }))}
                  style={s.secTitleWrap}
                  accessibilityLabel={sec.title}
                >
                  <Ionicons
                    name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                    size={15}
                    color={c.text3}
                  />
                  {group === 'folder' && (
                    <Ionicons
                      name={isFolder ? 'folder' : 'file-tray-outline'}
                      size={16}
                      color={isFolder ? palette.accent : c.text3}
                    />
                  )}
                  <Text numberOfLines={1} style={s.secTitle}>
                    {sec.title}
                  </Text>
                  <Text style={s.secMeta}>
                    {sec.items.length} · {formatBytes(secBytes)}
                  </Text>
                </Tap>
                {selecting ? (
                  <Tap
                    feedback="opacity"
                    hitSlop={8}
                    onPress={() => {
                      const allOn = sec.items.every((d) => selected[d.track.id]);
                      setSelected((p) => {
                        const n = { ...p };
                        sec.items.forEach((d) => (n[d.track.id] = !allOn));
                        return n;
                      });
                    }}
                    style={s.secBtn}
                  >
                    <Ionicons
                      name={
                        sec.items.every((d) => selected[d.track.id])
                          ? 'checkmark-circle'
                          : 'ellipse-outline'
                      }
                      size={20}
                      color={palette.accent}
                    />
                  </Tap>
                ) : (
                  <>
                    <Tap
                      feedback="opacity"
                      hitSlop={6}
                      onPress={() => playTrack(queue[0], queue)}
                      style={s.secBtn}
                      accessibilityLabel={vi ? `Phát ${sec.title}` : `Play ${sec.title}`}
                    >
                      <Ionicons name="play-circle" size={24} color={palette.accent} />
                    </Tap>
                    {isFolder &&
                      (nativeMenuAvailable ? (
                        <NativeMenu
                          items={folderActions(sec.key).map((a, i) => ({
                            id: a.id,
                            title: a.title,
                            icon: a.icon,
                            destructive: a.destructive,
                            section: i >= 2 ? 1 : 0,
                          }))}
                          onSelect={(id) => setTimeout(() => onFolderAction(sec.key, id), 350)}
                          title={sec.title}
                          label={vi ? 'Tuỳ chọn thư mục' : 'Folder options'}
                          style={s.secBtn}
                        >
                          <Ionicons name="ellipsis-horizontal" size={18} color={c.icon} />
                        </NativeMenu>
                      ) : (
                        <Tap
                          feedback="opacity"
                          hitSlop={6}
                          onPress={() => setSheet({ kind: 'folderActions', folder: sec.key })}
                          style={s.secBtn}
                          accessibilityLabel={vi ? 'Tuỳ chọn thư mục' : 'Folder options'}
                        >
                          <Ionicons name="ellipsis-horizontal" size={18} color={c.icon} />
                        </Tap>
                      ))}
                  </>
                )}
              </View>
            )}
            {!isCollapsed &&
              sec.items.map((d) => (
                <DownloadRow
                  key={d.track.id}
                  meta={d}
                  showFolder={group !== 'folder'}
                  selecting={selecting}
                  checked={!!selected[d.track.id]}
                  accent={palette.accent}
                  vi={vi}
                  onPress={() => {
                    if (selecting) toggle(d.track.id);
                    else playTrack(d.track, queue);
                  }}
                  onLongPress={() => {
                    haptic('medium');
                    setSelecting(true);
                    setSelected((p) => ({ ...p, [d.track.id]: true }));
                  }}
                  onMore={() => setActionTrack(d.track)}
                  onFolder={() => setSheet({ kind: 'group', ids: [d.track.id] })}
                />
              ))}
          </View>
        );
      })}

      <Tap
        feedback="opacity"
        onPress={() =>
          askDelete(
            all.map((d) => d.track.id),
            vi ? 'Xoá tất cả bản tải?' : 'Delete all downloads?'
          )
        }
        style={s.deleteAll}
      >
        <Ionicons name="trash-outline" size={16} color={c.danger} />
        <Text style={[s.deleteAllText, { color: c.danger }]}>
          {vi
            ? `Xoá tất cả bản tải · ${formatBytes(totalBytes)}`
            : `Delete all downloads · ${formatBytes(totalBytes)}`}
        </Text>
      </Tap>

      {sp && <PickerSheet {...sp} />}
    </View>
  );
};

// ---- the "app downloads vs. device songs" card ----

const SplitCard: React.FC<{
  vi: boolean;
  count: number;
  bytes: number;
  losslessBytes: number;
  localCount?: number;
}> = ({ vi, count, bytes, losslessBytes, localCount }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const lossPct = bytes ? Math.max(0.04, losslessBytes / bytes) : 0;
  return (
    <View style={s.splitWrap}>
      <View style={[s.splitCard, { borderColor: 'rgba(52, 211, 153, 0.35)' }]}>
        <View style={s.splitHead}>
          <View style={[s.splitIcon, { backgroundColor: 'rgba(52, 211, 153, 0.16)' }]}>
            <Ionicons name="arrow-down-circle" size={18} color={HOLYSIC_COLORS.flacEmerald} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.splitTitle}>{vi ? 'Tải từ HolySic' : 'Downloaded in HolySic'}</Text>
            <Text style={s.splitSub}>
              {count} {vi ? 'bài' : 'songs'} · {formatBytes(bytes)}
            </Text>
          </View>
        </View>
        {count > 0 && (
          <>
            <View style={s.bar}>
              {losslessBytes > 0 && (
                <View style={{ flex: lossPct, backgroundColor: HOLYSIC_COLORS.flacEmerald }} />
              )}
              {bytes - losslessBytes > 0 && (
                <View style={{ flex: 1 - lossPct, backgroundColor: HOLYSIC_COLORS.iosBlue }} />
              )}
            </View>
            <View style={s.legend}>
              <View style={[s.dot, { backgroundColor: HOLYSIC_COLORS.flacEmerald }]} />
              <Text style={s.legendText}>Lossless {formatBytes(losslessBytes)}</Text>
              <View style={[s.dot, { backgroundColor: HOLYSIC_COLORS.iosBlue, marginLeft: 10 }]} />
              <Text style={s.legendText}>AAC {formatBytes(bytes - losslessBytes)}</Text>
            </View>
          </>
        )}
        <Text style={s.splitNote}>
          {vi
            ? 'Lưu bên trong ứng dụng để nghe khi mất mạng.'
            : 'Kept inside the app for listening offline.'}
        </Text>
      </View>
      <Tap
        onPress={() => LocalLibrary.open()}
        style={[s.splitCard, s.splitLocal, { borderColor: 'rgba(244, 114, 182, 0.35)' }]}
        accessibilityLabel={vi ? 'Mở Nhạc trên máy' : 'Open Local Files'}
      >
        <View style={[s.splitIcon, { backgroundColor: 'rgba(244, 114, 182, 0.16)' }]}>
          <Ionicons name="phone-portrait" size={17} color="#F472B6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.splitTitle}>
            {vi ? 'Trên máy' : 'Local Files'}
            {localCount !== undefined ? ` · ${localCount}` : ''}
          </Text>
          <Text style={s.splitSub} numberOfLines={2}>
            {vi
              ? 'Tệp bạn tự thêm qua ứng dụng Tệp, AirDrop, máy tính'
              : 'Files you add via Files, AirDrop or a computer'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={c.text3} />
      </Tap>
    </View>
  );
};

// ---- one download ----

const DownloadRow = memo(
  ({
    meta,
    selecting,
    checked,
    accent,
    vi,
    onPress,
    onLongPress,
    onMore,
    onFolder,
    showFolder,
  }: {
    meta: DownloadedTrackMeta;
    showFolder: boolean;
    selecting: boolean;
    checked: boolean;
    accent: string;
    vi: boolean;
    onPress: () => void;
    onLongPress: () => void;
    onMore: () => void;
    onFolder: () => void;
  }) => {
    const c = useUi();
    const s = useThemedStyles(makeStyles);
    const { currentTrack } = useHolySic();
    const t = meta.track;
    const active = currentTrack?.id === t.id;
    const lossless = isLossless(meta);
    return (
      <Tap
        feedback="opacity"
        onPress={onPress}
        onLongPress={selecting ? undefined : onLongPress}
        delayLongPress={380}
        style={[s.row, active && { backgroundColor: accent + '1F' }]}
      >
        {selecting && (
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? accent : c.text3}
          />
        )}
        <ArtworkImage source={{ uri: t.artworkUrl }} fallbackSeed={t.title} style={s.art} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[s.title, active && { color: accent }]}>
            {t.title}
          </Text>
          <View style={s.subRow}>
            <View
              style={[
                s.qPill,
                lossless && {
                  borderColor: 'rgba(52, 211, 153, 0.45)',
                  backgroundColor: 'rgba(52, 211, 153, 0.10)',
                },
              ]}
            >
              <Text style={[s.qText, lossless && { color: HOLYSIC_COLORS.flacEmerald }]}>
                {lossless
                  ? 'FLAC'
                  : (meta.qualityLabel.match(/\d+\s?k/i)?.[0]?.replace(/\s/g, '') ?? 'AAC')}
              </Text>
            </View>
            <Text numberOfLines={1} style={s.sub}>
              {t.artist} · {formatBytes(meta.sizeBytes)}
              {meta.folder && showFolder ? ` · ${meta.folder}` : ''}
            </Text>
          </View>
        </View>
        {!selecting && (
          <>
            <Tap
              feedback="opacity"
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation?.();
                onFolder();
              }}
              style={s.rowBtn}
              accessibilityLabel={vi ? 'Xếp vào thư mục' : 'Put in folder'}
            >
              <Ionicons
                name={meta.folder ? 'folder' : 'folder-outline'}
                size={18}
                color={meta.folder ? accent : c.text3}
              />
            </Tap>
            <Tap
              feedback="opacity"
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation?.();
                onMore();
              }}
              style={s.rowBtn}
              accessibilityLabel={vi ? 'Thêm' : 'More'}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={c.text3} />
            </Tap>
          </>
        )}
      </Tap>
    );
  }
);
DownloadRow.displayName = 'DownloadRow';

const makeStyles = (c: UiColors) => ({
  splitWrap: { paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  splitCard: {
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: c.card,
    padding: 13,
  },
  splitLocal: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  splitHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  splitIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  splitTitle: { color: c.text, fontSize: 15, fontWeight: '800' as const },
  splitSub: { color: c.text2, fontSize: 12.5, marginTop: 1 },
  splitNote: { color: c.text3, fontSize: 11.5, marginTop: 8 },
  bar: {
    flexDirection: 'row' as const,
    height: 7,
    borderRadius: 4,
    overflow: 'hidden' as const,
    backgroundColor: c.field,
    marginTop: 12,
    gap: 2,
  },
  legend: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 7, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: c.text2, fontSize: 11.5, fontWeight: '600' as const },
  toolbar: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  tool: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: c.field,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toolText: { color: c.text, fontSize: 12.5, fontWeight: '700' as const },
  selBar: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  selAll: { fontWeight: '800' as const, fontSize: 13.5 },
  selCount: { color: c.text, fontWeight: '700' as const, fontSize: 13 },
  bulkRow: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  hint: { fontSize: 12, paddingHorizontal: 18, paddingBottom: 6, fontWeight: '600' as const },
  secHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  secTitleWrap: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 4,
  },
  secTitle: { color: c.text, fontSize: 15, fontWeight: '800' as const, flexShrink: 1 },
  secMeta: { color: c.text3, fontSize: 12, fontWeight: '600' as const },
  secBtn: {
    width: 34,
    height: 34,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  art: { width: 46, height: 46, borderRadius: 9 },
  title: { color: c.text, fontSize: 14.5, fontWeight: '700' as const },
  subRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 3 },
  qPill: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  qText: { color: c.text2, fontSize: 9.5, fontWeight: '800' as const },
  sub: { color: c.text3, fontSize: 12, flexShrink: 1 },
  rowBtn: {
    width: 32,
    height: 36,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  deleteAll: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 7,
    marginHorizontal: 14,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: c.field,
  },
  deleteAllText: { fontSize: 13.5, fontWeight: '700' as const },
});
