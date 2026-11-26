// Charts & genres browser — OpenSpot Music's "Trending in your country" (75+ countries) merged
// with Musike's "Browse by genre" in one screen: pick a country, pick a genre, play the top 50.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { CHART_COUNTRIES, CHART_GENRES } from '../../services/discovery/chartsService';
import { Track } from '../../types/music';
import { TrackRow } from '../TrackRow';
import { SheetSlot, useModalLayer } from '../overlay/ModalLayers';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialGenre?: number | null;
}

export const ChartsModal: React.FC<Props> = ({ visible, onClose, initialGenre = null }) => {
  const insets = useSafeAreaInsets();
  const { prefs, updatePrefs, palette, fetchChart, playTrack, savePlaylistFromTracks, showToast } =
    useHolySic();
  useModalLayer('charts', visible);
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const [genre, setGenre] = useState<number | null>(initialGenre);
  const [pickCountry, setPickCountry] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const country = CHART_COUNTRIES.find((c) => c.code === prefs.chartCountry) || CHART_COUNTRIES[0];
  const genreMeta = CHART_GENRES.find((g) => g.id === genre) || CHART_GENRES[0];

  useEffect(() => {
    if (visible) setGenre(initialGenre);
  }, [visible, initialGenre]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    fetchChart(country.code, genre).then((list) => {
      if (cancelled) return;
      setTracks(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, country.code, genre, fetchChart]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top > 30 ? 12 : 16 }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="chevron-down" size={22} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { fontFamily }]}>{vi ? 'Bảng xếp hạng' : 'Charts'}</Text>
            <Text style={styles.sub}>
              {country.flag} {vi ? country.vi : country.en} · {vi ? genreMeta.vi : genreMeta.en}
            </Text>
          </View>
          <Pressable
            onPress={() => setPickCountry((v) => !v)}
            style={[styles.countryBtn, { borderColor: palette.accent + '66' }]}
          >
            <Text style={{ fontSize: 16 }}>{country.flag}</Text>
            <Ionicons name={pickCountry ? 'chevron-up' : 'chevron-down'} size={14} color="#FFF" />
          </Pressable>
        </View>

        {pickCountry && (
          <ScrollView style={styles.countryList} contentContainerStyle={styles.countryWrap}>
            {CHART_COUNTRIES.map((c) => {
              const active = c.code === country.code;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => {
                    updatePrefs({ chartCountry: c.code });
                    setPickCountry(false);
                  }}
                  style={[
                    styles.countryChip,
                    active && { backgroundColor: palette.accent, borderColor: palette.accent },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? palette.onAccent : '#FFF',
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    {c.flag} {vi ? c.vi : c.en}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreRow}
          style={{ flexGrow: 0 }}
        >
          {CHART_GENRES.map((g) => {
            const active = g.id === genre;
            return (
              <Pressable
                key={String(g.id)}
                onPress={() => setGenre(g.id)}
                style={[
                  styles.genreChip,
                  active && { backgroundColor: g.tint, borderColor: g.tint },
                ]}
              >
                <Ionicons name={g.icon as any} size={14} color={active ? '#0A0A0E' : g.tint} />
                <Text
                  style={{ color: active ? '#0A0A0E' : '#F4F4F8', fontWeight: '700', fontSize: 13 }}
                >
                  {vi ? g.vi : g.en}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {tracks.length > 0 && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                playTrack(tracks[0], tracks);
                onClose();
              }}
              style={[styles.primary, { backgroundColor: palette.accent }]}
            >
              <Ionicons name="play" size={16} color={palette.onAccent} />
              <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                {vi ? 'Phát tất cả' : 'Play all'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const s = [...tracks].sort(() => Math.random() - 0.5);
                playTrack(s[0], s);
                onClose();
              }}
              style={styles.secondary}
            >
              <Ionicons name="shuffle" size={16} color="#FFF" />
            </Pressable>
            <Pressable
              onPress={() => {
                const name = `Top ${tracks.length} ${country.flag} ${vi ? genreMeta.vi : genreMeta.en} · ${new Date().toLocaleDateString()}`;
                savePlaylistFromTracks(name, tracks);
                showToast(vi ? `Đã lưu "${name}"` : `Saved "${name}"`);
              }}
              style={styles.secondary}
            >
              <Ionicons name="bookmark-outline" size={16} color="#FFF" />
            </Pressable>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color={palette.accent} />
        ) : tracks.length === 0 ? (
          <Text style={styles.empty}>
            {vi ? 'Không tải được bảng xếp hạng (kiểm tra mạng)' : 'Could not load this chart'}
          </Text>
        ) : (
          <FlatList
            data={tracks}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingHorizontal: 6 }}
            renderItem={({ item, index }) => (
              <TrackRow track={item} queueContext={tracks} indexBadge={index + 1} />
            )}
          />
        )}
      </View>
      <SheetSlot layer="charts" />
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  sub: { color: HOLYSIC_COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
  },
  countryList: { maxHeight: 260, marginHorizontal: 12, marginBottom: 8 },
  countryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countryChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: HOLYSIC_COLORS.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  genreRow: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: HOLYSIC_COLORS.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 99,
  },
  secondary: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  empty: {
    color: HOLYSIC_COLORS.textMuted,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 30,
  },
});
