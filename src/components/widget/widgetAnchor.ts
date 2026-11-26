// Lets Settings jump straight to the Widget card ("Widget" row at the top of Settings).
import type { View } from 'react-native';

let node: View | null = null;

export const WidgetCardAnchor = {
  set(v: View | null) {
    node = v;
  },
  get(): View | null {
    return node;
  },
};
