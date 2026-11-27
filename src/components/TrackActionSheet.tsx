// iOS Action Sheet for Track Context Menu (Play Next, Queue, Add to Playlist, Offline, Artist/Album, Share, Save to Files, Radio, Block)

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { ArtworkImage } from './ArtworkImage';
import { HOLYSIC_COLORS } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { GlassSurface } from './GlassSurface';
import { isLocalTrack, LocalLibrary, localDirOf } from '../services/local/localLibrary';
import { openSongEditor } from './local/SongInfoEditor';
import { openLyricsEditor } from './player/LyricsEditor';
import { T as UI, themedSheet } from '../theme/ui';
import { Tap } from './ui/Tap';
import { useDownloadRequest } from './download/DownloadOptionsSheet';
import { openTagSheet, tagNames } from './tags/TagSheet';
import { TagStore, useTags } from '../services/library/tags';
import { MvCache, useMvCache } from '../services/video/mvCache';

/** set before opening the sheet to land straight on the playlist picker (native menu → "New…") */
export const sheetIntent = { pickPlaylist: false };

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

  const requestDownload = useDownloadRequest();
  useTags();
  useMvCache();
  const [pickingPlaylist, setPickingPlaylist] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const { height: winH } = useWindowDimensions();
  const [newPlaylistName, setNewPlaylistName] = useState('');

  // Keep the last track while the sheet fades out, so iOS can finish dismissing (onDismiss)
  const [lastTrack, setLastTrack] = useState(actionTrack);
  useEffect(() => {
    if (actionTrack) {
      setLastTrack(actionTrack);
      setBlockOpen(false);
    }
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
  // pull the sheet down to dismiss it (UISheetPresentationController): follows the finger,
  // flings away past a threshold or a fast flick, otherwise springs back into place
  const dragY = useRef(new Animated.Value(0)).current;
  const dragRef = useRef({ close: () => {}, enabled: true });
  const listTopRef = useRef(true);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        dragRef.current.enabled && listTopRef.current && g.dy > 8 && g.dy > Math.abs(g.dx) * 1.4,
      onPanResponderMove: (_e, g) => dragY.setValue(g.dy > 0 ? g.dy : g.dy / 5),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.9) {
          Animated.timing(dragY, {
            toValue: 700,
            duration: 200,
            useNativeDriver: true,
          }).start(() => dragRef.current.close());
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            speed: 18,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    })
  ).current;
  useEffect(() => {
    if (!open) return;
    if (sheetIntent.pickPlaylist) {
      sheetIntent.pickPlaylist = false;
      setPickingPlaylist(true);
    }
    dragY.setValue(0);
    listTopRef.current = true;
    rise.setValue(1);
    Animated.spring(rise, {
      toValue: 0,
      useNativeDriver: true,
      speed: 15,
      bounciness: 5,
    }).start();
  }, [open, rise, dragY]);
  const riseY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, 140] });

  const shown = actionTrack || lastTrack;
  if (!shown) return null;
  const sheetTrack = shown;
  const vi = prefs.language === 'vi';
  const liked = isLiked(sheetTrack.id);
  const isOffline = Boolean(downloads[sheetTrack.id]);
  // what this download brought along (chosen when it was downloaded)
  const dl = downloads[sheetTrack.id];
  const offlineExtras = dl
    ? [
        dl.withLyrics !== false ? (vi ? 'kèm lời' : 'with lyrics') : '',
        MvCache.byTrack(sheetTrack.id)
          ? 'MV'
          : MvCache.isSaving(sheetTrack.id)
            ? vi
              ? 'đang lưu MV'
              : 'saving video'
            : '',
      ]
        .filter(Boolean)
        .join(' · ') || (vi ? 'chỉ nhạc' : 'audio only')
    : undefined;

  const close = () => {
    setPickingPlaylist(false);
    setNewPlaylistName('');
    setActionTrack(null);
  };
  dragRef.current = { close, enabled: !pickingPlaylist };
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
          <Animated.View
            style={{ transform: [{ translateY: Animated.add(riseY, dragY) }] }}
            {...pan.panHandlers}
          >
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
                  <ScrollView
                    style={{ maxHeight: Math.min(440, winH * 0.56) }}
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={32}
                    onScroll={(e) => (listTopRef.current = e.nativeEvent.contentOffset.y <= 0)}
                  >
                    {/* the everyday four as tiles: one tap, no reading a long list */}
                    <View style={styles.quickRow}>
                      <QuickTile
                        icon="play-forward"
                        label={vi ? 'Phát kế tiếp' : 'Play Next'}
                        onPress={() => {
                          addToQueue(sheetTrack, true);
                          close();
                        }}
                      />
                      <QuickTile
                        icon="list"
                        label={vi ? 'Cuối hàng chờ' : 'Play Last'}
                        onPress={() => {
                          addToQueue(sheetTrack, false);
                          close();
                        }}
                      />
                      <QuickTile
                        icon={liked ? 'heart' : 'heart-outline'}
                        tint={liked ? HOLYSIC_COLORS.roseLike : undefined}
                        label={liked ? (vi ? 'Đã thích' : 'Loved') : vi ? 'Thích' : 'Love'}
                        onPress={() => {
                          toggleLike(sheetTrack);
                          close();
                        }}
                      />
                      <QuickTile
                        icon="add-circle-outline"
                        label="Playlist"
                        onPress={() => setPickingPlaylist(true)}
                      />
                    </View>

                    {/* this song: lyrics, file, download */}
                    <View style={styles.group}>
                      {!sheetTrack.isLive && (
                        <SheetRow
                          icon="chatbox-ellipses-outline"
                          tint="#60A5FA"
                          label={vi ? 'Lời bài hát…' : 'Lyrics…'}
                          hint={vi ? 'Chọn, sửa, lưu offline' : 'Choose, edit, keep offline'}
                          onPress={() => closeThen(() => openLyricsEditor(sheetTrack))}
                        />
                      )}
                      <SheetRow
                        icon="pricetag-outline"
                        tint="#FBBF24"
                        label={vi ? 'Gắn thẻ…' : 'Tags…'}
                        hint={
                          tagNames(TagStore.idsOfTrack(sheetTrack.id)) ||
                          (vi ? 'Thêm, sửa, xoá thẻ' : 'Add, edit, remove tags')
                        }
                        onPress={() => {
                          const tr = sheetTrack;
                          closeThen(() => openTagSheet({ kind: 'tracks', tracks: [tr] }));
                        }}
                      />
                      {isLocalTrack(sheetTrack) && (
                        <SheetRow
                          icon="create-outline"
                          tint="#A78BFA"
                          label={vi ? 'Sửa thông tin & ảnh bìa…' : 'Edit info & cover…'}
                          onPress={() => closeThen(() => openSongEditor(sheetTrack))}
                        />
                      )}
                      {isLocalTrack(sheetTrack) ? (
                        <SheetRow
                          icon="folder-open-outline"
                          tint="#F472B6"
                          label={vi ? 'Hiện trong thư mục' : 'Show in folder'}
                          hint={localDirOf(sheetTrack) || 'HolySic'}
                          onPress={() => {
                            const dir = localDirOf(sheetTrack);
                            closeThen(() => {
                              setIsPlayerOpen(false);
                              LocalLibrary.open(dir);
                            });
                          }}
                        />
                      ) : (
                        <SheetRow
                          icon={isOffline ? 'trash-outline' : 'arrow-down-circle-outline'}
                          tint={isOffline ? '#F87171' : HOLYSIC_COLORS.flacEmerald}
                          label={
                            isOffline
                              ? vi
                                ? 'Xoá bản tải'
                                : 'Remove download'
                              : vi
                                ? 'Tải xuống để nghe offline'
                                : 'Download for offline'
                          }
                          hint={isOffline ? offlineExtras : undefined}
                          onPress={() => {
                            if (isOffline) {
                              removeDownload(sheetTrack.id);
                              close();
                            } else {
                              const tr = sheetTrack;
                              closeThen(() => requestDownload([tr]));
                            }
                          }}
                        />
                      )}
                      {/* Save the downloaded file to the Files app with a readable name */}
                      {isOffline && Platform.OS !== 'web' && (
                        <SheetRow
                          icon="document-outline"
                          label={vi ? 'Lưu tệp vào ứng dụng Tệp' : 'Save file to Files'}
                          onPress={() => {
                            const id = sheetTrack.id;
                            closeThen(() => exportDownload(id));
                          }}
                        />
                      )}
                    </View>

                    {/* go somewhere */}
                    <View style={styles.group}>
                      <SheetRow
                        icon="person-outline"
                        label={vi ? 'Xem nghệ sĩ' : 'Go to Artist'}
                        hint={sheetTrack.artist}
                        onPress={() => {
                          const targetArtist = sheetTrack.artist;
                          const targetId = sheetTrack.artistId || sheetTrack.artist;
                          // opens on top of whatever is showing (player included)
                          closeThen(() =>
                            openCollection({ kind: 'artist', id: targetId, name: targetArtist })
                          );
                        }}
                      />
                      {sheetTrack.albumId && (
                        <SheetRow
                          icon="disc-outline"
                          label={vi ? 'Xem album' : 'Go to Album'}
                          hint={sheetTrack.album || undefined}
                          onPress={() => {
                            const albumId = sheetTrack.albumId!;
                            closeThen(() => openCollection({ kind: 'album', id: albumId }));
                          }}
                        />
                      )}
                      <SheetRow
                        icon="radio-outline"
                        label={vi ? 'Radio từ bài này' : 'Start song radio'}
                        onPress={() => {
                          const seed = `${sheetTrack.artist} ${sheetTrack.genre || ''}`.trim();
                          closeThen(() => startInstantMix(seed));
                        }}
                      />
                      <SheetRow
                        icon="share-outline"
                        label={vi ? 'Chia sẻ bài hát' : 'Share song'}
                        onPress={() => {
                          const tr = sheetTrack;
                          closeThen(() => shareTrack(tr));
                        }}
                      />
                    </View>

                    {/* rarely needed: tucked behind one row */}
                    <View style={styles.group}>
                      <SheetRow
                        icon="remove-circle-outline"
                        tint="#F87171"
                        label={vi ? 'Không muốn nghe…' : 'Don’t play…'}
                        chevron={blockOpen ? 'chevron-up' : 'chevron-down'}
                        onPress={() => setBlockOpen((v) => !v)}
                      />
                      {blockOpen && (
                        <>
                          <SheetRow
                            indent
                            label={vi ? 'Chặn bài này' : 'Block this song'}
                            onPress={() => {
                              blockTrack(sheetTrack);
                              close();
                            }}
                          />
                          <SheetRow
                            indent
                            label={
                              vi
                                ? `Chặn nghệ sĩ ${sheetTrack.artist.split(',')[0]}`
                                : `Block ${sheetTrack.artist.split(',')[0]}`
                            }
                            onPress={() => {
                              blockArtist(sheetTrack.artist);
                              close();
                            }}
                          />
                        </>
                      )}
                    </View>
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

