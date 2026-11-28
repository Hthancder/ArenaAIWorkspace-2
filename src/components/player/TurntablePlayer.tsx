// HolySic Turntable Player Look — Spinning Vinyl LP Record + Pivoted Tonearm Seek Indicator

import React, { useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSpin } from '../../hooks/useSpin';
import { ArtworkImage } from '../ArtworkImage';
import { useHolySic } from '../../context/HolySicContext';
import { usePositionSec } from '../../services/audio/playbackClock';
import { useAppActive } from '../../services/appActivity';
import { Tilt } from '../../services/motion/tilt';
import { VinylSheen } from '../motion/VinylDepth';

/** `motion` = tilt effects on: the record floats above the plinth, its shadow and the groove
 *  light follow the angle (the deck itself is turned by the player's TiltCard) */
export const TurntableVinylStage: React.FC<{ motion?: boolean }> = ({ motion = false }) => {
  const { currentTrack, isPlaying, durationSec, darkPalette: palette } = useHolySic();
  const positionSec = usePositionSec();
  const active = useAppActive();
  const spinning = isPlaying && active;
  const spinAnim = useSpin(spinning);
  // the record sits a few points above the plinth: it moves against the eye, its shadow with it
  const floatMove = useMemo(
    () => ({
      transform: [
        { translateX: Animated.multiply(Tilt.x, -4) },
        { translateY: Animated.multiply(Tilt.y, -4) },
      ],
    }),
    []
  );
  const shadowMove = useMemo(
    () => ({
      transform: [
        { translateX: Animated.multiply(Tilt.x, 7) },
        { translateY: Animated.add(Animated.multiply(Tilt.y, 7), 6) },
      ],
    }),
    []
  );

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
        {/* Vinyl LP Record — the wrapper floats (tilt), the disc spins: separate nodes */}
        <View style={styles.discSlot}>
          {motion && <Animated.View style={[styles.discShadow, shadowMove]} />}
          <Animated.View style={motion ? floatMove : undefined}>
            <Animated.View style={[styles.vinylDisc, { transform: [{ rotate: spinDeg }] }]}>
              <View style={styles.groove1} />
              <View style={styles.groove2} />
              <View style={styles.groove3} />

              {/* Center Artwork Label */}
              <View style={[styles.centerLabel, { borderColor: palette.accent }]}>
                <ArtworkImage
                  source={{ uri: currentTrack.artworkUrl }}
                  fallbackSeed={currentTrack.title}
                  style={styles.labelArt}
                />
                <View style={styles.spindleHole} />
              </View>
            </Animated.View>
            <VinylSheen on={motion} size={252} label={0.43} />
          </Animated.View>
        </View>

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
  discSlot: {
    width: 252,
    height: 252,
    marginRight: 16,
  },
  discShadow: {
    position: 'absolute',
    width: 252,
    height: 252,
    borderRadius: 126,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
