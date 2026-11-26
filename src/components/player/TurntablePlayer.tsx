// HolySic Turntable Player Look — Spinning Vinyl LP Record + Pivoted Tonearm Seek Indicator

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { ArtworkImage } from '../ArtworkImage';
import { useHolySic } from '../../context/HolySicContext';

export const TurntableVinylStage: React.FC = () => {
  const { currentTrack, isPlaying, positionSec, durationSec, palette } = useHolySic();
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (isPlaying) {
      spinAnim.setValue(0);
      loop = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 9000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      loop.start();
    } else {
      spinAnim.stopAnimation();
    }
    return () => {
      loop?.stop();
    };
  }, [isPlaying, spinAnim]);

  if (!currentTrack) return null;

  const spinDeg = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progress = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  // Tonearm sweeps gently from 14deg (outer groove) to 34deg (inner groove) when playing, 0deg parked
  const armAngle = isPlaying ? 14 + progress * 20 : 2;

  return (
    <View style={styles.deckWrap}>
      <View style={[styles.plinth, { borderColor: palette.accent + '28' }]}>
        {/* Vinyl LP Record */}
        <Animated.View style={[styles.vinylDisc, { transform: [{ rotate: spinDeg }] }]}>
          <View style={styles.groove1} />
          <View style={styles.groove2} />
          <View style={styles.groove3} />

          {/* Center Artwork Label */}
          <View style={[styles.centerLabel, { borderColor: palette.accent }]}>
            <ArtworkImage source={{ uri: currentTrack.artworkUrl }} style={styles.labelArt} />
            <View style={styles.spindleHole} />
          </View>
        </Animated.View>

        {/* Tonearm Pivot & Arm */}
        <View style={styles.pivotBase}>
          <View style={[styles.tonearmAssembly, { transform: [{ rotate: `${armAngle}deg` }] }]}>
            <View style={styles.armShaft} />
            <View style={[styles.cartridgeHead, { backgroundColor: palette.accent }]} />
          </View>
          <View style={styles.pivotCap} />
        </View>

        {/* RPM Indicator */}
        <View style={styles.rpmBadge}>
          <View style={[styles.rpmDot, { backgroundColor: isPlaying ? '#34D399' : '#71717A' }]} />
          <Text style={styles.rpmText}>33⅓ RPM · HOLYSIC DIRECT DRIVE</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  deckWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  plinth: {
    width: 306,
    height: 306,
    borderRadius: 34,
    backgroundColor: 'rgba(14, 14, 20, 0.82)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  vinylDisc: {
    width: 252,
    height: 252,
    borderRadius: 126,
    backgroundColor: '#0E0E12',
    borderWidth: 4,
    borderColor: '#23232D',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  groove1: {
    position: 'absolute',
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  groove2: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  groove3: {
    position: 'absolute',
    width: 156,
    height: 156,
    borderRadius: 78,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  centerLabel: {
    width: 108,
    height: 108,
    borderRadius: 54,
    overflow: 'hidden',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelArt: {
    width: '100%',
    height: '100%',
  },
  spindleHole: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#111116',
    borderWidth: 2,
    borderColor: '#D4D4DC',
  },
  pivotBase: {
    position: 'absolute',
    top: 24,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#272733',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pivotCap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D4D4DE',
  },
  tonearmAssembly: {
    position: 'absolute',
    top: 22,
    width: 8,
    height: 178,
    alignItems: 'center',
    transformOrigin: 'top center',
  },
  armShaft: {
    width: 5,
    height: 162,
    borderRadius: 3,
    backgroundColor: '#C4C4D0',
  },
  cartridgeHead: {
    width: 14,
    height: 22,
    borderRadius: 4,
    marginTop: -4,
  },
  rpmBadge: {
    position: 'absolute',
    bottom: 11,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rpmDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  rpmText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
});
