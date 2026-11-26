// iOS Action Sheet for Track Context Menu (Play Next, Queue, Add to Playlist, Offline, Artist/Album, Share, Save to Files, Radio, Block)

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArtworkImage } from './ArtworkImage';
import { MOCHY_COLORS } from '../constants/theme';
import { useMochy } from '../context/MochyContext';
import { GlassSurface } from './GlassSurface';

export const TrackActionSheet: React.FC = () => {
  const {
    actionTrack,
    setActionTrack,
    addToQueue,
    isLiked,
    toggleLike,
    playlists,
    createPlaylist,
    addTrackToPlaylist,
    downloads,
    downloadTrack,
    removeDownload,
    openCollection,
    setIsPlayerOpen,
    prefs,
    palette,
    showToast,
    blockTrack,
    blockArtist,
    startInstantMix,
    shareTrack,
    exportDownload,
  } = useMochy();

  const [pickingPlaylist, setPickingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  if (!actionTrack) return null;
  const vi = prefs.language === 'vi';
  const liked = isLiked(actionTrack.id);
  const isOffline = Boolean(downloads[actionTrack.id]);

  const close = () => {
    setPickingPlaylist(false);
    setNewPlaylistName('');
    setActionTrack(null);
  };

  return (
    <Modal visible={Boolean(actionTrack)} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheetOuter} onPress={(e) => e.stopPropagation?.()}>
          <GlassSurface intensity={75} tintColor="rgba(18, 18, 26, 0.90)" style={styles.sheet}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <ArtworkImage source={{ uri: actionTrack.artworkUrl }} style={styles.art} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.title}>
                  {actionTrack.title}
                </Text>
                <Text numberOfLines={1} style={styles.artist}>
                  {actionTrack.artist}
                  {actionTrack.album ? ` · ${actionTrack.album}` : ''}
                </Text>
                <Text style={[styles.badge, { color: palette.accent }]}>
                  {actionTrack.qualityBadge || actionTrack.source.toUpperCase()}
                </Text>
              </View>
            </View>

            {pickingPlaylist ? (
              <View style={styles.playlistPicker}>
                <View style={styles.newPlRow}>
                  <TextInput
                    value={newPlaylistName}
                    onChangeText={setNewPlaylistName}
                    placeholder={vi ? 'Tên playlist mới…' : 'New playlist name…'}
                    placeholderTextColor={MOCHY_COLORS.textMuted}
                    style={styles.input}
                  />
                  <Pressable
                    onPress={() => {
                      if (!newPlaylistName.trim()) return;
                      const created = createPlaylist(newPlaylistName);
                      addTrackToPlaylist(created.id, actionTrack);
                      close();
                    }}
                    style={[styles.createBtn, { backgroundColor: palette.accent }]}
                  >
                    <Text style={{ color: palette.onAccent, fontWeight: '700', fontSize: 13 }}>
                      {vi ? 'Tạo & Lưu' : 'Create'}
                    </Text>
                  </Pressable>
                </View>

                <ScrollView style={{ maxHeight: 220 }}>
                  {playlists.map((pl) => (
                    <Pressable
                      key={pl.id}
                      onPress={() => {
                        addTrackToPlaylist(pl.id, actionTrack);
                        close();
                      }}
                      style={styles.menuItem}
                    >
                      <Ionicons name="musical-notes" size={20} color={palette.accent} />
                      <Text style={styles.menuLabel}>
                        {pl.name} ({pl.tracks.length})
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    addToQueue(actionTrack, true);
                    close();
                  }}
                >
                  <Ionicons name="play-forward-outline" size={21} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>
                    {vi ? 'Phát kế tiếp (Play Next)' : 'Play Next'}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    addToQueue(actionTrack, false);
                    close();
                  }}
                >
                  <Ionicons name="list-outline" size={21} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>
                    {vi ? 'Thêm vào cuối hàng chờ' : 'Add to Queue'}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    toggleLike(actionTrack);
                    close();
                  }}
                >
                  <Ionicons
                    name={liked ? 'heart-dislike-outline' : 'heart-outline'}
                    size={21}
                    color={liked ? MOCHY_COLORS.roseLike : '#FFFFFF'}
                  />
                  <Text style={styles.menuLabel}>
                    {liked
                      ? vi
                        ? 'Bỏ khỏi Bài hát đã thích'
                        : 'Remove from Liked Songs'
                      : vi
                        ? 'Thêm vào Bài hát đã thích'
                        : 'Save to Liked Songs'}
                  </Text>
                </Pressable>

                <Pressable style={styles.menuItem} onPress={() => setPickingPlaylist(true)}>
                  <Ionicons name="add-circle-outline" size={21} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>
                    {vi ? 'Thêm vào Playlist…' : 'Add to Playlist…'}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    if (isOffline) {
                      removeDownload(actionTrack.id);
                    } else {
                      downloadTrack(actionTrack);
                    }
                    close();
                  }}
                >
                  <Ionicons
                    name={isOffline ? 'trash-outline' : 'arrow-down-circle-outline'}
                    size={21}
                    color={isOffline ? '#F87171' : MOCHY_COLORS.flacEmerald}
                  />
                  <Text style={styles.menuLabel}>
                    {isOffline
                      ? vi
                        ? 'Xoá bản tải ngoại tuyến'
                        : 'Remove Offline Download'
                      : vi
                        ? 'Tải xuống nghe ngoại tuyến (Offline)'
                        : 'Download for Offline Playback'}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    const targetArtist = actionTrack.artist;
                    const targetId = actionTrack.artistId || actionTrack.artist;
                    close();
                    setIsPlayerOpen(false);
                    openCollection({ kind: 'artist', id: targetId, name: targetArtist });
                  }}
                >
                  <Ionicons name="person-outline" size={21} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>
                    {vi
                      ? `Xem nghệ sĩ: ${actionTrack.artist}`
                      : `Go to Artist: ${actionTrack.artist}`}
                  </Text>
                </Pressable>

                {actionTrack.albumId && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      const albumId = actionTrack.albumId!;
                      close();
                      setIsPlayerOpen(false);
                      openCollection({ kind: 'album', id: albumId });
                    }}
                  >
                    <Ionicons name="disc-outline" size={21} color="#FFFFFF" />
                    <Text style={styles.menuLabel}>
                      {vi
                        ? `Xem Album: ${actionTrack.album || ''}`
                        : `Go to Album: ${actionTrack.album || ''}`}
                    </Text>
                  </Pressable>
                )}

                {/* Share (OpenSpot) — the iOS share sheet also offers Copy */}
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    const tr = actionTrack;
                    close();
                    shareTrack(tr);
                  }}
                >
                  <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>{vi ? 'Chia sẻ bài hát' : 'Share song'}</Text>
                </Pressable>

                {/* Save the downloaded file to the Files app with a readable name (Spotube) */}
                {isOffline && Platform.OS !== 'web' && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      const id = actionTrack.id;
                      close();
                      exportDownload(id);
                    }}
                  >
                    <Ionicons name="folder-open-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.menuLabel}>
                      {vi ? 'Lưu tệp vào ứng dụng Tệp' : 'Save file to Files'}
                    </Text>
                  </Pressable>
                )}

                {/* Song radio (Musike autoplay radio seeded from one song) */}
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    const seed = `${actionTrack.artist} ${actionTrack.genre || ''}`.trim();
                    close();
                    startInstantMix(seed);
                  }}
                >
                  <Ionicons name="radio-outline" size={21} color="#FFFFFF" />
                  <Text style={styles.menuLabel}>
                    {vi ? 'Radio từ bài này' : 'Start song radio'}
                  </Text>
                </Pressable>

                {/* Blacklist (Spotube) */}
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    blockTrack(actionTrack);
                    close();
                  }}
                >
                  <Ionicons name="remove-circle-outline" size={21} color="#F87171" />
                  <Text style={styles.menuLabel}>{vi ? 'Chặn bài này' : 'Block this song'}</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    blockArtist(actionTrack.artist);
                    close();
                  }}
                >
                  <Ionicons name="ban-outline" size={21} color="#F87171" />
                  <Text style={styles.menuLabel}>
                    {vi
                      ? `Chặn nghệ sĩ ${actionTrack.artist.split(',')[0]}`
                      : `Block ${actionTrack.artist.split(',')[0]}`}
                  </Text>
                </Pressable>
              </ScrollView>
            )}

            <Pressable style={styles.cancelBtn} onPress={close}>
              <Text style={styles.cancelText}>{vi ? 'Đóng' : 'Close'}</Text>
            </Pressable>
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheetOuter: {
    paddingHorizontal: 10,
    paddingBottom: 18,
  },
  sheet: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  art: {
    width: 54,
    height: 54,
    borderRadius: 12,
    marginRight: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  artist: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 6,
    gap: 14,
  },
  menuLabel: {
    color: '#F4F4F8',
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  playlistPicker: {
    paddingVertical: 8,
  },
  newPlRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
  },
  createBtn: {
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cancelText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});
