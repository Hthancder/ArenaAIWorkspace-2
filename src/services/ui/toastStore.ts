// The toast pill's text, outside React context: a toast used to re-render the whole app twice
// (show + hide). Now only the pill itself listens.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

let msg: string | null = null;
let action: ToastAction | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const ToastStore = {
  get: () => msg,
  /** the button of the toast on screen (e.g. "Undo") */
  action: () => action,
  /** `ms` defaults to a reading-time estimate: short confirmations go fast, long errors linger.
   *  With an action (e.g. "Undo") the toast stays a little longer so there is time to tap it. */
  show(text: string, ms?: number, act?: ToastAction) {
    msg = text;
    action = act ?? null;
    emit();
    // VoiceOver doesn't read live regions on iOS; announce explicitly
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility?.(text);
    if (timer) clearTimeout(timer);
    const dur = ms ?? (act ? 5000 : Math.min(5000, Math.max(2200, 1400 + text.length * 45)));
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
