// Synchronized Word-by-Word & Line-Synced Glowing Lyrics View — ported from LyricsScreen.kt & LyricsGlowLine.kt

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { t } from '../../constants/i18n';
import { LyricsPosition } from '../../constants/preferences';
import { MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';

export const LyricsView: React.FC = () => {
  const {
    lyrics,
    isLoadingLyrics,
    activeLyricIndex,
    positionSec,
    seekTo,
    palette,
    prefs,
    updatePrefs,
    haptic,
  } = useMochy();

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
    return (
      <View style={styles.centerBox}>
        <Ionicons name="musical-notes-outline" size={44} color={MOCHY_COLORS.textMuted} />
        <Text style={[styles.helperText, { fontFamily }]}>
          {t(prefs.language, 'noLyrics')}
        </Text>
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
          <Text style={[styles.providerText, { color: palette.accent }]}>
            {lyrics.provider}
            {lyrics.wordSynced
              ? ' · Word-Synced'
              : lyrics.synced
                ? ' · Synced LRC'
                : ' · Plain'}
          </Text>
        </View>

        <Pressable onPress={cycleAlign} style={styles.alignBtn}>
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
          <Text style={styles.alignLabel}>{prefs.lyricsPosition}</Text>
        </Pressable>
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
          const textAlign = line.isBackground
            ? 'center'
            : isDuetV2
              ? 'right'
              : baseAlign;

          return (
            <Pressable
              key={line.id}
              onPress={() => {
                haptic('selection');
                seekTo(line.startSec);
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
                    const lit = positionSec + 0.08 >= w.startSec;
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
                      color: isPast
                        ? 'rgba(255,255,255,0.30)'
                        : 'rgba(255,255,255,0.52)',
                    },
                    { textAlign, fontFamily },
                  ]}
                >
                  {line.text}
                </Text>
              )}
            </Pressable>
          );
        })}

        <Text style={styles.footerText}>
          Lyrics powered by {lyrics.provider} · Mochy Music Open Lyrics
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
    color: MOCHY_COLORS.textSecondary,
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 21,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  providerText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  alignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  alignLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
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
