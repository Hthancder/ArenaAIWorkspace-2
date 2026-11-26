// iOS Action Sheet for Track Context Menu (Play Next, Queue, Add to Playlist, Offline, Artist/Album, Share, Save to Files, Radio, Block)

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
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
import { HOLYSIC_COLORS } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { GlassSurface } from './GlassSurface';
import { isLocalTrack, LocalLibrary, localDirOf } from '../services/local/localLibrary';
import { openSongEditor } from './local/SongInfoEditor';
import { T as UI, themedSheet } from '../theme/ui';
import { Tap } from './ui/Tap';

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
  } = useHolySic();

  const [pickingPlaylist, setPickingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  // Keep the last track while the sheet fades out, so iOS can finish dismissing (onDismiss)
  const [lastTrack, setLastTrack] = useState(actionTrack);
  useEffect(() => {
    if (actionTrack) setLastTrack(actionTrack);
  }, [actionTrack]);

  // Actions that present something else (share sheet, Files, another screen) must wait until
  // this sheet is fully dismissed — iOS ignores a presentation while another one is animating.
  const pendingRef = useRef<(() => void) | null>(null);
  const runPending = () => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  };

  // the sheet rises from the bottom on a native spring while the dimmer fades (UIKit sheet)
  const rise = useRef(new Animated.Value(1)).current;
  const open = Boolean(actionTrack);
  useEffect(() => {
    if (!open) return;
    rise.setValue(1);
    Animated.spring(rise, {
      toValue: 0,
      useNativeDriver: true,
      speed: 15,
      bounciness: 5,
    }).start();
  }, [open, rise]);
  const riseY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, 140] });

  const shown = actionTrack || lastTrack;
  if (!shown) return null;
  const sheetTrack = shown;
  const vi = prefs.language === 'vi';
  const liked = isLiked(sheetTrack.id);
  const isOffline = Boolean(downloads[sheetTrack.id]);

  const close = () => {
    setPickingPlaylist(false);
    setNewPlaylistName('');
    setActionTrack(null);
  };
  const closeThen = (fn: () => void) => {
    pendingRef.current = fn;
    close();
    // onDismiss is iOS-only; elsewhere (and as a safety net) run shortly after
    setTimeout(runPending, Platform.OS === 'ios' ? 650 : 0);
  };

  return (
    <Modal
      visible={Boolean(actionTrack)}
      transparent
      animationType="fade"
      onRequestClose={close}
      onDismiss={runPending}
    >
      {/* lifts the sheet above the keyboard when naming a new playlist */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Animated.View style={{ transform: [{ translateY: riseY }] }}>
            <Tap feedback="none" style={styles.sheetOuter} onPress={(e) => e.stopPropagation?.()}>
              <GlassSurface
                intensity={75}
                tintColor={UI.shade(18, 18, 26, 0.9)}
                style={styles.sheet}
              >
                <View style={styles.handle} />

                {/* Header */}
                <View style={styles.header}>
                  <ArtworkImage
                    source={{ uri: sheetTrack.artworkUrl }}
                    fallbackSeed={sheetTrack.title}
                    style={styles.art}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.title}>
                      {sheetTrack.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.artist}>
                      {sheetTrack.artist}
                      {sheetTrack.album ? ` · ${sheetTrack.album}` : ''}
                    </Text>
                    <Text style={[styles.badge, { color: palette.accent }]}>
                      {sheetTrack.qualityBadge || sheetTrack.source.toUpperCase()}
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
                        placeholderTextColor={UI.text3}
                        style={styles.input}
                      />
                      <Tap
                        onPress={() => {
                          if (!newPlaylistName.trim()) return;
                          const created = createPlaylist(newPlaylistName);
                          addTrackToPlaylist(created.id, sheetTrack);
                          close();
                        }}
                        style={[styles.createBtn, { backgroundColor: palette.accent }]}
                      >
                        <Text style={{ color: palette.onAccent, fontWeight: '700', fontSize: 13 }}>
                          {vi ? 'Tạo & Lưu' : 'Create'}
                        </Text>
                      </Tap>
                    </View>

                    <ScrollView style={{ maxHeight: 220 }}>
                      {playlists.map((pl) => (
                        <Tap
                          key={pl.id}
                          onPress={() => {
                            addTrackToPlaylist(pl.id, sheetTrack);
                            close();
                          }}
                          style={styles.menuItem}
                        >
                          <Ionicons name="musical-notes" size={20} color={palette.accent} />
                          <Text style={styles.menuLabel}>
                            {pl.name} ({pl.tracks.length})
                          </Text>
                        </Tap>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        addToQueue(sheetTrack, true);
                        close();
                      }}
                    >
                      <Ionicons name="play-forward-outline" size={21} color={UI.text} />
                      <Text style={styles.menuLabel}>
                        {vi ? 'Phát kế tiếp (Play Next)' : 'Play Next'}
                      </Text>
                    </Tap>

                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        addToQueue(sheetTrack, false);
                        close();
                      }}
                    >
                      <Ionicons name="list-outline" size={21} color={UI.text} />
                      <Text style={styles.menuLabel}>
                        {vi ? 'Thêm vào cuối hàng chờ' : 'Add to Queue'}
                      </Text>
                    </Tap>

                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        toggleLike(sheetTrack);
                        close();
                      }}
                    >
                      <Ionicons
                        name={liked ? 'heart-dislike-outline' : 'heart-outline'}
                        size={21}
                        color={liked ? HOLYSIC_COLORS.roseLike : UI.fg(1)}
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
                    </Tap>

                    <Tap style={styles.menuItem} onPress={() => setPickingPlaylist(true)}>
                      <Ionicons name="add-circle-outline" size={21} color={UI.text} />
                      <Text style={styles.menuLabel}>
                        {vi ? 'Thêm vào Playlist…' : 'Add to Playlist…'}
                      </Text>
                    </Tap>

                    {isLocalTrack(sheetTrack) && (
                      <Tap
                        style={styles.menuItem}
                        onPress={() => closeThen(() => openSongEditor(sheetTrack))}
                      >
                        <Ionicons name="create-outline" size={21} color="#A78BFA" />
                        <Text style={styles.menuLabel}>
                          {vi ? 'Sửa thông tin & ảnh bìa…' : 'Edit info & cover…'}
                        </Text>
                      </Tap>
                    )}

                    {isLocalTrack(sheetTrack) ? (
                      <Tap
                        style={styles.menuItem}
                        onPress={() => {
                          const dir = localDirOf(sheetTrack);
                          closeThen(() => {
                            setIsPlayerOpen(false);
                            LocalLibrary.open(dir);
                          });
                        }}
                      >
                        <Ionicons name="folder-open-outline" size={21} color="#F472B6" />
                        <Text style={styles.menuLabel}>
                          {vi
                            ? `Hiện trong thư mục: ${localDirOf(sheetTrack) || 'HolySic'}`
                            : `Show in folder: ${localDirOf(sheetTrack) || 'HolySic'}`}
                        </Text>
                      </Tap>
                    ) : (
                      <Tap
                        style={styles.menuItem}
                        onPress={() => {
                          if (isOffline) {
                            removeDownload(sheetTrack.id);
                          } else {
                            downloadTrack(sheetTrack);
                          }
                          close();
                        }}
                      >
                        <Ionicons
                          name={isOffline ? 'trash-outline' : 'arrow-down-circle-outline'}
                          size={21}
                          color={isOffline ? '#F87171' : HOLYSIC_COLORS.flacEmerald}
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
                      </Tap>
                    )}

                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        const targetArtist = sheetTrack.artist;
                        const targetId = sheetTrack.artistId || sheetTrack.artist;
                        // opens on top of whatever is showing (player included); closing it returns there
                        closeThen(() =>
                          openCollection({ kind: 'artist', id: targetId, name: targetArtist })
                        );
                      }}
                    >
                      <Ionicons name="person-outline" size={21} color={UI.text} />
                      <Text style={styles.menuLabel}>
                        {vi
                          ? `Xem nghệ sĩ: ${sheetTrack.artist}`
                          : `Go to Artist: ${sheetTrack.artist}`}
                      </Text>
                    </Tap>

                    {sheetTrack.albumId && (
                      <Tap
                        style={styles.menuItem}
                        onPress={() => {
                          const albumId = sheetTrack.albumId!;
                          closeThen(() => openCollection({ kind: 'album', id: albumId }));
                        }}
                      >
                        <Ionicons name="disc-outline" size={21} color={UI.text} />
                        <Text style={styles.menuLabel}>
                          {vi
                            ? `Xem Album: ${sheetTrack.album || ''}`
                            : `Go to Album: ${sheetTrack.album || ''}`}
                        </Text>
                      </Tap>
                    )}

                    {/* Share (OpenSpot) — the iOS share sheet also offers Copy */}
                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        const tr = sheetTrack;
                        closeThen(() => shareTrack(tr));
                      }}
                    >
                      <Ionicons name="share-outline" size={20} color={UI.text} />
                      <Text style={styles.menuLabel}>{vi ? 'Chia sẻ bài hát' : 'Share song'}</Text>
                    </Tap>

                    {/* Save the downloaded file to the Files app with a readable name (Spotube) */}
                    {isOffline && Platform.OS !== 'web' && (
                      <Tap
                        style={styles.menuItem}
                        onPress={() => {
                          const id = sheetTrack.id;
                          closeThen(() => exportDownload(id));
                        }}
                      >
                        <Ionicons name="folder-open-outline" size={20} color={UI.text} />
                        <Text style={styles.menuLabel}>
                          {vi ? 'Lưu tệp vào ứng dụng Tệp' : 'Save file to Files'}
                        </Text>
                      </Tap>
                    )}

                    {/* Song radio (Musike autoplay radio seeded from one song) */}
                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        const seed = `${sheetTrack.artist} ${sheetTrack.genre || ''}`.trim();
                        closeThen(() => startInstantMix(seed));
                      }}
                    >
                      <Ionicons name="radio-outline" size={21} color={UI.text} />
                      <Text style={styles.menuLabel}>
                        {vi ? 'Radio từ bài này' : 'Start song radio'}
                      </Text>
                    </Tap>

                    {/* Blacklist (Spotube) */}
                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        blockTrack(sheetTrack);
                        close();
                      }}
                    >
                      <Ionicons name="remove-circle-outline" size={21} color="#F87171" />
                      <Text style={styles.menuLabel}>
                        {vi ? 'Chặn bài này' : 'Block this song'}
                      </Text>
                    </Tap>
                    <Tap
                      style={styles.menuItem}
                      onPress={() => {
                        blockArtist(sheetTrack.artist);
                        close();
                      }}
                    >
                      <Ionicons name="ban-outline" size={21} color="#F87171" />
                      <Text style={styles.menuLabel}>
                        {vi
                          ? `Chặn nghệ sĩ ${sheetTrack.artist.split(',')[0]}`
                          : `Block ${sheetTrack.artist.split(',')[0]}`}
                      </Text>
                    </Tap>
                  </ScrollView>
                )}

                <Tap style={styles.cancelBtn} onPress={close}>
                  <Text style={styles.cancelText}>{vi ? 'Đóng' : 'Close'}</Text>
                </Tap>
              </GlassSurface>
            </Tap>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = themedSheet(() => ({
  backdrop: {
    flex: 1,
    backgroundColor: UI.shade(0, 0, 0, 0.62),
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
    backgroundColor: UI.fg(0.25),
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.12),
    marginBottom: 8,
  },
  art: {
    width: 54,
    height: 54,
    borderRadius: 12,
    marginRight: 12,
  },
  title: {
    color: UI.text,
    fontSize: 16,
    fontWeight: '700',
  },
  artist: {
    color: UI.text2,
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
    color: UI.text,
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
    backgroundColor: UI.fg(0.08),
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: UI.text,
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
    backgroundColor: UI.fg(0.08),
    alignItems: 'center',
  },
  cancelText: {
    color: UI.text,
    fontWeight: '600',
    fontSize: 15,
  },
}));
