// Multi-Source Search & Explore Hub (InnerTube · Monochrome FLAC · JioSaavn 320k · Apple Catalog)

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { t } from '../../constants/i18n';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { MOOD_CATEGORIES } from '../../data/curatedCatalog';
import { AlbumSummary, MusicSourceId, Track } from '../../types/music';
import { TrackRow } from '../TrackRow';

const SOURCE_FILTERS: { id: 'all' | MusicSourceId; label: string }[] = [
  { id: 'all', label: 'All Sources' },
  { id: 'jiosaavn', label: 'JioSaavn 320k' },
  { id: 'monochrome', label: 'Monochrome FLAC' },
  { id: 'innertube', label: 'InnerTube YT' },
  { id: 'itunes', label: 'Apple Catalog' },
];

const FEATURED_ARTISTS = [
  { name: 'tlinh', tag: 'V-Pop / R&B' },
  { name: 'Sơn Tùng M-TP', tag: 'V-Pop Icon' },
  { name: 'Vũ.', tag: 'Vietnam Indie' },
  { name: 'HIEUTHUHAI', tag: 'Hip-Hop / Pop' },
  { name: 'The Weeknd', tag: 'Synth / R&B' },
  { name: 'YOASOBI', tag: 'J-Pop' },
  { name: 'NewJeans', tag: 'K-Pop' },
  { name: 'Daft Punk', tag: 'Electronic' },
];

