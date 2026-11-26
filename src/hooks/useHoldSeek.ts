// Hold next / previous to fast-forward / rewind (Cog for iOS). A tap still skips the track;
// holding seeks 5 s every 250 ms (speeding up after 2 s) until the finger lifts.

import { useCallback, useRef } from 'react';

export function useHoldSeek(seekBy: (deltaSec: number) => void, direction: 1 | -1) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const held = useRef(false);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const onLongPress = useCallback(() => {
    held.current = true;
    startedAt.current = Date.now();
    stop();
    seekBy(5 * direction);
    timer.current = setInterval(() => {
      const fast = Date.now() - startedAt.current > 2000;
      seekBy((fast ? 10 : 5) * direction);
    }, 250);
  }, [direction, seekBy, stop]);

  const onPressOut = useCallback(() => {
    stop();
    // let the onPress that follows a long press know it should not skip
    setTimeout(() => {
      held.current = false;
    }, 50);
  }, [stop]);

  /** Wrap the tap handler: ignored when the press was a hold */
  const guard = useCallback(
    (fn: () => void) => () => {
      if (held.current) return;
      fn();
    },
    []
  );

  return { onLongPress, onPressOut, guard, delayLongPress: 380 };
}
