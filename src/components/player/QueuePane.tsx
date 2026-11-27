// Up Next — HolySic's queue with the editing tools of Spotube & Musike:
// tap to jump, drag the grip to reorder (lifts, neighbours slide aside — like Music's Up Next),
// remove, clear everything after the current song, save as playlist.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  PanResponderInstance,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { isLocalTrack } from '../../services/local/localLibrary';
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
    haptic,
    isOnline,
    downloads,
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

  // ── drag to reorder ──
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const shifts = useRef<Animated.Value[]>([]);
  while (shifts.current.length < queue.length) shifts.current.push(new Animated.Value(0));
  const live = useRef({ len: queue.length, to: -1, from: -1 });
  live.current.len = queue.length;
  const fns = useRef({ haptic, moveInQueue });
  fns.current = { haptic, moveInQueue };

  const resetPending = useRef(false);
  useLayoutEffect(() => {
    if (!resetPending.current || dragFrom !== null) return;
    resetPending.current = false;
    shifts.current.forEach((v) => v.setValue(0));
    dragY.setValue(0);
  }, [queue, dragFrom, dragY]);

  const settleShifts = (from: number, to: number) => {
    shifts.current.forEach((v, i) => {
      let target = 0;
      if (i !== from) {
        if (from < to && i > from && i <= to) target = -ROW_H;
        else if (from > to && i >= to && i < from) target = ROW_H;
      }
      Animated.spring(v, {
        toValue: target,
        useNativeDriver: true,
        speed: 22,
        bounciness: 2,
      }).start();
    });
  };
  const responders = useRef<Record<number, PanResponderInstance>>({});
  const grip = (idx: number) => {
    if (!responders.current[idx]) {
      responders.current[idx] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          live.current.from = idx;
          live.current.to = idx;
          dragY.setValue(0);
          setDragFrom(idx);
          fns.current.haptic('medium');
        },
        onPanResponderMove: (_e, g) => {
          dragY.setValue(g.dy);
          const to = Math.max(0, Math.min(live.current.len - 1, idx + Math.round(g.dy / ROW_H)));
          if (to !== live.current.to) {
            live.current.to = to;
            fns.current.haptic('selection');
            settleShifts(idx, to);
          }
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      });
    }
    return responders.current[idx].panHandlers;
  };
  const finish = () => {
    const { from, to } = live.current;
    if (from < 0) return;
    Animated.spring(dragY, {
      toValue: (to - from) * ROW_H,
      useNativeDriver: true,
      speed: 24,
      bounciness: 0,
    }).start(() => {
      // commit; the offsets are zeroed in the same frame the new order lands (layout effect)
      if (to !== from) fns.current.moveInQueue(from, to);
      live.current.from = -1;
      resetPending.current = true;
      setDragFrom(null);
    });
  };

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

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEnabled={dragFrom === null}
      >
        {queue.map((item, idx) => {
          const current = idx === queueIndex;
          const past = idx < queueIndex;
          const lifted = dragFrom === idx;
          const local = isLocalTrack(item);
          const saved = local || !!downloads[item.id];
          // offline: songs that need the network are skipped — show them greyed out
          const unavailable = !isOnline && !saved && item.source !== 'synth' && !item.synthPreset;
          return (
            <Animated.View
              key={`${item.id}-${idx}`}
              style={[
                lifted ? styles.lifted : null,
                {
                  zIndex: lifted ? 10 : 0,
                  transform: [
                    { translateY: lifted ? dragY : (shifts.current[idx] ?? 0) },
                    { scale: lifted ? 1.03 : 1 },
                  ],
                },
              ]}
            >
              <Tap
                onPress={() => !current && jumpToQueueIndex(idx)}
                disabled={dragFrom !== null}
                style={[
                  styles.row,
                  current && { backgroundColor: palette.container + '66' },
                  lifted && { backgroundColor: '#24242F' },
                  past && !lifted && { opacity: 0.5 },
                  unavailable && !lifted && { opacity: 0.32 },
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {saved || unavailable ? (
                      <Ionicons
                        name={
                          unavailable
                            ? 'cloud-offline-outline'
                            : local
                              ? 'phone-portrait-outline'
                              : 'arrow-down-circle'
                        }
                        size={12}
                        color={
                          unavailable ? HOLYSIC_COLORS.textSecondary : HOLYSIC_COLORS.flacEmerald
                        }
                      />
                    ) : null}
                    <Text numberOfLines={1} style={[styles.rowArtist, { flexShrink: 1 }]}>
                      {item.artist}
                    </Text>
                  </View>
                </View>

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
                {/* the grip: press and drag to move the song; VoiceOver gets up / down actions */}
                <View
                  {...grip(idx)}
                  style={styles.grip}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={vi ? 'Kéo để sắp xếp' : 'Drag to reorder'}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(e) =>
                    e.nativeEvent.actionName === 'increment'
                      ? moveInQueue(idx, idx - 1)
                      : moveInQueue(idx, idx + 1)
                  }
                >
                  <Ionicons
                    name="reorder-three"
                    size={22}
                    color={lifted ? palette.accent : HOLYSIC_COLORS.textMuted}
                  />
                </View>
              </Tap>
            </Animated.View>
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
  grip: {
    width: 36,
    height: ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -6,
  },
  lifted: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    borderRadius: 14,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
