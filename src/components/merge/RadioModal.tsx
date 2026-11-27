// Live radio — 50,000+ internet stations from the community-run Radio Browser directory.
// Search by name, browse by country or mood, save favourites. Stations play as live tracks.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { RADIO_TAGS, searchStations } from '../../services/discovery/radioBrowser';
import { Track } from '../../types/music';
import { ArtworkImage } from '../ArtworkImage';
import { HaloGlow } from '../brand/HaloGlow';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';

const SCOPES = [
  { id: 'saved', vi: 'Đã lưu', en: 'Saved', flag: '♥' },
  { id: 'VN', vi: 'Việt Nam', en: 'Vietnam', flag: '🇻🇳' },
  { id: 'world', vi: 'Thế giới', en: 'World', flag: '🌍' },
  { id: 'US', vi: 'Mỹ', en: 'USA', flag: '🇺🇸' },
  { id: 'GB', vi: 'Anh', en: 'UK', flag: '🇬🇧' },
  { id: 'KR', vi: 'Hàn Quốc', en: 'Korea', flag: '🇰🇷' },
  { id: 'JP', vi: 'Nhật Bản', en: 'Japan', flag: '🇯🇵' },
  { id: 'FR', vi: 'Pháp', en: 'France', flag: '🇫🇷' },
] as const;

