// HolySic Library Hub — Playlists, Liked Songs, Offline Downloads, History & Playlist Importer

import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { t } from '../../constants/i18n';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { TrackRow } from '../TrackRow';
import { Track } from '../../types/music';
import { isLocalTrack, LocalLibrary, playlistCoverOf } from '../../services/local/localLibrary';
import { DownloadsManager } from '../library/DownloadsManager';
import { openPlaylistEditor } from '../library/PlaylistEditor';
import { useLocalLibrary } from '../local/LocalLibraryScreen';
import { T as UI, themedSheet } from '../../theme/ui';
import { useTabScrollToTop } from '../../services/ui/tabBus';
import { Tap } from '../ui/Tap';
import { EmptyState } from '../ui/EmptyState';
import { PopIn } from '../ui/PopIn';
import { ScrollEdgeHairline } from '../ui/ScrollEdgeBar';
import { NativeMenu, nativeMenuAvailable } from '../ui/NativeMenu';
import { perfCount } from '../../services/perfProbe';

type LibFilter = 'playlists' | 'liked' | 'offline' | 'history';

export const LibraryScreen: React.FC = () => {
  perfCount('render:Library');
  const {
    prefs,
    palette,
    likedTracks,
    playlists,
    downloads,
    history,
    createPlaylist,
    openImport,
    openCollection,
    setIsRecapOpen,
    setActiveTab,
    playTrack,
    setIsPlayerOpen,
    deletePlaylist,
  } = useHolySic();

  const [tab, setTab] = useState<LibFilter>('playlists');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [plName, setPlName] = useState('');
  const [plDesc, setPlDesc] = useState('');

  const vi = prefs.language === 'vi';
  const local = useLocalLibrary();
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const offlineList = Object.values(downloads);
  const offlineIn = (list: Track[]) =>
    list.reduce((n, x) => n + (downloads[x.id] || isLocalTrack(x) ? 1 : 0), 0);
  // 4" phones: header pills go icon-only so the title never wraps
  const narrow = useWindowDimensions().width < 360;

  const scrollRef = useTabScrollToTop('library');
  const scrollY = useRef(new Animated.Value(0)).current;
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text numberOfLines={1} style={[styles.pageTitle, { fontFamily }]}>
          {t(prefs.language, 'library')}
        </Text>
        <View style={styles.headerRight}>
          <Tap
            onPress={() => LocalLibrary.open()}
            style={styles.iconBtn}
            accessibilityLabel={vi ? 'Nhạc trên máy' : 'Local Files'}
          >
            <Ionicons name="folder-open-outline" size={17} color={UI.text} />
          </Tap>
          <Tap
            onPress={() => openImport('link')}
            style={styles.iconBtn}
            accessibilityLabel={vi ? 'Nhập playlist' : 'Import playlist'}
          >
            <Ionicons name="cloud-upload-outline" size={17} color={UI.text} />
          </Tap>
          <Tap
            onPress={() => setShowCreateModal(true)}
            style={[styles.actionPill, { backgroundColor: palette.accent }]}
            accessibilityLabel={vi ? 'Tạo playlist mới' : 'New playlist'}
          >
            <Ionicons name="add" size={18} color={palette.onAccent} />
            {!narrow && (
              <Text style={[styles.actionPillText, { color: palette.onAccent }]}>
                {vi ? 'Tạo mới' : 'New'}
              </Text>
            )}
          </Tap>
        </View>
      </View>

      {/* Top Shelf Cards */}
      <View style={[styles.shelfRow, narrow && styles.shelfRowNarrow]}>
        <Tap
          onPress={() => LocalLibrary.open()}
          style={[
            styles.shelfCard,
            narrow && styles.shelfCardNarrow,
            { backgroundColor: 'rgba(244, 114, 182, 0.14)' },
          ]}
          accessibilityLabel={vi ? 'Mở Nhạc trên máy' : 'Open Local Files'}
        >
          <Ionicons name="phone-portrait" size={22} color="#F472B6" />
          <Text style={[styles.shelfCount, narrow && styles.shelfCountNarrow]}>
            {local.ready ? local.files.length : '–'}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={styles.shelfLabel}
          >
            {vi ? 'Trên máy' : 'Local'}
          </Text>
        </Tap>

        <Tap
          onPress={() => openCollection({ kind: 'liked' })}
          style={[
            styles.shelfCard,
            narrow && styles.shelfCardNarrow,
            { backgroundColor: 'rgba(255, 77, 121, 0.14)' },
          ]}
        >
          <Ionicons name="heart" size={22} color={HOLYSIC_COLORS.roseLike} />
          <Text style={[styles.shelfCount, narrow && styles.shelfCountNarrow]}>
            {likedTracks.length}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={styles.shelfLabel}
          >
            {vi ? 'Đã thích' : 'Liked'}
          </Text>
        </Tap>

        <Tap
          onPress={() => setTab('offline')}
          style={[
            styles.shelfCard,
            narrow && styles.shelfCardNarrow,
            { backgroundColor: 'rgba(52, 211, 153, 0.14)' },
          ]}
        >
          <Ionicons name="arrow-down-circle" size={22} color={HOLYSIC_COLORS.flacEmerald} />
          <Text style={[styles.shelfCount, narrow && styles.shelfCountNarrow]}>
            {offlineList.length}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={styles.shelfLabel}
          >
            {vi ? 'Đã tải' : 'Downloads'}
          </Text>
        </Tap>

        <Tap
          onPress={() => setIsRecapOpen(true)}
          style={[
            styles.shelfCard,
            narrow && styles.shelfCardNarrow,
            { backgroundColor: palette.container },
          ]}
        >
          <Ionicons name="sparkles" size={22} color={palette.accent} />
          <Text style={[styles.shelfCount, narrow && styles.shelfCountNarrow]}>
            {history.length}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={styles.shelfLabel}
          >
            Recap
          </Text>
        </Tap>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
      >
        {(
          [
            { id: 'playlists', label: t(prefs.language, 'playlists') },
            { id: 'liked', label: t(prefs.language, 'likedSongs') },
            { id: 'offline', label: vi ? 'Đã tải' : 'Downloads' },
            { id: 'history', label: t(prefs.language, 'history') },
          ] as { id: LibFilter; label: string }[]
        ).map((item) => {
          const active = tab === item.id;
          return (
            <Tap
              key={item.id}
              onPress={() => setTab(item.id)}
              style={[
                styles.tabChip,
                active && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[styles.tabChipText, { color: active ? palette.onAccent : UI.fg(0.88) }]}
              >
                {item.label}
              </Text>
            </Tap>
          );
        })}
      </ScrollView>

      {/* scroll-edge hairline under the pinned header */}
      <View style={{ zIndex: 2 }}>
        <ScrollEdgeHairline scrollY={scrollY} />
      </View>
      <Animated.ScrollView
        ref={scrollRef as any}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {tab === 'playlists' && playlists.length === 0 && (
          <EmptyState
            icon="albums-outline"
            accent={palette.accent}
            title={vi ? 'Chưa có danh sách phát' : 'No playlists yet'}
            message={
              vi
                ? 'Tạo playlist mới hoặc nhập từ Spotify, YouTube, Apple Music.'
                : 'Make a new playlist or import one from Spotify, YouTube or Apple Music.'
            }
            actionLabel={vi ? 'Tạo playlist' : 'New playlist'}
            actionIcon="add"
            onAction={() => setShowCreateModal(true)}
          />
        )}
        {tab === 'playlists' && (
          <View style={styles.playlistList}>
            {playlists.map((pl) => (
              <NativeMenu
                key={pl.id}
                trigger="longPress"
                previewRadius={16}
                previewBackground={UI.surface('#14141B')}
                items={[
                  {
                    id: 'play',
                    title: vi ? 'Phát' : 'Play',
                    icon: 'play.fill',
                    disabled: pl.tracks.length === 0,
                    section: 0,
                  },
                  {
                    id: 'shuffle',
                    title: vi ? 'Trộn bài' : 'Shuffle',
                    icon: 'shuffle',
                    disabled: pl.tracks.length === 0,
                    section: 0,
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
                          title: vi ? 'Sửa tên & thứ tự…' : 'Edit Name & Order…',
                          icon: 'pencil',
                          section: 1,
                        },
                        {
                          id: 'cover',
                          title: vi ? 'Đổi ảnh bìa…' : 'Change Cover…',
                          icon: 'photo',
                          section: 1,
                        },
                        {
                          id: 'delete',
                          title: vi ? 'Xoá playlist' : 'Delete Playlist',
                          icon: 'trash',
                          destructive: true,
                          section: 2,
                        },
                      ]),
                ]}
                onSelect={(id) => {
                  if (id === 'play' && pl.tracks.length) {
                    playTrack(pl.tracks[0], pl.tracks);
                    setIsPlayerOpen(true);
                  } else if (id === 'shuffle' && pl.tracks.length) {
                    const list = [...pl.tracks].sort(() => Math.random() - 0.5);
                    playTrack(list[0], list);
                    setIsPlayerOpen(true);
                  } else if (id === 'open') {
                    openCollection({ kind: 'playlist', playlistId: pl.id });
                  } else if (id === 'edit') {
                    setTimeout(() => openPlaylistEditor(pl.id), 350);
                  } else if (id === 'cover') {
                    setTimeout(() => openPlaylistEditor(pl.id, 'cover'), 350);
                  } else if (id === 'delete') {
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
                  }
                }}
              >
                <Tap
                  onPress={() => openCollection({ kind: 'playlist', playlistId: pl.id })}
                  // a hold belongs to the native context menu (and must not open the page on release)
                  onLongPress={nativeMenuAvailable ? () => {} : undefined}
                  style={styles.playlistCard}
                >
                  {playlistCoverOf(pl) ? (
                    <ArtworkImage source={{ uri: playlistCoverOf(pl) }} style={styles.plCover} />
                  ) : (
                    <View
                      style={[
                        styles.plCover,
                        styles.plCoverFallback,
                        { backgroundColor: pl.coverTint || palette.container },
                      ]}
                    >
                      <Ionicons name="musical-notes" size={26} color={UI.text} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[styles.plName, { fontFamily }]}>
                      {pl.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.plSub}>
                      {pl.tracks.length} {vi ? 'bài hát' : 'songs'}
                      {offlineIn(pl.tracks) > 0 ? ` · ${offlineIn(pl.tracks)} offline` : ''}
                      {pl.description ? ` · ${pl.description}` : ''}
                    </Text>
                  </View>
                  {!nativeMenuAvailable && !pl.isSystem ? (
                    <Tap
                      feedback="opacity"
                      hitSlop={8}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        openPlaylistEditor(pl.id);
                      }}
                      style={styles.plEdit}
                      accessibilityLabel={vi ? `Sửa ${pl.name}` : `Edit ${pl.name}`}
                    >
                      <Ionicons name="pencil" size={15} color={UI.text2} />
                    </Tap>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={UI.text3} />
                </Tap>
              </NativeMenu>
            ))}
          </View>
        )}

        {tab === 'liked' && (
          <>
            {likedTracks.length === 0 ? (
              <EmptyState
                icon="heart-outline"
                accent={palette.accent}
                title={vi ? 'Chưa có bài hát đã thích' : 'No liked songs yet'}
                message={
                  vi
                    ? 'Chạm trái tim trong trình phát để lưu bài hát vào đây.'
                    : 'Tap the heart in the player to keep a song here.'
                }
                actionLabel={vi ? 'Tìm nhạc' : 'Find music'}
                actionIcon="search"
                onAction={() => setActiveTab('search')}
              />
            ) : (
              likedTracks.map((song) => (
                <TrackRow key={song.id} track={song} queueContext={likedTracks} />
              ))
            )}
          </>
        )}

        {tab === 'offline' && <DownloadsManager />}

        {tab === 'history' && (
          <>
            {history.length === 0 ? (
              <EmptyState
                icon="time-outline"
                accent={palette.accent}
                title={vi ? 'Chưa nghe bài nào' : 'Nothing played yet'}
                message={
                  vi
                    ? 'Những bài bạn vừa nghe sẽ tự hiện ở đây.'
                    : 'Songs you play show up here automatically.'
                }
                actionLabel={vi ? 'Về Trang chủ' : 'Go Home'}
                actionIcon="home-outline"
                onAction={() => setActiveTab('home')}
              />
            ) : (
              history.map((ev) => (
                <TrackRow key={ev.id} track={ev.track} queueContext={history.map((h) => h.track)} />
              ))
            )}
          </>
        )}
      </Animated.ScrollView>

      {/* Create Playlist Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Tap
            feedback="none"
            style={styles.modalBackdrop}
            onPress={() => setShowCreateModal(false)}
          >
            <PopIn visible={showCreateModal} style={{ width: '100%', alignItems: 'center' }}>
              <Tap feedback="none" style={styles.modalBox} onPress={(e) => e.stopPropagation?.()}>
                <Text style={styles.modalTitle}>{t(prefs.language, 'createPlaylist')}</Text>
                <TextInput
                  value={plName}
                  onChangeText={setPlName}
                  placeholder={vi ? 'Tên danh sách phát…' : 'Playlist title…'}
                  autoFocus
                  returnKeyType="next"
                  placeholderTextColor={UI.text3}
                  style={styles.modalInput}
                />
                <TextInput
                  value={plDesc}
                  onChangeText={setPlDesc}
                  placeholder={vi ? 'Mô tả ngắn (tuỳ chọn)…' : 'Optional description…'}
                  placeholderTextColor={UI.text3}
                  style={styles.modalInput}
                />
                <View style={styles.modalActions}>
                  <Tap onPress={() => setShowCreateModal(false)} style={styles.cancelModalBtn}>
                    <Text style={{ color: UI.text, fontWeight: '600' }}>
                      {vi ? 'Huỷ' : 'Cancel'}
                    </Text>
                  </Tap>
                  <Tap
                    onPress={() => {
                      if (!plName.trim()) return;
                      createPlaylist(plName, plDesc);
                      setPlName('');
                      setPlDesc('');
                      setShowCreateModal(false);
                    }}
                    disabled={!plName.trim()}
                    style={[
                      styles.confirmModalBtn,
                      { backgroundColor: palette.accent, opacity: plName.trim() ? 1 : 0.45 },
                    ]}
                  >
                    <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                      {vi ? 'Tạo ngay' : 'Create'}
                    </Text>
                  </Tap>
                </View>
              </Tap>
            </PopIn>
          </Tap>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = themedSheet(() => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  pageTitle: {
    flexShrink: 1,
    marginRight: 10,
    color: UI.text,
    fontSize: 24,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
    flexShrink: 0,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: UI.fg(0.09),
  },
  // round icon-only header buttons (UIKit bar button style) leave the large title room
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.09),
  },
  actionPillText: {
    color: UI.text,
    fontSize: 12.5,
    fontWeight: '700',
  },
  shelfRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  shelfCard: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  // 4" phones: 2×2 grid of horizontal tiles ("♥ 12 Đã thích") instead of four cramped columns
  shelfRowNarrow: { flexWrap: 'wrap' },
  shelfCardNarrow: {
    flexBasis: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  shelfCountNarrow: { marginTop: 0, fontSize: 17 },
  shelfLabelNarrow: { marginTop: 0, flexShrink: 1 },
  shelfCount: {
    color: UI.text,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 6,
  },
  shelfLabel: {
    color: UI.text2,
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  tabChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: UI.fg(0.06),
    borderWidth: 1,
    borderColor: UI.fg(0.09),
  },
  tabChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 175,
  },
  playlistList: {
    paddingHorizontal: 14,
    gap: 10,
  },
  playlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 11,
    borderRadius: 18,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.07),
    gap: 13,
  },
  plCover: {
    width: 58,
    height: 58,
    borderRadius: 14,
  },
  plEdit: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.07),
  },
  plCoverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plName: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '700',
  },
  plSub: {
    color: UI.text2,
    fontSize: 12.5,
    marginTop: 3,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: UI.shade(0, 0, 0, 0.68),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#16161F',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: UI.fg(0.14),
  },
  modalTitle: {
    color: UI.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalSub: {
    color: UI.text2,
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: UI.fg(0.07),
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: UI.text,
    fontSize: 14,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  cancelModalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: UI.fg(0.08),
  },
  confirmModalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
}));
