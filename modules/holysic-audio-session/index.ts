// JS side of the local HolySicAudioSession native module (iOS builds only; null elsewhere).

import { requireOptionalNativeModule } from 'expo';

export interface NativeOutputPort {
  name: string;
  /** AVAudioSession.Port raw value: Speaker, Headphones, USBAudio, BluetoothA2DPOutput, AirPlay… */
  type: string;
  uid: string;
  channels: number;
}

export interface NativeRouteInfo {
  sampleRate: number;
  preferredSampleRate: number;
  outputs: NativeOutputPort[];
  outputVolume: number;
  ioBufferDuration: number;
  outputLatency: number;
}

export interface HolySicAudioSessionNative {
  getRoute(): NativeRouteInfo;
  setPreferredSampleRate(rate: number): Promise<NativeRouteInfo>;
  resetPreferredSampleRate(): Promise<NativeRouteInfo>;
  addListener(event: 'onRouteChange', cb: (r: NativeRouteInfo) => void): { remove(): void };
}

export const HolySicAudioSessionModule =
  requireOptionalNativeModule<HolySicAudioSessionNative>('HolySicAudioSession');
