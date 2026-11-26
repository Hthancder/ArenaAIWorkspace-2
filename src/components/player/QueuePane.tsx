// Up Next — HolySic's queue with the editing tools of Spotube & Musike:
// tap to jump, move up/down, remove, clear everything after the current song, save as playlist.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { ArtworkImage } from '../ArtworkImage';
import { Tap } from '../ui/Tap';

const ROW_H = 60;

export const QueuePane: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const {
    queue,
    queueIndex,
    isPlaying,
    jumpToQueueIndex,
    removeFromQueue,
    moveInQueue,
    clearUpcoming,
    savePlaylistFromTracks,
    showToast,
    darkPalette: palette,
    prefs,
  } = useHolySic();
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);
  const scrollRef = useRef<ScrollView | null>(null);
  const upcoming = Math.max(0, queue.length - queueIndex - 1);

  // keep the playing song in view when the pane opens / the song changes
  useEffect(() => {
    const y = Math.max(0, queueIndex * ROW_H - ROW_H);
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 30);
    return () => clearTimeout(t);
  }, [queueIndex]);

  const saveQueue = () => {
    if (queue.length === 0) return;
    const d = new Date();
    const name = `${vi ? 'Hàng chờ' : 'Queue'} ${d.getDate()}/${d.getMonth() + 1} ${d
      .getHours()
      .toString()
      .padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    savePlaylistFromTracks(name, queue);
    showToast(vi ? `Đã lưu "${name}" vào Thư viện` : `Saved "${name}" to Library`);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { fontFamily }]}>{vi ? 'Hàng chờ phát' : 'Up Next'}</Text>
          <Text style={styles.sub}>
            {vi
              ? `${queueIndex + 1}/${queue.length} · còn ${upcoming} bài`
              : `${queueIndex + 1}/${queue.length} · ${upcoming} left`}
          </Text>
        </View>
        <Tap feedback="opacity" onPress={onDone} hitSlop={8}>
          <Text style={{ color: palette.accent, fontWeight: '800' }}>{vi ? 'Xong' : 'Done'}</Text>
        </Tap>
      </View>

      <View style={styles.tools}>
        <Tap onPress={saveQueue} style={styles.tool}>
          <Ionicons name="bookmark-outline" size={14} color="#FFF" />
          <Text numberOfLines={1} style={styles.toolText}>
            {vi ? 'Lưu playlist' : 'Save playlist'}
          </Text>
        </Tap>
        <Tap
          onPress={clearUpcoming}
          disabled={upcoming === 0}
          style={[styles.tool, upcoming === 0 && { opacity: 0.4 }]}
        >
          <Ionicons name="trash-outline" size={14} color="#F87171" />
          <Text numberOfLines={1} style={[styles.toolText, { color: '#F87171' }]}>
            {vi ? 'Xoá bài sau' : 'Clear upcoming'}
          </Text>
        </Tap>
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        {queue.map((item, idx) => {
          const current = idx === queueIndex;
          const past = idx < queueIndex;
          return (
            <Tap
              key={`${item.id}-${idx}`}
              onPress={() => !current && jumpToQueueIndex(idx)}
              style={[
                styles.row,
                current && { backgroundColor: palette.container + '66' },
                past && { opacity: 0.5 },
              ]}
            >
              <View>
                <ArtworkImage
                  source={{ uri: item.artworkUrl }}
                  fallbackSeed={item.title}
                  style={styles.art}
                />
                {current && (
                  <View style={styles.nowOverlay}>
                    <Ionicons
                      name={isPlaying ? 'stats-chart' : 'pause'}
                      size={14}
                      color={palette.accent}
                    />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, { fontFamily }, current && { color: palette.accent }]}
                >
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={styles.rowArtist}>
                  {item.artist}
                </Text>
              </View>
              <Tap
                feedback="opacity"
                hitSlop={6}
                disabled={idx === 0}
                onPress={() => moveInQueue(idx, idx - 1)}
                style={[styles.iconBtn, idx === 0 && { opacity: 0.25 }]}
                accessibilityLabel={vi ? 'Lên' : 'Move up'}
              >
                <Ionicons name="chevron-up" size={17} color="#FFF" />
              </Tap>
              <Tap
                feedback="opacity"
                hitSlop={6}
                disabled={idx === queue.length - 1}
                onPress={() => moveInQueue(idx, idx + 1)}
                style={[styles.iconBtn, idx === queue.length - 1 && { opacity: 0.25 }]}
                accessibilityLabel={vi ? 'Xuống' : 'Move down'}
              >
                <Ionicons name="chevron-down" size={17} color="#FFF" />
              </Tap>
              <Tap
                feedback="opacity"
                hitSlop={6}
                disabled={current}
                onPress={() => removeFromQueue(idx)}
                style={[styles.iconBtn, current && { opacity: 0.25 }]}
                accessibilityLabel={vi ? 'Xoá khỏi hàng chờ' : 'Remove'}
              >
                <Ionicons name="close" size={17} color={HOLYSIC_COLORS.textSecondary} />
              </Tap>
            </Tap>
          );
        })}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  sub: { color: HOLYSIC_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  tools: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tool: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  toolText: { flexShrink: 1, color: '#FFF', fontSize: 12.5, fontWeight: '700' },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  art: { width: 44, height: 44, borderRadius: 10 },
  nowOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: '#FFF', fontSize: 14.5, fontWeight: '700' },
  rowArtist: { color: HOLYSIC_COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
