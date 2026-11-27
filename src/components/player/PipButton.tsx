// Picture in Picture toggle: floats the lyrics / now playing card over other apps.
// Renders nothing where PiP isn't available (Expo Go, Android, browsers without video PiP).

import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { Pip, usePipState } from '../../services/pip/pip';
import { Tap } from '../ui/Tap';

export const PipButton: React.FC<{
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}> = ({ size = 19, color = 'rgba(255,255,255,0.6)', style }) => {
  const { supported, active } = usePipState();
  const { prefs, palette, haptic, showToast, currentTrack } = useHolySic();
  const hasTrack = !!currentTrack;
  // the button is on screen: have the first frame ready so the tap starts PiP straight away
  useEffect(() => {
    if (supported && hasTrack) Pip.prepare();
  }, [supported, hasTrack]);
  if (!supported) return null;
  const vi = prefs.language === 'vi';
  return (
    <Tap
      hitSlop={12}
      disabled={!currentTrack}
      onPress={async () => {
        haptic('light');
        const was = Pip.get().active;
        const ok = await Pip.toggle();
        if (!was && !ok) {
          const err = Pip.get().error;
          showToast(
            vi
              ? `Chưa mở được PiP${err ? ` · ${err}` : ''}`
              : `Couldn't start PiP${err ? ` · ${err}` : ''}`
          );
        }
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        active
          ? vi
            ? 'Tắt cửa sổ nổi (PiP)'
            : 'Close Picture in Picture'
          : vi
            ? 'Mở lời trong cửa sổ nổi (PiP)'
            : 'Lyrics in Picture in Picture'
      }
      style={style}
    >
      <MaterialIcons
        name={active ? 'picture-in-picture' : 'picture-in-picture-alt'}
        size={size}
        color={active ? palette.accent : color}
      />
    </Tap>
  );
};
