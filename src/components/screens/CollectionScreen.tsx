// Dedicated Album / Artist / Playlist / Liked / Offline Detail View

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ArtistBioCard } from '../ArtistBioCard';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { T as UI, themedSheet } from '../../theme/ui';

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
    downloadTrack,
    downloadingIds,
    searchTracks,
    showToast,
    createPlaylist,
  } = useHolySic();
  useModalLayer('collection', Boolean(collectionTarget));

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
      loadAlbumFull(collectionTarget.id).then((res) => {
        if (!cancelled) {
          if (res) setAlbumData(res);
          setLoading(false);
        }
      });
    } else if (collectionTarget.kind === 'artist') {
      setLoading(true);
      loadArtistFull(collectionTarget.id || collectionTarget.name).then((res) => {
        if (!cancelled) {
          setArtistData(res);
          setLoading(false);
        }
      });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [collectionTarget, loadAlbumFull, loadArtistFull]);

  if (!collectionTarget) return null;
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  let title = '';
  let subtitle = '';
  let artworkUrl = '';
  let tracks: Track[] = [];
  let removablePlaylistId: string | null = null;

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
    artworkUrl = pl?.coverUrl || pl?.tracks[0]?.artworkUrl || '';
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
  }

  const headerPalette = buildArtworkPalette(title);
  const allTracks = tracks;
  const canFilter = collectionTarget.kind !== 'album' && allTracks.length >= 6;
  if (canFilter && (filterQ.trim() || sortBy !== 'default')) {
    const q = filterQ.trim().toLowerCase();
    let list = q
      ? allTracks.filter((x) => `${x.title} ${x.artist} ${x.album || ''}`.toLowerCase().includes(q))
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
    collectionTarget.kind === 'liked';
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

  return (
    <Modal
      visible={Boolean(collectionTarget)}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => openCollection(null)}
    >
      <View
        style={[
          styles.root,
          { backgroundColor: prefs.pureBlack ? UI.surface('#000') : UI.surface('#0A0A0F') },
        ]}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={[headerPalette.gradient[0], UI.surface('#0A0A0F')]}
            style={[styles.hero, { paddingTop: Math.max(insets.top, 16) }]}
          >
            <View style={styles.navBar}>
              <Pressable onPress={() => openCollection(null)} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={UI.text} />
              </Pressable>

              <View style={{ flex: 1 }} />
              {tracks.length > 0 && (
                <Pressable
                  onPress={() => {
                    setSelecting((v) => !v);
                    setSelected({});
                    setPickPlaylist(false);
                  }}
                  style={[styles.backBtn, { marginRight: removablePlaylistId ? 8 : 0 }]}
                >
                  <Ionicons
                    name={selecting ? 'close' : 'checkmark-done-outline'}
                    size={19}
                    color={UI.text}
                  />
                </Pressable>
              )}
              {removablePlaylistId && (
                <Pressable
                  onPress={() => {
                    deletePlaylist(removablePlaylistId!);
                    openCollection(null);
                  }}
                  style={styles.backBtn}
                >
                  <Ionicons name="trash-outline" size={19} color="#F87171" />
                </Pressable>
              )}
            </View>

            <View style={styles.heroContent}>
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

              <Text style={[styles.heroTitle, { fontFamily }]}>{title}</Text>
              <Text style={styles.heroSub}>{subtitle}</Text>

              {tracks.length > 0 && (
                <View style={styles.heroBtns}>
                  <Pressable
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
                  </Pressable>

                  <Pressable
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
                  </Pressable>
                </View>
              )}
              {tracks.length > 0 && (
                <View style={[styles.heroBtns, { marginTop: 10 }]}>
                  {canSaveAsPlaylist && (
                    <Pressable
                      onPress={() => {
                        const pl = savePlaylistFromTracks(title, tracks, subtitle, artworkUrl);
                        showToast(
                          vi
                            ? `Đã lưu thành playlist "${pl.name}"`
                            : `Saved as playlist "${pl.name}"`
                        );
                      }}
                      style={styles.chipBtn}
                    >
                      <Ionicons name="bookmark-outline" size={15} color={UI.text} />
                      <Text style={styles.chipText}>
                        {vi ? 'Lưu playlist' : 'Save as playlist'}
                      </Text>
                    </Pressable>
                  )}
                  {collectionTarget.kind !== 'offline' && (
                    <Pressable
                      onPress={() => {
                        tracks.slice(0, 50).forEach((x) => downloadTrack(x));
                        showToast(
                          vi
                            ? `Đang tải ${Math.min(50, tracks.length)} bài…`
                            : `Downloading ${Math.min(50, tracks.length)} songs…`
                        );
                      }}
                      style={styles.chipBtn}
                    >
                      <Ionicons name="arrow-down-circle-outline" size={15} color={UI.text} />
                      <Text style={styles.chipText}>
                        {Object.keys(downloadingIds).length > 0
                          ? `${Object.keys(downloadingIds).length}…`
                          : vi
                            ? 'Tải tất cả'
                            : 'Download all'}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
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
                  </Pressable>
                </View>
              )}
            </View>
          </LinearGradient>

          {loading && (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator size="large" color={headerPalette.accent} />
            </View>
          )}

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
                  <Pressable hitSlop={8} onPress={() => setFilterQ('')}>
                    <Ionicons name="close-circle" size={16} color={UI.text3} />
                  </Pressable>
                )}
              </View>
              <Pressable
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
              </Pressable>
            </View>
          )}
          {canFilter && filterQ.trim() !== '' && tracks.length === 0 && (
            <Text style={styles.filterEmpty}>
              {vi ? 'Không có bài nào khớp bộ lọc' : 'No songs match the filter'}
            </Text>
          )}
          {selecting && (
            <View style={styles.selectBar}>
              <Pressable
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
              </Pressable>
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
              <Pressable
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
              </Pressable>
              <Pressable onPress={() => queueTracks(chosen, true)} style={styles.chipBtn}>
                <Ionicons name="play-forward-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Phát kế' : 'Play next'}</Text>
              </Pressable>
              <Pressable onPress={() => queueTracks(chosen)} style={styles.chipBtn}>
                <Ionicons name="list" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Hàng chờ' : 'Queue'}</Text>
              </Pressable>
              {collectionTarget.kind !== 'liked' && (
                <Pressable onPress={() => likeTracks(chosen)} style={styles.chipBtn}>
                  <Ionicons name="heart-outline" size={15} color={UI.text} />
                  <Text style={styles.chipText}>{vi ? 'Thích' : 'Like'}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setPickPlaylist((v) => !v)} style={styles.chipBtn}>
                <Ionicons name="add-circle-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Vào playlist' : 'To playlist'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  chosen.forEach((x) => downloadTrack(x));
                }}
                style={styles.chipBtn}
              >
                <Ionicons name="arrow-down-circle-outline" size={15} color={UI.text} />
                <Text style={styles.chipText}>{vi ? 'Tải' : 'Download'}</Text>
              </Pressable>
              {removablePlaylistId && (
                <Pressable
                  onPress={() => {
                    removeTracksFromPlaylist(
                      removablePlaylistId!,
                      chosen.map((x) => x.id)
                    );
                    setSelected({});
                  }}
                  style={styles.chipBtn}
                >
                  <Ionicons name="trash-outline" size={15} color="#F87171" />
                  <Text style={[styles.chipText, { color: '#F87171' }]}>
                    {vi ? 'Xoá' : 'Remove'}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          )}
          {selecting && pickPlaylist && chosen.length > 0 && (
            <View style={styles.plPicker}>
              <Pressable
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
              </Pressable>
              {playlists
                .filter((p) => p.id !== removablePlaylistId)
                .map((p) => (
                  <Pressable
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
                  </Pressable>
                ))}
            </View>
          )}

          <View style={{ paddingHorizontal: 6 }}>
            {selecting &&
              tracks.map((song, idx) => (
                <Pressable
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
                </Pressable>
              ))}
            {!selecting &&
              tracks.map((song, idx) => (
                <TrackRow
                  key={`${song.id}-${idx}`}
                  track={song}
                  queueContext={tracks}
                  indexBadge={idx + 1}
                  onRemove={
                    removablePlaylistId
                      ? () => removeTrackFromPlaylist(removablePlaylistId!, song.id)
                      : undefined
                  }
                />
              ))}
            {!selecting && collectionTarget.kind === 'artist' && tracks.length > 0 && (
              <Pressable onPress={loadMoreArtist} disabled={loadingMore} style={styles.loadMore}>
                {loadingMore ? (
                  <ActivityIndicator color={headerPalette.accent} />
                ) : (
                  <Text style={{ color: headerPalette.accent, fontWeight: '800' }}>
                    {vi ? 'Thêm bài của nghệ sĩ' : 'Load more songs'}
                  </Text>
                )}
              </Pressable>
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
                    <Pressable
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
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
        </ScrollView>
      </View>
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
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 22,
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
    paddingHorizontal: 14,
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
}));
