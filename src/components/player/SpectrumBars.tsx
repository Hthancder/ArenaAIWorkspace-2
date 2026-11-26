// Real spectrum visualizer (Cog idea). Draws ONLY real audio: 32 log bands from the audio engine's
// FFT of the PCM that is actually playing (native vDSP FFT on iOS / web AnalyserNode). Bars rise
// fast and fall slowly like a hardware meter, with peak caps that hold and drop. When a stream
// can't be read (HLS on iOS, cross-origin audio on the web) it says so instead of faking bars.
//
// Smoothness: the bars never re-render React. Each bar is a native-driven Animated value moved
// with setValue (applied on the UI thread), as a translateY inside a clipped column, so a frame
// costs 32 tiny native updates instead of a 32-view React render.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { audioEngine, SpectrumStatus } from '../../services/audio/audioEngine';

interface Props {
  isPlaying: boolean;
  color: string;
  /** Second colour: bars blend from `color` (bass) to `colorHigh` (treble) */
  colorHigh?: string;
  height?: number;
  /** Number of bars (the 32 engine bands are resampled) */
  bars?: number;
  /** Peak caps that hold, then fall */
  peaks?: boolean;
  /** Show the "why isn't it moving" line when the stream can't be analysed */
  showStatus?: boolean;
  language?: string;
  /** Kept for API compatibility (no longer used: nothing is faked from the position) */
  positionSec?: number;
}

function resample(src: number[], count: number): number[] {
  if (src.length === count) return src;
  const out = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const a = Math.floor((i * src.length) / count);
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / count));
    let m = 0;
    for (let k = a; k < b && k < src.length; k++) m = Math.max(m, src[k]);
    out[i] = m;
  }
  return out;
}

function mix(c1: string, c2: string, t: number): string {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})/i.exec(h);
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = p(c1);
  const b = p(c2);
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

export const statusText = (s: SpectrumStatus, vi: boolean): string | null => {
  if (s.state === 'waiting')
    return vi ? 'Đang kết nối phổ âm thật…' : 'Connecting to the live spectrum…';
  if (s.state !== 'unsupported') return null;
  if (s.reason === 'hls')
    return vi
      ? 'Luồng HLS: iOS không cho đọc âm thanh để vẽ phổ. Bài từ JioSaavn, Monochrome, Audius, bài đã tải và tệp trên máy có phổ thật.'
      : 'HLS stream: iOS gives no audio samples to draw from. JioSaavn, Monochrome, Audius, downloads and local files show the real spectrum.';
  if (s.reason === 'cors')
    return vi
      ? 'Trình duyệt chặn đọc âm thanh của nguồn này (CORS) — trên iPhone sẽ có phổ thật.'
      : 'The browser blocks reading this source (CORS) — the iPhone app shows the real spectrum.';
  return vi
    ? 'iOS không mở được bộ đọc âm thanh cho luồng này.'
    : "iOS couldn't open an audio tap for this stream.";
};

