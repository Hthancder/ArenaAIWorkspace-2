// "Nhạc trên máy" — Spotify-style Local Files, organised by the user's own folders.
// A page that slides over the tabs (the mini player & tab bar stay visible, like Spotify), so the
// full player and the ⋯ track menu open normally on top of it. Its sheets/prompts render in
// <LocalOverlayHost/> (mounted above the dock) so nothing gets covered.

import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import {
  compareNames,
  FolderNode,
  LocalFile,
  LocalLibrary,
  localPathOf,
  LocalState,
} from '../../services/local/localLibrary';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { openSongEditor } from './SongInfoEditor';
import { queueM3UImport } from '../merge/ImportModal';
import { exportPlaylistM3U } from '../../services/import/playlistFiles';

export const useLocalLibrary = (): LocalState =>
  useSyncExternalStore(LocalLibrary.subscribe, LocalLibrary.getState, LocalLibrary.getState);

// ---------- overlay store (sheets / prompts / move picker) ----------

type ActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
};
type Overlay =
  | { type: 'actions'; title: string; subtitle?: string; items: ActionItem[] }
  | {
      type: 'prompt';
      title: string;
      initial?: string;
      placeholder?: string;
      confirm: string;
      onSubmit: (v: string) => void | Promise<void>;
    }
  | { type: 'confirm'; title: string; message: string; confirm: string; onConfirm: () => void }
  | { type: 'move'; paths: string[]; onDone?: () => void }
  | { type: 'cover'; dir: string }
  | { type: 'help' };

let overlay: Overlay | null = null;
const overlaySubs = new Set<() => void>();
const setOverlay = (o: Overlay | null) => {
  overlay = o;
  overlaySubs.forEach((f) => f());
};
const useOverlay = () =>
  useSyncExternalStore(
    (cb) => {
      overlaySubs.add(cb);
      return () => {
        overlaySubs.delete(cb);
      };
    },
    () => overlay,
    () => overlay
  );

// ---------- helpers ----------

const fmtDur = (sec: number) => {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const fmtTotal = (sec: number, vi: boolean) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.max(h ? 0 : 1, Math.round((sec % 3600) / 60));
  return h ? `${h} ${vi ? 'giờ' : 'h'} ${m} ${vi ? 'phút' : 'min'}` : `${m} ${vi ? 'phút' : 'min'}`;
};
const shuffled = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

type View_ = 'folders' | 'songs' | 'albums' | 'artists';
type SortMode = 'name' | 'recent' | 'artist';
type Nav =
  | { kind: 'folder'; path: string }
  | { kind: 'group'; group: 'album' | 'artist'; key: string; title: string };

interface Group {
  key: string;
  title: string;
  subtitle: string;
  cover: string;
  files: LocalFile[];
}

function groupBy(files: LocalFile[], by: 'album' | 'artist', vi: boolean): Group[] {
  const map = new Map<string, Group>();
  for (const f of files) {
    const name =
      by === 'album'
        ? f.track.album || (vi ? 'Không rõ album' : 'Unknown album')
        : f.track.artists?.[0] || f.track.artist;
    const key = fold(name);
    let g = map.get(key);
    if (!g) {
      g = { key, title: name, subtitle: '', cover: '', files: [] };
      map.set(key, g);
    }
    g.files.push(f);
    if (!g.cover && f.track.artworkUrl) g.cover = f.track.artworkUrl;
  }
  const out = [...map.values()];
  for (const g of out) {
    if (by === 'album') {
      g.subtitle = f0(g.files).meta.albumArtist || f0(g.files).track.artist;
      g.files.sort(
        (a, b) =>
          (a.meta.discNo || 0) - (b.meta.discNo || 0) ||
          (a.meta.trackNo || 999) - (b.meta.trackNo || 999) ||
          compareNames(a.name, b.name)
      );
    } else {
      g.subtitle = `${g.files.length} ${vi ? 'bài' : 'songs'}`;
      g.files.sort((a, b) => compareNames(a.track.title, b.track.title));
    }
  }
  return out.sort((a, b) => compareNames(a.title, b.title));
}
const f0 = (a: LocalFile[]) => a[0];

// ---------- screen ----------

