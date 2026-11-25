// Curated seed catalog, Moods & Genres, and AutoEQ Headphone Presets for Mochy Music iOS

import { EqualizerBand, LyricLine, Track } from '../types/music';

export interface MoodCategory {
  id: string;
  labelVi: string;
  labelEn: string;
  query: string;
  colors: [string, string];
  icon: string;
}

export const MOOD_CATEGORIES: MoodCategory[] = [
  { id: 'vpop', labelVi: 'V-Pop Thịnh Hành', labelEn: 'V-Pop Hits', query: 'V-Pop hits Sơn Tùng tlinh Vũ', colors: ['#7C3AED', '#2563EB'], icon: 'sparkles' },
  { id: 'chill', labelVi: 'Thư Giãn & Lo-Fi', labelEn: 'Chill & Lo-Fi', query: 'lofi chill beats study', colors: ['#0F766E', '#1E3A8A'], icon: 'moon' },
  { id: 'indie-vn', labelVi: 'Indie Việt', labelEn: 'Vietnam Indie', query: 'Ngọt Cá Hồi Hoang Vũ Đen Vâu', colors: ['#B45309', '#7C2D12'], icon: 'musical-notes' },
  { id: 'rnb', labelVi: 'R&B / Soul Đêm Khuya', labelEn: 'Late Night R&B', query: 'The Weeknd Joji SZA Frank Ocean', colors: ['#9D174D', '#311042'], icon: 'heart' },
  { id: 'focus', labelVi: 'Tập Trung Sâu', labelEn: 'Deep Focus', query: 'ambient piano focus Hans Zimmer', colors: ['#1D4ED8', '#0F172A'], icon: 'planet' },
  { id: 'jpop', labelVi: 'J-Pop / Anime', labelEn: 'J-Pop & Anime', query: 'YOASOBI Kenshi Yonezu Ado Fujii Kaze', colors: ['#DB2777', '#4F46E5'], icon: 'flash' },
  { id: 'kpop', labelVi: 'K-Pop Mới Nhất', labelEn: 'K-Pop Radar', query: 'NewJeans aespa Jennie BTS', colors: ['#059669', '#0284C7'], icon: 'star' },
  { id: 'electronic', labelVi: 'Synthwave & EDM', labelEn: 'Synth & Electronic', query: 'Daft Punk Fred again Porter Robinson', colors: ['#6D28D9', '#BE185D'], icon: 'pulse' },
];

export const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  { freqHz: 32, label: '32', gainDb: 0 },
  { freqHz: 64, label: '64', gainDb: 0 },
  { freqHz: 125, label: '125', gainDb: 0 },
  { freqHz: 250, label: '250', gainDb: 0 },
  { freqHz: 500, label: '500', gainDb: 0 },
  { freqHz: 1000, label: '1k', gainDb: 0 },
  { freqHz: 2000, label: '2k', gainDb: 0 },
  { freqHz: 4000, label: '4k', gainDb: 0 },
  { freqHz: 8000, label: '8k', gainDb: 0 },
  { freqHz: 16000, label: '16k', gainDb: 0 },
];

export interface AutoEqPreset {
  id: string;
  name: string;
  category: 'Standard' | 'AutoEQ Apple' | 'AutoEQ Audiophile';
  gains: [number, number, number, number, number, number, number, number, number, number];
}

