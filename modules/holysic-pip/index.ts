// JS side of the local HolySicPiP native module (iOS builds only; null in Expo Go / web).
//
// iOS floats only video, so the module draws its own "video": a live card with the current lyric
// line (karaoke fill), the next line, cover, title and progress — and lifts it into the system
// Picture-in-Picture window. It times itself from the playing AVPlayer, so lines stay on time
// even while JS sleeps in the background.

import { requireOptionalNativeModule } from 'expo';

/** lyrics / card / minimal: 16:9 · square: cover-first 1:1 · bar: lyrics-only strip · stack: portrait */
export type PipStyle = 'lyrics' | 'card' | 'minimal' | 'square' | 'bar' | 'stack';

export interface PipMeta {
  title: string;
  artist: string;
  /** http(s)/file/data URI or '' */
  artwork: string;
  /** #rrggbb */
  accent: string;
  style: PipStyle;
  showLyrics: boolean;
  /** seconds (0 = unknown) */
  duration: number;
  /** text shown when the song has no synced lyrics */
  noLyrics: string;
  /** "Up next · Title — Artist" — shown when there are no lyrics on screen ('' = none) */
  upNext: string;
  /** the lyrics effect (LyricsEffect id: glow, wave, depth, minimal, focus, typewriter, marker,
   *  glitch, bloom, spectrum, rain, lift, slide, flip, stamp, cinema) — older builds ignore it */
  effect?: string;
  /** the player's ambient light: #rrggbb × 6 — primary, dark base, then the cover's four corners
   *  (top-left, top-right, bottom-left, bottom-right); [] = plain accent gradient */
  ambient?: string[];
  /** its strength 0..1 (Settings › Ambient light) */
  ambientLevel?: number;
}

export interface PipStateEvent {
  active: boolean;
  possible: boolean;
  error?: string;
}

export type PipCommandEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; delta: number }
  /** an absolute position (the web window's seek bar) */
  | { type: 'seekTo'; position: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'restore' };

export interface HolySicPiPNative {
  isSupported(): boolean;
  isActive(): boolean;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  prepare(): Promise<void>;
  setAutoStart(on: boolean): Promise<void>;
  /** the expo-audio AudioPlayer shared object that is playing */
  setPlayer(player: object): void;
  clearPlayer(): void;
  setMeta(meta: PipMeta): void;
  setLyrics(starts: number[], texts: string[], offsetSec: number, synced: boolean): void;
  setPlayback(positionSec: number, playing: boolean): void;
  /** real word timing per line (same order as setLyrics; an empty list = estimate from the
   *  line's length). Newer builds only — call it guarded. */
  setWords?(texts: string[][], starts: number[][], ends: number[][]): void;
  addListener(event: 'onPipState', cb: (e: PipStateEvent) => void): { remove(): void };
  addListener(event: 'onPipCommand', cb: (e: PipCommandEvent) => void): { remove(): void };
}

export const HolySicPiP = requireOptionalNativeModule<HolySicPiPNative>('HolySicPiP');
