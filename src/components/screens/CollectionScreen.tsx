// Dedicated Album / Artist / Playlist / Liked / Offline / Tag Detail View

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArtistBioCard } from '../ArtistBioCard';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../constants/i18n';
import { buildArtworkPalette, HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { AlbumSummary, ArtistSummary, Track } from '../../types/music';
import { TrackRow } from '../TrackRow';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';
import { exportPlaylistM3U } from '../../services/import/playlistFiles';
import { playlistCoverOf } from '../../services/local/localLibrary';
import { openPlaylistEditor } from '../library/PlaylistEditor';
import { T as UI, themedSheet } from '../../theme/ui';
import { EmptyState } from '../ui/EmptyState';
import { Tap } from '../ui/Tap';
import { Rise } from '../ui/Rise';
import { GlassSurface } from '../GlassSurface';
import { NativeMenu, nativeMenuAvailable, MenuItem } from '../ui/NativeMenu';
import { Progressive } from '../../hooks/useProgressive';
import { MediaBackdrop } from '../ambient/MediaBackdrop';
import { openBackdropEditor } from '../backdrop/BackdropEditor';
import { pageBgKey } from '../../services/backdrop/backdropMedia';
import { useAppActive } from '../../services/appActivity';
import { ToastStore } from '../../services/ui/toastStore';
import { normTag, Tag, TagStore, useTags } from '../../services/library/tags';
import { openTagSheet } from '../tags/TagSheet';
import { TagChip } from '../tags/TagChip';
import { useDownloadRequest } from '../download/DownloadOptionsSheet';

export const CollectionModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    collectionTarget,
    openCollection,
    loadAlbumFull,
    loadArtistFull,
    playlists,
    likedTracks,
    downloads,
    playTrack,
    removeTrackFromPlaylist,
    deletePlaylist,
    prefs,
    savePlaylistFromTracks,
    addTracksToPlaylist,
    likeTracks,
    queueTracks,
    removeTracksFromPlaylist,
    removeDownloads,
    downloadTrack,
    downloadingIds,
    searchTracks,
    showToast,
    createPlaylist,
    isOnline,
    setActiveTab,
    palette,
    isPlayerOpen,
    isPlaying,
    ambient,
    updatePlaylist,
    togglePinPlaylist,
  } = useHolySic();
  const appActive = useAppActive();
  // tag pages, playlist tag chips and the filter follow tag changes
  useTags();
  const requestDownload = useDownloadRequest();
  const [reloadTick, setReloadTick] = useState(0);
  useModalLayer('collection', Boolean(collectionTarget));

  // ── iOS navigation feel: the page is pushed in from the right, and a swipe from the left edge
  // (or the back button) slides it away while the app shows through, dimmed, behind it ──
  const { width: screenW } = useWindowDimensions();
  const pushX = useRef(new Animated.Value(screenW)).current;
  // scroll offset (native-driven) for the pinned bar that materialises as the hero scrolls away
  const scrollY = useRef(new Animated.Value(0)).current;
  // a transformed layer only while the page moves; a plain view once it has settled
  const [moving, setMoving] = useState(true);
  const open = Boolean(collectionTarget);
  useEffect(() => {
    if (!open) return;
    pushX.setValue(screenW);
    setMoving(true);
    Animated.timing(pushX, {
      toValue: 0,
      duration: 340,
      easing: Easing.bezier(0.2, 0.9, 0.25, 1),
      useNativeDriver: true,
    }).start(({ finished }) => finished && setMoving(false));
  }, [open, pushX, screenW]);
  const nav = useRef({ close: () => openCollection(null), w: screenW });
  nav.current = { close: () => openCollection(null), w: screenW };
  const goBack = useCallback(() => {
    setMoving(true);
    Animated.timing(pushX, {
      toValue: nav.current.w,
      duration: 240,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => nav.current.close());
  }, [pushX]);
  const edgeSwipe = useRef(
    PanResponder.create({
      // only from the left edge, only horizontal — claims it before the lists inside can
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        g.x0 < 32 && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setMoving(true),
      onPanResponderMove: (_e, g) => pushX.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_e, g) => {
        if (g.dx > nav.current.w * 0.33 || (g.dx > 40 && g.vx > 0.5)) {
          Animated.timing(pushX, {
            toValue: nav.current.w,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start(() => nav.current.close());
        } else {
          Animated.spring(pushX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(() =>
            setMoving(false)
          );
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(pushX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(() =>
          setMoving(false)
        ),
    })
  ).current;

  const [loading, setLoading] = useState(false);
  // Multi-select (Musike): pick songs, then play / like / queue / add to playlist / remove
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pickPlaylist, setPickPlaylist] = useState(false);
  // Artist "load more" songs (OpenSpot paginated artist songs)
  const [moreTracks, setMoreTracks] = useState<Track[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Filter & sort inside a collection (Spotube / Musike library tools)
  const [filterQ, setFilterQ] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'title' | 'artist' | 'duration'>('default');

  useEffect(() => {
    scrollY.setValue(0);
    setSelecting(false);
    setSelected({});
    setFilterQ('');
    setSortBy('default');
    setPickPlaylist(false);
    setMoreTracks([]);
  }, [collectionTarget]);
  const [albumData, setAlbumData] = useState<AlbumSummary | null>(null);
  const [artistData, setArtistData] = useState<ArtistSummary | null>(null);

  useEffect(() => {
    if (!collectionTarget) {
      setAlbumData(null);
      setArtistData(null);
      return;
    }

    let cancelled = false;
    if (collectionTarget.kind === 'album') {
      if (collectionTarget.summary) setAlbumData(collectionTarget.summary);
      setLoading(true);
      loadAlbumFull(collectionTarget.id)
        .then((res) => {
          if (!cancelled && res) setAlbumData(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (collectionTarget.kind === 'artist') {
      setLoading(true);
      loadArtistFull(collectionTarget.id || collectionTarget.name)
        .then((res) => {
          if (!cancelled) setArtistData(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [collectionTarget, loadAlbumFull, loadArtistFull, reloadTick]);

  if (!collectionTarget) return null;
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  let title = '';
  let subtitle = '';
  let creator = '';
  let pinned = false;
  let artworkUrl = '';
  let tracks: Track[] = [];
  let removablePlaylistId: string | null = null;
  let tag: Tag | undefined;
  let tagPlaylists: typeof playlists = [];

  if (collectionTarget.kind === 'album') {
    title = albumData?.title || 'Album';
    subtitle = `${albumData?.artist || ''}${albumData?.year ? ` · ${albumData.year}` : ''}`;
    artworkUrl = albumData?.artworkUrl || '';
    tracks = albumData?.tracks || [];
  } else if (collectionTarget.kind === 'artist') {
    title = artistData?.name || collectionTarget.name;
    subtitle = artistData?.genre
      ? `${vi ? 'Nghệ sĩ' : 'Artist'} · ${artistData.genre}`
      : vi
        ? 'Nghệ sĩ nổi bật'
        : 'Featured Artist';
    artworkUrl = artistData?.artworkUrl || '';
    const base = artistData?.topTracks || [];
    const have = new Set(base.map((x) => `${x.title}|${x.artist}`.toLowerCase()));
    tracks = [
      ...base,
      ...moreTracks.filter((x) => !have.has(`${x.title}|${x.artist}`.toLowerCase())),
    ];
  } else if (collectionTarget.kind === 'playlist') {
    const pl = playlists.find((p) => p.id === collectionTarget.playlistId);
    title = pl?.name || 'Playlist';
    subtitle = pl?.description || `${pl?.tracks.length || 0} ${vi ? 'bài hát' : 'songs'}`;
    creator = pl?.creator || '';
    pinned = !!pl?.pinnedAt;
    artworkUrl = playlistCoverOf(pl);
    tracks = pl?.tracks || [];
    removablePlaylistId = pl?.id || null;
  } else if (collectionTarget.kind === 'liked') {
    title = t(prefs.language, 'likedSongs');
    subtitle = `${likedTracks.length} ${vi ? 'bài hát đã lưu' : 'saved tracks'}`;
    artworkUrl = likedTracks[0]?.artworkUrl || '';
    tracks = likedTracks;
  } else if (collectionTarget.kind === 'offline') {
    const dlList = Object.values(downloads).map((d) => d.track);
    title = t(prefs.language, 'offlineDownloads');
    subtitle = `${dlList.length} ${vi ? 'bài hát sẵn sàng nghe offline' : 'offline tracks'}`;
    artworkUrl = dlList[0]?.artworkUrl || '';
    tracks = dlList;
  } else if (collectionTarget.kind === 'tag') {
    tag = TagStore.byId(collectionTarget.tagId);
    const plIds = tag ? TagStore.playlistsWith(tag.id) : [];
    tagPlaylists = playlists.filter((p) => plIds.includes(p.id));
    tracks = tag ? TagStore.tracksWith(tag.id) : [];
    title = tag ? tag.name : vi ? 'Thẻ đã xoá' : 'Deleted tag';
    subtitle = [
      vi ? `${tracks.length} bài hát` : `${tracks.length} songs`,
      tagPlaylists.length
        ? vi
          ? `${tagPlaylists.length} playlist`
          : `${tagPlaylists.length} playlists`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    artworkUrl = tracks[0]?.artworkUrl || '';
  }
  // the playlist's own tags (chips under its title)
  const plTags = removablePlaylistId ? TagStore.tagsOfPlaylist(removablePlaylistId) : [];

  const headerPalette = buildArtworkPalette(title);
  // the page's own photo / GIF / video (or the app's, when "also behind pages" is on)
  const bgKey = pageBgKey(collectionTarget as any);
  const ownBg = (prefs.pageBackdrops || {})[bgKey];
  const pageBg =
    ownBg ?? (prefs.pagesUseAppBg && prefs.appBackdrop === 'media' ? prefs.appBgMedia : null);
  const pageBgColor = prefs.pureBlack ? UI.surface('#000') : UI.surface('#0A0A0F');
  const allTracks = tracks;
  const canFilter = collectionTarget.kind !== 'album' && allTracks.length >= 6;
  if (canFilter && (filterQ.trim() || sortBy !== 'default')) {
    const q = filterQ.trim().toLowerCase();
    // songs match on title, artist, album — and their tags ("chill" finds songs tagged Chill)
    const tq = normTag(q);
    const tagHit = (x: Track) =>
      !!tq && TagStore.tagsOfTrack(x.id).some((tg) => normTag(tg.name).includes(tq));
    let list = q
      ? allTracks.filter(
          (x) => `${x.title} ${x.artist} ${x.album || ''}`.toLowerCase().includes(q) || tagHit(x)
        )
      : [...allTracks];
    if (sortBy === 'title') list = list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === 'artist')
      list = list.sort(
        (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
      );
    else if (sortBy === 'duration') list = list.sort((a, b) => a.durationSec - b.durationSec);
    tracks = list;
  }
  const SORT_LABEL = {
    default: vi ? 'Mặc định' : 'Default',
    title: vi ? 'Tên A–Z' : 'Title A–Z',
    artist: vi ? 'Nghệ sĩ' : 'Artist',
    duration: vi ? 'Thời lượng' : 'Length',
  } as const;
  const SORT_ORDER = ['default', 'title', 'artist', 'duration'] as const;
  const chosen = tracks.filter((x) => selected[x.id]);
  const canSaveAsPlaylist =
    collectionTarget.kind === 'album' ||
    collectionTarget.kind === 'artist' ||
    collectionTarget.kind === 'liked' ||
    collectionTarget.kind === 'tag';
  const loadMoreArtist = async () => {
    if (collectionTarget.kind !== 'artist') return;
    setLoadingMore(true);
    const name = artistData?.name || collectionTarget.name;
    const res = await searchTracks(name, 'all');
    const nameLc = name.toLowerCase();
    const mine = res.tracks.filter((x) => x.artist.toLowerCase().includes(nameLc));
    setMoreTracks((prev) => {
      const ids = new Set([...prev, ...tracks].map((x) => `${x.title}|${x.artist}`.toLowerCase()));
      return [...prev, ...mine.filter((x) => !ids.has(`${x.title}|${x.artist}`.toLowerCase()))];
    });
    setLoadingMore(false);
  };

  // ── page actions (chips on web; one native "…" pull-down on iOS) ──
  const saveAsPlaylist = () => {
    const pl = savePlaylistFromTracks(title, tracks, subtitle, artworkUrl);
    showToast(vi ? `Đã lưu thành playlist "${pl.name}"` : `Saved as playlist "${pl.name}"`);
  };
  // asks what comes along (lyrics / video) when the user wants to be asked
  const downloadAll = () => requestDownload(tracks.slice(0, 50));
  // tag page: take the tag off songs (undo from the toast)
  const untagWithUndo = (list: Track[]) => {
    if (!tag) return;
    const id = tag.id;
    TagStore.applyToTracks(list, id, false);
    ToastStore.show(
      list.length === 1
        ? vi
          ? `Đã bỏ thẻ “${tag.name}”`
          : `Removed “${tag.name}”`
        : vi
          ? `Đã bỏ thẻ khỏi ${list.length} bài`
          : `Removed the tag from ${list.length} songs`,
      undefined,
      { label: vi ? 'Hoàn tác' : 'Undo', onPress: () => TagStore.applyToTracks(list, id, true) }
    );
  };
  const deleteTag = () => {
    if (!tag) return;
    const name = tag.name;
    const undo = TagStore.remove(tag.id);
    goBack();
    if (undo)
      ToastStore.show(vi ? `Đã xoá thẻ “${name}”` : `Deleted “${name}”`, undefined, {
        label: vi ? 'Hoàn tác' : 'Undo',
        onPress: () => TagStore.restore(undo),
      });
  };
  const tagPlaylist = () =>
    removablePlaylistId &&
    openTagSheet({ kind: 'playlist', playlistId: removablePlaylistId, name: title });
  const exportM3U = async () => {
    const rel = await exportPlaylistM3U(title, allTracks);
    if (!rel) return;
    const fname = rel.split('/').pop();
    showToast(
      Platform.OS === 'web'
        ? vi
          ? `Đã tải ${fname} · bản sao trong Nhạc trên máy › Playlists`
          : `Downloaded ${fname} · a copy is in Local Files › Playlists`
        : vi
          ? `Đã lưu ${fname} vào Tệp › HolySic › Playlists`
          : `Saved ${fname} to Files › HolySic › Playlists`
    );
  };
  const toggleSelecting = () => {
    setSelecting((v) => !v);
    setSelected({});
    setPickPlaylist(false);
  };
  const confirmDelete = () => {
    if (!removablePlaylistId) return;
    const id = removablePlaylistId;
    const doDelete = () => {
      deletePlaylist(id);
      goBack();
    };
    const q = vi ? `Xoá playlist “${title}”?` : `Delete “${title}”?`;
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(q)) doDelete();
      return;
    }
    Alert.alert(q, vi ? 'Không thể hoàn tác.' : 'This can’t be undone.', [
      { text: vi ? 'Huỷ' : 'Cancel', style: 'cancel' },
      { text: vi ? 'Xoá' : 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };
  // removing songs from a playlist can be undone from the toast (order is restored exactly)
  const removeWithUndo = (ids: string[]) => {
    if (!removablePlaylistId) return;
    const plId = removablePlaylistId;
    const before = playlists.find((p) => p.id === plId)?.tracks || [];
    // the rows below slide up into the gap (and back down on undo), like UITableView
    const smooth = () =>
      LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'opacity'));
    smooth();
    if (ids.length === 1) removeTrackFromPlaylist(plId, ids[0]);
    else removeTracksFromPlaylist(plId, ids);
    ToastStore.show(
      ids.length === 1
        ? vi
          ? 'Đã xoá khỏi playlist'
          : 'Removed from playlist'
        : vi
          ? `Đã xoá ${ids.length} bài`
          : `Removed ${ids.length} songs`,
      undefined,
      {
        label: vi ? 'Hoàn tác' : 'Undo',
        onPress: () => {
          smooth();
          updatePlaylist(plId, { tracks: before });
        },
      }
    );
  };
  const downloadingCount = Object.keys(downloadingIds).length;
  const pageMenu: MenuItem[] = [];
  if (tracks.length > 0) {
    pageMenu.push({
      id: 'select',
      title: vi ? 'Chọn bài…' : 'Select Songs…',
      icon: 'checkmark.circle',
      section: 0,
    });
    if (canSaveAsPlaylist) {
      pageMenu.push({
        id: 'save',
        title: vi ? 'Lưu thành playlist' : 'Save as Playlist',
        icon: 'bookmark',
        section: 1,
      });
    }
    if (collectionTarget.kind !== 'offline') {
      pageMenu.push({
        id: 'download',
        title: vi ? 'Tải tất cả' : 'Download All',
        subtitle:
          downloadingCount > 0
            ? vi
              ? `Đang tải ${downloadingCount} bài`
              : `${downloadingCount} downloading`
            : undefined,
        icon: 'arrow.down.circle',
        section: 1,
      });
    }
    pageMenu.push({
      id: 'm3u',
      title: vi ? 'Xuất M3U vào Tệp' : 'Export M3U to Files',
      icon: 'square.and.arrow.up',
      section: 1,
    });
  }
  pageMenu.push({
    id: 'bg',
    title: vi ? 'Ảnh nền trang…' : 'Page Background…',
    subtitle: ownBg ? (vi ? 'Đang dùng ảnh riêng' : 'Using its own') : undefined,
    icon: 'photo.on.rectangle',
    section: 2,
  });
  if (removablePlaylistId) {
    pageMenu.push(
      {
        id: 'pin',
        title: pinned
          ? vi
            ? 'Bỏ ghim'
            : 'Unpin'
          : vi
            ? 'Ghim lên đầu Thư viện'
            : 'Pin to Top of Library',
        icon: pinned ? 'pin.slash' : 'pin',
        section: 2,
      },
      {
        id: 'edit',
        title: vi ? 'Sửa playlist…' : 'Edit Playlist…',
        subtitle: vi ? 'Tên, người tạo, mô tả, thứ tự' : 'Name, creator, description, order',
        icon: 'pencil',
        section: 2,
      },
      {
        id: 'cover',
        title: vi ? 'Đổi ảnh bìa…' : 'Change Cover…',
        icon: 'photo',
        section: 2,
      }
    );
    pageMenu.push({
      id: 'delete',
      title: vi ? 'Xoá playlist' : 'Delete Playlist',
      icon: 'trash',
      destructive: true,
      section: 3,
    });
  }
  if (tag) {
    pageMenu.push(
      {
        id: 'tagManage',
        title: vi ? 'Đổi tên, màu thẻ…' : 'Rename / Recolour Tag…',
        icon: 'pencil',
        section: 2,
      },
      {
        id: 'tagDelete',
        title: vi ? 'Xoá thẻ' : 'Delete Tag',
        subtitle: vi ? 'Bài hát và playlist vẫn giữ nguyên' : 'Songs and playlists stay',
        icon: 'trash',
        destructive: true,
        section: 3,
      }
    );
  }
  const onPageMenu = (id: string) => {
    if (id === 'select') toggleSelecting();
    else if (id === 'tagManage') setTimeout(() => openTagSheet({ kind: 'manage' }), 350);
    else if (id === 'tagDelete') setTimeout(deleteTag, 350);
    else if (id === 'save') saveAsPlaylist();
    else if (id === 'download') downloadAll();
    else if (id === 'm3u') exportM3U();
    else if (id === 'bg')
      setTimeout(
        () =>
          openBackdropEditor({
            scope: 'page',
            key: bgKey,
            title,
            cover: artworkUrl || undefined,
          }),
        350
      );
    else if (id === 'pin' && removablePlaylistId) togglePinPlaylist(removablePlaylistId);
    else if (id === 'edit' && removablePlaylistId)
      setTimeout(() => openPlaylistEditor(removablePlaylistId), 350);
    else if (id === 'cover' && removablePlaylistId)
      setTimeout(() => openPlaylistEditor(removablePlaylistId, 'cover'), 350);
    // the alert waits for the menu to finish closing
    else if (id === 'delete') setTimeout(confirmDelete, 350);
  };
  const nativePage = nativeMenuAvailable && pageMenu.length > 0;

  return (
    <Modal
      visible={Boolean(collectionTarget)}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={goBack}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#000',
            opacity: pushX.interpolate({
              inputRange: [0, screenW],
              outputRange: [0.4, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
      <Animated.View
        {...edgeSwipe.panHandlers}
        style={[
          styles.root,
          { backgroundColor: pageBgColor },
          moving && styles.pushed,
          moving && { transform: [{ translateX: pushX }] },
        ]}
      >
        {pageBg && (
          <MediaBackdrop
            media={pageBg}
            active={appActive && !isPlayerOpen && !ambient.lowPower}
            scheme={UI.scheme}
            bg={pageBgColor}
            accent={palette.accent}
            isPlaying={isPlaying}
            reduceMotion={ambient.reduceMotion}
          />
        )}
        <Animated.ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
        >
          <LinearGradient
            colors={
              pageBg
                ? ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']
                : [headerPalette.gradient[0], UI.surface('#0A0A0F')]
            }
            style={[styles.hero, { paddingTop: Math.max(insets.top, 16) }]}
          >
            <View style={styles.navBar}>
              {/* the back button lives in the pinned bar below (it stays put while you scroll) */}
              <View style={{ width: 38, height: 38 }} />

              <View style={{ flex: 1 }} />
              {nativePage && !selecting ? (
                <NativeMenu
                  items={pageMenu}
                  onSelect={onPageMenu}
                  title={title}
                  label={vi ? 'Tuỳ chọn' : 'More'}
                  style={styles.backBtn}
                >
                  <Ionicons name="ellipsis-horizontal" size={19} color={UI.text} />
                </NativeMenu>
              ) : (
                <>
                  {tracks.length > 0 && (
                    <Tap
                      onPress={toggleSelecting}
                      style={[
                        styles.backBtn,
                        { marginRight: removablePlaylistId && !selecting ? 8 : 0 },
                      ]}
                      accessibilityLabel={
                        selecting ? (vi ? 'Xong' : 'Done') : vi ? 'Chọn bài' : 'Select'
                      }
                    >
                      <Ionicons
                        name={selecting ? 'close' : 'checkmark-done-outline'}
                        size={19}
                        color={UI.text}
                      />
                    </Tap>
                  )}
                  {removablePlaylistId && !selecting && (
                    <Tap
                      onPress={confirmDelete}
                      style={styles.backBtn}
                      accessibilityLabel={vi ? 'Xoá playlist' : 'Delete playlist'}
                    >
                      <Ionicons name="trash-outline" size={19} color="#F87171" />
                    </Tap>
                  )}
                </>
              )}
            </View>

            <View style={styles.heroContent}>
              {/* iOS stretchy header: the cover grows as you pull down, settles back as you scroll */}
              <Animated.View
                style={{
                  transform: [
                    {
                      scale: scrollY.interpolate({
                        inputRange: [-240, 0, 240],
                        outputRange: [1.22, 1, 0.9],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                  opacity: scrollY.interpolate({
                    inputRange: [0, 260],
                    outputRange: [1, 0.35],
                    extrapolate: 'clamp',
                  }),
                }}
              >
                {removablePlaylistId ? (
                  <Tap
                    feedback="scale"
                    onPress={() => openPlaylistEditor(removablePlaylistId, 'cover')}
                    accessibilityLabel={vi ? 'Đổi ảnh bìa' : 'Change cover'}
                  >
                    {artworkUrl ? (
                      <ArtworkImage source={{ uri: artworkUrl }} style={styles.heroCover} />
                    ) : (
                      <View
                        style={[
                          styles.heroCover,
                          styles.placeholderCover,
                          { backgroundColor: headerPalette.container },
                        ]}
                      >
                        <Ionicons name="musical-notes" size={56} color={headerPalette.accent} />
                      </View>
                    )}
                    <View style={styles.coverEditBadge}>
                      <Ionicons name="pencil" size={13} color="#fff" />
                    </View>
                  </Tap>
                ) : artworkUrl ? (
                  <ArtworkImage source={{ uri: artworkUrl }} style={styles.heroCover} />
                ) : (
                  <View
                    style={[
                      styles.heroCover,
                      styles.placeholderCover,
                      { backgroundColor: tag ? tag.color + '33' : headerPalette.container },
                    ]}
                  >
                    <Ionicons
                      name={tag ? 'pricetag' : 'musical-notes'}
                      size={56}
                      color={tag ? tag.color : headerPalette.accent}
                    />
                  </View>
                )}
              </Animated.View>

              {tag ? (
                <View style={styles.tagKicker}>
                  <View style={[styles.tagKickerDot, { backgroundColor: tag.color }]} />
                  <Text style={styles.tagKickerText}>{vi ? 'THẺ' : 'TAG'}</Text>
                </View>
              ) : null}
              <Text style={[styles.heroTitle, { fontFamily }]}>{title}</Text>
              {creator || pinned ? (
                <View style={styles.creatorLine}>
                  {pinned ? (
                    <Ionicons
                      name="pin"
                      size={12}
                      color={headerPalette.accent}
                      style={{ transform: [{ rotate: '45deg' }] }}
                    />
                  ) : null}
                  {creator ? (
                    <Tap
                      feedback="opacity"
                      disabled={!removablePlaylistId}
                      onPress={() => removablePlaylistId && openPlaylistEditor(removablePlaylistId)}
                      accessibilityLabel={
                        vi
                          ? `Người tạo: ${creator}. Chạm để sửa`
                          : `Creator: ${creator}. Tap to edit`
                      }
                      style={styles.creatorTap}
                    >
                      <Ionicons name="person-circle" size={15} color={UI.text2} />
                      <Text style={styles.creatorText} numberOfLines={1}>
                        {vi ? `Tạo bởi ${creator}` : `By ${creator}`}
                      </Text>
                    </Tap>
                  ) : (
                    <Text style={styles.creatorText}>{vi ? 'Đã ghim' : 'Pinned'}</Text>
                  )}
                </View>
              ) : null}
              <Text style={styles.heroSub}>{subtitle}</Text>
              {/* a playlist's tags: tap one to open it, + to add / remove */}
              {removablePlaylistId ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 10, marginHorizontal: -18, alignSelf: 'stretch' }}
                  contentContainerStyle={styles.tagRow}
                >
                  {plTags.map((tg) => (
                    <TagChip
                      key={tg.id}
                      tag={tg}
                      size="sm"
                      onPress={() => openCollection({ kind: 'tag', tagId: tg.id })}
                      accessibilityLabel={vi ? `Thẻ ${tg.name}, mở` : `Tag ${tg.name}, open`}
                    />
                  ))}
                  <Tap
                    feedback="scale"
                    onPress={tagPlaylist}
                    style={styles.tagAdd}
                    accessibilityRole="button"
                    accessibilityLabel={vi ? 'Gắn thẻ cho playlist' : 'Tag this playlist'}
                  >
                    <Ionicons
                      name={plTags.length ? 'create-outline' : 'pricetag-outline'}
                      size={12}
                      color={UI.text2}
                    />
                    <Text style={styles.tagAddText}>
                      {plTags.length ? (vi ? 'Sửa thẻ' : 'Edit tags') : vi ? 'Gắn thẻ' : 'Add tag'}
                    </Text>
                  </Tap>
                </ScrollView>
              ) : null}

              {tracks.length > 0 && (
                <View style={styles.heroBtns}>
                  <Tap
                    onPress={() => {
                      playTrack(tracks[0], tracks);
                      openCollection(null);
                    }}
                    style={[styles.primaryBtn, { backgroundColor: headerPalette.accent }]}
                  >
                    <Ionicons name="play" size={18} color={headerPalette.onAccent} />
                    <Text style={{ color: headerPalette.onAccent, fontWeight: '800' }}>
                      {t(prefs.language, 'playAll')}
                    </Text>
                  </Tap>

                  <Tap
                    onPress={() => {
                      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                      playTrack(shuffled[0], shuffled);
                      openCollection(null);
                    }}
                    style={styles.secondaryBtn}
                  >
                    <Ionicons name="shuffle" size={18} color={UI.text} />
                    <Text style={{ color: UI.text, fontWeight: '700' }}>
                      {t(prefs.language, 'shuffle')}
                    </Text>
                  </Tap>
                </View>
              )}
              {tracks.length > 0 && !nativePage && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 10, marginHorizontal: -18, alignSelf: 'stretch' }}
                  contentContainerStyle={styles.chipRow}
                >
                  <Tap
                    onPress={() =>
                      openBackdropEditor({
                        scope: 'page',
                        key: bgKey,
                        title,
                        cover: artworkUrl || undefined,
                      })
                    }
                    style={styles.chipBtn}
                    accessibilityLabel={vi ? 'Ảnh nền trang' : 'Page background'}
                  >
                    <Ionicons name="image-outline" size={15} color={UI.text} />
                    <Text style={styles.chipText}>{vi ? 'Ảnh nền' : 'Background'}</Text>
                  </Tap>
                  {removablePlaylistId && (
                    <Tap
                      onPress={() => togglePinPlaylist(removablePlaylistId)}
                      style={[styles.chipBtn, pinned && { borderColor: headerPalette.accent }]}
                      accessibilityLabel={pinned ? (vi ? 'Bỏ ghim' : 'Unpin') : vi ? 'Ghim' : 'Pin'}
                      accessibilityState={{ selected: pinned }}
                    >
                      <Ionicons
                        name={pinned ? 'pin' : 'pin-outline'}
                        size={15}
                        color={pinned ? headerPalette.accent : UI.text}
                      />
                      <Text style={styles.chipText}>
                        {pinned ? (vi ? 'Đã ghim' : 'Pinned') : vi ? 'Ghim' : 'Pin'}
                      </Text>
                    </Tap>
                  )}
                  {removablePlaylistId && (
                    <Tap
                      onPress={() => openPlaylistEditor(removablePlaylistId)}
                      style={styles.chipBtn}
                    >
                      <Ionicons name="pencil" size={15} color={UI.text} />
                      <Text style={styles.chipText}>{vi ? 'Sửa playlist' : 'Edit'}</Text>
                    </Tap>
                  )}
                  {tag && (
                    <Tap onPress={() => openTagSheet({ kind: 'manage' })} style={styles.chipBtn}>
                      <Ionicons name="pencil" size={15} color={UI.text} />
                      <Text style={styles.chipText}>{vi ? 'Sửa thẻ' : 'Edit tag'}</Text>
                    </Tap>
                  )}
                  {canSaveAsPlaylist && (
                    <Tap onPress={saveAsPlaylist} style={styles.chipBtn}>
                      <Ionicons name="bookmark-outline" size={15} color={UI.text} />
                      <Text style={styles.chipText}>
                        {vi ? 'Lưu playlist' : 'Save as playlist'}
                      </Text>
                    </Tap>
                  )}
                  {collectionTarget.kind !== 'offline' && (
                    <Tap onPress={downloadAll} style={styles.chipBtn}>
                      <Ionicons name="arrow-down-circle-outline" size={15} color={UI.text} />
                      <Text style={styles.chipText}>
                        {Object.keys(downloadingIds).length > 0
                          ? `${Object.keys(downloadingIds).length}…`
                          : vi
                            ? 'Tải tất cả'
                            : 'Download all'}
                      </Text>
                    </Tap>
                  )}
                  <Tap
                    onPress={async () => {
                      const rel = await exportPlaylistM3U(title, allTracks);
                      if (!rel) return;
                      const fname = rel.split('/').pop();
                      showToast(
                        Platform.OS === 'web'
                          ? vi
                            ? `Đã tải ${fname} · bản sao trong Nhạc trên máy › Playlists`
                            : `Downloaded ${fname} · a copy is in Local Files › Playlists`
                          : vi
                            ? `Đã lưu ${fname} vào Tệp › HolySic › Playlists`
                            : `Saved ${fname} to Files › HolySic › Playlists`
                      );
                    }}
                    style={styles.chipBtn}
                    accessibilityLabel={vi ? 'Xuất M3U' : 'Export M3U'}
                  >
                    <Ionicons name="share-outline" size={15} color={UI.text} />
                    <Text style={styles.chipText}>{vi ? 'Xuất M3U' : 'Export M3U'}</Text>
                  </Tap>
                  {tag && (
                    <Tap
                      onPress={deleteTag}
                      style={styles.chipBtn}
                      accessibilityLabel={vi ? 'Xoá thẻ' : 'Delete tag'}
                    >
                      <Ionicons name="trash-outline" size={15} color="#F87171" />
                      <Text style={[styles.chipText, { color: '#F87171' }]}>
                        {vi ? 'Xoá thẻ' : 'Delete tag'}
                      </Text>
                    </Tap>
                  )}
                </ScrollView>
              )}
            </View>
          </LinearGradient>

          {/* tag page: playlists carrying the tag */}
          {tag && tagPlaylists.length > 0 && !selecting && (
            <View style={{ marginTop: 6, marginBottom: 6 }}>
              <Text style={[styles.discographyHeading, { fontFamily }]}>
                {vi ? 'Playlist' : 'Playlists'}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {tagPlaylists.map((p) => {
                  const cover = playlistCoverOf(p);
                  return (
                    <Tap
                      key={p.id}
                      onPress={() => openCollection({ kind: 'playlist', playlistId: p.id })}
                      style={{ width: 120 }}
                      accessibilityLabel={p.name}
                    >
                      {cover ? (
                        <ArtworkImage source={{ uri: cover }} style={styles.tagPlCover} />
                      ) : (
                        <View
                          style={[
                            styles.tagPlCover,
                            styles.placeholderCover,
                            { backgroundColor: p.coverTint || headerPalette.container },
                          ]}
                        >
                          <Ionicons name="musical-notes" size={34} color={UI.text} />
                        </View>
                      )}
                      <Text numberOfLines={1} style={styles.tagPlName}>
                        {p.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.tagPlSub}>
                        {p.tracks.length} {vi ? 'bài' : 'songs'}
                      </Text>
                    </Tap>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {loading && (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator size="large" color={headerPalette.accent} />
            </View>
          )}

          {!loading &&
            allTracks.length === 0 &&
            (collectionTarget.kind === 'album' || collectionTarget.kind === 'artist' ? (
              <EmptyState
                icon={isOnline ? 'cloud-outline' : 'cloud-offline-outline'}
                accent={headerPalette.accent}
                title={
                  isOnline
                    ? vi
                      ? 'Chưa tải được danh sách bài'
                      : 'Couldn’t load the songs'
                    : vi
                      ? 'Bạn đang ngoại tuyến'
                      : 'You’re offline'
                }
                message={
                  isOnline
                    ? vi
                      ? 'Nguồn nhạc đang chậm hoặc không phản hồi. Thử lại sau giây lát.'
                      : 'The music source is slow or not answering. Try again in a moment.'
                    : vi
                      ? 'Kết nối mạng để xem bài hát của trang này.'
                      : 'Connect to the internet to see this page’s songs.'
                }
                actionLabel={vi ? 'Thử lại' : 'Try again'}
                actionIcon="refresh"
                onAction={() => setReloadTick((n) => n + 1)}
              />
            ) : (
              <EmptyState
                icon={
                  collectionTarget.kind === 'liked'
                    ? 'heart-outline'
                    : collectionTarget.kind === 'offline'
                      ? 'cloud-download-outline'
                      : tag
                        ? 'pricetag-outline'
                        : 'musical-notes-outline'
                }
                accent={headerPalette.accent}
                title={
                  collectionTarget.kind === 'liked'
                    ? vi
                      ? 'Chưa có bài hát đã thích'
                      : 'No liked songs yet'
                    : collectionTarget.kind === 'offline'
                      ? vi
                        ? 'Chưa có bài tải về'
                        : 'No downloads yet'
                      : tag
                        ? vi
                          ? 'Chưa có bài nào mang thẻ này'
                          : 'No songs with this tag yet'
                        : vi
                          ? 'Playlist còn trống'
                          : 'This playlist is empty'
                }
                message={
                  tag
                    ? vi
                      ? 'Mở menu ⋯ của một bài › Gắn thẻ…, hoặc Chọn bài › Gắn thẻ để gắn nhiều bài một lúc.'
                      : 'Open a song’s ⋯ menu › Tags…, or Select songs › Tag to tag many at once.'
                    : vi
                      ? 'Tìm một bài rồi mở menu ⋯ để thêm vào đây.'
                      : 'Find a song, then use its ⋯ menu to add it here.'
                }
                actionLabel={vi ? 'Tìm nhạc' : 'Find music'}
                actionIcon="search"
                onAction={() => {
                  goBack();
                  setActiveTab('search');
                }}
              />
            ))}

          {/* Tracklist */}
          {canFilter && (
            <View style={styles.filterRow}>
              <View style={styles.filterBox}>
                <Ionicons name="search" size={15} color={UI.text3} />
                <TextInput
                  value={filterQ}
                  onChangeText={setFilterQ}
                  placeholder={
                    vi ? `Lọc ${allTracks.length} bài…` : `Filter ${allTracks.length} songs…`
                  }
                  placeholderTextColor={UI.text3}
                  style={styles.filterInput}
                />
                {filterQ.length > 0 && (
                  <Tap hitSlop={8} onPress={() => setFilterQ('')}>
                    <Ionicons name="close-circle" size={16} color={UI.text3} />
                  </Tap>
                )}
              </View>
              <Tap
                onPress={() =>
                  setSortBy(SORT_ORDER[(SORT_ORDER.indexOf(sortBy) + 1) % SORT_ORDER.length])
                }
                style={[
                  styles.sortChip,
                  sortBy !== 'default' && { borderColor: headerPalette.accent },
                ]}
              >
                <Ionicons
                  name="swap-vertical"
                  size={14}
                  color={sortBy !== 'default' ? headerPalette.accent : UI.fg(1)}
                />
                <Text style={styles.sortText}>{SORT_LABEL[sortBy]}</Text>
              </Tap>
            </View>
          )}
          {canFilter && filterQ.trim() !== '' && tracks.length === 0 && (
            <Text style={styles.filterEmpty}>
              {vi ? 'Không có bài nào khớp bộ lọc' : 'No songs match the filter'}
            </Text>
          )}
          {selecting && (
            <View style={styles.selectBar}>
              <Tap
                onPress={() => {
                  const all = chosen.length === tracks.length;
                  setSelected(all ? {} : Object.fromEntries(tracks.map((x) => [x.id, true])));
                }}
              >
                <Text style={{ color: headerPalette.accent, fontWeight: '800' }}>
                  {chosen.length === tracks.length
                    ? vi
                      ? 'Bỏ chọn'
                      : 'None'
                    : vi
                      ? 'Chọn tất cả'
                      : 'All'}
                </Text>
              </Tap>
              <Text style={{ color: UI.text, fontWeight: '700' }}>
                {chosen.length} {vi ? 'đã chọn' : 'selected'}
              </Text>
            </View>
          )}
          {selecting && chosen.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bulkRow}
            >
              <Tap
                onPress={() => {
                  playTrack(chosen[0], chosen);
                  openCollection(null);
                }}
                style={[styles.chipBtn, { backgroundColor: headerPalette.accent }]}
              >
                <Ionicons name="play" size={15} color={headerPalette.onAccent} />
                <Text style={[styles.chipText, { color: headerPalette.onAccent }]}>
                  {vi ? 'Phát' : 'Play'}
                </Text>
              </Tap>
              <Tap onPress={() => queueTracks(chosen, true)} style={styles.chipBtn}>
                <Ionicons name="play-forward-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Phát kế' : 'Play next'}</Text>
              </Tap>
              <Tap onPress={() => queueTracks(chosen)} style={styles.chipBtn}>
                <Ionicons name="list" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Hàng chờ' : 'Queue'}</Text>
              </Tap>
              {collectionTarget.kind !== 'liked' && (
                <Tap onPress={() => likeTracks(chosen)} style={styles.chipBtn}>
                  <Ionicons name="heart-outline" size={15} color={UI.text} />
                  <Text style={styles.chipText}>{vi ? 'Thích' : 'Like'}</Text>
                </Tap>
              )}
              <Tap onPress={() => setPickPlaylist((v) => !v)} style={styles.chipBtn}>
                <Ionicons name="add-circle-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Vào playlist' : 'To playlist'}</Text>
              </Tap>
              <Tap
                onPress={() => openTagSheet({ kind: 'tracks', tracks: chosen })}
                style={styles.chipBtn}
              >
                <Ionicons name="pricetag-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Gắn thẻ' : 'Tag'}</Text>
              </Tap>
              {tag && (
                <Tap
                  onPress={() => {
                    untagWithUndo(chosen);
                    setSelected({});
                  }}
                  style={styles.chipBtn}
                >
                  <Ionicons name="close-circle-outline" size={15} color="#F87171" />
                  <Text style={[styles.chipText, { color: '#F87171' }]}>
                    {vi ? 'Bỏ thẻ' : 'Untag'}
                  </Text>
                </Tap>
              )}
              <Tap onPress={() => requestDownload(chosen)} style={styles.chipBtn}>
                <Ionicons name="arrow-down-circle-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Tải' : 'Download'}</Text>
              </Tap>
              {collectionTarget.kind === 'offline' && (
                <Tap
                  onPress={() => {
                    removeDownloads(chosen.map((x) => x.id));
                    setSelected({});
                  }}
                  style={styles.chipBtn}
                >
                  <Ionicons name="trash-outline" size={15} color="#F87171" />
                  <Text style={[styles.chipText, { color: '#F87171' }]}>
                    {vi ? 'Xoá bản tải' : 'Delete'}
                  </Text>
                </Tap>
              )}
              {removablePlaylistId && (
                <Tap
                  onPress={() => {
                    removeWithUndo(chosen.map((x) => x.id));
                    setSelected({});
                  }}
                  style={styles.chipBtn}
                >
                  <Ionicons name="trash-outline" size={15} color="#F87171" />
                  <Text style={[styles.chipText, { color: '#F87171' }]}>
                    {vi ? 'Xoá' : 'Remove'}
                  </Text>
                </Tap>
              )}
            </ScrollView>
          )}
          {selecting && pickPlaylist && chosen.length > 0 && (
            <View style={styles.plPicker}>
              <Tap
                onPress={() => {
                  const pl = createPlaylist(
                    vi
                      ? `Playlist mới ${new Date().toLocaleDateString()}`
                      : `New playlist ${new Date().toLocaleDateString()}`
                  );
                  addTracksToPlaylist(pl.id, chosen);
                  setPickPlaylist(false);
                }}
                style={styles.plRow}
              >
                <Ionicons name="add" size={18} color={headerPalette.accent} />
                <Text style={{ color: UI.text, fontWeight: '700' }}>
                  {vi ? 'Playlist mới' : 'New playlist'}
                </Text>
              </Tap>
              {playlists
                .filter((p) => p.id !== removablePlaylistId)
                .map((p) => (
                  <Tap
                    key={p.id}
                    onPress={() => {
                      addTracksToPlaylist(p.id, chosen);
                      setPickPlaylist(false);
                    }}
                    style={styles.plRow}
                  >
                    <Ionicons name="musical-notes" size={16} color={headerPalette.accent} />
                    <Text style={{ color: UI.text }} numberOfLines={1}>
                      {p.name} ({p.tracks.length})
                    </Text>
                  </Tap>
                ))}
            </View>
          )}

          <View style={{ paddingHorizontal: 6 }}>
            {selecting &&
              tracks.map((song, idx) => (
                <Tap
                  key={`sel-${song.id}-${idx}`}
                  onPress={() => setSelected((prev) => ({ ...prev, [song.id]: !prev[song.id] }))}
                  style={styles.selRow}
                >
                  <Ionicons
                    name={selected[song.id] ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={selected[song.id] ? headerPalette.accent : UI.text3}
                  />
                  <ArtworkImage
                    source={{ uri: song.artworkUrl }}
                    fallbackSeed={song.title}
                    style={styles.selArt}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: UI.text, fontWeight: '700' }}>
                      {song.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: UI.text3, fontSize: 12 }}>
                      {song.artist}
                    </Text>
                  </View>
                </Tap>
              ))}
            {!selecting && (
              <Progressive total={tracks.length} resetKey={collectionTarget}>
                {(shown) =>
                  tracks.slice(0, shown).map((song, idx) => (
                    <Rise key={`${song.id}-${idx}`} index={idx}>
                      <TrackRow
                        track={song}
                        queueContext={tracks}
                        indexBadge={idx + 1}
                        onRemove={
                          removablePlaylistId
                            ? () => removeWithUndo([song.id])
                            : tag
                              ? () => untagWithUndo([song])
                              : undefined
                        }
                        removeLabel={tag ? (vi ? 'Bỏ thẻ' : 'Untag') : undefined}
                      />
                    </Rise>
                  ))
                }
              </Progressive>
            )}
            {!selecting && collectionTarget.kind === 'artist' && tracks.length > 0 && (
              <Tap onPress={loadMoreArtist} disabled={loadingMore} style={styles.loadMore}>
                {loadingMore ? (
                  <ActivityIndicator color={headerPalette.accent} />
                ) : (
                  <Text style={{ color: headerPalette.accent, fontWeight: '800' }}>
                    {vi ? 'Thêm bài của nghệ sĩ' : 'Load more songs'}
                  </Text>
                )}
              </Tap>
            )}
          </View>

          {collectionTarget.kind === 'artist' && (
            <ArtistBioCard
              name={title}
              language={prefs.language}
              accent={headerPalette.accent}
              fontFamily={fontFamily}
            />
          )}

          {/* Artist Discography Albums if viewing Artist */}
          {collectionTarget.kind === 'artist' &&
            artistData?.albums &&
            artistData.albums.length > 0 && (
              <View style={{ marginTop: 22 }}>
                <Text style={[styles.discographyHeading, { fontFamily }]}>
                  {vi ? 'Album & Đĩa đơn' : 'Discography'}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                >
                  {artistData.albums.map((alb) => (
                    <Tap
                      key={alb.id}
                      onPress={() => openCollection({ kind: 'album', id: alb.id, summary: alb })}
                      style={{ width: 136 }}
                    >
                      <ArtworkImage
                        source={{ uri: alb.artworkUrl }}
                        style={{ width: 136, height: 136, borderRadius: 16, marginBottom: 6 }}
                      />
                      <Text
                        numberOfLines={1}
                        style={{ color: UI.text, fontWeight: '700', fontSize: 13.5 }}
                      >
                        {alb.title}
                      </Text>
                      {alb.year && (
                        <Text style={{ color: UI.text3, fontSize: 12 }}>{alb.year}</Text>
                      )}
                    </Tap>
                  ))}
                </ScrollView>
              </View>
            )}
        </Animated.ScrollView>

        {/* pinned bar: back stays in reach; once the hero has scrolled away a frosted bar with the
            title fades in behind it (UINavigationBar scroll-edge behaviour) */}
        <View
          pointerEvents="box-none"
          style={[styles.pinnedBar, { paddingTop: Math.max(insets.top, 16) }]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: scrollY.interpolate({
                  inputRange: [120, 185],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <GlassSurface
              intensity={70}
              tintColor={UI.shade(12, 12, 18, 0.9)}
              style={[StyleSheet.absoluteFill, styles.pinnedGlass]}
            >
              <View />
            </GlassSurface>
          </Animated.View>
          <Tap
            onPress={goBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={vi ? 'Quay lại' : 'Back'}
          >
            <Ionicons name="chevron-back" size={22} color={UI.text} />
          </Tap>
          <Animated.Text
            numberOfLines={1}
            pointerEvents="none"
            style={[
              styles.pinnedTitle,
              { fontFamily },
              {
                opacity: scrollY.interpolate({
                  inputRange: [215, 255],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [215, 255],
                      outputRange: [6, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            {title}
          </Animated.Text>
          <View style={{ width: 38 }} />
        </View>
      </Animated.View>
      <SheetSlot layer="collection" />
    </Modal>
  );
};

const styles = themedSheet(() => ({
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 6,
  },
  filterBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: UI.fg(0.06),
  },
  filterInput: { flex: 1, color: UI.text, fontSize: 14 },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: UI.fg(0.1),
    backgroundColor: UI.fg(0.06),
  },
  sortText: { color: UI.text, fontSize: 12.5, fontWeight: '700' },
  filterEmpty: { color: UI.text3, textAlign: 'center', marginVertical: 18 },
  root: {
    flex: 1,
  },
  // edge shadow while the page slides (like a pushed UINavigationController page)
  pushed: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: -6, height: 0 },
  },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 22,
  },
  pinnedBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 8,
    gap: 10,
  },
  pinnedGlass: {
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.12),
  },
  pinnedTitle: {
    flex: 1,
    textAlign: 'center',
    color: UI.text,
    fontSize: 16,
    fontWeight: '800',
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: UI.shade(0, 0, 0, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroContent: {
    alignItems: 'center',
  },
  heroCover: {
    width: 196,
    height: 196,
    borderRadius: 24,
    marginBottom: 16,
  },
  placeholderCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEditBadge: {
    position: 'absolute',
    right: 10,
    bottom: 26,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  heroTitle: {
    color: UI.text,
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroSub: {
    color: UI.text2,
    fontSize: 13.5,
    marginTop: 4,
    textAlign: 'center',
  },
  creatorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  creatorTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 260,
  },
  creatorText: {
    color: UI.text2,
    fontSize: 13,
    fontWeight: '600',
  },
  // secondary actions on one line (scrolls sideways on narrow screens instead of wrapping)
  chipRow: {
    flexGrow: 1,
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  heroBtns: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 18,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 99,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 99,
    backgroundColor: UI.fg(0.12),
  },
  chipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: UI.fg(0.12),
  },
  chipText: { color: UI.text, fontWeight: '700', fontSize: 13 },
  selectBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  bulkRow: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  plPicker: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: UI.fg(0.06),
    overflow: 'hidden',
  },
  plRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  selRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selArt: { width: 44, height: 44, borderRadius: 8 },
  loadMore: { alignItems: 'center', paddingVertical: 16 },
  discographyHeading: {
    color: UI.text,
    fontSize: 18,
    fontWeight: '800',
    marginHorizontal: 18,
    marginBottom: 12,
  },
  // tags: the kicker on a tag page, a playlist's chips, the tag page's playlists
  tagKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tagKickerDot: { width: 8, height: 8, borderRadius: 4 },
  tagKickerText: { color: UI.text2, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  tagRow: {
    flexGrow: 1,
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
  },
  tagAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: UI.fg(0.28),
  },
  tagAddText: { color: UI.text2, fontSize: 12, fontWeight: '600' },
  tagPlCover: { width: 120, height: 120, borderRadius: 12 },
  tagPlName: { color: UI.text, fontSize: 13.5, fontWeight: '700', marginTop: 6 },
  tagPlSub: { color: UI.text2, fontSize: 12, marginTop: 1 },
}));
