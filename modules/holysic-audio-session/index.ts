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
  /** iPhone (hardware) volume 0…1 */
  getSystemVolume(): number;
  /** move the real system volume; false when no window / slider is available */
  setSystemVolume(value: number): Promise<boolean>;
  /** open the native AirPlay / Bluetooth output picker */
  showRoutePicker(): Promise<boolean>;
  addListener(event: 'onRouteChange', cb: (r: NativeRouteInfo) => void): { remove(): void };
  addListener(event: 'onSystemVolume', cb: (e: { volume: number }) => void): { remove(): void };
}

export const HolySicAudioSessionModule =
  requireOptionalNativeModule<HolySicAudioSessionNative>('HolySicAudioSession');
