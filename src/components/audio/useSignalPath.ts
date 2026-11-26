// Live bit-perfect signal path for the current song (source → processing → volume → output).

import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { audioEngine } from '../../services/audio/audioEngine';
import { signalPath, sourceFacts, useAudioOutput } from '../../services/audio/audioOutput';

export function useSignalPath() {
  const { prefs, currentTrack, resolvedStream } = useHolySic();
  const output = useAudioOutput();
  // the PCM tap's measured rate settles a few seconds into a song
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    setMeasured(0);
    const t = setTimeout(() => setMeasured(audioEngine.measuredSampleRate()), 3500);
    return () => clearTimeout(t);
  }, [currentTrack?.id, resolvedStream?.url]);

  return useMemo(() => {
    const source = sourceFacts(currentTrack, resolvedStream, measured || undefined);
    return {
      source,
      output,
      ...signalPath({
        vi: prefs.language === 'vi',
        bitPerfect: prefs.bitPerfect,
        source,
        output,
        web: Platform.OS === 'web',
      }),
    };
  }, [currentTrack, resolvedStream, measured, output, prefs.language, prefs.bitPerfect]);
}
