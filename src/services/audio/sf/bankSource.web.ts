// Web preview: the sample bank is a static asset (~24 MB), fetched only when a MIDI file is played.
import { Asset } from 'expo-asset';

export function soundBankUrl(): string | null {
  try {
    return Asset.fromModule(require('../../../../modules/holysic-dsp/ios/SoundBank/holysic-gm.hsb'))
      .uri;
  } catch {
    return null;
  }
}
