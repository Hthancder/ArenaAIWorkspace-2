// Spectrum visualizer (Cog). Real FFT bands from the audio engine when the platform can tap PCM
// (iOS progressive/FLAC streams, web with Audio Lab DSP); otherwise a gentle animated stand-in.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { audioEngine } from '../../services/audio/audioEngine';

interface Props {
  isPlaying: boolean;
  positionSec: number;
  color: string;
  height?: number;
}

const FALLBACK = [0.4, 0.85, 0.6, 1.0, 0.72, 0.92, 0.5, 0.88, 0.65, 0.45, 0.78, 0.55];

export const SpectrumBars: React.FC<Props> = ({ isPlaying, positionSec, color, height = 36 }) => {
  const [bands, setBands] = useState<number[] | null>(null);
  const smooth = useRef<number[]>(new Array(12).fill(0));
  const lastReal = useRef(0);

  useEffect(() => {
    const unsub = audioEngine.subscribeSpectrum((b) => {
      lastReal.current = Date.now();
      // fast attack, slow release — like a hardware meter
      smooth.current = b.map((v, i) => {
        const prev = smooth.current[i] || 0;
        return v > prev ? prev + (v - prev) * 0.6 : prev + (v - prev) * 0.18;
      });
      setBands([...smooth.current]);
    });
    return unsub;
  }, []);

  const live = bands && Date.now() - lastReal.current < 1500;
  return (
    <View style={[styles.row, { height: height + 8 }]}>
      {FALLBACK.map((h, idx) => {
        const v = live
          ? 4 + bands![idx] * height
          : isPlaying
            ? 8 + (Math.sin(positionSec * 5 + idx) + 1) * (height / 2.6) * h
            : 5;
        return (
          <View
            key={idx}
            style={[styles.bar, { height: isPlaying || live ? v : 5, backgroundColor: color }]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  bar: { width: 6, borderRadius: 3, opacity: 0.92 },
});