/** one of the four quick actions on top of the sheet */
const QuickTile: React.FC<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tint?: string;
  onPress: () => void;
}> = ({ icon, label, tint, onPress }) => (
  <Tap
    style={styles.quickTile}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Ionicons name={icon} size={22} color={tint || UI.text} />
    <Text style={styles.quickLabel} numberOfLines={2}>
      {label}
    </Text>
  </Tap>
);

/** a row inside a grouped card: icon, title, optional grey detail */
const SheetRow: React.FC<{
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
  tint?: string;
  chevron?: 'chevron-up' | 'chevron-down';
  indent?: boolean;
  onPress: () => void;
}> = ({ icon, label, hint, tint, chevron, indent, onPress }) => (
  <Tap
    style={[styles.groupRow, indent && styles.groupRowIndent]}
    onPress={onPress}
    accessibilityRole="button"
  >
    {icon ? <Ionicons name={icon} size={20} color={tint || UI.text} /> : null}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.menuLabel} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.groupHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
    {chevron ? <Ionicons name={chevron} size={16} color={UI.fg(0.45)} /> : null}
  </Tap>
);

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
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  quickTile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: UI.fg(0.07),
  },
  quickLabel: {
    color: UI.text,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  group: {
    borderRadius: 14,
    backgroundColor: UI.fg(0.05),
    marginBottom: 10,
    overflow: 'hidden',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 9,
    paddingHorizontal: 14,
    gap: 14,
  },
  groupRowIndent: {
    paddingLeft: 48,
    minHeight: 44,
  },
  groupHint: {
    color: UI.fg(0.5),
    fontSize: 12.5,
    marginTop: 1,
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
