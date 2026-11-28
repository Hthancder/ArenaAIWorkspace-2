// Picture in Picture: one front for the iOS module (HolySicPiP) and the web canvas fallback.
//
// State (supported / active / possible) lives outside React context: only the PiP buttons and
// the settings card subscribe. The bridge (usePipBridge) feeds it the song, the lyrics and the
// play state; the floating window's buttons come back through `onCommand`.

import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { HolySicPiPNative, PipCommandEvent, PipMeta } from '../../../modules/holysic-pip';
import { webPip } from './pipWeb';

export interface PipState {
  supported: boolean;
  active: boolean;
  possible: boolean;
  error?: string;
}

function nativeModule(): HolySicPiPNative | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return require('../../../modules/holysic-pip').HolySicPiP ?? null;
  } catch {
    return null;
  }
}

const native = nativeModule();
const isWeb = Platform.OS === 'web';

function detectSupport(): boolean {
  if (native) {
    try {
      return native.isSupported();
    } catch {
      return false;
    }
  }
  return isWeb && webPip.supported();
}

let state: PipState = { supported: detectSupport(), active: false, possible: false };
const subs = new Set<() => void>();
const cmdSubs = new Set<(c: PipCommandEvent) => void>();

function setState(patch: Partial<PipState>) {
  const next = { ...state, ...patch };
  if (
    next.active === state.active &&
    next.possible === state.possible &&
    next.error === state.error &&
    next.supported === state.supported
  )
    return;
  state = next;
  subs.forEach((f) => f());
}

const onState = (e: { active: boolean; possible: boolean; error?: string }) =>
  setState({ active: e.active, possible: e.possible, error: e.error });
const onCommand = (c: PipCommandEvent) => cmdSubs.forEach((f) => f(c));

if (native) {
  try {
    native.addListener('onPipState', onState);
    native.addListener('onPipCommand', onCommand);
  } catch {
    // ignore
  }
} else if (isWeb) {
  webPip.stateSubs.add(onState);
  webPip.cmdSubs.add(onCommand);
}

const safe = (f: () => void) => {
  try {
    f();
  } catch {
    // an older build without the call
  }
};

export const Pip = {
  get: (): PipState => state,
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  onCommand(f: (c: PipCommandEvent) => void): () => void {
    cmdSubs.add(f);
    return () => {
      cmdSubs.delete(f);
    };
  },
  async start(): Promise<boolean> {
    if (!state.supported) return false;
    setState({ error: undefined });
    try {
      if (native) return await native.start();
      if (isWeb) return await webPip.start();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
    return false;
  },
  async stop(): Promise<void> {
    try {
      if (native) await native.stop();
      else if (isWeb) await webPip.stop();
    } catch {
      // ignore
    }
  },
  async toggle(): Promise<boolean> {
    if (state.active) {
      await Pip.stop();
      return false;
    }
    return Pip.start();
  },
  /** iOS: get the window ready (first frame drawn) so a tap opens it at once — iOS only
   *  starts PiP right inside the tap, so the work must be done before */
  prepare(): void {
    if (!state.supported) return;
    if (native) native.prepare().catch(() => undefined);
    else if (isWeb) webPip.prepare();
  },
  /** iOS: float by itself when the app goes to the background while music plays */
  setAutoStart(on: boolean): void {
    if (native) native.setAutoStart(on).catch(() => undefined);
  },
  setPlayer(p: object | null): void {
    if (!native) return;
    safe(() => (p ? native.setPlayer(p) : native.clearPlayer()));
  },
  setMeta(m: PipMeta): void {
    if (native) safe(() => native.setMeta(m));
    else if (isWeb) webPip.setMeta(m);
  },
  setLyrics(starts: number[], texts: string[], offsetSec: number, synced: boolean): void {
    if (native) safe(() => native.setLyrics(starts, texts, offsetSec, synced));
    else if (isWeb) webPip.setLyrics(starts, texts, offsetSec, synced);
  },
  setWords(texts: string[][], starts: number[][], ends: number[][]): void {
    if (native) safe(() => native.setWords?.(texts, starts, ends));
    else if (isWeb) webPip.setWords(texts, starts, ends);
  },
  setPlayback(positionSec: number, playing: boolean): void {
    if (native) safe(() => native.setPlayback(positionSec, playing));
    else if (isWeb) webPip.setPlayback(positionSec, playing);
  },
};

export function usePipState(): PipState {
  return useSyncExternalStore(Pip.subscribe, Pip.get, Pip.get);
}
