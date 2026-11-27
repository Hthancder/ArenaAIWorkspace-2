// Dev-only performance counters. Off unless `globalThis.__HS_PERF__` is set before the app loads
// (the benchmark script does that), so the release app pays one boolean check per call site.
//
// Read them with `globalThis.__HS_PERF__` — counts are cumulative, the bench diffs snapshots.

type Counters = Record<string, number>;

const g = globalThis as unknown as { __HS_PERF__?: Counters };

export const perfOn = (): boolean => !!g.__HS_PERF__;

/** count one event under `key` */
export function perfCount(key: string, n = 1): void {
  const c = g.__HS_PERF__;
  if (c) c[key] = (c[key] || 0) + n;
}

/** React.Profiler onRender: commits + time spent rendering, per tree id */
export function perfOnRender(id: string, _phase: string, actualMs: number): void {
  const c = g.__HS_PERF__;
  if (!c) return;
  c[`commit:${id}`] = (c[`commit:${id}`] || 0) + 1;
  c[`renderMs:${id}`] = (c[`renderMs:${id}`] || 0) + actualMs;
}

/** record one measurement (e.g. how late a lyric line switched), kept as a list */
export function perfSample(key: string, v: number): void {
  const g2 = globalThis as unknown as { __HS_PERF_S__?: Record<string, number[]> };
  if (!g.__HS_PERF__) return;
  const s = (g2.__HS_PERF_S__ = g2.__HS_PERF_S__ || {});
  (s[key] = s[key] || []).push(v);
}

/** the real playback position, if the bench provides it (web: the <audio> element) */
export function perfTruePos(): number | null {
  const f = (globalThis as unknown as { __HS_TRUEPOS__?: () => number | null }).__HS_TRUEPOS__;
  return f ? f() : null;
}
