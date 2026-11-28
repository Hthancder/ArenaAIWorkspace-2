// Small, pure helpers for editing LRC text line by line (the lyrics editor's timing mode).
// The text is the source of truth: rows are read from it and every change writes it back, so
// lines without a time, tags ([ar:], [offset:]), word timing and the user's order all survive.

export interface LrcRow {
  /** index of the line in the text */
  line: number;
  /** the line's (first) time in seconds, null = not timed yet */
  time: number | null;
  /** the words, without the leading time tags */
  body: string;
}

const LEAD_STAMPS = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)\s*/;
const FIRST_STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META = /^\s*\[[a-z]+:.*\]\s*$/i;

const toSec = (m: RegExpMatchArray) =>
  Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0);

/** [mm:ss.cc] */
export function lrcStamp(sec: number): string {
  const c = Math.max(0, Math.round(sec * 100) / 100);
  const m = Math.floor(c / 60);
  return `[${String(m).padStart(2, '0')}:${(c - m * 60).toFixed(2).padStart(5, '0')}]`;
}

/** m:ss.cc for the screen */
export function fmtLrcTime(sec: number): string {
  const c = Math.max(0, sec);
  const m = Math.floor(c / 60);
  return `${m}:${(c - m * 60).toFixed(2).padStart(5, '0')}`;
}

/** the lyric lines of the text (blank lines and tags are left out) */
export function lrcRows(text: string): LrcRow[] {
  const out: LrcRow[] = [];
  text.split('\n').forEach((raw, line) => {
    if (!raw.trim() || META.test(raw)) return;
    const lead = raw.match(LEAD_STAMPS);
    if (lead) {
      const first = lead[1].match(FIRST_STAMP);
      out.push({ line, time: first ? toSec(first) : null, body: raw.slice(lead[0].length) });
    } else out.push({ line, time: null, body: raw.trim() });
  });
  return out;
}

function rewrite(text: string, line: number, f: (raw: string) => string): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length) return text;
  lines[line] = f(lines[line]);
  return lines.join('\n');
}

/** set (or clear, with null) the line's time; extra times of a repeated line are kept */
export function setLrcTime(text: string, line: number, sec: number | null): string {
  return rewrite(text, line, (raw) => {
    const lead = raw.match(LEAD_STAMPS);
    const body = lead ? raw.slice(lead[0].length) : raw.trim();
    const rest = lead ? lead[1].replace(FIRST_STAMP, '') : '';
    if (sec === null) return rest + body;
    return lrcStamp(sec) + rest + body;
  });
}

/** move the line's time by `delta` s — and, with `ripple`, every timed line written after it */
export function shiftLrcTimes(text: string, line: number, delta: number, ripple: boolean): string {
  let next = text;
  for (const r of lrcRows(text)) {
    if (r.time === null) continue;
    if (r.line === line || (ripple && r.line > line))
      next = setLrcTime(next, r.line, Math.max(0, r.time + delta));
  }
  return next;
}

/** the row being sung at `sec` (latest time not after it), -1 before the first */
export function lrcRowAt(rows: LrcRow[], sec: number): number {
  let best = -1;
  let bestT = -Infinity;
  rows.forEach((r, i) => {
    if (r.time !== null && r.time <= sec && r.time >= bestT) {
      best = i;
      bestT = r.time;
    }
  });
  return best;
}