export const SearchScreen: React.FC = () => {
  const {
    prefs,
    palette,
    searchTracks,
    searchHistory,
    addSearchHistory,
    clearSearchHistory,
    featuredAlbums,
    openCollection,
  } = useMochy();

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSourceId>('all');
  const [results, setResults] = useState<Track[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setAlbumResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await searchTracks(trimmed, sourceFilter);
      setResults(res.tracks);
      setAlbumResults(res.albums);
      setLoading(false);
    }, 320);

    return () => clearTimeout(timer);
  }, [query, searchTracks, sourceFilter]);

  const submitQuery = (q: string) => {
    setQuery(q);
    addSearchHistory(q);
  };

  return (
    <View style={styles.container}>
      {/* Sticky Search Input */}
      <View style={styles.searchHeader}>
        <Text style={[styles.pageTitle, { fontFamily }]}>
          {t(prefs.language, 'search')}
        </Text>

        <View style={[styles.searchBox, { borderColor: palette.accent + '35' }]}>
          <Ionicons name="search" size={19} color={MOCHY_COLORS.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => addSearchHistory(query)}
            placeholder={t(prefs.language, 'searchPlaceholder')}
            placeholderTextColor={MOCHY_COLORS.textMuted}
            returnKeyType="search"
            style={[styles.searchInput, { fontFamily }]}
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={19} color={MOCHY_COLORS.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Source Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPillsRow}
        >
          {SOURCE_FILTERS.map((f) => {
            const active = sourceFilter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setSourceFilter(f.id)}
                style={[
                  styles.filterPill,
                  active && {
                    backgroundColor: palette.accent,
                    borderColor: palette.accent,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: active ? palette.onAccent : '#E4E4EC' },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {query.trim().length > 0 ? (
          <>
            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={palette.accent} />
                <Text style={styles.loadingText}>
                  {vi ? 'Đang tìm trên các module nguồn nhạc…' : 'Searching enabled modules…'}
                </Text>
              </View>
            )}

            {albumResults.length > 0 && (
              <>
                <Text style={[styles.subHeading, { fontFamily }]}>Albums</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12, marginBottom: 14 }}
                >
                  {albumResults.map((alb) => (
                    <Pressable
                      key={alb.id}
                      onPress={() =>
                        openCollection({ kind: 'album', id: alb.id, summary: alb })
                      }
                      style={styles.albumCard}
                    >
                      <Image source={{ uri: alb.artworkUrl }} style={styles.albumArt} />
                      <Text numberOfLines={1} style={styles.albumTitle}>
                        {alb.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.albumArtist}>
                        {alb.artist}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={[styles.subHeading, { fontFamily }]}>
              {vi ? `Kết quả bài hát (${results.length})` : `Songs (${results.length})`}
            </Text>

            {results.map((song) => (
              <TrackRow key={song.id} track={song} queueContext={results} />
            ))}

            {!loading && results.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="musical-notes" size={36} color={MOCHY_COLORS.textMuted} />
                <Text style={styles.emptyText}>
                  {vi
                    ? 'Không tìm thấy kết quả trên nguồn đã chọn. Hãy thử "All Sources"!'
                    : 'No results on this source filter. Try switching to All Sources!'}
                </Text>
              </View>
            )}
          </>
        ) : (
          /* Explore Hub when query is empty */
          <>
            {searchHistory.length > 0 && (
              <View style={styles.historyBlock}>
                <View style={styles.historyTop}>
                  <Text style={[styles.subHeading, { marginHorizontal: 0, fontFamily }]}>
                    {vi ? 'Tìm kiếm gần đây' : 'Recent Searches'}
                  </Text>
                  <Pressable onPress={clearSearchHistory}>
                    <Text style={{ color: MOCHY_COLORS.textMuted, fontSize: 12.5 }}>
                      {vi ? 'Xoá' : 'Clear'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.historyChips}>
                  {searchHistory.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => submitQuery(item)}
                      style={styles.historyChip}
                    >
                      <Ionicons name="time-outline" size={14} color={MOCHY_COLORS.textSecondary} />
                      <Text style={styles.historyChipText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Top Artists Quick Access */}
            <Text style={[styles.subHeading, { fontFamily }]}>
              {t(prefs.language, 'topArtists')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12, marginBottom: 18 }}
            >
              {FEATURED_ARTISTS.map((art) => (
                <Pressable
                  key={art.name}
                  onPress={() =>
                    openCollection({ kind: 'artist', id: art.name, name: art.name })
                  }
                  style={styles.artistPillCard}
                >
                  <View style={[styles.artistInitialCircle, { backgroundColor: palette.container }]}>
                    <Text style={[styles.artistInitial, { color: palette.accent }]}>
                      {art.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={styles.artistName}>
                    {art.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.artistTag}>
                    {art.tag}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Moods & Genres Bento Grid */}
            <Text style={[styles.subHeading, { fontFamily }]}>
              {t(prefs.language, 'moodsAndGenres')}
            </Text>
            <View style={styles.genreGrid}>
              {MOOD_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.id}
                  onPress={() => submitQuery(cat.query)}
                  style={styles.genreCell}
                >
                  <LinearGradient
                    colors={cat.colors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.genreGradient}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={22}
                      color="rgba(255,255,255,0.85)"
                    />
                    <Text style={[styles.genreTitle, { fontFamily }]}>
                      {vi ? cat.labelVi : cat.labelEn}
                    </Text>
                  </LinearGradient>
                </Pressable>
              ))}
            </View>

            {featuredAlbums.length > 0 && (
              <>
                <Text style={[styles.subHeading, { fontFamily, marginTop: 18 }]}>
                  {t(prefs.language, 'featuredAlbums')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                >
                  {featuredAlbums.map((alb) => (
                    <Pressable
                      key={alb.id}
                      onPress={() =>
                        openCollection({ kind: 'album', id: alb.id, summary: alb })
                      }
                      style={styles.albumCard}
                    >
                      <Image source={{ uri: alb.artworkUrl }} style={styles.albumArt} />
                      <Text numberOfLines={1} style={styles.albumTitle}>
                        {alb.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.albumArtist}>
                        {alb.artist}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  pageTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 16,
    backgroundColor: MOCHY_COLORS.surfaceCard,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  filterPillsRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 175,
    paddingTop: 6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loadingText: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 13,
  },
  subHeading: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 10,
  },
  historyBlock: {
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  historyChipText: {
    color: '#F4F4F8',
    fontSize: 13,
    fontWeight: '600',
  },
  artistPillCard: {
    width: 112,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  artistInitialCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  artistInitial: {
    fontSize: 22,
    fontWeight: '900',
  },
  artistName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  artistTag: {
    color: MOCHY_COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  genreCell: {
    width: '50%',
    padding: 6,
  },
  genreGradient: {
    height: 86,
    borderRadius: 18,
    padding: 14,
    justifyContent: 'space-between',
  },
  genreTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  albumCard: {
    width: 132,
  },
  albumArt: {
    width: 132,
    height: 132,
    borderRadius: 16,
    backgroundColor: '#1B1B24',
    marginBottom: 6,
  },
  albumTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  albumArtist: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyText: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
