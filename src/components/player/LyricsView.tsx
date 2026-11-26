// Synchronized Word-by-Word & Line-Synced Glowing Lyrics View — ported from LyricsScreen.kt & LyricsGlowLine.kt

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../constants/i18n';
import { LyricsPosition } from '../../constants/preferences';
import { HOLYSIC_COLORS, resolveFontFamily } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { usePositionSec } from '../../services/audio/playbackClock';
import { Tap } from '../ui/Tap';

export const LyricsView: React.FC = () => {
  const {
    lyrics,
    isLoadingLyrics,
    reloadLyrics,
    currentTrack,
    activeLyricIndex,
    seekTo,
    darkPalette: palette,
    prefs,
    updatePrefs,
    haptic,
    lyricsOffsetSec,
    nudgeLyricsOffset,
  } = useHolySic();
  const positionSec = usePositionSec();
  const vi = prefs.language === 'vi';

  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  useEffect(() => {
    if (activeLyricIndex >= 0 && scrollRef.current) {
      const estimatedY = Math.max(0, activeLyricIndex * 62 - 120);
      scrollRef.current.scrollTo({ y: estimatedY, animated: true });
    }
  }, [activeLyricIndex]);

  const cycleAlign = () => {
    haptic('selection');
    const order: LyricsPosition[] = ['LEFT', 'CENTER', 'RIGHT'];
    const next = order[(order.indexOf(prefs.lyricsPosition) + 1) % order.length];
    updatePrefs({ lyricsPosition: next });
  };

  if (isLoadingLyrics) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={[styles.helperText, { fontFamily }]}>
          {t(prefs.language, 'searchingLyrics')}
        </Text>
      </View>
    );
  }

  if (!lyrics || lyrics.lines.length === 0) {
    const live = !!currentTrack?.isLive;
    return (
      <View style={styles.centerBox}>
        <Ionicons
          name={live ? 'radio-outline' : 'musical-notes-outline'}
          size={44}
          color={HOLYSIC_COLORS.textMuted}
        />
        <Text style={[styles.helperText, { fontFamily }]}>
          {live
            ? vi
              ? 'Radio trực tiếp không có lời bài hát'
              : 'Live radio has no lyrics'
            : t(prefs.language, 'noLyrics')}
        </Text>
        {!live && currentTrack && (
          <Tap
            onPress={() => {
              haptic('light');
              reloadLyrics();
            }}
            style={[styles.retryBtn, { borderColor: palette.accent + '55' }]}
            accessibilityRole="button"
          >
            <Ionicons name="refresh" size={15} color={palette.accent} />
            <Text style={[styles.retryText, { color: palette.accent }]}>
              {vi ? 'Tìm lại' : 'Search again'}
            </Text>
          </Tap>
        )}
      </View>
    );
  }

  const baseAlign =
    prefs.lyricsPosition === 'CENTER'
      ? 'center'
      : prefs.lyricsPosition === 'RIGHT'
        ? 'right'
        : 'left';

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.providerBadge}>
          <Ionicons name="sparkles" size={12} color={palette.accent} />
          <Text numberOfLines={1} style={[styles.providerText, { color: palette.accent }]}>
            {lyrics.provider === 'Local'
              ? vi
                ? 'Tệp trên máy'
                : 'Local file'
              : lyrics.provider === 'Built-in'
                ? 'HolySic'
                : lyrics.provider}
            {lyrics.wordSynced
              ? vi
                ? ' · Theo từng chữ'
                : ' · Word-synced'
              : lyrics.synced
                ? vi
                  ? ' · Đồng bộ'
                  : ' · Synced'
                : vi
                  ? ' · Không đồng bộ'
                  : ' · Plain'}
          </Text>
        </View>

        {lyrics.synced && (
          <View style={styles.offsetGroup}>
            <Tap
              feedback="opacity"
              onPress={() => nudgeLyricsOffset(-500)}
              hitSlop={6}
              style={styles.offsetBtn}
              accessibilityLabel={vi ? 'Lời sớm hơn 0,5 giây' : 'Lyrics 0.5s earlier'}
            >
              <Ionicons name="remove" size={14} color="#FFF" />
            </Tap>
            <Tap
              onPress={() => nudgeLyricsOffset('reset')}
              onLongPress={() => nudgeLyricsOffset('reset')}
              style={styles.offsetLabelWrap}
            >
              <Text
                style={[styles.offsetLabel, lyricsOffsetSec !== 0 && { color: palette.accent }]}
              >
                {lyricsOffsetSec === 0
                  ? vi
                    ? 'Lệch 0s'
                    : 'Sync 0s'
                  : `${lyricsOffsetSec > 0 ? '+' : ''}${lyricsOffsetSec.toFixed(1)}s`}
              </Text>
            </Tap>
            <Tap
              feedback="opacity"
              onPress={() => nudgeLyricsOffset(500)}
              hitSlop={6}
              style={styles.offsetBtn}
              accessibilityLabel={vi ? 'Lời trễ hơn 0,5 giây' : 'Lyrics 0.5s later'}
            >
              <Ionicons name="add" size={14} color="#FFF" />
            </Tap>
          </View>
        )}

        <Tap onPress={cycleAlign} style={styles.alignBtn}>
          <Ionicons
            name={
              prefs.lyricsPosition === 'CENTER'
                ? 'Menu' in Ionicons.glyphMap
                  ? 'reorder-three-outline'
                  : 'text-outline'
                : 'reorder-two-outline'
            }
            size={16}
            color="#FFF"
          />
        </Tap>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {lyrics.lines.map((line, idx) => {
          const isActive = idx === activeLyricIndex;
          const isPast = idx < activeLyricIndex;
          const isDuetV2 = line.agent && line.agent.toLowerCase().includes('2');
          const textAlign = line.isBackground ? 'center' : isDuetV2 ? 'right' : baseAlign;

          return (
            <Tap
              feedback="opacity"
              key={line.id}
              onPress={() => {
                haptic('selection');
                seekTo(Math.max(0, line.startSec + lyricsOffsetSec));
              }}
              style={[
                styles.lineWrap,
                isActive && {
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderRadius: 16,
                },
              ]}
            >
              {line.words && line.words.length > 0 && isActive ? (
                <Text style={[styles.lineTextActive, { textAlign, fontFamily }]}>
                  {line.words.map((w, wIdx) => {
                    const lit = positionSec - lyricsOffsetSec + 0.08 >= w.startSec;
                    return (
                      <Text
                        key={`${line.id}-w-${wIdx}`}
                        style={{
                          color: lit ? '#FFFFFF' : 'rgba(255,255,255,0.38)',
                          textShadowColor: lit ? palette.accent : 'transparent',
                          textShadowRadius: lit ? 12 : 0,
                        }}
                      >
                        {w.text}
                        {wIdx < line.words!.length - 1 ? ' ' : ''}
                      </Text>
                    );
                  })}
                </Text>
              ) : (
                <Text
                  style={[
                    line.isBackground ? styles.bgLineText : styles.lineText,
                    isActive && styles.lineTextActive,
                    isActive && {
                      color: '#FFFFFF',
                      textShadowColor: palette.accent + '88',
                      textShadowRadius: 14,
                    },
                    !isActive && {
                      color: isPast ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.52)',
                    },
                    { textAlign, fontFamily },
                  ]}
                >
                  {line.text}
                </Text>
              )}
            </Tap>
          );
        })}

        <Text style={styles.footerText}>
          {lyrics.provider === 'Local'
            ? 'Lyrics from the song file (.lrc / embedded tags) · HolySic'
            : `Lyrics powered by ${lyrics.provider} · HolySic Open Lyrics`}
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  helperText: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: { fontSize: 13.5, fontWeight: '700' },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  providerBadge: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  providerText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: '700',
  },
  offsetGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 8,
    marginRight: 8,
  },
  offsetBtn: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center' },
  offsetLabelWrap: { paddingHorizontal: 2 },
  offsetLabel: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '800',
    minWidth: 46,
    textAlign: 'center',
  },
  alignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    paddingVertical: 20,
    paddingHorizontal: 8,
    paddingBottom: 90,
  },
  lineWrap: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginVertical: 2,
  },
  lineText: {
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 30,
  },
  lineTextActive: {
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 35,
  },
  bgLineText: {
    fontSize: 16.5,
    fontStyle: 'italic',
    fontWeight: '600',
    lineHeight: 24,
  },
  footerText: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 28,
  },
});
