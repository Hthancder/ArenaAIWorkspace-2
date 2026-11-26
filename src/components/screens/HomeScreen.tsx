// HolySic Home Screen — Greeting, Mood Chips, Quick Picks, Mix It, VN/Global Charts, Albums & Recap Banner

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { t } from '../../constants/i18n';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { MOOD_CATEGORIES } from '../../data/curatedCatalog';
import { Track } from '../../types/music';
import { CHART_COUNTRIES, CHART_GENRES } from '../../services/discovery/chartsService';
import { HomeSectionId } from '../../constants/preferences';
import { HolySicMarkIcon } from '../HolySicIcons';
import { TrackRow } from '../TrackRow';
import { HaloGlow, SectionTitle } from '../brand/HaloGlow';
import { AmbientSpill, useAmbientColors } from '../ambient/AmbientLight';
import { searchStations } from '../../services/discovery/radioBrowser';
import { AUDIUS_GENRES, fetchAudiusTrending } from '../../services/providers/audiusProvider';

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
    openRadio,
    toggleFavoriteStation,
    currentTrack,
    ambient,
    openImport,
    importLocalFiles,
    likedTracks,
    downloads,
  } = useHolySic();

  const ambientColors = useAmbientColors();
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

  // Live radio shelf: saved stations first, then the most-played stations in your chart country
  const [stations, setStations] = useState<Track[]>([]);
  useEffect(() => {
    if (!shown('radio')) return;
    let cancelled = false;
    searchStations({ countrycode: country.code, limit: 14 }).then(
      (l) => !cancelled && setStations(l)
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country.code]);
  const radioShelf = [
    ...(prefs.favoriteStations || []),
    ...stations.filter((x) => !(prefs.favoriteStations || []).some((f) => f.id === x.id)),
  ].slice(0, 16);

  // Audius indie trending (artist uploads, full-length MP3 320)
  const [audiusGenre, setAudiusGenre] = useState('');
  const [audius, setAudius] = useState<Track[]>([]);
  const [audiusLoading, setAudiusLoading] = useState(false);
  useEffect(() => {
    if (!shown('audius')) return;
    let cancelled = false;
    setAudiusLoading(true);
    fetchAudiusTrending(audiusGenre, 'week', 20)
      .then((l) => !cancelled && setAudius(l))
      .finally(() => !cancelled && setAudiusLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audiusGenre]);

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

  // Chunk Quick Picks into columns of 3 for HolySic's horizontal swipe grid
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
      {currentTrack && ambient.spill && !prefs.pureBlack && (
        <AmbientSpill
          variant="wash"
          colors={ambientColors}
          level={ambient.level * 0.85}
          style={styles.homeWash}
        />
      )}
      <HaloGlow color={palette.accent} height={320} intensity={currentTrack ? 0.6 : 1} />
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View style={styles.brandLeft}>
          <LinearGradient
            colors={[palette.accent + '55', 'rgba(18,10,36,0.9)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.logoBadge, styles.logoBadgeHalo]}
          >
            <HolySicMarkIcon size={24} color="#FFFFFF" filled />
          </LinearGradient>
          <View>
            <Text style={[styles.greetingSub, { fontFamily }]}>{greeting}</Text>
            <Text style={[styles.brandTitle, { fontFamily }]}>
              Holy<Text style={{ color: palette.accent }}>Sic</Text>
            </Text>
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
              tint: HOLYSIC_COLORS.roseLike,
              label: vi ? 'Đã thích' : 'Liked',
              sub: String(likedTracks.length),
              onPress: () => openCollection({ kind: 'liked' }),
            },
            {
              icon: 'arrow-down-circle',
              tint: HOLYSIC_COLORS.flacEmerald,
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
              icon: 'radio',
              tint: '#F87171',
              label: 'Radio',
              sub: 'LIVE',
              onPress: () => openRadio(),
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
            <SectionTitle fontFamily={fontFamily}>{t(prefs.language, 'quickPicks')}</SectionTitle>
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
            <SectionTitle fontFamily={fontFamily}>
              {t(prefs.language, 'keepListening')}
            </SectionTitle>
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
            <SectionTitle fontFamily={fontFamily}>
              {t(prefs.language, 'featuredAlbums')}
            </SectionTitle>
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
              <SectionTitle fontFamily={fontFamily}>
                {vi
                  ? `Thịnh hành ${country.flag} ${country.vi}`
                  : `Trending ${country.flag} ${country.en}`}
              </SectionTitle>
              <Ionicons name="chevron-down" size={15} color={HOLYSIC_COLORS.textMuted} />
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
            <SectionTitle fontFamily={fontFamily}>{vi ? 'Thể loại' : 'Genres'}</SectionTitle>
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

      {/* Live radio (Radio Browser) */}
      {shown('radio') && radioShelf.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <SectionTitle fontFamily={fontFamily}>
              {vi ? 'Radio trực tuyến' : 'Live radio'}
            </SectionTitle>
            <Pressable onPress={openRadio}>
              <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 13 }}>
                {vi ? 'Tất cả đài' : 'All stations'}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalCards}
          >
            {radioShelf.map((st) => {
              const on = currentTrack?.id === st.id;
              return (
                <Pressable
                  key={st.id}
                  onPress={() => playTrack(st, radioShelf)}
                  onLongPress={() => toggleFavoriteStation(st)}
                  style={styles.radioCard}
                >
                  <View>
                    <ArtworkImage
                      source={{ uri: st.artworkUrl }}
                      fallbackSeed={st.title}
                      style={[styles.radioArt, on && { borderColor: palette.accent }]}
                    />
                    <View style={styles.liveTag}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveTagText}>LIVE</Text>
                    </View>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.squareTitle, { fontFamily }, on && { color: palette.accent }]}
                  >
                    {st.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.squareSub}>
                    {st.genre || st.artist}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Indie trending from Audius */}
      {shown('audius') && (audius.length > 0 || audiusLoading) && (
        <>
          <View style={styles.sectionHeader}>
            <SectionTitle fontFamily={fontFamily}>
              {vi ? 'Indie thịnh hành · Audius' : 'Indie trending · Audius'}
            </SectionTitle>
            <Pressable onPress={() => audius[0] && playTrack(audius[0], audius)}>
              <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 13 }}>
                {t(prefs.language, 'playAll')}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.horizontalCards, { gap: 8, paddingBottom: 10 }]}
          >
            {AUDIUS_GENRES.map((g) => {
              const active = audiusGenre === g.id;
              return (
                <Pressable
                  key={g.id || 'all'}
                  onPress={() => setAudiusGenre(g.id)}
                  style={[
                    styles.audiusChip,
                    active && { backgroundColor: palette.accent, borderColor: palette.accent },
                  ]}
                >
                  <Text style={[styles.audiusChipText, active && { color: palette.onAccent }]}>
                    {vi ? g.vi : g.en}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.listCard}>
            {audiusLoading && audius.length === 0 ? (
              <ActivityIndicator style={{ marginVertical: 18 }} color={palette.accent} />
            ) : (
              audius
                .slice(0, 6)
                .map((song, idx) => (
                  <TrackRow key={song.id} track={song} queueContext={audius} indexBadge={idx + 1} />
                ))
            )}
          </View>
        </>
      )}

      {/* Global chart */}
      {shown('global') && (
        <>
          <View style={styles.sectionHeader}>
            <SectionTitle fontFamily={fontFamily}>
              {t(prefs.language, 'globalCharts')} {globalCountry.flag}
            </SectionTitle>
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
  homeWash: { position: 'absolute', top: -40, left: -40, right: -40, height: 420 },
  logoBadgeHalo: { borderWidth: 1, borderColor: 'rgba(252,211,77,0.35)' },
  radioCard: { width: 118 },
  radioArt: {
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: '#1B1B24',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  liveTag: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: 'rgba(10,10,14,0.85)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveTagText: { color: '#FFF', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  audiusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  audiusChipText: { color: '#E4E4EC', fontWeight: '700', fontSize: 12.5 },
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
  qaSub: { color: HOLYSIC_COLORS.textMuted, fontSize: 11, marginTop: 1 },
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
    color: HOLYSIC_COLORS.textSecondary,
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
    backgroundColor: HOLYSIC_COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: HOLYSIC_COLORS.glassBorder,
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
    backgroundColor: HOLYSIC_COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: HOLYSIC_COLORS.glassBorder,
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
    color: HOLYSIC_COLORS.textSecondary,
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
