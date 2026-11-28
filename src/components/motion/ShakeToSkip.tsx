// Settings › Controls › Shake to skip. Holds the motion sensor (raw samples only — no tilt
// drawing) while the app is in front and a song is loaded, and skips on a deliberate shake.
// Ignored while typing (iOS uses shaking for "Undo Typing" there).

import { useEffect, useRef } from 'react';
import { TextInput } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { useAppActive } from '../../services/appActivity';
import { createShakeDetector } from '../../services/motion/shake';
import { Tilt } from '../../services/motion/tilt';

export const ShakeToSkip: React.FC = () => {
  const { prefs, currentTrack, playNext, haptic, showToast } = useHolySic();
  const appActive = useAppActive();
  const on = !!prefs.shakeSkip && appActive && !!currentTrack;
  // latest callbacks without restarting the sensor on every render
  const act = useRef({ playNext, haptic, showToast, vi: prefs.language === 'vi' });
  act.current = { playNext, haptic, showToast, vi: prefs.language === 'vi' };

  useEffect(() => {
    if (!on) return;
    const release = Tilt.acquire({ visual: false });
    const detector = createShakeDetector(() => {
      if (TextInput.State?.currentlyFocusedInput?.()) return;
      const a = act.current;
      a.haptic('medium');
      a.playNext();
      a.showToast(a.vi ? 'Lắc máy · bài tiếp theo' : 'Shake · next song');
    });
    const off = Tilt.onSample(detector);
    return () => {
      off();
      release();
    };
  }, [on]);
  return null;
};