export const RadioModal: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {
    radioOpen,
    closeRadio,
    prefs,
    palette,
    playTrack,
    currentTrack,
    isPlaying,
    togglePlay,
    isFavoriteStation,
    toggleFavoriteStation,
  } = useHolySic();
  useModalLayer('radio', radioOpen);
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const saved = prefs.favoriteStations || [];
  const [scope, setScope] = useState<string>(saved.length ? 'saved' : 'VN');
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!radioOpen) return;
    const q = query.trim();
    if (scope === 'saved' && !q && !tag) {
      setList(saved);
      setLoading(false);
      setFailed(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(
      () => {
        searchStations({
          name: q || undefined,
          countrycode: scope !== 'world' && scope !== 'saved' ? scope : undefined,
          tag: tag || undefined,
          limit: 50,
        })
          .then((res) => {
            if (id !== reqRef.current) return;
            setList(res);
            setFailed(res.length === 0);
          })
          .catch(() => id === reqRef.current && setFailed(true))
          .finally(() => id === reqRef.current && setLoading(false));
      },
      q ? 420 : 0
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioOpen, scope, tag, query, scope === 'saved' ? saved.length : 0]);

  const play = (st: Track) => {
    if (currentTrack?.id === st.id) togglePlay();
    else playTrack(st, list);
  };

  return (
    <Modal
      visible={radioOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeRadio}
    >
      <View style={[styles.root, { paddingTop: insets.top > 30 ? 12 : 16 }]}>
        <HaloGlow color={palette.accent} height={260} />
        <View style={styles.header}>
          <Tap onPress={closeRadio} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="chevron-down" size={22} color={UI.text} />
          </Tap>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { fontFamily }]}>
              {vi ? 'Radio trực tuyến' : 'Live radio'}
            </Text>
            <Text style={styles.sub}>
              {vi ? '50.000+ đài · Radio Browser' : '50,000+ stations · Radio Browser'}
            </Text>
          </View>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={UI.text3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={vi ? 'Tìm đài: VOV, Lofi, BBC…' : 'Find a station: BBC, lofi, jazz…'}
            placeholderTextColor={UI.text3}
            style={[styles.searchInput, { fontFamily }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Tap feedback="opacity" hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={17} color={UI.text3} />
            </Tap>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={{ flexGrow: 0 }}
        >
          {SCOPES.map((s) => {
            const active = scope === s.id;
            return (
              <Tap
                key={s.id}
                onPress={() => setScope(s.id)}
                style={[
                  styles.chip,
                  active && { backgroundColor: palette.accent, borderColor: palette.accent },
                ]}
              >
                <Text style={[styles.chipText, active && { color: palette.onAccent }]}>
                  {s.flag} {vi ? s.vi : s.en}
                  {s.id === 'saved' && saved.length ? ` ${saved.length}` : ''}
                </Text>
              </Tap>
            );
          })}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.chips, { paddingTop: 0 }]}
          style={{ flexGrow: 0 }}
        >
          {RADIO_TAGS.map((t) => {
            const active = tag === t.id;
            return (
              <Tap
                key={t.id}
                onPress={() => setTag(active ? null : t.id)}
                style={[styles.tagChip, active && { borderColor: palette.accent }]}
              >
                <Text style={[styles.tagText, active && { color: palette.accent }]}>
                  #{vi ? t.vi : t.en}
                </Text>
              </Tap>
            );
          })}
        </ScrollView>

        {loading && list.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={palette.accent} />
        ) : (
          <FlatList
            data={list}
            keyExtractor={(x) => x.id}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {scope === 'saved' && !query && !tag
                  ? vi
                    ? 'Chưa lưu đài nào. Chạm ♡ ở một đài để lưu lại.'
                    : 'No saved stations yet. Tap ♡ on a station to keep it here.'
                  : failed
                    ? vi
                      ? 'Không tải được danh sách đài (kiểm tra mạng) hoặc không có kết quả.'
                      : 'Could not load stations (check your connection) or nothing matched.'
                    : ''}
              </Text>
            }
            renderItem={({ item }) => {
              const active = currentTrack?.id === item.id;
              const fav = isFavoriteStation(item.id);
              return (
                <Tap
                  onPress={() => play(item)}
                  style={[styles.row, active && { backgroundColor: palette.container + '55' }]}
                >
                  <View>
                    <ArtworkImage
                      source={{ uri: item.artworkUrl }}
                      fallbackSeed={item.title}
                      style={styles.logo}
                    />
                    {active && (
                      <View style={styles.nowOverlay}>
                        <Ionicons
                          name={isPlaying ? 'radio' : 'pause'}
                          size={18}
                          color={palette.accent}
                        />
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={[styles.name, { fontFamily }, active && { color: palette.accent }]}
                    >
                      {item.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {item.artist}
                    </Text>
                    <Text numberOfLines={1} style={styles.badge}>
                      {item.qualityBadge}
                    </Text>
                  </View>
                  <Tap
                    feedback="opacity"
                    hitSlop={8}
                    onPress={() => toggleFavoriteStation(item)}
                    style={styles.favBtn}
                    accessibilityLabel={vi ? 'Lưu đài' : 'Save station'}
                  >
                    <Ionicons
                      name={fav ? 'heart' : 'heart-outline'}
                      size={20}
                      color={fav ? HOLYSIC_COLORS.roseLike : UI.text2}
                    />
                  </Tap>
                </Tap>
              );
            }}
          />
        )}
      </View>
      <SheetSlot layer="radio" />
    </Modal>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: UI.surface('#0A0A0E') },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.08),
  },
  title: { color: UI.text, fontSize: 22, fontWeight: '800' },
  sub: { color: UI.text3, fontSize: 12.5, marginTop: 2 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444' },
  liveText: { color: '#FCA5A5', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginTop: 14,
    height: 44,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: UI.fg(0.07),
  },
  searchInput: { flex: 1, color: UI.text, fontSize: 15 },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: UI.fg(0.1),
    backgroundColor: UI.fg(0.05),
  },
  chipText: { color: UI.fg(0.88), fontWeight: '700', fontSize: 13 },
  tagChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  tagText: { color: UI.text2, fontWeight: '700', fontSize: 12.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 16,
  },
  logo: { width: 56, height: 56, borderRadius: 14, backgroundColor: UI.surface('#1B1B24') },
  nowOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    backgroundColor: UI.shade(0, 0, 0, 0.55),
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: UI.text, fontSize: 15, fontWeight: '800' },
  meta: { color: UI.text2, fontSize: 12.5, marginTop: 2 },
  badge: { color: UI.text3, fontSize: 11, marginTop: 2, fontWeight: '700' },
  favBtn: { padding: 6 },
  empty: {
    color: UI.text3,
    textAlign: 'center',
    marginTop: 40,
    marginHorizontal: 30,
    lineHeight: 20,
  },
}));
