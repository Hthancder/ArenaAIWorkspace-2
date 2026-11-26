// Mochy Music Home Screen — Greeting, Mood Chips, Quick Picks, Mix It, VN/Global Charts, Albums & Recap Banner

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { t } from '../../constants/i18n';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { MOOD_CATEGORIES } from '../../data/curatedCatalog';
import { Track } from '../../types/music';
import { CHART_COUNTRIES, CHART_GENRES } from '../../services/discovery/chartsService';
import { HomeSectionId } from '../../constants/preferences';
import { MochyMarkIcon } from '../MochyIcons';
import { TrackRow } from '../TrackRow';

export const HomeScreen: React.FC = () => {
  const {
    prefs,
    palette,
    quickPicks,
    vnTrending,
    globalTrending,
    featuredAlbums,
    history,
    isLoadingHome,
    refreshHomeFeeds,
    playTrack,
    startInstantMix,
    openCollection,
    setIsAudioLabOpen,
    setIsRecapOpen,
    searchTracks,
    fetchChart,
    openCharts,
    openImport,
    importLocalFiles,
    likedTracks,
    downloads,
  } = useMochy();

  const shown = (id: HomeSectionId) => !prefs.hiddenHomeSections.includes(id);
  const country = CHART_COUNTRIES.find((c) => c.code === prefs.chartCountry) || CHART_COUNTRIES[0];
  const globalCode = country.code === 'us' ? 'gb' : 'us';
  const globalCountry = CHART_COUNTRIES.find((c) => c.code === globalCode)!;
  const [localChart, setLocalChart] = useState<Track[]>([]);
  const [globalChart, setGlobalChart] = useState<Track[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchChart(country.code, null).then((l) => !cancelled && setLocalChart(l));
    fetchChart(globalCode, null).then((l) => !cancelled && setGlobalChart(l));
    return () => {
      cancelled = true;
    };
  }, [country.code, globalCode, fetchChart]);
  const chartLocal = localChart.length > 0 ? localChart : vnTrending;
  const chartGlobal = globalChart.length > 0 ? globalChart : globalTrending;

  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [moodTracks, setMoodTracks] = useState<Track[] | null>(null);
  const [loadingMood, setLoadingMood] = useState(false);

  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t(prefs.language, 'greetingMorning')
      : hour < 18
        ? t(prefs.language, 'greetingAfternoon')
        : t(prefs.language, 'greetingEvening');

  const handleMoodSelect = async (moodId: string, query: string) => {
    if (selectedMood === moodId) {
      setSelectedMood(null);
      setMoodTracks(null);
      return;
    }
    setSelectedMood(moodId);
    setLoadingMood(true);
    const res = await searchTracks(query, 'all');
    setMoodTracks(res.tracks);
    setLoadingMood(false);
  };

  // Chunk Quick Picks into columns of 3 for Mochy's horizontal swipe grid
  const activePicks = moodTracks && moodTracks.length > 0 ? moodTracks : quickPicks;
  const pickColumns: Track[][] = [];
  for (let i = 0; i < Math.min(activePicks.length, 12); i += 3) {
    pickColumns.push(activePicks.slice(i, i + 3));
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View style={styles.brandLeft}>
          <View style={[styles.logoBadge, { backgroundColor: palette.container }]}>
            <MochyMarkIcon size={22} color={palette.accent} filled />
          </View>
          <View>
            <Text style={[styles.greetingSub, { fontFamily }]}>{greeting}</Text>
            <Text style={[styles.brandTitle, { fontFamily }]}>Mochy Music</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable onPress={() => setIsAudioLabOpen(true)} style={styles.headerIconBtn}>
            <Ionicons name="options-outline" size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={() => setIsRecapOpen(true)} style={styles.headerIconBtn}>
            <Ionicons name="stats-chart" size={19} color={palette.accent} />
          </Pressable>
          <Pressable onPress={refreshHomeFeeds} style={styles.headerIconBtn}>
            <Ionicons name="refresh" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Mood Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moodRow}
      >
        {MOOD_CATEGORIES.map((m) => {
          const active = selectedMood === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => handleMoodSelect(m.id, m.query)}
              style={[
                styles.moodChip,
                active && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.moodChipText,
                  { color: active ? palette.onAccent : '#F4F4F8', fontFamily },
                ]}
              >
                {vi ? m.labelVi : m.labelEn}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Quick Actions (OpenSpot Music) */}
      {shown('quickActions') && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActions}
        >
          {[
            {
              icon: 'heart',
              tint: MOCHY_COLORS.roseLike,
              label: vi ? 'Đã thích' : 'Liked',
              sub: String(likedTracks.length),
              onPress: () => openCollection({ kind: 'liked' }),
            },
            {
              icon: 'arrow-down-circle',
              tint: MOCHY_COLORS.flacEmerald,
              label: vi ? 'Tải xuống' : 'Downloads',
              sub: String(Object.keys(downloads).length),
              onPress: () => openCollection({ kind: 'offline' }),
            },
            {
              icon: 'link',
              tint: '#60A5FA',
              label: vi ? 'Dán link' : 'Paste link',
              sub: 'YT · Spotify',
              onPress: () => openImport('link'),
            },
            {
              icon: 'list',
              tint: '#FBBF24',
              label: vi ? 'Tìm danh sách' : 'Search a list',
              sub: vi ? 'Nhiều bài' : 'Batch',
              onPress: () => openImport('list'),
            },
            {
              icon: 'globe-outline',
              tint: '#A78BFA',
              label: vi ? 'Xếp hạng' : 'Charts',
              sub: country.flag,
              onPress: () => openCharts(null),
            },
            {
              icon: 'folder-open-outline',
              tint: '#F472B6',
              label: vi ? 'Tệp' : 'Files',
              sub: 'MP3 · FLAC',
              onPress: () => importLocalFiles(),
            },
          ].map((qa) => (
            <Pressable key={qa.label} onPress={qa.onPress} style={styles.qaCard}>
              <View style={[styles.qaIcon, { backgroundColor: qa.tint + '22' }]}>
                <Ionicons name={qa.icon as any} size={18} color={qa.tint} />
              </View>
              <View>
                <Text numberOfLines={1} style={[styles.qaLabel, { fontFamily }]}>
                  {qa.label}
                </Text>
                <Text numberOfLines={1} style={styles.qaSub}>
                  {qa.sub}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Quick Picks Horizontal Multi-Row Grid */}
      {shown('quickPicks') && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { fontFamily }]}>
              {t(prefs.language, 'quickPicks')}
            </Text>
            {(isLoadingHome || loadingMood) && (
              <ActivityIndicator size="small" color={palette.accent} />
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickGridScroll}
          >
            {pickColumns.map((col, colIdx) => (
              <View key={colIdx} style={styles.quickColumn}>
                {col.map((song) => (
                  <TrackRow key={song.id} track={song} queueContext={activePicks} compact />
                ))}
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {/* Mix It Instant DJ Flow + Recap Dual Feature Cards */}
      <View style={styles.dualCardsRow}>
        <Pressable onPress={() => startInstantMix()} style={{ flex: 1 }}>
          <LinearGradient
            colors={[palette.gradient[0], '#1A1630']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.promoCard}
          >
            <View style={styles.promoTopRow}>
              <Ionicons name="sparkles" size={20} color={palette.accent} />
              <Text style={[styles.promoTag, { color: palette.accent }]}>MIX IT</Text>
            </View>
            <Text style={[styles.promoTitle, { fontFamily }]}>
              {t(prefs.language, 'mixItTitle')}
            </Text>
            <Text numberOfLines={2} style={styles.promoDesc}>
              {t(prefs.language, 'mixItDesc')}
            </Text>
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => setIsRecapOpen(true)} style={{ flex: 1 }}>
          <LinearGradient
            colors={['#1E293B', '#0F172A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.promoCard}
          >
            <View style={styles.promoTopRow}>
              <Ionicons name="id-card-outline" size={20} color="#34D399" />
              <Text style={[styles.promoTag, { color: '#34D399' }]}>ID CARD</Text>
            </View>
            <Text style={[styles.promoTitle, { fontFamily }]}>
              {t(prefs.language, 'recapBannerTitle')}
            </Text>
            <Text numberOfLines={2} style={styles.promoDesc}>
              {t(prefs.language, 'recapBannerDesc')}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Keep Listening (if history exists) */}
      {shown('recent') && history.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { fontFamily }]}>
              {t(prefs.language, 'keepListening')}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalCards}
          >
            {history.slice(0, 8).map((ev) => (
              <Pressable
                key={ev.id}
                onPress={() =>
                  playTrack(
                    ev.track,
                    history.map((h) => h.track)
                  )
                }
                style={styles.squareCard}
              >
                <ArtworkImage source={{ uri: ev.track.artworkUrl }} style={styles.squareArt} />
                <Text numberOfLines={1} style={[styles.squareTitle, { fontFamily }]}>
                  {ev.track.title}
                </Text>
                <Text numberOfLines={1} style={styles.squareSub}>
                  {ev.track.artist}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Featured Albums Shelf */}
      {shown('albums') && featuredAlbums.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { fontFamily }]}>
              {t(prefs.language, 'featuredAlbums')}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalCards}
          >
            {featuredAlbums.map((alb) => (
              <Pressable
                key={alb.id}
                onPress={() => openCollection({ kind: 'album', id: alb.id, summary: alb })}
                style={styles.squareCard}
              >
                <ArtworkImage source={{ uri: alb.artworkUrl }} style={styles.squareArt} />
                <Text numberOfLines={1} style={[styles.squareTitle, { fontFamily }]}>
                  {alb.title}
                </Text>
                <Text numberOfLines={1} style={styles.squareSub}>
                  {alb.artist}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Charts by country (OpenSpot trending, real Apple Music charts) */}
      {shown('charts') && (
        <>
          <View style={styles.sectionHeader}>
            <Pressable
              onPress={() => openCharts(null)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={[styles.sectionTitle, { fontFamily }]}>
                {vi
                  ? `Thịnh hành ${country.flag} ${country.vi}`
                  : `Trending ${country.flag} ${country.en}`}
              </Text>
              <Ionicons name="chevron-down" size={15} color={MOCHY_COLORS.textMuted} />
            </Pressable>
            <Pressable onPress={() => chartLocal[0] && playTrack(chartLocal[0], chartLocal)}>
              <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 13 }}>
                {t(prefs.language, 'playAll')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.listCard}>
            {chartLocal.slice(0, 6).map((song, idx) => (
              <TrackRow key={song.id} track={song} queueContext={chartLocal} indexBadge={idx + 1} />
            ))}
            <Pressable onPress={() => openCharts(null)} style={styles.seeAll}>
              <Text style={{ color: palette.accent, fontWeight: '700' }}>
                {vi ? 'Xem top 50 & đổi quốc gia' : 'See top 50 & change country'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Genres & moods (Musike genre browse) */}
      {shown('genres') && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { fontFamily }]}>{vi ? 'Thể loại' : 'Genres'}</Text>
          </View>
          <View style={styles.genreGrid}>
            {CHART_GENRES.filter((g) => g.id !== null)
              .slice(0, 12)
              .map((g) => (
                <Pressable
                  key={String(g.id)}
                  onPress={() => openCharts(g.id)}
                  style={[
                    styles.genreTile,
                    { backgroundColor: g.tint + '26', borderColor: g.tint + '55' },
                  ]}
                >
                  <Ionicons name={g.icon as any} size={18} color={g.tint} />
                  <Text numberOfLines={1} style={[styles.genreText, { fontFamily }]}>
                    {vi ? g.vi : g.en}
                  </Text>
                </Pressable>
              ))}
          </View>
        </>
      )}

      {/* Global chart */}
      {shown('global') && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { fontFamily }]}>
              {t(prefs.language, 'globalCharts')} {globalCountry.flag}
            </Text>
            <Pressable onPress={() => chartGlobal[0] && playTrack(chartGlobal[0], chartGlobal)}>
              <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 13 }}>
                {t(prefs.language, 'playAll')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.listCard}>
            {chartGlobal.slice(0, 6).map((song, idx) => (
              <TrackRow
                key={song.id}
                track={song}
                queueContext={chartGlobal}
                indexBadge={idx + 1}
              />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  quickActions: { gap: 10, paddingHorizontal: 16, paddingBottom: 6, paddingTop: 2 },
  qaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  qaIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaLabel: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  qaSub: { color: MOCHY_COLORS.textMuted, fontSize: 11, marginTop: 1 },
  seeAll: { alignItems: 'center', paddingVertical: 12 },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  genreTile: {
    width: '31.5%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  genreText: { color: '#FFF', fontWeight: '700', fontSize: 13, flexShrink: 1 },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 170,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  logoBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  greetingSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: MOCHY_COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  moodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: MOCHY_COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
  },
  moodChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  quickGridScroll: {
    paddingHorizontal: 12,
    gap: 10,
  },
  quickColumn: {
    width: 325,
  },
  dualCardsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  promoCard: {
    borderRadius: 22,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    minHeight: 126,
    justifyContent: 'space-between',
  },
  promoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  promoTag: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  promoTitle: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
    marginTop: 6,
  },
  promoDesc: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    lineHeight: 16.5,
    marginTop: 4,
  },
  horizontalCards: {
    paddingHorizontal: 16,
    gap: 14,
  },
  squareCard: {
    width: 142,
  },
  squareArt: {
    width: 142,
    height: 142,
    borderRadius: 18,
    backgroundColor: '#1B1B24',
    marginBottom: 8,
  },
  squareTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  squareSub: {
    color: MOCHY_COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  listCard: {
    marginHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 4,
  },
});
