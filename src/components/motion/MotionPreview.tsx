// Live preview for Settings › Motion effects: a small cover that turns, catches the light and
// shows the foil exactly as the player will. Holds the sensor only while it is on screen.

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { T as UI } from '../../theme/ui';
import { ArtworkImage } from '../ArtworkImage';
import { CoverSheen, TiltCard, useTilt } from './TiltLayers';

const SIZE = 132;

export const MotionPreview: React.FC<{ holo: boolean; cover: boolean }> = ({ holo, cover }) => {
  const { currentTrack, palette, prefs } = useHolySic();
  const vi = prefs.language === 'vi';
  const tilt = useTilt(true);
  const on = tilt.on && cover;
  return (
    <View
      style={styles.wrap}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <TiltCard on={on} maxDeg={11} float={4}>
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
          <CoverSheen on={on} size={SIZE} holo={holo} />
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