export const AUTO_EQ_PRESETS: AutoEqPreset[] = [
  { id: 'flat', name: 'Flat (Studio Bypass)', category: 'Standard', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass_boost', name: 'Mochy Sub-Bass Punch', category: 'Standard', gains: [6.5, 5.5, 3.8, 1.5, 0, -0.5, 0.5, 1.5, 2.0, 2.0] },
  { id: 'vocal_glow', name: 'Vocal & Lyrics Clarity', category: 'Standard', gains: [-1.5, -1.0, 0, 1.5, 3.2, 4.2, 3.5, 2.0, 1.0, 0.5] },
  { id: 'lofi_warm', name: 'Vinyl Warmth', category: 'Standard', gains: [3.0, 3.5, 2.5, 1.2, 0.5, -0.8, -1.5, -2.5, -3.5, -4.5] },
  { id: 'v_shape', name: 'Harman Dynamic V', category: 'Standard', gains: [4.8, 4.0, 1.8, -0.8, -1.5, -0.5, 1.8, 3.5, 4.2, 3.8] },
  { id: 'airpods_pro_2', name: 'AirPods Pro (2nd Gen) · AutoEQ', category: 'AutoEQ Apple', gains: [1.5, 1.0, -0.5, -1.2, -0.4, 0.8, 1.9, 2.4, 1.2, 2.5] },
  { id: 'airpods_max', name: 'AirPods Max · AutoEQ', category: 'AutoEQ Apple', gains: [0.8, 0.2, -1.2, -1.5, 0.4, 1.8, 3.1, 2.2, 0.5, 1.4] },
  { id: 'earpods', name: 'Apple EarPods (USB-C/Lightning) · AutoEQ', category: 'AutoEQ Apple', gains: [5.8, 3.4, -1.5, -2.6, -0.8, 0.5, 1.2, -1.4, 1.6, 3.2] },
  { id: 'wh1000xm5', name: 'Sony WH-1000XM5 · AutoEQ', category: 'AutoEQ Audiophile', gains: [-2.8, -4.2, -3.6, -1.4, 0.8, 1.6, 2.8, 2.2, 1.4, 2.0] },
  { id: 'hd600', name: 'Sennheiser HD 600 · AutoEQ', category: 'AutoEQ Audiophile', gains: [5.5, 3.2, 0.8, -0.6, -0.4, -0.8, -1.2, 0.6, 1.4, 2.2] },
];

function makeCoverDataSvg(title: string, sub: string, c1: string, c2: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <circle cx="460" cy="140" r="190" fill="rgba(255,255,255,0.10)"/>
    <circle cx="130" cy="480" r="220" fill="rgba(0,0,0,0.24)"/>
    <text x="48" y="470" fill="#ffffff" font-family="-apple-system, Inter, sans-serif" font-size="44" font-weight="700">${title}</text>
    <text x="48" y="522" fill="rgba(255,255,255,0.78)" font-family="-apple-system, Inter, sans-serif" font-size="26" font-weight="500">${sub}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Built-in Mochy Acoustic Lab Showcase tracks — playable 100% offline with zero network
 * (via synthesized stereo WAV buffer) while live charts & search populate from real APIs!
 */
export const OFFLINE_SHOWCASE_TRACKS: Track[] = [
  {
    id: 'mochy-synth-midnight-hanoi',
    title: 'Midnight Over West Lake',
    artist: 'Mochy Sound Lab',
    artists: ['Mochy Sound Lab'],
    album: 'Mochy Sessions Vol. 1',
    artworkUrl: makeCoverDataSvg('Midnight Over', 'West Lake · Mochy Lab', '#4F46E5', '#0F172A'),
    durationSec: 32,
    source: 'synth',
    synthPreset: 'dreamy',
    qualityBadge: 'PCM 16-bit · 44.1 kHz',
    genre: 'Lo-Fi Ambient',
    releaseYear: 2026,
  },
  {
    id: 'mochy-synth-neon-rain',
    title: 'Neon Rain in Shibuya',
    artist: 'Mochy Sound Lab',
    artists: ['Mochy Sound Lab'],
    album: 'Mochy Sessions Vol. 1',
    artworkUrl: makeCoverDataSvg('Neon Rain', 'City Pop Synth · Mochy', '#DB2777', '#311042'),
    durationSec: 32,
    source: 'synth',
    synthPreset: 'citypop',
    qualityBadge: 'PCM 16-bit · 44.1 kHz',
    genre: 'City Synth',
    releaseYear: 2026,
  },
  {
    id: 'mochy-synth-velvet-sunrise',
    title: 'Velvet Espresso',
    artist: 'Mochy Sound Lab',
    artists: ['Mochy Sound Lab'],
    album: 'Mochy Sessions Vol. 1',
    artworkUrl: makeCoverDataSvg('Velvet Espresso', 'Warm Rhodes · Mochy', '#D97706', '#451A03'),
    durationSec: 32,
    source: 'synth',
    synthPreset: 'warm',
    qualityBadge: 'PCM 16-bit · 44.1 kHz',
    genre: 'Chillhop',
    releaseYear: 2026,
  },
];

export const BUILTIN_LYRICS_MAP: Record<string, LyricLine[]> = {
  'mochy-synth-midnight-hanoi': [
    {
      id: 'l1',
      startSec: 0.5,
      endSec: 6.5,
      text: 'City lights ripple softly across West Lake tonight',
      words: [
        { text: 'City', startSec: 0.5, endSec: 1.3 },
        { text: 'lights', startSec: 1.3, endSec: 2.1 },
        { text: 'ripple', startSec: 2.1, endSec: 3.1 },
        { text: 'softly', startSec: 3.1, endSec: 4.1 },
        { text: 'across', startSec: 4.1, endSec: 4.9 },
        { text: 'West', startSec: 4.9, endSec: 5.5 },
        { text: 'Lake', startSec: 5.5, endSec: 6.0 },
        { text: 'tonight', startSec: 6.0, endSec: 6.5 },
      ],
    },
    {
      id: 'l2',
      startSec: 7.0,
      endSec: 13.5,
      text: 'Warm chords drift through headphones without a trace',
      words: [
        { text: 'Warm', startSec: 7.0, endSec: 7.9 },
        { text: 'chords', startSec: 7.9, endSec: 8.9 },
        { text: 'drift', startSec: 8.9, endSec: 9.8 },
        { text: 'through', startSec: 9.8, endSec: 10.6 },
        { text: 'headphones', startSec: 10.6, endSec: 11.8 },
        { text: 'without', startSec: 11.8, endSec: 12.5 },
        { text: 'a', startSec: 12.5, endSec: 12.8 },
        { text: 'trace', startSec: 12.8, endSec: 13.5 },
      ],
    },
    {
      id: 'l3',
      startSec: 14.0,
      endSec: 20.5,
      text: 'No ads, no walls — just pure open-source sound',
      isBackground: false,
    },
    {
      id: 'l4',
      startSec: 21.0,
      endSec: 27.5,
      text: '(Mochy Music keeps spinning into the dawn)',
      isBackground: true,
    },
    {
      id: 'l5',
      startSec: 27.8,
      endSec: 32.0,
      text: 'Breathe slow and let the melody stay >_<',
    },
  ],
};

/**
 * Generates an in-memory stereo 22.05kHz 16-bit PCM WAV data URI for offline/fallback playback
 * so audio ALWAYS plays cleanly on both iOS AVPlayer and Web HTML5 Audio even when offline.
 */
const wavCache: Record<string, string> = {};

export function getOrCreateSynthWavUri(preset = 'dreamy', durationSec = 32): string {
  if (wavCache[preset]) return wavCache[preset];

  const sampleRate = 22050;
  const numChannels = 2;
  const totalSamples = sampleRate * durationSec;
  const dataSize = totalSamples * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const progressions: Record<string, number[][]> = {
    dreamy: [
      [261.63, 329.63, 392.0, 493.88], // Cmaj7
      [220.0, 261.63, 329.63, 392.0],  // Am7
      [174.61, 220.0, 261.63, 349.23], // Fmaj7
      [196.0, 246.94, 293.66, 392.0],  // G6
    ],
    citypop: [
      [293.66, 349.23, 440.0, 523.25], // Dm7
      [196.0, 246.94, 329.63, 392.0],  // G13
      [261.63, 329.63, 392.0, 493.88], // Cmaj7
      [220.0, 277.18, 329.63, 415.3],  // A7maj
    ],
    warm: [
      [233.08, 293.66, 349.23, 440.0], // Bbmaj7
      [196.0, 233.08, 293.66, 349.23], // Gm7
      [155.56, 196.0, 233.08, 293.66], // Ebmaj7
      [174.61, 220.0, 261.63, 329.63], // F9
    ],
  };

  const chords = progressions[preset] || progressions.dreamy;
  let offset = 44;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const bar = Math.floor(t / 4) % chords.length;
    const barPhase = (t % 4) / 4;
    const env = Math.min(1, barPhase * 12) * Math.exp(-barPhase * 1.45);
    const chord = chords[bar];

    // Electric piano warm harmonics + gentle arpeggio bell
    let padL = 0;
    let padR = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = chord[n];
      const vibrato = 1 + 0.0018 * Math.sin(2 * Math.PI * 4.2 * t + n);
      const s = Math.sin(2 * Math.PI * f * vibrato * t) * 0.16 +
                Math.sin(2 * Math.PI * f * 2 * t) * 0.03 * Math.exp(-barPhase * 3);
      padL += s * (n % 2 === 0 ? 1.08 : 0.88);
      padR += s * (n % 2 === 1 ? 1.08 : 0.88);
    }

    const arpIdx = Math.floor((t * 2) % chord.length);
    const arpPhase = (t * 2) % 1;
    const arpEnv = Math.min(1, arpPhase * 24) * Math.exp(-arpPhase * 4.5);
    const arpFreq = chord[arpIdx] * 2;
    const arp = Math.sin(2 * Math.PI * arpFreq * t) * 0.11 * arpEnv;

    // Soft lo-fi sub-bass pulse on beats
    const beatPhase = (t * 1.0) % 1;
    const subEnv = Math.exp(-beatPhase * 6.5);
    const sub = Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.18 * subEnv;

    const fadeOut = t > durationSec - 2 ? (durationSec - t) / 2 : 1;
    const fadeIn = t < 0.4 ? t / 0.4 : 1;
    const master = fadeIn * fadeOut;

    const sampleL = Math.max(-0.95, Math.min(0.95, (padL * env + arp * 0.9 + sub) * master));
    const sampleR = Math.max(-0.95, Math.min(0.95, (padR * env + arp * 1.1 + sub) * master));

    view.setInt16(offset, sampleL * 32767, true);
    view.setInt16(offset + 2, sampleR * 32767, true);
    offset += 4;
  }

  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    chunks.push(
      chars[b1 >> 2] +
      chars[((b1 & 3) << 4) | (b2 >> 4)] +
      (i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=') +
      (i + 2 < bytes.length ? chars[b3 & 63] : '=')
    );
  }
  const uri = `data:audio/wav;base64,${chunks.join('')}`;
  wavCache[preset] = uri;
  return uri;
}
