// Song Row Component with active equalizer bars, Offline/FLAC badges, Like & Menu

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from './ArtworkImage';
import { HOLYSIC_COLORS, resolveFontFamily } from '../constants/theme';
import { useHolySic } from '../context/HolySicContext';
import { Track } from '../types/music';
import { formatTimeSec } from './HolySicIcons';

interface TrackRowProps {
  track: Track;
  queueContext?: Track[];
  indexBadge?: number;
  compact?: boolean;
  onRemove?: () => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  queueContext,
  indexBadge,
  compact = false,
  onRemove,
}) => {
  const {
    currentTrack,
    isPlaying,
    playTrack,
    togglePlay,
    isLiked,
    toggleLike,
    setActionTrack,
    downloads,
    downloadingIds,
    palette,
    prefs,
  } = useHolySic();

  const active = currentTrack?.id === track.id;
  const liked = isLiked(track.id);
  const isOffline = Boolean(downloads[track.id]);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const handlePress = () => {
    if (active) {
      togglePlay();
    } else {
      playTrack(track, queueContext);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        active && { backgroundColor: palette.container + '55' },
        pressed && { opacity: 0.78 },
      ]}
    >
      {indexBadge !== undefined && (
        <Text
          style={[
            styles.indexNum,
            { color: active ? palette.accent : HOLYSIC_COLORS.textMuted, fontFamily },
          ]}
        >
          {indexBadge}
        </Text>
      )}

      <View style={styles.artWrap}>
        <ArtworkImage source={{ uri: track.artworkUrl }} style={styles.art} />
        {active && (
          <View style={styles.playingOverlay}>
            <Ionicons name={isPlaying ? 'stats-chart' : 'pause'} size={16} color={palette.accent} />
          </View>
        )}
      </View>

      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <Text
            numberOfLines={1}
            style={[
              styles.title,
              {
                color: active ? palette.accent : HOLYSIC_COLORS.textPrimary,
                fontFamily,
              },
            ]}
          >
            {track.title}
          </Text>
          {track.explicit && (
            <View style={styles.explicitBadge}>
              <Text style={styles.explicitText}>E</Text>
            </View>
          )}
        </View>

        <View style={styles.subRow}>
          {isOffline && (
            <Ionicons
              name="arrow-down-circle"
              size={13}
              color={HOLYSIC_COLORS.flacEmerald}
              style={{ marginRight: 4 }}
            />
          )}
          {isDownloading && (
            <Ionicons
              name="cloud-download-outline"
              size={13}
              color={HOLYSIC_COLORS.iosBlue}
              style={{ marginRight: 4 }}
            />
          )}
          <Text numberOfLines={1} style={[styles.subtitle, { fontFamily }]}>
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
      </View>

      {track.qualityBadge && !compact && (
        <View
          style={[
            styles.qualityPill,
            track.qualityBadge.includes('FLAC') && {
              borderColor: 'rgba(52, 211, 153, 0.4)',
              backgroundColor: 'rgba(52, 211, 153, 0.10)',
            },
          ]}
        >
          <Text
            style={[
              styles.qualityText,
              track.qualityBadge.includes('FLAC') && { color: HOLYSIC_COLORS.flacEmerald },
            ]}
          >
            {track.qualityBadge.includes('FLAC')
              ? 'FLAC'
              : track.qualityBadge.includes('320')
                ? '320k'
                : track.source === 'synth'
                  ? 'LAB'
                  : 'AAC'}
          </Text>
        </View>
      )}

      <Text
        style={[
          styles.duration,
          { fontFamily },
          track.isLive && { color: '#F87171', fontWeight: '900' },
        ]}
      >
        {track.isLive ? 'LIVE' : formatTimeSec(track.durationSec)}
      </Text>

      <Pressable
        hitSlop={8}
        onPress={(e) => {
          e.stopPropagation?.();
          toggleLike(track);
        }}
        style={styles.iconBtn}
      >
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={19}
          color={liked ? HOLYSIC_COLORS.roseLike : HOLYSIC_COLORS.textMuted}
        />
      </Pressable>

      {onRemove ? (
        <Pressable
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            onRemove();
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="close-circle-outline" size={19} color={HOLYSIC_COLORS.textMuted} />
        </Pressable>
      ) : (
        <Pressable
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation?.();
            setActionTrack(track);
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={HOLYSIC_COLORS.textSecondary} />
        </Pressable>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginVertical: 2,
  },
  rowCompact: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  indexNum: {
    width: 24,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginRight: 6,
  },
  artWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1E1E28',
    marginRight: 12,
  },
  art: {
    width: '100%',
    height: '100%',
  },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  explicitBadge: {
    marginLeft: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  explicitText: {
    color: '#D8D8E2',
    fontSize: 9,
    fontWeight: '800',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  subtitle: {
    fontSize: 12.5,
    color: HOLYSIC_COLORS.textSecondary,
    flexShrink: 1,
  },
  qualityPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 8,
  },
  qualityText: {
    color: HOLYSIC_COLORS.textSecondary,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  duration: {
    fontSize: 12,
    color: HOLYSIC_COLORS.textMuted,
    marginRight: 6,
    minWidth: 34,
    textAlign: 'right',
  },
  iconBtn: {
    padding: 5,
    marginLeft: 2,
  },
});
