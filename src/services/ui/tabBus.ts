// Tapping the tab you're already on scrolls that screen back to the top (UIKit behaviour).
// The tab bar emits; each screen's main ScrollView listens through `useTabScrollToTop`.

import { useEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';

type Listener = (tab: string) => void;
const listeners = new Set<Listener>();

export const TabBus = {
  reselect(tab: string) {
    listeners.forEach((l) => l(tab));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Ref for a screen's main ScrollView: re-tapping `tab` in the tab bar scrolls it to the top. */
export function useTabScrollToTop(tab: string) {
  const ref = useRef<ScrollView>(null);
  useEffect(
    () =>
      TabBus.subscribe((t) => {
        if (t === tab) ref.current?.scrollTo({ y: 0, animated: true });
      }),
    [tab]
  );
  return ref;
}
