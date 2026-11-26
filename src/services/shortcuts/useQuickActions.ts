// Home Screen quick actions (touch and hold the HolySic icon) — iOS builds only.
//
//   ▶ Phát tiếp      "<last song>"     resume and open the player
//   ♥ Trộn bài đã thích                shuffle the liked songs
//   ✦ Mix It                           instant DJ mix
//   ⌕ Tìm kiếm                         jump straight to Search
//
// The native side (modules/holysic-shortcuts) publishes the items and forwards the tap; a cold
// start through a shortcut is picked up with consumeInitial() once the queue has been restored.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { HolySicShortcutsNative } from '../../../modules/holysic-shortcuts';
import { useHolySic } from '../../context/HolySicContext';

let native: HolySicShortcutsNative | null | undefined;
function mod(): HolySicShortcutsNative | null {
  if (native !== undefined) return native;
  native = null;
  if (Platform.OS !== 'ios') return null;
  try {
    native = require('../../../modules/holysic-shortcuts').HolySicShortcutsModule ?? null;
  } catch {
    native = null;
  }
  return native ?? null;
}

type ShortcutType = 'resume' | 'liked' | 'mix' | 'search';

export function useQuickActions() {
  const {
    prefs,
    currentTrack,
    isPlaying,
    togglePlay,
    setIsPlayerOpen,
    likedTracks,
    playTrack,
    startInstantMix,
    setActiveTab,
  } = useHolySic();
  const vi = prefs.language === 'vi';

  // keep the menu current: the subtitle names the song you'd resume
  useEffect(() => {
    const m = mod();
    if (!m) return;
    const items = [
      currentTrack && {
        type: 'resume',
        title: vi ? 'Phát tiếp' : 'Resume',
        subtitle: `${currentTrack.title} · ${currentTrack.artist}`.slice(0, 80),
        icon: 'play.fill',
      },
      likedTracks.length > 0 && {
        type: 'liked',
        title: vi ? 'Trộn bài đã thích' : 'Shuffle liked songs',
        subtitle: vi ? `${likedTracks.length} bài` : `${likedTracks.length} songs`,
        icon: 'heart.fill',
      },
      {
        type: 'mix',
        title: 'Mix It',
        subtitle: vi ? 'DJ tự động nối bài' : 'Instant DJ mix',
        icon: 'sparkles',
      },
      { type: 'search', title: vi ? 'Tìm kiếm' : 'Search', icon: 'magnifyingglass' },
    ].filter(Boolean) as { type: string; title: string; subtitle?: string; icon: string }[];
    try {
      m.setItems(items.slice(0, 4));
    } catch {
      // ignore
    }
  }, [vi, currentTrack?.id, currentTrack, likedTracks.length]);

  const acts = useRef({
    currentTrack,
    isPlaying,
    togglePlay,
    setIsPlayerOpen,
    likedTracks,
    playTrack,
    startInstantMix,
    setActiveTab,
  });
  acts.current = {
    currentTrack,
    isPlaying,
    togglePlay,
    setIsPlayerOpen,
    likedTracks,
    playTrack,
    startInstantMix,
    setActiveTab,
  };

  useEffect(() => {
    const m = mod();
    if (!m) return;
    let lastRun = 0;
    const run = (type: string | null) => {
      if (!type) return;
      // a cold start can report the same tap twice (launch options + performAction)
      if (Date.now() - lastRun < 1500) return;
      lastRun = Date.now();
      const x = acts.current;
      switch (type as ShortcutType) {
        case 'resume':
          if (!x.currentTrack) return;
          if (!x.isPlaying) x.togglePlay();
          x.setIsPlayerOpen(true);
          break;
        case 'liked': {
          if (!x.likedTracks.length) return;
          const list = [...x.likedTracks];
          for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
          }
          x.playTrack(list[0], list);
          x.setIsPlayerOpen(true);
          break;
        }
        case 'mix':
          x.startInstantMix();
          break;
        case 'search':
          x.setIsPlayerOpen(false);
          x.setActiveTab('search');
          break;
      }
    };
    const sub = m.addListener('onShortcut', (e) => run(e?.type ?? null));
    // cold start: wait for the restored session (queue, likes) before acting
    const t = setTimeout(() => {
      try {
        run(m.consumeInitial());
      } catch {
        // ignore
      }
    }, 1200);
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, []);
}