export const SpectrumBars: React.FC<Props> = React.memo(
  ({
    isPlaying,
    color,
    colorHigh,
    height = 36,
    bars = 12,
    peaks = false,
    showStatus = false,
    language = 'vi',
  }) => {
    const [status, setStatus] = useState<SpectrumStatus>({ state: 'idle' });
    const vals = useMemo(
      () => Array.from({ length: bars }, () => new Animated.Value(0)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [bars]
    );
    const peakVals = useMemo(
      () => Array.from({ length: bars }, () => new Animated.Value(0)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [bars]
    );
    const smooth = useRef<number[]>(new Array(bars).fill(0));
    const peakVal = useRef<number[]>(new Array(bars).fill(0));
    const peakHold = useRef<number[]>(new Array(bars).fill(0));

    // move the values to the native driver once, so every later setValue runs on the UI thread
    useEffect(() => {
      const kick = [...vals, ...peakVals].map((v) =>
        Animated.timing(v, { toValue: 0, duration: 1, useNativeDriver: true })
      );
      Animated.parallel(kick).start();
    }, [vals, peakVals]);

    const push = () => {
      const s = smooth.current;
      for (let i = 0; i < bars; i++) {
        vals[i].setValue(s[i]);
        if (peaks) peakVals[i].setValue(peakVal.current[i]);
      }
    };

    useEffect(() => {
      smooth.current = new Array(bars).fill(0);
      peakVal.current = new Array(bars).fill(0);
      peakHold.current = new Array(bars).fill(0);
      const unsubS = audioEngine.subscribeSpectrumStatus(setStatus);
      const unsub = audioEngine.subscribeSpectrum((raw) => {
        const b = resample(raw, bars);
        const now = Date.now();
        const s = smooth.current;
        for (let i = 0; i < bars; i++) {
          const prev = s[i] || 0;
          const v = b[i];
          // fast attack, slow release — like a hardware meter
          s[i] = v > prev ? prev + (v - prev) * 0.7 : prev + (v - prev) * 0.18;
          if (peaks) {
            if (s[i] >= peakVal.current[i]) {
              peakVal.current[i] = s[i];
              peakHold.current[i] = now + 450;
            } else if (now > peakHold.current[i]) {
              peakVal.current[i] = Math.max(s[i], peakVal.current[i] - 0.022);
            }
          }
        }
        push();
      });
      return () => {
        unsub();
        unsubS();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bars, peaks, vals, peakVals]);

    // When paused or the stream can't be read, let the real bars fall to rest
    useEffect(() => {
      if (isPlaying && status.state === 'live') return;
      const t = setInterval(() => {
        let any = false;
        const s = smooth.current;
        for (let i = 0; i < bars; i++) {
          s[i] = s[i] * 0.8 > 0.01 ? s[i] * 0.8 : 0;
          if (s[i] > 0) any = true;
          peakVal.current[i] = Math.max(0, peakVal.current[i] - 0.04);
          if (peakVal.current[i] > 0) any = true;
        }
        push();
        if (!any) clearInterval(t);
      }, 33);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, status.state, bars]);

    const note = showStatus ? statusText(status, language === 'vi') : null;
    const gap = bars > 20 ? 3 : 4;
    const colH = height + 6;
    const colors = useMemo(
      () =>
        Array.from({ length: bars }, (_, idx) =>
          colorHigh ? mix(color, colorHigh, idx / Math.max(1, bars - 1)) : color
        ),
      [bars, color, colorHigh]
    );
    const live = status.state === 'live';
    return (
      <View>
        <View style={[styles.row, { height: colH, gap }]}>
          {colors.map((c, idx) => (
            <View key={idx} style={[styles.col, { height: colH }]}>
              {/* a full-height bar slid down: 0 → 3 pt visible, 1 → full height */}
              <Animated.View
                style={[
                  styles.bar,
                  {
                    height: colH,
                    backgroundColor: c,
                    opacity: live ? 0.95 : 0.35,
                    borderRadius: bars > 20 ? 2 : 3,
                    transform: [
                      {
                        translateY: vals[idx].interpolate({
                          inputRange: [0, 1],
                          outputRange: [colH - 3, colH - 3 - height],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
              {peaks && (
                <Animated.View
                  style={[
                    styles.peak,
                    {
                      backgroundColor: c,
                      opacity: peakVals[idx].interpolate({
                        inputRange: [0, 0.03, 0.06],
                        outputRange: [0, 0, 0.9],
                        extrapolate: 'clamp',
                      }),
                      transform: [
                        {
                          translateY: peakVals[idx].interpolate({
                            inputRange: [0, 1],
                            outputRange: [-5, -5 - height],
                            extrapolate: 'clamp',
                          }),
                        },
                      ],
                    },
                  ]}
                />
              )}
            </View>
          ))}
        </View>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  col: { flex: 1, maxWidth: 10, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, right: 0, top: 0 },
  peak: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, borderRadius: 1 },
  note: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
});
