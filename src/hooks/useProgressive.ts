// Long lists (liked songs, history, big playlists) live inside ScrollViews with headers and
// tabs around them. Mounting 1 000 rows at once froze the tab for a moment; this hands out the
// first screenful at once and the rest in small batches on the following frames, so the list
// appears instantly and is complete a beat later — nothing is cut off.

import React, { useEffect, useState } from 'react';

export function useProgressive(total: number, first = 30, step = 40, resetKey?: unknown): number {
  const [count, setCount] = useState(() => Math.min(total, first));
  // a different list (another tab, another playlist): start small again
  useEffect(() => {
    setCount(Math.min(total, first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  useEffect(() => {
    if (count >= total) return;
    let id: ReturnType<typeof setTimeout> | number;
    const raf = typeof requestAnimationFrame === 'function';
    const next = () => setCount((c) => Math.min(total, c + step));
    if (raf) id = requestAnimationFrame(next);
    else id = setTimeout(next, 16);
    return () => {
      if (raf) cancelAnimationFrame(id as number);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, [count, total, step]);
  return Math.min(count, total);
}

/** Same, as a component — for lists computed after an early return (hooks can't go there). */
export function Progressive({
  total,
  resetKey,
  children,
}: {
  total: number;
  resetKey?: unknown;
  children: (shown: number) => React.ReactNode;
}): React.ReactElement {
  const shown = useProgressive(total, 30, 40, resetKey);
  return React.createElement(React.Fragment, null, children(shown));
}
