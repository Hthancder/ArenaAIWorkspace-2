// JS side of the local HolySicDSP native module (iOS builds only; null in Expo Go / web).

import { requireOptionalNativeModule } from 'expo';

export interface DSPParams {
  enabled: boolean;
  /** headroom so boosts never clip (negative dB) */
  preampDb: number;
  /** 10 gains in dB: 32 Hz … 16 kHz */
  bands: number[];
  bassDb: number;
  /** 0…1 */
  reverb: number;
  /** stereo width 0…2 (1 = untouched) */
  width: number;
  eightD: boolean;
  eightDPeriod: number;
}

export interface DSPStatus {
  liveTaps: number;
  processedFrames: number;
  sampleRate: number;
  attached: number;
}

export interface HolySicDSPNative {
  /** `player` is the expo-audio AudioPlayer shared object */
  attach(player: object, primary: boolean): Promise<boolean>;
  detach(player: object): Promise<void>;
  setParams(p: DSPParams): void;
  setSpectrumEnabled(on: boolean): void;
  getStatus(): DSPStatus;
  addListener(
    event: 'onSpectrum',
    cb: (e: { bands: number[]; sampleRate: number }) => void
  ): { remove(): void };
  addListener(
    event: 'onTapState',
    cb: (e: { state: 'attached' | 'unsupported'; reason?: 'hls' | 'tap' }) => void
  ): { remove(): void };
}

export const HolySicDSP = requireOptionalNativeModule<HolySicDSPNative>('HolySicDSP');
