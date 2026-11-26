// Real spectrum visualizer (Cog idea). Draws ONLY real audio: 32 log bands from the audio engine's
// FFT of the PCM that is actually playing (iOS tap / web AnalyserNode). Bars rise fast and fall
// slowly like a hardware meter, with peak caps that hold and drop. When a stream can't be read
// (HLS on iOS, cross-origin audio on the web) it says so instead of animating fake bars.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

export const SpectrumBars: React.FC<Props> = ({
  isPlaying,
  color,
  colorHigh,
  height = 36,
  bars = 12,
  peaks = false,
  showStatus = false,
  language = 'vi',
}) => {
  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(0));
  const [status, setStatus] = useState<SpectrumStatus>({ state: 'idle' });
  const smooth = useRef<number[]>(new Array(bars).fill(0));
  const peakVal = useRef<number[]>(new Array(bars).fill(0));
  const peakHold = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    smooth.current = new Array(bars).fill(0);
    peakVal.current = new Array(bars).fill(0);
    peakHold.current = new Array(bars).fill(0);
    const unsubS = audioEngine.subscribeSpectrumStatus(setStatus);
    const unsub = audioEngine.subscribeSpectrum((raw) => {
      const b = resample(raw, bars);
      const now = Date.now();
      smooth.current = b.map((v, i) => {
        const prev = smooth.current[i] || 0;
        // fast attack, slow release — like a hardware meter
        return v > prev ? prev + (v - prev) * 0.65 : prev + (v - prev) * 0.2;
      });
      if (peaks) {
        smooth.current.forEach((v, i) => {
          if (v >= peakVal.current[i]) {
            peakVal.current[i] = v;
            peakHold.current[i] = now + 450;
          } else if (now > peakHold.current[i]) {
            peakVal.current[i] = Math.max(v, peakVal.current[i] - 0.025);
          }
        });
      }
      setLevels([...smooth.current]);
    });
    return () => {
      unsub();
      unsubS();
    };
  }, [bars, peaks]);

  // When paused or the stream can't be read, let the real bars fall to rest
  useEffect(() => {
    if (isPlaying && status.state === 'live') return;
    const t = setInterval(() => {
      let any = false;
      smooth.current = smooth.current.map((v) => {
        const n = v * 0.8;
        if (n > 0.01) any = true;
        return n > 0.01 ? n : 0;
      });
      peakVal.current = peakVal.current.map((v) => Math.max(0, v - 0.04));
      setLevels([...smooth.current]);
      if (!any) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [isPlaying, status.state]);

  const note = showStatus ? statusText(status, language === 'vi') : null;
  const gap = bars > 20 ? 3 : 4;
  return (
    <View>
      <View style={[styles.row, { height: height + 6, gap }]}>
        {levels.map((v, idx) => {
          const c = colorHigh ? mix(color, colorHigh, idx / Math.max(1, bars - 1)) : color;
          const h = 3 + v * height;
          return (
            <View key={idx} style={[styles.col, { height: height + 6 }]}>
              {peaks && peakVal.current[idx] > 0.03 && (
                <View
                  style={[
                    styles.peak,
                    { bottom: 3 + peakVal.current[idx] * height + 2, backgroundColor: c },
                  ]}
                />
              )}
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: c,
                    opacity: status.state === 'live' ? 0.95 : 0.35,
                    borderRadius: bars > 20 ? 2 : 3,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  col: { flex: 1, justifyContent: 'flex-end', maxWidth: 10 },
  bar: { width: '100%' },
  peak: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1, opacity: 0.9 },
  note: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
});
