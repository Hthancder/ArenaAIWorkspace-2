// The toast pill's text, outside React context: a toast used to re-render the whole app twice
// (show + hide). Now only the pill itself listens.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

let msg: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const ToastStore = {
  get: () => msg,
  /** `ms` defaults to a reading-time estimate: short confirmations go fast, long errors linger. */
  show(text: string, ms?: number) {
    msg = text;
    emit();
    // VoiceOver doesn't read live regions on iOS; announce explicitly
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility?.(text);
    if (timer) clearTimeout(timer);
    const dur = ms ?? Math.min(5000, Math.max(2200, 1400 + text.length * 45));
    timer = setTimeout(ToastStore.hide, dur);
  },
  hide() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (msg === null) return;
    msg = null;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useToastMessage(): string | null {
  return useSyncExternalStore(ToastStore.subscribe, ToastStore.get, ToastStore.get);
}
