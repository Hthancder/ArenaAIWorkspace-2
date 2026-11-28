// Who may turn the screen.
//
// The app is a portrait app (tabs, lists, sheets are laid out for it): it starts locked to
// portrait (app.json › expo-screen-orientation › initialOrientation). Only two places turn:
//   • the full player, while it is open — follows the phone (Settings › Player › Rotate player)
//   • the full-screen music video — landscape for a wide video, free for a tall one
// The full-screen video is a layer over the player, so its wish wins while it is up; when it
// closes the player's wish comes back, and when the player closes everything returns to portrait.
//
// Web: browsers turn on their own (the layout follows the window); a lock only works there in
// browser full screen, so it is tried and silently ignored.

import { Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

export type OrientationWish = 'portrait' | 'auto' | 'landscape';

let base: OrientationWish = 'portrait';
let top: OrientationWish | null = null;
let applied: OrientationWish | null = null;

function lockFor(w: OrientationWish): ScreenOrientation.OrientationLock {
  switch (w) {
    case 'landscape':
      return ScreenOrientation.OrientationLock.LANDSCAPE;
    case 'auto':
      return ScreenOrientation.OrientationLock.DEFAULT; // all but upside down
    default:
      return ScreenOrientation.OrientationLock.PORTRAIT_UP;
  }
}

function apply(): void {
  const want = top ?? base;
  if (want === applied) return;
  applied = want;
  if (Platform.OS === 'web') {
    // only possible in browser full screen; elsewhere the browser refuses (fine)
    if (want === 'landscape')
      ScreenOrientation.lockAsync(lockFor(want)).catch(() => {
        applied = null; // allowed later (after entering full screen)
      });
    else ScreenOrientation.unlockAsync().catch(() => undefined);
    return;
  }
  ScreenOrientation.lockAsync(lockFor(want)).catch(() => {
    applied = null; // try again on the next change
  });
}

export const Orientation = {
  /** the app's own wish (portrait outside the player, 'auto' while the player is open). The
   *  player (always mounted) sets it on startup, which also makes sure the app sits upright. */
  setBase(w: OrientationWish): void {
    base = w;
    apply();
  },
  /** a full-screen layer's wish; null = gone (the base comes back) */
  setTop(w: OrientationWish | null): void {
    top = w;
    apply();
  },
};
