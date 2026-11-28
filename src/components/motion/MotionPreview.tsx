// Live preview for Settings › Motion effects: a small cover that turns, shows its edge and
// floats over its shadow exactly as the player's will. Holds the sensor only while it is on screen.

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { T as UI } from '../../theme/ui';
import { ArtworkImage } from '../ArtworkImage';
import { useAmbientColors } from '../ambient/AmbientLight';
import { TiltCard, useTilt } from './TiltLayers';

const SIZE = 132;

export const MotionPreview: React.FC<{ cover: boolean; edge?: boolean }> = ({
  cover,
  edge = true,
}) => {
  const { currentTrack, palette, prefs } = useHolySic();
  const vi = prefs.language === 'vi';
  const tilt = useTilt(true);
  const on = tilt.on && cover;
  const amb = useAmbientColors();
  return (
    <View
      style={styles.wrap}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <TiltCard
        on={on}
        maxDeg={11}
        float={4}
        depth={edge ? 5 : 0}
        radius={18}
        crisp
        glass={amb.corners}
        shadowTint={amb.dark}
      >
        <View style={styles.card}>
          {currentTrack?.artworkUrl ? (
            <ArtworkImage
              source={{ uri: currentTrack.artworkUrl }}
              fallbackSeed={currentTrack.title}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <LinearGradient
              colors={[palette.accent, '#1B1036', '#07070B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}
        </View>
      </TiltCard>
      <Text style={[styles.hint, { color: UI.text3 }]}>
        {!tilt.on
          ? vi
            ? 'Đang tắt'
            : 'Off'
          : !cover
            ? vi
              ? 'Bìa nghiêng 3D đang tắt'
              : '3D cover is off'
            : vi
              ? 'Nghiêng máy để thử'
              : 'Tilt your phone to try'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 14 },
  card: {
    width: SIZE,
    height: SIZE,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#191922',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hint: { marginTop: 12, fontSize: 12, fontWeight: '600' },
});
