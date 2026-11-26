// Multi-Source Search & Explore Hub (InnerTube · Monochrome FLAC · JioSaavn 320k · Apple Catalog)

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { t } from '../../constants/i18n';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { looksLikeLink } from '../../services/import/linkImport';
import { MOOD_CATEGORIES } from '../../data/curatedCatalog';
import { AlbumSummary, MusicSourceId, Track } from '../../types/music';
import { TrackRow } from '../TrackRow';
import { useLocalLibrary } from '../local/LocalLibraryScreen';
import { LocalLibrary } from '../../services/local/localLibrary';
import { T as UI, themedSheet } from '../../theme/ui';
import { useTabScrollToTop } from '../../services/ui/tabBus';
import { Tap } from '../ui/Tap';

const SOURCE_FILTERS: { id: 'all' | MusicSourceId; vi: string; en: string }[] = [
  { id: 'all', vi: 'Tất cả', en: 'All' },
  { id: 'innertube', vi: 'YouTube Music', en: 'YouTube Music' },
  { id: 'monochrome', vi: 'Lossless FLAC', en: 'Lossless FLAC' },
  { id: 'jiosaavn', vi: 'JioSaavn', en: 'JioSaavn' },
  { id: 'itunes', vi: 'Apple Music', en: 'Apple Music' },
  { id: 'audius', vi: 'Audius (indie)', en: 'Audius (indie)' },
  { id: 'radio', vi: 'Radio', en: 'Radio' },
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
    openMusicLink,
    openImport,
    searchSuggestions,
    haptic,
    isOnline,
  } = useHolySic();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSourceId>('all');
  const [results, setResults] = useState<Track[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const isLink = looksLikeLink(query);
  const localState = useLocalLibrary();
  // Local Files matches show instantly, above the online results
  const localHits = useMemo(
    () => (isLink || query.trim().length < 2 ? [] : LocalLibrary.search(query, 30)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, isLink, localState.files]
  );
  const localTracks = useMemo(() => localHits.map((f) => f.track), [localHits]);
  const listCount =
    !isLink && /[,;\n]/.test(query)
      ? query.split(/[,;\n]/).filter((x) => x.trim().length > 1).length
      : 0;

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  // Suggestions as you type (Musike)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || isLink || listCount > 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchSuggestions(q)
        .then((s) => {
          if (!cancelled)
            setSuggestions(s.filter((x) => x.toLowerCase() !== q.toLowerCase()).slice(0, 6));
        })
        .catch(() => {});
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isLink, listCount, searchSuggestions]);

  const runLink = async () => {
    setLinkBusy(true);
    setLinkMsg(null);
    const res = await openMusicLink(query.trim());
    setLinkBusy(false);
    if (res.kind === 'playlist') openCollection({ kind: 'playlist', playlistId: res.playlist.id });
    else if (res.kind === 'none') setLinkMsg(res.message);
    else setQuery('');
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || looksLikeLink(trimmed)) {
      setResults([]);
      setAlbumResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearchFailed(false);
    // a slower, older search must never overwrite the results of what is typed now
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchTracks(trimmed, sourceFilter);
        if (stale) return;
        setResults(res.tracks);
        setAlbumResults(res.albums);
      } catch {
        if (stale) return;
        setResults([]);
        setAlbumResults([]);
        setSearchFailed(true);
      }
      setLoading(false);
    }, 320);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, searchTracks, sourceFilter, retryTick]);

  const submitQuery = (q: string) => {
    setQuery(q);
    addSearchHistory(q);
  };

  const scrollRef = useTabScrollToTop('search');
  return (
    <View style={styles.container}>
      {/* Sticky Search Input */}
      <View style={styles.searchHeader}>
        <Text style={[styles.pageTitle, { fontFamily }]}>{t(prefs.language, 'search')}</Text>

        <View style={[styles.searchBox, { borderColor: palette.accent + '35' }]}>
          <Ionicons name="search" size={19} color={UI.text2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => addSearchHistory(query)}
            placeholder={t(prefs.language, 'searchPlaceholder')}
            placeholderTextColor={UI.text3}
            returnKeyType="search"
            style={[styles.searchInput, { fontFamily }]}
          />
          {query.length > 0 && (
            <Tap hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={19} color={UI.text3} />
            </Tap>
          )}
        </View>

        {/* Paste a link (Musike / OpenSpot) */}
        {isLink && (
          <View style={styles.linkCard}>
            <Ionicons name="link" size={20} color={palette.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: UI.text, fontWeight: '800' }}>
                {vi ? 'Liên kết nhạc' : 'Music link'}
              </Text>
              <Text
                style={{ color: linkMsg ? '#FCA5A5' : UI.text3, fontSize: 12 }}
                numberOfLines={2}
              >
                {linkMsg ||
                  (vi
                    ? 'Bài hát sẽ phát ngay; playlist/album được nhập vào Thư viện'
                    : 'Songs play now; playlists/albums are imported')}
              </Text>
            </View>
            <Tap
              onPress={runLink}
              disabled={linkBusy}
              style={[styles.linkBtn, { backgroundColor: palette.accent }]}
            >
              {linkBusy ? (
                <ActivityIndicator size="small" color={palette.onAccent} />
              ) : (
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                  {vi ? 'Mở' : 'Open'}
                </Text>
              )}
            </Tap>
          </View>
        )}

        {/* Several songs typed at once → "Search a list" */}
        {listCount > 1 && (
          <Tap onPress={() => openImport('list', query)} style={styles.linkCard}>
            <Ionicons name="list" size={20} color="#FBBF24" />
            <Text style={{ color: UI.text, fontWeight: '700', flex: 1 }}>
              {vi
                ? `Tìm từng bài trong danh sách (${listCount})`
                : `Search each song in the list (${listCount})`}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={UI.text3} />
          </Tap>
        )}

        {/* Suggestions while typing */}
        {suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {suggestions.map((s) => (
              <Tap key={s} onPress={() => submitQuery(s)} style={styles.suggestRow}>
                <Ionicons name="search-outline" size={14} color={UI.text3} />
                <Text numberOfLines={1} style={{ color: UI.fg(0.88), flex: 1, fontSize: 14 }}>
                  {s}
                </Text>
                <Tap hitSlop={8} onPress={() => setQuery(s + ' ')}>
                  <Ionicons
                    name="arrow-up-outline"
                    size={14}
                    color={UI.text3}
                    style={{ transform: [{ rotate: '-45deg' }] }}
                  />
                </Tap>
              </Tap>
            ))}
          </View>
        )}

        {/* Source Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPillsRow}
        >
          {SOURCE_FILTERS.map((f) => {
            const active = sourceFilter === f.id;
            return (
              <Tap
                key={f.id}
                onPress={() => {
                  haptic('selection');
                  setSourceFilter(f.id);
                }}
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
                    { color: active ? palette.onAccent : UI.fg(0.88) },
                  ]}
                >
                  {vi ? f.vi : f.en}
                </Text>
              </Tap>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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

            {localTracks.length > 0 && (
              <>
                <View style={styles.localHead}>
                  <Ionicons name="phone-portrait-outline" size={16} color={palette.accent} />
                  <Text style={[styles.subHeading, styles.localTitle, { fontFamily }]}>
                    {vi
                      ? `Trên máy (${localTracks.length})`
                      : `On this device (${localTracks.length})`}
                  </Text>
                  <Tap
                    onPress={() => LocalLibrary.open('')}
                    hitSlop={8}
                    accessibilityLabel={vi ? 'Mở Nhạc trên máy' : 'Open Local Files'}
                  >
                    <Text style={[styles.localMore, { color: palette.accent }]}>
                      {vi ? 'Mở thư viện' : 'Open'}
                    </Text>
                  </Tap>
                </View>
                {localTracks.slice(0, 6).map((song) => (
                  <TrackRow key={song.id} track={song} queueContext={localTracks} />
                ))}
              </>
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
                    <Tap
                      key={alb.id}
                      onPress={() => openCollection({ kind: 'album', id: alb.id, summary: alb })}
                      style={styles.albumCard}
                    >
                      <ArtworkImage source={{ uri: alb.artworkUrl }} style={styles.albumArt} />
                      <Text numberOfLines={1} style={styles.albumTitle}>
                        {alb.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.albumArtist}>
                        {alb.artist}
                      </Text>
                    </Tap>
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

            {!loading && results.length === 0 && localTracks.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons
                  name={
                    !isOnline
                      ? 'cloud-offline-outline'
                      : searchFailed
                        ? 'warning-outline'
                        : 'musical-notes'
                  }
                  size={36}
                  color={UI.text3}
                />
                <Text style={styles.emptyText}>
                  {!isOnline
                    ? vi
                      ? 'Bạn đang ngoại tuyến. Chỉ tìm được nhạc trên máy và bài đã tải về.'
                      : 'You’re offline. Only music on this device and downloads can be found.'
                    : searchFailed
                      ? vi
                        ? 'Không kết nối được tới nguồn nhạc.'
                        : 'Couldn’t reach the music sources.'
                      : sourceFilter !== 'all'
                        ? vi
                          ? 'Không tìm thấy trên nguồn này. Thử chọn "Tất cả" nhé.'
                          : 'Nothing on this source. Try "All".'
                        : vi
                          ? `Không tìm thấy kết quả cho “${query.trim()}”. Thử từ khoá ngắn hơn hoặc bỏ dấu.`
                          : `No results for “${query.trim()}”. Try fewer words.`}
                </Text>
                {(searchFailed || sourceFilter !== 'all') && isOnline && (
                  <Tap
                    onPress={() => {
                      haptic('light');
                      if (sourceFilter !== 'all') setSourceFilter('all');
                      else setRetryTick((n) => n + 1);
                    }}
                    style={[styles.emptyAction, { borderColor: palette.accent + '55' }]}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={sourceFilter !== 'all' ? 'apps-outline' : 'refresh'}
                      size={15}
                      color={palette.accent}
                    />
                    <Text style={[styles.emptyActionText, { color: palette.accent }]}>
                      {sourceFilter !== 'all'
                        ? vi
                          ? 'Tìm ở tất cả nguồn'
                          : 'Search all sources'
                        : vi
                          ? 'Thử lại'
                          : 'Try again'}
                    </Text>
                  </Tap>
                )}
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
                  <Tap onPress={clearSearchHistory}>
                    <Text style={{ color: UI.text3, fontSize: 12.5 }}>{vi ? 'Xoá' : 'Clear'}</Text>
                  </Tap>
                </View>
                <View style={styles.historyChips}>
                  {searchHistory.map((item) => (
                    <Tap key={item} onPress={() => submitQuery(item)} style={styles.historyChip}>
                      <Ionicons name="time-outline" size={14} color={UI.text2} />
                      <Text style={styles.historyChipText}>{item}</Text>
                    </Tap>
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
                <Tap
                  key={art.name}
                  onPress={() => openCollection({ kind: 'artist', id: art.name, name: art.name })}
                  style={styles.artistPillCard}
                >
                  <View
                    style={[styles.artistInitialCircle, { backgroundColor: palette.container }]}
                  >
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
                </Tap>
              ))}
            </ScrollView>

            {/* Moods & Genres Bento Grid */}
            <Text style={[styles.subHeading, { fontFamily }]}>
              {t(prefs.language, 'moodsAndGenres')}
            </Text>
            <View style={styles.genreGrid}>
              {MOOD_CATEGORIES.map((cat) => (
                <Tap key={cat.id} onPress={() => submitQuery(cat.query)} style={styles.genreCell}>
                  <LinearGradient
                    colors={cat.colors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.genreGradient}
                  >
                    <Ionicons name={cat.icon as any} size={22} color={UI.fg(0.85)} />
                    <Text style={[styles.genreTitle, { fontFamily }]}>
                      {vi ? cat.labelVi : cat.labelEn}
                    </Text>
                  </LinearGradient>
                </Tap>
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
                    <Tap
                      key={alb.id}
                      onPress={() => openCollection({ kind: 'album', id: alb.id, summary: alb })}
                      style={styles.albumCard}
                    >
                      <ArtworkImage source={{ uri: alb.artworkUrl }} style={styles.albumArt} />
                      <Text numberOfLines={1} style={styles.albumTitle}>
                        {alb.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.albumArtist}>
                        {alb.artist}
                      </Text>
                    </Tap>
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

const styles = themedSheet(() => ({
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 16,
    backgroundColor: UI.fg(0.06),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  linkBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 99,
    minWidth: 58,
    alignItems: 'center',
  },
  suggestBox: {
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: UI.fg(0.05),
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.06),
  },
  container: {
    flex: 1,
  },
  searchHeader: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  pageTitle: {
    color: UI.text,
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
    backgroundColor: UI.fg(0.065),
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: UI.text,
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
    backgroundColor: UI.fg(0.06),
    borderWidth: 1,
    borderColor: UI.fg(0.1),
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
    color: UI.text2,
    fontSize: 13,
  },
  subHeading: {
    color: UI.text,
    fontSize: 17,
    fontWeight: '800',
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 10,
  },
  localHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    marginTop: 10,
    marginBottom: 10,
  },
  localTitle: { flex: 1, marginHorizontal: 0, marginTop: 0, marginBottom: 0 },
  localMore: { fontSize: 13, fontWeight: '800' },
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
    backgroundColor: UI.fg(0.07),
  },
  historyChipText: {
    color: UI.text,
    fontSize: 13,
    fontWeight: '600',
  },
  artistPillCard: {
    width: 112,
    padding: 12,
    borderRadius: 18,
    backgroundColor: UI.fg(0.05),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
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
    color: UI.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  artistTag: {
    color: UI.text3,
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
    color: UI.text,
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
    backgroundColor: UI.surface('#1B1B24'),
    marginBottom: 6,
  },
  albumTitle: {
    color: UI.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  albumArtist: {
    color: UI.text2,
    fontSize: 12,
    marginTop: 2,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  emptyActionText: { fontSize: 13.5, fontWeight: '700' },
  emptyText: {
    color: UI.text2,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
}));