export const LocalLibraryScreen: React.FC = () => {
  const st = useLocalLibrary();
  const insets = useSafeAreaInsets();
  const {
    prefs,
    palette,
    playTrack,
    addToQueue,
    setActionTrack,
    savePlaylistFromTracks,
    showToast,
    haptic,
    currentTrack,
    isPlaying,
    openImport,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const [stack, setStack] = useState<Nav[]>([{ kind: 'folder', path: '' }]);
  const [view, setView] = useState<View_>('folders');
  const [sort, setSort] = useState<SortMode>('name');
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // (re)open at a folder
  useEffect(() => {
    if (st.openAt === null) return;
    setStack(
      st.openAt
        ? [
            { kind: 'folder', path: '' },
            { kind: 'folder', path: st.openAt },
          ]
        : [{ kind: 'folder', path: '' }]
    );
    setView('folders');
    setQuery('');
    setSelecting(false);
    setSelected(new Set());
  }, [st.openNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = stack[stack.length - 1];
  const atRoot = stack.length === 1;
  const folder: FolderNode | null =
    nav.kind === 'folder' ? LocalLibrary.folder(nav.path) || (atRoot ? st.root : null) : null;

  // a folder disappeared (moved/deleted in Files): step back to the nearest existing parent
  useEffect(() => {
    if (nav.kind === 'folder' && !folder && st.ready) setStack((s) => s.slice(0, -1));
  }, [folder, nav, st.ready]);

  const albums = useMemo(() => groupBy(st.files, 'album', vi), [st.files, vi]);
  const artists = useMemo(() => groupBy(st.files, 'artist', vi), [st.files, vi]);

  const q = fold(query.trim());
  const match = (f: LocalFile) =>
    !q || fold(`${f.track.title} ${f.track.artist} ${f.track.album || ''} ${f.name}`).includes(q);

  const sortFiles = (files: LocalFile[]) => {
    if (sort === 'recent') return [...files].sort((a, b) => b.meta.addedAt - a.meta.addedAt);
    if (sort === 'artist')
      return [...files].sort(
        (a, b) =>
          compareNames(a.track.artist, b.track.artist) || compareNames(a.track.title, b.track.title)
      );
    return files; // folder order (disc / track number / name)
  };

  // what this page lists
  let title = vi ? 'Nhạc trên máy' : 'Local Files';
  let subtitleCount = 0;
  let subtitleSec = 0;
  let folders: FolderNode[] = [];
  let files: LocalFile[] = [];
  let groups: Group[] | null = null;
  let scopeTracks: Track[] = [];
  let cover = '';

  if (nav.kind === 'group') {
    const g = (nav.group === 'album' ? albums : artists).find((x) => x.key === nav.key);
    title = nav.title;
    files = (g?.files || []).filter(match);
    cover = g?.cover || '';
    scopeTracks = (g?.files || []).map((f) => f.track);
    subtitleCount = g?.files.length || 0;
    subtitleSec = (g?.files || []).reduce((s, f) => s + (f.track.durationSec || 0), 0);
  } else if (atRoot && view !== 'folders') {
    if (view === 'songs') {
      files = sortFiles(
        q
          ? st.files.filter(match)
          : [...st.files].sort((a, b) => compareNames(a.track.title, b.track.title))
      );
      if (sort !== 'name') files = sortFiles(files);
    } else {
      groups = (view === 'albums' ? albums : artists).filter(
        (g) => !q || fold(`${g.title} ${g.subtitle}`).includes(q)
      );
    }
    scopeTracks = st.files.map((f) => f.track);
    subtitleCount = st.files.length;
    subtitleSec = st.root.totalSec;
  } else if (folder) {
    if (!atRoot) title = folder.name;
    cover = atRoot ? '' : folder.coverUri || '';
    if (q) {
      // search the whole subtree
      const all: LocalFile[] = [];
      const walk = (n: FolderNode) => {
        n.files.forEach((f) => match(f) && all.push(f));
        n.folders.forEach(walk);
      };
      walk(folder);
      files = all;
      folders = folder.folders.filter((f) => fold(f.name).includes(q));
    } else {
      folders =
        sort === 'recent' ? [...folder.folders].sort((a, b) => b.mtime - a.mtime) : folder.folders;
      files = sortFiles(folder.files);
    }
    scopeTracks = LocalLibrary.tracksIn(folder.path);
    subtitleCount = folder.total;
    subtitleSec = folder.totalSec;
  }

  const currentDir = nav.kind === 'folder' && folder ? folder.path : '';

  const back = () => {
    if (selecting) {
      setSelecting(false);
      setSelected(new Set());
      return;
    }
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
    else LocalLibrary.close();
  };

  const playList = (tracks: Track[], start?: Track, shuffle = false) => {
    if (!tracks.length) return;
    haptic('light');
    const list = shuffle ? shuffled(tracks) : tracks;
    playTrack(start || list[0], list);
  };

  const toggleSel = (path: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const tracksForPaths = (paths: string[]): Track[] => {
    const out: Track[] = [];
    for (const p of paths) {
      const f = st.files.find((x) => x.path === p);
      if (f) out.push(f.track);
      else out.push(...LocalLibrary.tracksIn(p));
    }
    return out;
  };

  // ----- prompts -----
  const promptNewFolder = (parent: string, after?: (rel: string) => void) =>
    setOverlay({
      type: 'prompt',
      title: vi ? 'Thư mục mới' : 'New folder',
      placeholder: vi ? 'Ví dụ: Chill, Nhạc Trịnh, Gym…' : 'e.g. Chill, Workout…',
      confirm: vi ? 'Tạo' : 'Create',
      onSubmit: async (v) => {
        const rel = await LocalLibrary.createFolder(parent, v);
        showToast(vi ? `Đã tạo thư mục “${v.trim()}”` : `Created “${v.trim()}”`);
        after?.(rel);
      },
    });

  const importHere = async (dir: string) => {
    try {
      const n = await LocalLibrary.importFromPicker(dir);
      if (n) showToast(vi ? `Đã thêm ${n} bài vào thư mục` : `Added ${n} songs`);
    } catch (e: any) {
      showToast(String(e?.message || e));
    }
  };

  const confirmDelete = (paths: string[], label: string) =>
    setOverlay({
      type: 'confirm',
      title: vi ? 'Xoá khỏi máy?' : 'Delete from device?',
      message: vi
        ? `${label} sẽ bị xoá khỏi thư mục của HolySic (cả trong ứng dụng Tệp). Không thể hoàn tác.`
        : `${label} will be deleted from HolySic's folder (also in the Files app). This can't be undone.`,
      confirm: vi ? 'Xoá' : 'Delete',
      onConfirm: async () => {
        const n = await LocalLibrary.remove(paths);
        setSelecting(false);
        setSelected(new Set());
        showToast(vi ? `Đã xoá ${n} mục` : `Deleted ${n} items`);
      },
    });

  const runAutoFill = async (paths: string[]) => {
    if (st.fetching) return;
    showToast(
      vi
        ? 'Đang tìm thông tin & ảnh bìa trên Apple Music / Deezer…'
        : 'Looking up details & covers on Apple Music / Deezer…'
    );
    const r = await LocalLibrary.autoFill(paths);
    showToast(
      !r.checked
        ? vi
          ? 'Các bài đã đủ thông tin & ảnh bìa'
          : 'Every song already has details & a cover'
        : vi
          ? `Đã bổ sung ${r.matched}/${r.checked} bài${r.matched < r.checked ? ' — bài còn lại: ⋯ → Sửa thông tin để chọn tay' : ''}`
          : `Filled ${r.matched}/${r.checked} songs${r.matched < r.checked ? ' — for the rest: ⋯ → Edit info' : ''}`
    );
  };

  const savePlaylist = (tracks: Track[], name: string) =>
    setOverlay({
      type: 'prompt',
      title: vi ? 'Lưu thành playlist' : 'Save as playlist',
      initial: name,
      confirm: vi ? 'Lưu' : 'Save',
      onSubmit: (v) => {
        savePlaylistFromTracks(
          v.trim() || name,
          tracks,
          vi ? 'Từ Nhạc trên máy' : 'From Local Files'
        );
        showToast(vi ? `Đã lưu playlist ${tracks.length} bài` : `Saved ${tracks.length} songs`);
      },
    });

  const folderMenu = () =>
    setOverlay({
      type: 'actions',
      title: atRoot ? title : folder?.name || title,
      subtitle: `${subtitleCount} ${vi ? 'bài' : 'songs'}`,
      items: [
        ...(nav.kind === 'folder'
          ? [
              {
                icon: 'folder-open-outline' as const,
                label: vi ? 'Thư mục mới' : 'New folder',
                onPress: () => promptNewFolder(currentDir),
              },
              {
                icon: 'add-circle-outline' as const,
                label: vi ? 'Thêm bài từ ứng dụng Tệp vào đây' : 'Add songs from Files here',
                onPress: () => importHere(currentDir),
              },
              ...(!atRoot
                ? [
                    {
                      icon: 'image-outline' as const,
                      label: vi ? 'Ảnh bìa thư mục…' : 'Folder cover…',
                      onPress: () => setOverlay({ type: 'cover', dir: currentDir }),
                    },
                  ]
                : []),
            ]
          : []),
        ...(scopeTracks.length
          ? [
              {
                icon: 'sparkles-outline' as const,
                label: vi
                  ? 'Tự tìm thông tin & ảnh bìa còn thiếu'
                  : 'Find missing details & covers',
                onPress: () => runAutoFill(scopeTracks.map((t) => localPathOf(t))),
              },
            ]
          : []),
        {
          icon: st.autoFetch ? 'toggle' : 'toggle-outline',
          label: vi
            ? `Tự tìm cho bài mới: ${st.autoFetch ? 'Bật' : 'Tắt'}`
            : `Auto-find for new songs: ${st.autoFetch ? 'On' : 'Off'}`,
          onPress: () => {
            LocalLibrary.setAutoFetch(!st.autoFetch);
            showToast(
              !st.autoFetch
                ? vi
                  ? 'Bài mới sẽ tự có thông tin & ảnh bìa (khi tìm được chắc chắn)'
                  : 'New songs get details & covers automatically (confident matches only)'
                : vi
                  ? 'Đã tắt tự tìm'
                  : 'Auto-find off'
            );
          },
        },
        {
          icon: 'checkmark-circle-outline',
          label: vi ? 'Chọn nhiều' : 'Select',
          onPress: () => setSelecting(true),
        },
        {
          icon: 'swap-vertical-outline',
          label:
            (vi ? 'Sắp xếp: ' : 'Sort: ') +
            (sort === 'name'
              ? vi
                ? 'Theo thư mục / tên'
                : 'Folder order / name'
              : sort === 'recent'
                ? vi
                  ? 'Mới thêm'
                  : 'Recently added'
                : vi
                  ? 'Nghệ sĩ'
                  : 'Artist'),
          onPress: () =>
            setSort((s) => (s === 'name' ? 'recent' : s === 'recent' ? 'artist' : 'name')),
        },
        ...(scopeTracks.length
          ? [
              {
                icon: 'list-outline' as const,
                label: vi ? 'Lưu thành playlist' : 'Save as playlist',
                onPress: () => savePlaylist(scopeTracks, title),
              },
              {
                icon: 'share-outline' as const,
                label: vi ? 'Xuất playlist M3U' : 'Export M3U playlist',
                onPress: async () => {
                  const rel = await exportPlaylistM3U(title, scopeTracks);
                  if (rel) showToast(vi ? `Đã lưu ${rel}` : `Saved ${rel}`);
                },
              },
            ]
          : []),
        ...(Platform.OS === 'ios'
          ? [
              {
                icon: 'folder-outline' as const,
                label: vi
                  ? 'Mở thư mục HolySic trong ứng dụng Tệp'
                  : 'Open HolySic folder in Files',
                onPress: () => LocalLibrary.openInFilesApp(),
              },
            ]
          : []),
        {
          icon: 'refresh-outline',
          label: vi ? 'Quét lại' : 'Rescan',
          onPress: () => LocalLibrary.scan(),
        },
        {
          icon: 'help-circle-outline',
          label: vi ? 'Cách thêm & sắp xếp nhạc' : 'How to add & organise music',
          onPress: () => setOverlay({ type: 'help' }),
        },
      ],
    });

  const subFolderMenu = (f: FolderNode) =>
    setOverlay({
      type: 'actions',
      title: f.name,
      subtitle: `${f.total} ${vi ? 'bài' : 'songs'}`,
      items: [
        {
          icon: 'play',
          label: vi ? 'Phát thư mục' : 'Play folder',
          onPress: () => playList(LocalLibrary.tracksIn(f.path)),
        },
        {
          icon: 'shuffle',
          label: vi ? 'Phát ngẫu nhiên' : 'Shuffle',
          onPress: () => playList(LocalLibrary.tracksIn(f.path), undefined, true),
        },
        {
          icon: 'list-outline',
          label: vi ? 'Lưu thành playlist' : 'Save as playlist',
          onPress: () => savePlaylist(LocalLibrary.tracksIn(f.path), f.name),
        },
        {
          icon: 'create-outline',
          label: vi ? 'Đổi tên' : 'Rename',
          onPress: () =>
            setOverlay({
              type: 'prompt',
              title: vi ? 'Đổi tên thư mục' : 'Rename folder',
              initial: f.name,
              confirm: vi ? 'Lưu' : 'Save',
              onSubmit: async (v) => {
                await LocalLibrary.rename(f.path, v);
              },
            }),
        },
        {
          icon: 'image-outline',
          label: vi ? 'Ảnh bìa thư mục…' : 'Folder cover…',
          onPress: () => setOverlay({ type: 'cover', dir: f.path }),
        },
        {
          icon: 'arrow-redo-outline',
          label: vi ? 'Chuyển tới thư mục…' : 'Move to…',
          onPress: () => setOverlay({ type: 'move', paths: [f.path] }),
        },
        {
          icon: 'trash-outline',
          label: vi ? 'Xoá thư mục' : 'Delete folder',
          danger: true,
          onPress: () =>
            confirmDelete(
              [f.path],
              vi ? `Thư mục “${f.name}” (${f.total} bài)` : `“${f.name}” (${f.total} songs)`
            ),
        },
      ],
    });

  const fileMenu = (f: LocalFile) =>
    setOverlay({
      type: 'actions',
      title: f.track.title,
      subtitle: f.path,
      items: [
        {
          icon: 'play-forward-outline',
          label: vi ? 'Phát tiếp theo' : 'Play next',
          onPress: () => {
            addToQueue(f.track, true);
          },
        },
        {
          icon: 'list-outline',
          label: vi ? 'Thêm vào hàng chờ' : 'Add to queue',
          onPress: () => addToQueue(f.track, false),
        },
        {
          icon: 'sparkles-outline',
          label: vi ? 'Sửa thông tin & ảnh bìa…' : 'Edit info & cover…',
          onPress: () => openSongEditor(f.track),
        },
        {
          icon: 'arrow-redo-outline',
          label: vi ? 'Chuyển tới thư mục…' : 'Move to…',
          onPress: () => setOverlay({ type: 'move', paths: [f.path] }),
        },
        {
          icon: 'create-outline',
          label: vi ? 'Đổi tên tệp' : 'Rename file',
          onPress: () =>
            setOverlay({
              type: 'prompt',
              title: vi ? 'Đổi tên tệp' : 'Rename file',
              initial: f.name.replace(/\.[^.]+$/, ''),
              confirm: vi ? 'Lưu' : 'Save',
              onSubmit: async (v) => {
                await LocalLibrary.rename(f.path, v);
              },
            }),
        },
        {
          icon: 'ellipsis-horizontal-circle-outline',
          label: vi ? 'Thích, playlist, chia sẻ…' : 'Like, playlist, share…',
          onPress: () => setActionTrack(f.track),
        },
        {
          icon: 'trash-outline',
          label: vi ? 'Xoá tệp' : 'Delete file',
          danger: true,
          onPress: () => confirmDelete([f.path], `“${f.name}”`),
        },
      ],
    });

  // ----- rows -----
  const renderFolder = (f: FolderNode) => {
    const sel = selected.has(f.path);
    return (
      <Pressable
        key={'d:' + f.path}
        onPress={() =>
          selecting ? toggleSel(f.path) : setStack((s) => [...s, { kind: 'folder', path: f.path }])
        }
        onLongPress={() => (selecting ? toggleSel(f.path) : subFolderMenu(f))}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityLabel={(vi ? 'Thư mục ' : 'Folder ') + f.name}
      >
        {selecting && <Check on={sel} color={palette.accent} />}
        <View style={[styles.folderIcon, { backgroundColor: palette.container }]}>
          {f.coverUri ? (
            <ArtworkImage
              source={{ uri: f.coverUri }}
              style={styles.folderArt}
              fallbackSeed={f.path}
            />
          ) : (
            <Ionicons name="folder" size={24} color={palette.accent} />
          )}
          {f.coverUri && (
            <View style={styles.folderBadge}>
              <Ionicons name="folder" size={11} color="#FFFFFF" />
            </View>
          )}
        </View>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[styles.rowTitle, { fontFamily }]}>
            {f.name}
          </Text>
          <Text numberOfLines={1} style={styles.rowSub}>
            {f.folders.length ? `${f.folders.length} ${vi ? 'thư mục' : 'folders'} · ` : ''}
            {f.total} {vi ? 'bài' : 'songs'}
            {f.totalSec ? ` · ${fmtTotal(f.totalSec, vi)}` : ''}
          </Text>
        </View>
        {!selecting && (
          <Pressable
            hitSlop={10}
            onPress={() => subFolderMenu(f)}
            style={styles.moreBtn}
            accessibilityLabel={(vi ? 'Tuỳ chọn ' : 'Options for ') + f.name}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color="rgba(255,255,255,0.6)" />
          </Pressable>
        )}
      </Pressable>
    );
  };

  const listTracks = files.map((f) => f.track);
  const renderFile = (f: LocalFile, idx: number) => {
    const sel = selected.has(f.path);
    const playing = currentTrack?.id === f.track.id;
    return (
      <Pressable
        key={'f:' + f.path}
        onPress={() => (selecting ? toggleSel(f.path) : playList(listTracks, f.track))}
        onLongPress={() => (selecting ? toggleSel(f.path) : fileMenu(f))}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {selecting && <Check on={sel} color={palette.accent} />}
        <View>
          <ArtworkImage
            source={{ uri: f.track.artworkUrl }}
            style={styles.art}
            fallbackSeed={f.path}
          />
          {playing && (
            <View style={styles.playingDot}>
              <Ionicons
                name={isPlaying ? 'volume-high' : 'pause'}
                size={13}
                color={palette.accent}
              />
            </View>
          )}
        </View>
        <View style={styles.rowText}>
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, { fontFamily }, playing && { color: palette.accent }]}
          >
            {nav.kind === 'group' && nav.group === 'album' && f.meta.trackNo
              ? `${f.meta.trackNo}. `
              : ''}
            {f.track.title}
          </Text>
          <Text numberOfLines={1} style={styles.rowSub}>
            {f.track.artist}
            {f.track.durationSec ? ` · ${fmtDur(f.track.durationSec)}` : ''}
            {q && nav.kind === 'folder' && f.dir !== currentDir ? ` · ${f.dir || '/'}` : ''}
          </Text>
        </View>
        {!selecting && (
          <Pressable
            hitSlop={10}
            onPress={() => fileMenu(f)}
            style={styles.moreBtn}
            accessibilityLabel={(vi ? 'Tuỳ chọn ' : 'Options for ') + f.track.title}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color="rgba(255,255,255,0.6)" />
          </Pressable>
        )}
      </Pressable>
    );
  };

  const renderGroup = (g: Group) => (
    <Pressable
      key={'g:' + g.key}
      onPress={() =>
        setStack((s) => [
          ...s,
          {
            kind: 'group',
            group: view === 'albums' ? 'album' : 'artist',
            key: g.key,
            title: g.title,
          },
        ])
      }
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <ArtworkImage
        source={{ uri: g.cover }}
        style={[styles.art, view === 'artists' && { borderRadius: 26 }]}
        fallbackSeed={g.key}
      />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { fontFamily }]}>
          {g.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {view === 'albums'
            ? `${g.subtitle} · ${g.files.length} ${vi ? 'bài' : 'songs'}`
            : g.subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );

  // breadcrumb for folders
  const crumbs = nav.kind === 'folder' && nav.path ? nav.path.split('/') : [];

  const isEmptyLibrary = st.ready && st.files.length === 0 && st.root.folders.length === 0;
  type Item = {
    k: string;
    node?: FolderNode;
    file?: LocalFile;
    group?: Group;
    idx?: number;
    pl?: string;
  };
  const playlistFiles =
    nav.kind === 'folder' && folder && !selecting
      ? folder.playlists.filter((p) => !query.trim() || fold(baseName(p)).includes(fold(query)))
      : [];
  const items: Item[] = groups
    ? groups.map((g) => ({ k: 'g' + g.key, group: g }))
    : [
        ...folders.map((f) => ({ k: 'd' + f.path, node: f })),
        ...playlistFiles.map((p) => ({ k: 'p' + p, pl: p })),
        ...files.map((f, idx) => ({ k: 'f' + f.path, file: f, idx })),
      ];

  const openPlaylistFile = async (rel: string) => {
    try {
      const text = await LocalLibrary.readText(rel);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      queueM3UImport({ text, name: baseName(rel), baseDir: dir });
      openImport('list');
    } catch (e: any) {
      showToast(
        (vi ? 'Không đọc được playlist: ' : 'Could not read the playlist: ') + (e?.message || e)
      );
    }
  };
  const renderPlaylist = (rel: string) => (
    <Pressable
      key={'p:' + rel}
      onPress={() => openPlaylistFile(rel)}
      onLongPress={() => playlistMenu(rel)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityLabel={'Playlist ' + baseName(rel)}
    >
      <LinearGradient colors={[palette.accent, palette.container]} style={styles.art}>
        <Ionicons name="list" size={22} color={palette.onAccent} />
      </LinearGradient>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { fontFamily }]}>
          {baseName(rel).replace(/\.m3u8?$/i, '')}
        </Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {vi ? 'Playlist M3U · chạm để mở' : 'M3U playlist · tap to open'}
        </Text>
      </View>
      <Pressable
        hitSlop={10}
        onPress={() => playlistMenu(rel)}
        style={styles.moreBtn}
        accessibilityLabel={(vi ? 'Tuỳ chọn ' : 'Options for ') + baseName(rel)}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color="rgba(255,255,255,0.6)" />
      </Pressable>
    </Pressable>
  );
  const playlistMenu = (rel: string) =>
    setOverlay({
      type: 'actions',
      title: baseName(rel),
      subtitle: rel,
      items: [
        {
          icon: 'open-outline',
          label: vi ? 'Mở / lưu vào Thư viện' : 'Open / save to Library',
          onPress: () => openPlaylistFile(rel),
        },
        {
          icon: 'trash-outline',
          label: vi ? 'Xoá tệp playlist' : 'Delete playlist file',
          danger: true,
          onPress: () =>
            setOverlay({
              type: 'confirm',
              title: vi ? 'Xoá tệp playlist?' : 'Delete playlist file?',
              message: vi
                ? 'Chỉ xoá tệp .m3u, các bài hát vẫn còn.'
                : 'Only the .m3u file is deleted, the songs stay.',
              confirm: vi ? 'Xoá' : 'Delete',
              onConfirm: () => LocalLibrary.remove([rel]),
            }),
        },
      ],
    });

  const header = (
    <View>
      <View style={styles.hero}>
        {nav.kind === 'folder' && !atRoot && !selecting ? (
          <Pressable
            onPress={() => setOverlay({ type: 'cover', dir: currentDir })}
            accessibilityLabel={vi ? 'Đổi ảnh bìa thư mục' : 'Change folder cover'}
          >
            {cover ? (
              <ArtworkImage source={{ uri: cover }} style={styles.heroArt} fallbackSeed={title} />
            ) : (
              <LinearGradient colors={[palette.accent, palette.container]} style={styles.heroArt}>
                <Ionicons name="folder-open" size={38} color={palette.onAccent} />
              </LinearGradient>
            )}
            <View style={styles.heroEdit}>
              <Ionicons name="camera" size={13} color="#FFFFFF" />
            </View>
          </Pressable>
        ) : cover ? (
          <ArtworkImage source={{ uri: cover }} style={styles.heroArt} fallbackSeed={title} />
        ) : (
          <LinearGradient colors={[palette.accent, palette.container]} style={styles.heroArt}>
            <Ionicons
              name={
                nav.kind === 'group'
                  ? nav.group === 'album'
                    ? 'disc'
                    : 'person'
                  : atRoot
                    ? 'phone-portrait'
                    : 'folder-open'
              }
              size={38}
              color={palette.onAccent}
            />
          </LinearGradient>
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={[styles.heroTitle, { fontFamily }]}>
            {title}
          </Text>
          <Text style={styles.heroSub}>
            {subtitleCount} {vi ? 'bài' : 'songs'}
            {subtitleSec ? ` · ${fmtTotal(subtitleSec, vi)}` : ''}
          </Text>
          {st.scanning && (
            <View style={styles.scanRow}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={styles.scanText}>
                {st.progress.total
                  ? `${vi ? 'Đang đọc thẻ nhạc' : 'Reading tags'} ${st.progress.done}/${st.progress.total}`
                  : vi
                    ? 'Đang quét thư mục…'
                    : 'Scanning…'}
              </Text>
            </View>
          )}
          {st.fetching && (
            <View style={styles.scanRow}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={styles.scanText} numberOfLines={1}>
                {vi ? 'Đang tìm thông tin & ảnh bìa' : 'Finding details & covers'}{' '}
                {st.fetching.done}/{st.fetching.total}
                {st.fetching.matched ? ` · ${vi ? 'đã có' : 'found'} ${st.fetching.matched}` : ''}
              </Text>
              <Pressable
                onPress={() => LocalLibrary.cancelAutoFill()}
                hitSlop={8}
                accessibilityLabel={vi ? 'Dừng tìm' : 'Stop'}
              >
                <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.6)" />
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {scopeTracks.length > 0 && !selecting && (
        <View style={styles.playRow}>
          <Pressable
            onPress={() =>
              playList(groups ? scopeTracks : listTracks.length ? listTracks : scopeTracks)
            }
            style={[styles.playBtn, { backgroundColor: palette.accent }]}
          >
            <Ionicons name="play" size={18} color={palette.onAccent} />
            <Text style={[styles.playText, { color: palette.onAccent }]}>
              {vi ? 'Phát' : 'Play'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => playList(scopeTracks, undefined, true)}
            style={[styles.playBtn, styles.ghostBtn]}
          >
            <Ionicons name="shuffle" size={18} color="#FFFFFF" />
            <Text style={styles.playText}>{vi ? 'Ngẫu nhiên' : 'Shuffle'}</Text>
          </Pressable>
          {nav.kind === 'folder' && (
            <Pressable
              onPress={() => promptNewFolder(currentDir)}
              style={styles.roundBtn}
              accessibilityLabel={vi ? 'Thư mục mới' : 'New folder'}
            >
              <Ionicons name="folder-open-outline" size={18} color="#FFFFFF" />
            </Pressable>
          )}
          {nav.kind === 'folder' && (
            <Pressable
              onPress={() => importHere(currentDir)}
              style={styles.roundBtn}
              accessibilityLabel={vi ? 'Thêm bài từ Tệp' : 'Add from Files'}
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      )}

      {atRoot && nav.kind === 'folder' && !isEmptyLibrary && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.segRow}
        >
          {(
            [
              ['folders', vi ? 'Thư mục' : 'Folders', 'folder-outline'],
              ['songs', vi ? 'Bài hát' : 'Songs', 'musical-notes-outline'],
              ['albums', 'Album', 'disc-outline'],
              ['artists', vi ? 'Nghệ sĩ' : 'Artists', 'person-outline'],
            ] as [View_, string, keyof typeof Ionicons.glyphMap][]
          ).map(([id, label, icon]) => {
            const on = view === id;
            return (
              <Pressable
                key={id}
                onPress={() => setView(id)}
                style={[
                  styles.seg,
                  on && { backgroundColor: palette.accent, borderColor: palette.accent },
                ]}
              >
                <Ionicons name={icon} size={14} color={on ? palette.onAccent : '#E4E4EC'} />
                <Text style={[styles.segText, on && { color: palette.onAccent }]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {crumbs.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.crumbs}
        >
          <Pressable onPress={() => setStack([{ kind: 'folder', path: '' }])}>
            <Ionicons name="phone-portrait-outline" size={14} color="rgba(255,255,255,0.6)" />
          </Pressable>
          {crumbs.map((c, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1;
            return (
              <View key={path} style={styles.crumbItem}>
                <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.35)" />
                <Pressable
                  disabled={last}
                  onPress={() =>
                    setStack([
                      { kind: 'folder', path: '' },
                      ...crumbs.slice(0, i + 1).map((_, j) => ({
                        kind: 'folder' as const,
                        path: crumbs.slice(0, j + 1).join('/'),
                      })),
                    ])
                  }
                >
                  <Text style={[styles.crumbText, last && { color: '#FFFFFF' }]}>{c}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      {!isEmptyLibrary && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              nav.kind === 'folder'
                ? vi
                  ? 'Tìm trong thư mục này (cả thư mục con)'
                  : 'Search this folder & subfolders'
                : vi
                  ? 'Tìm bài hát'
                  : 'Search songs'
            }
            placeholderTextColor="rgba(255,255,255,0.4)"
            style={styles.searchInput}
            autoCorrect={false}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color="rgba(255,255,255,0.5)" />
            </Pressable>
          )}
        </View>
      )}

      {isEmptyLibrary && (
        <HelpCard
          vi={vi}
          accent={palette.accent}
          onAccent={palette.onAccent}
          big
          onImport={() => importHere('')}
          onNewFolder={() => promptNewFolder('')}
          web={st.backend === 'web'}
        />
      )}
      {!isEmptyLibrary && st.ready && items.length === 0 && (
        <View style={styles.emptyFolder}>
          <Ionicons
            name={q ? 'search' : 'folder-open-outline'}
            size={30}
            color="rgba(255,255,255,0.35)"
          />
          <Text style={styles.emptyText}>
            {q
              ? vi
                ? 'Không có kết quả'
                : 'No results'
              : vi
                ? 'Thư mục trống — thêm bài từ ứng dụng Tệp, hoặc chuyển bài từ thư mục khác vào đây.'
                : 'Empty folder — add songs from Files, or move songs here from another folder.'}
          </Text>
          {!q && nav.kind === 'folder' && (
            <Pressable
              onPress={() => importHere(currentDir)}
              style={[styles.smallBtn, { borderColor: palette.accent }]}
            >
              <Ionicons name="add" size={16} color={palette.accent} />
              <Text style={[styles.smallBtnText, { color: palette.accent }]}>
                {vi ? 'Thêm bài từ Tệp' : 'Add from Files'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#07070A' }]}>
      <LinearGradient
        colors={[palette.container, '#07070A']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        locations={[0, 0.45]}
      />
      {/* top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={back}
          hitSlop={10}
          style={styles.topBtn}
          accessibilityLabel={vi ? 'Quay lại' : 'Back'}
        >
          <Ionicons name={selecting ? 'close' : 'chevron-back'} size={22} color="#FFFFFF" />
        </Pressable>
        <Text numberOfLines={1} style={[styles.topTitle, { fontFamily }]}>
          {selecting
            ? `${selected.size} ${vi ? 'đã chọn' : 'selected'}`
            : atRoot
              ? vi
                ? 'Nhạc trên máy'
                : 'Local Files'
              : title}
        </Text>
        {selecting ? (
          <Pressable
            onPress={() =>
              setSelected(
                selected.size === items.length
                  ? new Set()
                  : new Set(items.map((i) => i.node?.path || i.file?.path || '').filter(Boolean))
              )
            }
            hitSlop={10}
            style={styles.topTextBtn}
          >
            <Text style={[styles.topTextBtnLabel, { color: palette.accent }]}>
              {selected.size === items.length && items.length
                ? vi
                  ? 'Bỏ chọn'
                  : 'None'
                : vi
                  ? 'Tất cả'
                  : 'All'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={folderMenu}
            hitSlop={10}
            style={styles.topBtn}
            accessibilityLabel={vi ? 'Tuỳ chọn thư mục' : 'Folder options'}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
          </Pressable>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.k}
        ListHeaderComponent={header}
        renderItem={({ item }) =>
          item.group
            ? renderGroup(item.group)
            : item.node
              ? renderFolder(item.node)
              : item.pl
                ? renderPlaylist(item.pl)
                : renderFile(item.file!, item.idx || 0)
        }
        contentContainerStyle={{ paddingBottom: 190 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={11}
      />

      {selecting && (
        <View style={[styles.selBar, { bottom: 150 + insets.bottom }]}>
          <SelAction
            icon="arrow-redo-outline"
            label={vi ? 'Chuyển' : 'Move'}
            disabled={!selected.size}
            onPress={() =>
              setOverlay({
                type: 'move',
                paths: [...selected],
                onDone: () => {
                  setSelecting(false);
                  setSelected(new Set());
                },
              })
            }
          />
          <SelAction
            icon="list-outline"
            label={vi ? 'Hàng chờ' : 'Queue'}
            disabled={!selected.size}
            onPress={() => {
              const ts = tracksForPaths([...selected]);
              ts.forEach((t) => addToQueue(t, false));
              showToast(vi ? `Đã thêm ${ts.length} bài vào hàng chờ` : `Queued ${ts.length} songs`);
              setSelecting(false);
              setSelected(new Set());
            }}
          />
          <SelAction
            icon="albums-outline"
            label="Playlist"
            disabled={!selected.size}
            onPress={() => savePlaylist(tracksForPaths([...selected]), title)}
          />
          <SelAction
            icon="trash-outline"
            label={vi ? 'Xoá' : 'Delete'}
            danger
            disabled={!selected.size}
            onPress={() =>
              confirmDelete(
                [...selected],
                vi ? `${selected.size} mục đã chọn` : `${selected.size} items`
              )
            }
          />
        </View>
      )}
    </View>
  );
};

const Check: React.FC<{ on: boolean; color: string }> = ({ on, color }) => (
  <Ionicons
    name={on ? 'checkmark-circle' : 'ellipse-outline'}
    size={22}
    color={on ? color : 'rgba(255,255,255,0.4)'}
    style={{ marginRight: 2 }}
  />
);

const SelAction: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}> = ({ icon, label, onPress, disabled, danger }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={[styles.selAction, disabled && { opacity: 0.35 }]}
  >
    <Ionicons name={icon} size={20} color={danger ? '#F87171' : '#FFFFFF'} />
    <Text style={[styles.selLabel, danger && { color: '#F87171' }]}>{label}</Text>
  </Pressable>
);

const HelpCard: React.FC<{
  vi: boolean;
  accent: string;
  onAccent: string;
  big?: boolean;
  web?: boolean;
  onImport?: () => void;
  onNewFolder?: () => void;
}> = ({ vi, accent, onAccent, big, web, onImport, onNewFolder }) => (
  <View style={[styles.help, big && { marginTop: 8 }]}>
    {big && (
      <Text style={styles.helpTitle}>
        {vi ? 'Thư viện nhạc của riêng bạn' : 'Your own music library'}
      </Text>
    )}
    {web ? (
      <Text style={styles.helpText}>
        {vi
          ? 'Bản xem trước trên web giữ tệp trong bộ nhớ của tab (mất khi tải lại). Trên iPhone, nhạc nằm trong thư mục của HolySic và được giữ lại.'
          : 'The web preview keeps files in this tab’s memory (lost on reload). On iPhone, music lives in HolySic’s folder and stays.'}
      </Text>
    ) : null}
    {[
      vi
        ? [
            'folder-outline',
            'Mở ứng dụng Tệp › Trên iPhone › HolySic (hoặc Finder trên Mac / iTunes trên Windows khi cắm cáp).',
          ]
        : [
            'folder-outline',
            'Open the Files app › On My iPhone › HolySic (or Finder on a Mac / iTunes on Windows via cable).',
          ],
      vi
        ? [
            'musical-notes-outline',
            'Kéo thả bài hát (MP3, M4A, AAC, FLAC, WAV, AIFF, ALAC) vào đó.',
          ]
        : ['musical-notes-outline', 'Drop songs in (MP3, M4A, AAC, FLAC, WAV, AIFF, ALAC).'],
      vi
        ? [
            'git-network-outline',
            'Tạo thư mục tuỳ ý để nhóm nhạc — lồng nhiều cấp cũng được (Nghệ sĩ › Album, Chill › Đêm…). Mỗi thư mục là một nhóm có thể phát / trộn / lưu thành playlist.',
          ]
        : [
            'git-network-outline',
            'Make any folders you like to group music — nested too (Artist › Album, Chill › Night…). Each folder can be played, shuffled or saved as a playlist.',
          ],
      vi
        ? [
            'images-outline',
            'Tên bài, nghệ sĩ, album và ảnh bìa đọc từ thẻ trong tệp. Ảnh bìa thư mục: chạm vào ảnh ở đầu thư mục (hoặc ⋯ → Ảnh bìa thư mục), hay thả cover.jpg vào thư mục.',
          ]
        : [
            'images-outline',
            'Title, artist, album and cover come from the file’s tags. Folder cover: tap the artwork at the top of a folder (or ⋯ → Folder cover), or drop a cover.jpg into it.',
          ],
    ].map(([icon, text]) => (
      <View key={text} style={styles.helpRow}>
        <Ionicons name={icon as any} size={18} color={accent} />
        <Text style={styles.helpText}>{text}</Text>
      </View>
    ))}
    {big && (
      <View style={styles.helpBtns}>
        {Platform.OS === 'ios' && (
          <Pressable
            onPress={() => LocalLibrary.openInFilesApp()}
            style={[styles.playBtn, { backgroundColor: accent }]}
          >
            <Ionicons name="folder-open" size={17} color={onAccent} />
            <Text style={[styles.playText, { color: onAccent }]}>
              {vi ? 'Mở ứng dụng Tệp' : 'Open Files'}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onImport}
          style={[
            styles.playBtn,
            Platform.OS === 'ios' ? styles.ghostBtn : { backgroundColor: accent },
          ]}
        >
          <Ionicons name="add" size={18} color={Platform.OS === 'ios' ? '#FFFFFF' : onAccent} />
          <Text style={[styles.playText, Platform.OS !== 'ios' && { color: onAccent }]}>
            {vi ? 'Chọn tệp…' : 'Pick files…'}
          </Text>
        </Pressable>
        <Pressable onPress={onNewFolder} style={[styles.playBtn, styles.ghostBtn]}>
          <Ionicons name="folder-outline" size={17} color="#FFFFFF" />
          <Text style={styles.playText}>{vi ? 'Thư mục mới' : 'New folder'}</Text>
        </Pressable>
      </View>
    )}
  </View>
);

// ---------- overlay host (rendered above the dock in App.tsx) ----------

export const LocalOverlayHost: React.FC = () => {
  const o = useOverlay();
  const st = useLocalLibrary();
  const { palette, prefs, showToast } = useHolySic();
  const insets = useSafeAreaInsets();
  const vi = prefs.language === 'vi';
  useEffect(() => {
    if (st.openAt === null && overlay) setOverlay(null);
  }, [st.openAt]);
  if (!o || st.openAt === null) return null;
  const close = () => setOverlay(null);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.scrim} onPress={close} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {o.type === 'actions' && (
            <>
              <Text numberOfLines={1} style={styles.sheetTitle}>
                {o.title}
              </Text>
              {o.subtitle ? (
                <Text numberOfLines={1} style={styles.sheetSub}>
                  {o.subtitle}
                </Text>
              ) : null}
              <ScrollView style={{ maxHeight: 440 }}>
                {o.items.map((it) => (
                  <Pressable
                    key={it.label}
                    onPress={() => {
                      close();
                      setTimeout(it.onPress, 0);
                    }}
                    style={({ pressed }) => [styles.sheetItem, pressed && styles.rowPressed]}
                  >
                    <Ionicons name={it.icon} size={20} color={it.danger ? '#F87171' : '#FFFFFF'} />
                    <Text style={[styles.sheetLabel, it.danger && { color: '#F87171' }]}>
                      {it.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          {o.type === 'prompt' && (
            <PromptBody
              o={o}
              accent={palette.accent}
              onAccent={palette.onAccent}
              vi={vi}
              close={close}
              showToast={showToast}
            />
          )}
          {o.type === 'confirm' && (
            <>
              <Text style={styles.sheetTitle}>{o.title}</Text>
              <Text style={styles.confirmMsg}>{o.message}</Text>
              <View style={styles.dialogBtns}>
                <Pressable onPress={close} style={[styles.dialogBtn, styles.ghostBtn]}>
                  <Text style={styles.playText}>{vi ? 'Huỷ' : 'Cancel'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    close();
                    o.onConfirm();
                  }}
                  style={[styles.dialogBtn, { backgroundColor: '#DC2626' }]}
                >
                  <Text style={[styles.playText, { color: '#FFFFFF' }]}>{o.confirm}</Text>
                </Pressable>
              </View>
            </>
          )}
          {o.type === 'move' && (
            <MovePicker
              o={o}
              close={close}
              vi={vi}
              accent={palette.accent}
              onAccent={palette.onAccent}
              showToast={showToast}
            />
          )}
          {o.type === 'cover' && (
            <CoverPicker
              o={o}
              close={close}
              vi={vi}
              accent={palette.accent}
              onAccent={palette.onAccent}
              container={palette.container}
              showToast={showToast}
            />
          )}
          {o.type === 'help' && (
            <>
              <Text style={styles.sheetTitle}>
                {vi ? 'Cách thêm & sắp xếp nhạc' : 'Adding & organising music'}
              </Text>
              <HelpCard
                vi={vi}
                accent={palette.accent}
                onAccent={palette.onAccent}
                web={st.backend === 'web'}
              />
              <Pressable
                onPress={close}
                style={[styles.dialogBtn, styles.ghostBtn, { marginTop: 12 }]}
              >
                <Text style={styles.playText}>{vi ? 'Đã hiểu' : 'Got it'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

/** Folder cover: from Photos (square crop), from Files, or reuse a song's embedded cover. */
const CoverPicker: React.FC<{
  o: Extract<Overlay, { type: 'cover' }>;
  close: () => void;
  vi: boolean;
  accent: string;
  onAccent: string;
  container: string;
  showToast: (m: string) => void;
}> = ({ o, close, vi, accent, onAccent, container, showToast }) => {
  useLocalLibrary(); // re-render after the rescan
  const folder = LocalLibrary.folder(o.dir);
  const [busy, setBusy] = useState(false);
  const songCovers = useMemo(() => LocalLibrary.embeddedCoversIn(o.dir), [o.dir, folder?.total]);
  const apply = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      showToast(done);
      close();
    } catch (e: any) {
      showToast((vi ? 'Không đặt được ảnh bìa: ' : 'Could not set cover: ') + (e?.message || e));
      setBusy(false);
    }
  };
  const set = (uri: string, resize = true) =>
    apply(
      () => LocalLibrary.setFolderCover(o.dir, uri, { resize }),
      vi ? 'Đã đổi ảnh bìa thư mục' : 'Folder cover updated'
    );
  const fromPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true, // iOS crops to a square
      aspect: [1, 1],
      quality: 1,
    });
    if (!res.canceled && res.assets?.[0]?.uri) set(res.assets[0].uri);
  };
  const fromFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['image/*'],
      copyToCacheDirectory: true,
    });
    if (!res.canceled && res.assets?.[0]?.uri) set(res.assets[0].uri);
  };
  if (!folder) return null;
  return (
    <>
      <View style={styles.coverHead}>
        {folder.coverUri ? (
          <ArtworkImage
            source={{ uri: folder.coverUri }}
            style={styles.coverBig}
            fallbackSeed={folder.name}
          />
        ) : (
          <LinearGradient colors={[accent, container]} style={styles.coverBig}>
            <Ionicons name="folder-open" size={40} color={onAccent} />
          </LinearGradient>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle} numberOfLines={2}>
            {folder.name}
          </Text>
          <Text style={styles.sheetSub}>
            {folder.coverPath
              ? (vi ? 'Ảnh bìa riêng · ' : 'Own cover · ') + baseName(folder.coverPath)
              : folder.coverUri
                ? vi
                  ? 'Đang mượn ảnh bìa của một bài bên trong'
                  : 'Borrowing a song’s cover'
                : vi
                  ? 'Chưa có ảnh bìa'
                  : 'No cover yet'}
          </Text>
          {busy && (
            <ActivityIndicator color={accent} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
          )}
        </View>
      </View>
      <View style={styles.coverBtns}>
        <Pressable
          disabled={busy}
          onPress={fromPhotos}
          style={[styles.coverBtn, { backgroundColor: accent }]}
        >
          <Ionicons name="images" size={18} color={onAccent} />
          <Text style={[styles.coverBtnText, { color: onAccent }]}>
            {vi ? 'Chọn từ Ảnh' : 'From Photos'}
          </Text>
        </Pressable>
        <Pressable disabled={busy} onPress={fromFiles} style={styles.coverBtn}>
          <Ionicons name="document-outline" size={18} color="#FFFFFF" />
          <Text style={styles.coverBtnText}>{vi ? 'Từ Tệp' : 'From Files'}</Text>
        </Pressable>
      </View>
      {songCovers.length > 0 && (
        <>
          <Text style={styles.coverSection}>
            {vi ? 'Dùng ảnh bìa của bài hát' : 'Use a song’s cover'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {songCovers.map((c) => (
                <Pressable
                  key={c.uri}
                  disabled={busy}
                  onPress={() => set(c.uri, false)}
                  accessibilityLabel={(vi ? 'Ảnh bìa ' : 'Cover of ') + c.title}
                >
                  <ArtworkImage
                    source={{ uri: c.uri }}
                    style={styles.coverThumb}
                    fallbackSeed={c.title}
                  />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </>
      )}
      {folder.coverPath ? (
        <Pressable
          disabled={busy}
          onPress={() =>
            apply(
              () => LocalLibrary.removeFolderCover(o.dir),
              vi ? 'Đã xoá ảnh bìa thư mục' : 'Folder cover removed'
            )
          }
          style={[styles.sheetItem, { marginTop: 10 }]}
        >
          <Ionicons name="trash-outline" size={20} color="#F87171" />
          <Text style={[styles.sheetLabel, { color: '#F87171' }]}>
            {vi ? 'Xoá ảnh bìa' : 'Remove cover'}
          </Text>
        </Pressable>
      ) : null}
      <Text style={[styles.sheetSub, { marginTop: 12 }]}>
        {vi
          ? 'Ảnh được lưu thành cover.jpg trong thư mục — thấy được cả trong ứng dụng Tệp. Bài không có ảnh bìa riêng sẽ dùng ảnh này.'
          : 'Saved as cover.jpg inside the folder (visible in Files too). Songs without their own art use it.'}
      </Text>
    </>
  );
};

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const PromptBody: React.FC<{
  o: Extract<Overlay, { type: 'prompt' }>;
  accent: string;
  onAccent: string;
  vi: boolean;
  close: () => void;
  showToast: (m: string) => void;
}> = ({ o, accent, onAccent, vi, close, showToast }) => {
  const [v, setV] = useState(o.initial || '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    try {
      await o.onSubmit(v);
      close();
    } catch (e: any) {
      showToast(String(e?.message || e));
      setBusy(false);
    }
  };
  return (
    <>
      <Text style={styles.sheetTitle}>{o.title}</Text>
      <TextInput
        value={v}
        onChangeText={setV}
        placeholder={o.placeholder}
        placeholderTextColor="rgba(255,255,255,0.35)"
        autoFocus
        selectTextOnFocus
        onSubmitEditing={submit}
        returnKeyType="done"
        style={styles.promptInput}
      />
      <View style={styles.dialogBtns}>
        <Pressable onPress={close} style={[styles.dialogBtn, styles.ghostBtn]}>
          <Text style={styles.playText}>{vi ? 'Huỷ' : 'Cancel'}</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!v.trim() || busy}
          style={[styles.dialogBtn, { backgroundColor: accent, opacity: v.trim() ? 1 : 0.4 }]}
        >
          <Text style={[styles.playText, { color: onAccent }]}>{o.confirm}</Text>
        </Pressable>
      </View>
    </>
  );
};

const MovePicker: React.FC<{
  o: Extract<Overlay, { type: 'move' }>;
  close: () => void;
  vi: boolean;
  accent: string;
  onAccent: string;
  showToast: (m: string) => void;
}> = ({ o, close, vi, accent, onAccent, showToast }) => {
  const st = useLocalLibrary();
  const [path, setPath] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const node = LocalLibrary.folder(path) || st.root;
  const moving = new Set(o.paths);
  const sources = new Set(
    o.paths.map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))
  );
  const allHere = sources.size === 1 && sources.has(path);
  const doMove = async () => {
    const n = await LocalLibrary.move(o.paths, path);
    close();
    o.onDone?.();
    showToast(
      vi
        ? `Đã chuyển ${n} mục vào “${path ? path.split('/').pop() : 'HolySic'}”`
        : `Moved ${n} items to “${path ? path.split('/').pop() : 'HolySic'}”`
    );
  };
  return (
    <>
      <View style={styles.moveHead}>
        {path ? (
          <Pressable
            hitSlop={10}
            onPress={() => setPath(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Ionicons name="phone-portrait-outline" size={18} color="rgba(255,255,255,0.7)" />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>{vi ? 'Chuyển tới…' : 'Move to…'}</Text>
          <Text numberOfLines={1} style={styles.sheetSub}>
            {path
              ? `HolySic / ${path.split('/').join(' / ')}`
              : vi
                ? 'HolySic (thư mục gốc)'
                : 'HolySic (top level)'}
          </Text>
        </View>
      </View>
      <ScrollView style={{ maxHeight: 300 }}>
        {node.folders
          .filter((f) => !moving.has(f.path))
          .map((f) => (
            <Pressable
              key={f.path}
              onPress={() => setPath(f.path)}
              style={({ pressed }) => [styles.sheetItem, pressed && styles.rowPressed]}
            >
              <Ionicons name="folder" size={20} color={accent} />
              <Text style={[styles.sheetLabel, { flex: 1 }]} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={styles.sheetSub}>{f.total}</Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ))}
        {node.folders.filter((f) => !moving.has(f.path)).length === 0 && (
          <Text style={[styles.sheetSub, { paddingVertical: 14 }]}>
            {vi ? 'Không có thư mục con.' : 'No subfolders.'}
          </Text>
        )}
      </ScrollView>
      {naming ? (
        <View style={styles.inlineNew}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder={vi ? 'Tên thư mục mới' : 'New folder name'}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.promptInput, { flex: 1, marginTop: 0 }]}
            onSubmitEditing={async () => {
              if (!name.trim()) return;
              const rel = await LocalLibrary.createFolder(path, name);
              setName('');
              setNaming(false);
              setPath(rel);
            }}
          />
        </View>
      ) : (
        <Pressable onPress={() => setNaming(true)} style={[styles.sheetItem]}>
          <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
          <Text style={styles.sheetLabel}>{vi ? 'Thư mục mới ở đây' : 'New folder here'}</Text>
        </Pressable>
      )}
      <View style={styles.dialogBtns}>
        <Pressable onPress={close} style={[styles.dialogBtn, styles.ghostBtn]}>
          <Text style={styles.playText}>{vi ? 'Huỷ' : 'Cancel'}</Text>
        </Pressable>
        <Pressable
          onPress={doMove}
          disabled={allHere}
          style={[styles.dialogBtn, { backgroundColor: accent, opacity: allHere ? 0.4 : 1 }]}
        >
          <Text style={[styles.playText, { color: onAccent }]}>
            {vi ? 'Chuyển vào đây' : 'Move here'}
          </Text>
        </Pressable>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 8,
  },
  topBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  topTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  topTextBtn: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  topTextBtnLabel: { fontSize: 14, fontWeight: '800' },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  heroArt: {
    width: 92,
    height: 92,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroEdit: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,28,0.92)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBig: {
    width: 112,
    height: 112,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  coverBtns: { flexDirection: 'row', gap: 10 },
  coverBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  coverBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  coverSection: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 10,
  },
  coverThumb: { width: 68, height: 68, borderRadius: 12, overflow: 'hidden' },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 4, fontWeight: '600' },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  scanText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  playRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    marginTop: 16,
    alignItems: 'center',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    height: 42,
    borderRadius: 21,
  },
  ghostBtn: { backgroundColor: 'rgba(255,255,255,0.1)' },
  playText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  segRow: { gap: 8, paddingHorizontal: 18, paddingTop: 16 },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  segText: { color: '#E4E4EC', fontWeight: '700', fontSize: 13 },
  crumbs: { alignItems: 'center', gap: 4, paddingHorizontal: 18, paddingTop: 14 },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumbText: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  rowSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12.5, marginTop: 2 },
  moreBtn: { padding: 6 },
  art: { width: 52, height: 52, borderRadius: 10 },
  folderIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  folderArt: { width: 52, height: 52 },
  folderBadge: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playingDot: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0B0B10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFolder: { alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 30 },
  emptyText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    height: 36,
    marginTop: 6,
  },
  smallBtnText: { fontWeight: '800', fontSize: 13 },
  help: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  helpTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  helpRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  helpText: { flex: 1, color: 'rgba(255,255,255,0.78)', fontSize: 13.5, lineHeight: 19 },
  helpBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  selBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(28,28,38,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  selAction: { alignItems: 'center', gap: 4, minWidth: 64 },
  selLabel: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#15151D',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sheetTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  sheetSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12.5, marginTop: 3 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  sheetLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  confirmMsg: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, marginTop: 10 },
  dialogBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dialogBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptInput: {
    marginTop: 14,
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#FFFFFF',
    fontSize: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  moveHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  inlineNew: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
});
