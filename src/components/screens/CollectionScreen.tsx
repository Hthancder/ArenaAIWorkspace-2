// Dedicated Album / Artist / Playlist / Liked / Offline Detail View

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../constants/i18n';
import { buildArtworkPalette, MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { AlbumSummary, ArtistSummary, Track } from '../../types/music';
import { TrackRow } from '../TrackRow';

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
  } = useMochy();

  const [loading, setLoading] = useState(false);
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
    tracks = artistData?.topTracks || [];
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

  return (
    <Modal
      visible={Boolean(collectionTarget)}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => openCollection(null)}
    >
      <View style={[styles.root, { backgroundColor: prefs.pureBlack ? '#000' : '#0A0A0F' }]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={[headerPalette.gradient[0], '#0A0A0F']}
            style={[styles.hero, { paddingTop: Math.max(insets.top, 16) }]}
          >
            <View style={styles.navBar}>
              <Pressable
                onPress={() => openCollection(null)}
                style={styles.backBtn}
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </Pressable>

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
                    <Ionicons name="shuffle" size={18} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                      {t(prefs.language, 'shuffle')}
                    </Text>
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
          <View style={{ paddingHorizontal: 6 }}>
            {tracks.map((song, idx) => (
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
          </View>

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
                      onPress={() =>
                        openCollection({ kind: 'album', id: alb.id, summary: alb })
                      }
                      style={{ width: 136 }}
                    >
                      <ArtworkImage
                        source={{ uri: alb.artworkUrl }}
                        style={{ width: 136, height: 136, borderRadius: 16, marginBottom: 6 }}
                      />
                      <Text numberOfLines={1} style={{ color: '#FFF', fontWeight: '700', fontSize: 13.5 }}>
                        {alb.title}
                      </Text>
                      {alb.year && (
                        <Text style={{ color: MOCHY_COLORS.textMuted, fontSize: 12 }}>
                          {alb.year}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(0,0,0,0.35)',
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
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 13.5,
    marginTop: 4,
    textAlign: 'center',
  },
  heroBtns: {
    flexDirection: 'row',
    gap: 12,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  discographyHeading: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginHorizontal: 18,
    marginBottom: 12,
  },
});
