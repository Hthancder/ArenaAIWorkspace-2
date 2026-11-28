// Drawing for the web Picture in Picture canvas: the player's ambient light behind the card, the
// sung line with every lyrics effect of the Lyrics screen, and a seek bar. The iOS module
// (HolySicPiPModule.swift) draws the same things with Core Graphics — keep the two in step.

export interface PipWord {
  text: string;
  start: number;
  end: number;
}

/** Word starts estimated from length when the lyrics only time whole lines (same as the app) */
export function estimateWords(text: string, start: number, end: number): PipWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const span = Math.min(12, Math.max(0.8, end - start));
  const dur = span * 0.82;
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  let acc = 0;
  return parts.map((p) => {
    const s = start + (dur * acc) / total;
    acc += p.length + 1;
    return { text: p, start: s, end: start + (dur * acc) / total };
  });
}

/** effects that move between frames (the render loop runs faster for them) */
export const ANIMATED_FX = new Set([
  'glow',
  'wave',
  'focus',
  'typewriter',
  'glitch',
  'bloom',
  'spectrum',
  'rain',
  'lift',
  'scramble',
  'ball',
  'pen',
  'bubble',
]);

/** The words of the sung line — real timing, or estimated (cached: asked for every frame) */
let wordsMemo: { text: string; start: number; end: number; words: PipWord[] } | null = null;
export function lineWords(
  text: string,
  real: PipWord[] | null | undefined,
  start: number,
  end: number
): PipWord[] {
  if (real && real.length) return real;
  const m = wordsMemo;
  if (m && m.text === text && m.start === start && m.end === end) return m.words;
  const words = estimateWords(text, start, end);
  wordsMemo = { text, start, end, words };
  return words;
}

/** a word's fill time (the app caps it at 0.45 s so a long note never lags) */
const fillS = (w: PipWord) => Math.max(0.12, Math.min(0.45, w.end - w.start));
/** a word's typing / writing time: the whole time it is sung */
const spanS = (w: PipWord) => Math.max(0.12, w.end - w.start);
/** Handwriting: how long the pen takes over a word (the app: 0.92 × its length, 0.16–1.2 s) */
const penS = (w: PipWord) => Math.max(0.16, Math.min(1.2, (w.end - w.start) * 0.92));
/** Sing-along: the hop onto word i (≤ 0.45 s, ending on its start) — same as the app */
export function hopS(words: PipWord[], i: number): number {
  const span = i > 0 ? words[i].start - words[i - 1].start : 0.45;
  return Math.max(0.14, Math.min(0.45, span * 0.85));
}

// Decode: look-alike glyphs of the same kind (same sets as the app's cipherChar)
const CIPHER_LOWER = 'aceimnorsuvxz';
const CIPHER_UPPER = 'ABCDEGHKMNOPRSUVXZ';
const CIPHER_DIGIT = '0123456789';
export function cipherChar(c: string, seed: number): string {
  const set = /[0-9]/.test(c)
    ? CIPHER_DIGIT
    : c !== c.toLowerCase()
      ? CIPHER_UPPER
      : c !== c.toUpperCase()
        ? CIPHER_LOWER
        : null;
  if (!set) return c;
  const h = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return set.charAt(Math.floor((h - Math.floor(h)) * set.length) % set.length);
}

/**
 * Is anything on the sung line moving at lyrics time `t`? The render loop only draws a new frame
 * while it is (plus on word starts / progress steps) — a still line costs nothing between words.
 */
export function fxBusy(fx: string, words: PipWord[], lineStart: number, t: number): boolean {
  const within = (after: number) => words.some((w) => t >= w.start && t < w.start + after);
  switch (fx) {
    case 'glow':
      return t - lineStart < 0.4;
    case 'typewriter':
      return words.some(
        (w) => t >= w.start && t < w.start + Math.max(0.12, w.end - w.start) + 0.05
      );
    case 'marker':
    case 'lift':
      return words.some((w) => t >= w.start && t < w.start + fillS(w) + 0.05);
    case 'spectrum':
      return words.some((w) => t >= w.start && t < w.start + Math.max(0.5, fillS(w)) + 0.05);
    case 'scramble':
      // the cipher flickers while a word is being decoded
      return words.some((w) => t >= w.start && t < w.start + spanS(w) + 0.05);
    case 'pen':
      return words.some((w) => t >= w.start && t < w.start + penS(w) + 0.05);
    case 'ball':
      // in the air (a hop ends on a word's start) or squashing on landing
      return words.some((w, i) => t >= w.start - hopS(words, i) && t < w.start + 0.16);
    case 'bubble':
      return t - lineStart < 0.45;
    case 'wave':
      return within(0.6);
    case 'focus':
      return within(0.3);
    case 'glitch':
      return within(0.25);
    case 'bloom':
      return within(0.75);
    case 'rain':
      return within(0.7);
    default:
      return false;
  }
}

/** how many words have started (line-level effects only change then) */
export function wordsStarted(words: PipWord[], t: number): number {
  let n = 0;
  while (n < words.length && words[n].start <= t) n++;
  return n;
}

/** The i-th spectrum colour from the accent's hue (same as the app's spectrumColor) */
function spectrumHex(accent: string, i: number): string {
  const [r, g, b] = hexRgb(accent).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 265;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  h = (((h + i * 32) % 360) + 360) % 360;
  const l = 0.7;
  const c = (1 - Math.abs(2 * l - 1)) * 0.85;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [R, G, B] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hx = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hx(R)}${hx(G)}${hx(B)}`;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(h || '');
  const v = m ? parseInt(m[1], 16) : 0x8b5cf6;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export const rgba = (h: string, a: number) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
/** dark ink on a light accent, white on a dark one */
export function inkOn(h: string): string {
  const [r, g, b] = hexRgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#111116' : '#FFFFFF';
}

// ─────────────────────────────────────────────────────────── ambient backdrop

/**
 * The player's ambient light (AmbientBackdrop): dark base, the blurred cover flooding from the
 * top, five soft colour lobes (primary + the cover's corners), and the legibility scrim.
 * Drawn once per song / style into `out` and reused every frame.
 */
export function drawAmbient(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  colors: string[],
  level: number,
  art: HTMLImageElement | null,
  accent: string
) {
  const [primary, dark, tl, tr, bl, br] =
    colors.length >= 6 ? colors : [accent, '#0A0A12', accent, accent, accent, accent];
  const lv = colors.length >= 6 ? Math.max(0.35, level) : 0.7;
  const base = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, H);
  base.addColorStop(0, dark);
  base.addColorStop(1, '#050507');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  if (art) {
    try {
      const s = Math.max((W * 1.9) / art.width, (H * 1.9) / art.height);
      ctx.save();
      ctx.globalAlpha = 0.62 * lv;
      ctx.filter = `blur(${Math.round(Math.max(W, H) / 14)}px)`;
      ctx.drawImage(
        art,
        W / 2 - (art.width * s) / 2,
        H * 0.25 - (art.height * s) / 2,
        art.width * s,
        art.height * s
      );
      ctx.restore();
    } catch {
      // a canvas without filters: the lobes alone still carry the colour
    }
  }
  // lobes: same centres as the app's SVG (viewBox -25…125, so 30 % / 70 % of the middle)
  const R = Math.max(W, H) * 0.42;
  const lobe = (cx: number, cy: number, c: string, o: number, r: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = Math.min(1, o * 0.9 * lv);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.45, rgba(c, a * 0.45));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  lobe(W * 0.5, H * 0.5, primary, 0.75, R * 1.25);
  lobe(W * 0.3, H * 0.3, tl, 0.9, R);
  lobe(W * 0.7, H * 0.3, tr, 0.9, R);
  lobe(W * 0.3, H * 0.7, bl, 0.9, R);
  lobe(W * 0.7, H * 0.7, br, 0.9, R);
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, 'rgba(0,0,0,0.12)');
  scrim.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  scrim.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);
}

// ─────────────────────────────────────────────────────────── seek bar

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** track + accent fill + knob, elapsed and remaining time under it (times: false = bar only) */
export function drawSeekBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  pos: number,
  duration: number,
  accent: string,
  times = true,
  playing = true
) {
  const f = duration > 0 ? clamp01(pos / duration) : 0;
  const h = 8;
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  const round = (rx: number, rw: number) => {
    ctx.beginPath();
    const r = h / 2;
    const rr = ctx as CanvasRenderingContext2D & {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    };
    if (rr.roundRect) rr.roundRect(rx, y, Math.max(h, rw), h, r);
    else ctx.rect(rx, y, Math.max(h, rw), h);
    ctx.fill();
  };
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  round(x, w);
  ctx.fillStyle = accent;
  round(x, w * f);
  if (duration > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x + w * f, y + h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (!times) return;
  ctx.save();
  ctx.font = `600 19px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText(mmss(pos), x, y + 18);
  ctx.textAlign = 'right';
  ctx.fillText(
    duration > 0 ? '-' + mmss(Math.max(0, duration - pos)) : playing ? '' : '❚❚',
    x + w,
    y + 18
  );
  ctx.restore();
}

// ─────────────────────────────────────────────────────────── the sung line

interface Box {
  w: PipWord;
  x: number;
  y: number;
  width: number;
  /** a space follows on the same row */
  gap: number;
}

/** the last layout (re-measuring every word of the line each frame was most of a frame's cost) */
let layoutMemo: {
  key: string;
  words: PipWord[];
  out: { boxes: Box[]; fs: number };
} | null = null;

function layout(
  ctx: CanvasRenderingContext2D,
  words: PipWord[],
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  maxLines: number,
  align: CanvasTextAlign
): { boxes: Box[]; fs: number } {
  const key = `${x}|${y}|${w}|${h}|${size}|${maxLines}|${align}`;
  const m = layoutMemo;
  if (m && m.words === words && m.key === key) return m.out;
  const out = measureLayout(ctx, words, x, y, w, h, size, maxLines, align);
  layoutMemo = { key, words, out };
  return out;
}

function measureLayout(
  ctx: CanvasRenderingContext2D,
  words: PipWord[],
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  maxLines: number,
  align: CanvasTextAlign
): { boxes: Box[]; fs: number } {
  let fs = size;
  let rows: PipWord[][] = [];
  let space = 0;
  for (;;) {
    ctx.font = `800 ${fs}px ${FONT}`;
    space = ctx.measureText(' ').width;
    rows = [];
    let cur: PipWord[] = [];
    let cw = 0;
    for (const wd of words) {
      const ww = ctx.measureText(wd.text).width;
      if (cur.length && cw + space + ww > w) {
        rows.push(cur);
        cur = [wd];
        cw = ww;
      } else {
        cw += (cur.length ? space : 0) + ww;
        cur.push(wd);
      }
    }
    if (cur.length) rows.push(cur);
    if (fs <= 22 || (rows.length <= maxLines && rows.length * fs * 1.2 <= h)) break;
    fs -= 4;
  }
  rows = rows.slice(0, maxLines);
  const lh = fs * 1.2;
  const top = y + (h - rows.length * lh) / 2;
  const boxes: Box[] = [];
  rows.forEach((row, ri) => {
    const widths = row.map((wd) => ctx.measureText(wd.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1);
    let cx =
      align === 'center' ? x + (w - Math.min(w, total)) / 2 : align === 'right' ? x + w - total : x;
    row.forEach((wd, i) => {
      boxes.push({
        w: wd,
        x: cx,
        y: top + ri * lh,
        width: widths[i],
        gap: i < row.length - 1 ? space : 0,
      });
      cx += widths[i] + space;
    });
  });
  return { boxes, fs };
}

/** blurred text: drawn far off the canvas, only its shadow (offset back) lands on it */
function blurText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  blur: number
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = -20000;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(s, x + 20000, y);
  ctx.restore();
}

export interface SungOpts {
  text: string;
  words: PipWord[] | null; // real word timing, or null (estimated from the line)
  lineStart: number;
  lineEnd: number;
  /** lyrics time now (position − offset + lead) */
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  maxLines: number;
  align: CanvasTextAlign;
  effect: string;
  accent: string;
}

/** The sung line with the chosen lyrics effect. */
/** Reduce Motion (web): no hops, jolts or zoom — colour and fades only */
let calmQuery: MediaQueryList | null = null;
const calm = () => {
  if (typeof matchMedia !== 'function') return false;
  if (!calmQuery) calmQuery = matchMedia('(prefers-reduced-motion: reduce)');
  return calmQuery.matches;
};

export function drawSung(ctx: CanvasRenderingContext2D, o: SungOpts) {
  const real = !!(o.words && o.words.length);
  const words = lineWords(o.text, o.words, o.lineStart, o.lineEnd);
  if (!words.length) return;
  const { boxes, fs } = layout(ctx, words, o.x, o.y, o.w, o.h, o.size, o.maxLines, o.align);
  const fx = o.effect;
  const t = o.t;
  const frac = (wd: PipWord) => clamp01((t - wd.start) / fillS(wd));
  // line-level effects light the whole line unless the lyrics have real word timing
  const wholeLine = !real && (fx === 'glow' || fx === 'depth' || fx === 'minimal');
  const lit = (wd: PipWord) => wholeLine || t >= wd.start;
  const still = calm();
  ctx.save();
  ctx.font = `800 ${fs}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (fx === 'glow') {
    // the line grows in and glows (Lyrics screen: zoom + glow)
    const a = clamp01((t - o.lineStart) / 0.35);
    const e = 1 - Math.pow(1 - a, 3);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    ctx.translate(cx, cy);
    const sc = still ? 1 : 0.93 + 0.07 * e;
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = 0.45 + 0.55 * e;
    for (const b of boxes) {
      ctx.shadowColor = rgba(o.accent, 0.75);
      ctx.shadowBlur = 18;
      ctx.fillStyle = lit(b.w) ? '#FFFFFF' : 'rgba(255,255,255,0.42)';
      if (!lit(b.w)) ctx.shadowColor = 'transparent';
      ctx.fillText(b.w.text, b.x, b.y);
    }
  } else if (fx === 'wave') {
    for (const b of boxes) {
      const age = t - b.w.start;
      let dy = 0;
      if (age >= 0 && age < 0.6 && !still) {
        dy =
          age < 0.13 ? -(age / 0.13) : -Math.exp(-(age - 0.13) * 7) * Math.cos((age - 0.13) * 15);
      }
      ctx.fillStyle = age >= 0 ? '#FFFFFF' : 'rgba(255,255,255,0.42)';
      if (age >= 0) {
        ctx.shadowColor = rgba(o.accent, 0.55);
        ctx.shadowBlur = 10;
      } else {
        ctx.shadowColor = 'transparent';
      }
      ctx.fillText(b.w.text, b.x, b.y + dy * fs * 0.14);
    }
  } else if (fx === 'focus') {
    for (const b of boxes) {
      const k = clamp01((t - b.w.start) / 0.28);
      if (k < 1) blurText(ctx, b.w.text, b.x, b.y, `rgba(255,255,255,${0.85 * (1 - k)})`, 11);
      if (k > 0) {
        ctx.globalAlpha = k;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(b.w.text, b.x, b.y);
        ctx.globalAlpha = 1;
      }
    }
  } else if (fx === 'typewriter') {
    const ink = inkOn(o.accent);
    let cursorDone = false;
    for (const b of boxes) {
      // typed over the word's whole length (as the app does), not the capped fill time
      const f = clamp01((t - b.w.start) / Math.max(0.12, b.w.end - b.w.start));
      const n = f >= 1 ? b.w.text.length : Math.ceil(b.w.text.length * f);
      const shown = b.w.text.slice(0, n);
      ctx.fillStyle = '#FFFFFF';
      if (shown) ctx.fillText(shown, b.x, b.y);
      const sx = b.x + (shown ? ctx.measureText(shown).width : 0);
      const rest = b.w.text.slice(n);
      if (!rest) continue;
      if (!cursorDone && (f > 0 || n === 0)) {
        // a block cursor on the next letter
        cursorDone = true;
        const ch = rest.charAt(0);
        const cw = ctx.measureText(ch).width;
        ctx.fillStyle = o.accent;
        ctx.fillRect(sx - 1, b.y + fs * 0.08, cw + 2, fs * 1.08);
        ctx.fillStyle = ink;
        ctx.fillText(ch, sx, b.y);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillText(rest.slice(1), sx + cw, b.y);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillText(rest, sx, b.y);
      }
    }
  } else if (fx === 'marker') {
    const ink = inkOn(o.accent);
    for (const b of boxes) {
      const f = frac(b.w);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(b.w.text, b.x, b.y);
      if (f <= 0) continue;
      const bw = (b.width + b.gap + 3) * f;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = o.accent;
      ctx.beginPath();
      const rr = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };
      if (rr.roundRect) rr.roundRect(b.x - 3, b.y + fs * 0.3, bw, fs * 0.8, 6);
      else ctx.rect(b.x - 3, b.y + fs * 0.3, bw, fs * 0.8);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - 3, b.y - 6, bw, fs * 1.2 + 12);
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.fillText(b.w.text, b.x, b.y);
      ctx.restore();
    }
  } else if (fx === 'glitch') {
    for (const b of boxes) {
      const age = t - b.w.start;
      if (age >= 0.22) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(b.w.text, b.x, b.y);
        continue;
      }
      // unsung: split layers; just sung: they jolt and lock together
      const k = age < 0 ? 1 : 1 - age / 0.22;
      const jolt = age >= 0 && !still ? Math.sin(age * 95) * 5 * k : 0;
      const sp = 3.5 * k;
      ctx.save();
      ctx.globalAlpha = 0.6 * Math.max(0.35, k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#FF2D55';
      ctx.fillText(b.w.text, b.x - sp + jolt, b.y);
      ctx.fillStyle = '#22E4FF';
      ctx.fillText(b.w.text, b.x + sp + jolt, b.y);
      ctx.restore();
      ctx.fillStyle = age >= 0 ? '#FFFFFF' : 'rgba(255,255,255,0.5)';
      ctx.fillText(b.w.text, b.x + jolt, b.y);
    }
  } else if (fx === 'bloom') {
    for (const b of boxes) {
      const age = t - b.w.start;
      if (age < 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fillText(b.w.text, b.x, b.y);
        continue;
      }
      const cx = b.x + b.width / 2;
      const cy = b.y + fs * 0.6;
      // the ripple: an accent copy that spreads out and fades
      const k = clamp01(age / 0.72);
      const e = 1 - Math.pow(1 - k, 3);
      const ra = k < 0.1 ? (k / 0.1) * 0.5 : 0.5 * (1 - (k - 0.1) / 0.9);
      if (ra > 0.01) {
        ctx.save();
        ctx.translate(cx, cy);
        const rs = still ? 1 : 1 + 0.45 * e;
        ctx.scale(rs, rs);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha = ra;
        ctx.shadowColor = o.accent;
        ctx.shadowBlur = 18;
        ctx.fillStyle = o.accent;
        ctx.fillText(b.w.text, b.x, b.y);
        ctx.restore();
      }
      // the pop: up to 1.16×, settling with a little spring
      const pop = still
        ? 1
        : age < 0.11
          ? 1 + 0.16 * (age / 0.11)
          : 1 + 0.16 * Math.exp(-(age - 0.11) * 9) * Math.cos((age - 0.11) * 16);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.translate(-cx, -cy);
      ctx.globalAlpha = 0.42 + 0.58 * clamp01(age / 0.16);
      ctx.shadowColor = o.accent;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.w.text, b.x, b.y);
      ctx.restore();
    }
  } else if (fx === 'spectrum') {
    boxes.forEach((b, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(b.w.text, b.x, b.y);
      const f = frac(b.w);
      if (f <= 0) return;
      const hue = spectrumHex(o.accent, i);
      const age = t - b.w.start;
      const lift =
        still || age > 0.6
          ? 0
          : age < 0.11
            ? -4 * (age / 0.11)
            : -4 * Math.exp(-(age - 0.11) * 9) * Math.cos((age - 0.11) * 14);
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - 2, b.y - 10, (b.width + 4) * f, fs * 1.2 + 20);
      ctx.clip();
      ctx.shadowColor = rgba(hue, 0.7);
      ctx.shadowBlur = 12;
      ctx.fillStyle = hue;
      ctx.fillText(b.w.text, b.x, b.y + lift);
      ctx.restore();
    });
  } else if (fx === 'rain') {
    for (const b of boxes) {
      const age = t - b.w.start;
      if (age < 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.24)';
        ctx.fillText(b.w.text, b.x, b.y);
        continue;
      }
      // falls from above and lands with a bounce (a damped spring around the line)
      const dy = still ? 0 : -fs * 0.8 * Math.exp(-age * 7.5) * Math.cos(age * 13);
      const a = clamp01(age / 0.2);
      if (a < 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.24 * (1 - a)})`;
        ctx.fillText(b.w.text, b.x, b.y);
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = rgba(o.accent, 0.6);
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.w.text, b.x, b.y + dy);
      ctx.restore();
    }
  } else if (fx === 'lift') {
    for (const b of boxes) {
      const f = frac(b.w);
      const e = 1 - (1 - f) * (1 - f);
      ctx.fillStyle = `rgba(255,255,255,${0.38 * (1 - f)})`;
      if (f < 1) ctx.fillText(b.w.text, b.x, b.y);
      if (f <= 0) continue;
      ctx.save();
      ctx.globalAlpha = e;
      ctx.shadowColor = 'rgba(255,255,255,0.55)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.w.text, b.x, b.y - (still ? 0 : fs * 0.1 * e));
      ctx.restore();
    }
  } else if (fx === 'scramble') {
    // Decode: decoded letters white, the next few flicker through look-alike glyphs (accent),
    // the rest faint — glyphs drawn on the real letters' places, so nothing shifts
    const tick = still ? 0 : Math.floor(t * 14);
    let gi = 0;
    boxes.forEach((b, wi) => {
      const f = clamp01((t - b.w.start) / spanS(b.w));
      const chars = Array.from(b.w.text);
      const n = f >= 1 ? chars.length : f <= 0 ? 0 : Math.ceil(chars.length * f);
      let x = b.x;
      chars.forEach((ch, ci) => {
        const cw = ctx.measureText(ch).width;
        if (ci < n) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(ch, x, b.y);
        } else if (f > 0 && f < 1 && ci < n + 4 && !still) {
          const g = cipherChar(ch, tick * 31 + (gi + ci) * 7 + wi);
          ctx.save();
          ctx.shadowColor = o.accent;
          ctx.shadowBlur = 8;
          ctx.fillStyle = o.accent;
          ctx.fillText(g, x + (cw - ctx.measureText(g).width) / 2, b.y);
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.fillText(ch, x, b.y);
        }
        x += cw;
      });
      gi += chars.length + 1;
    });
  } else if (fx === 'ball') {
    // Sing-along: the ball lands on each word as it is sung, hopping over from the last one
    let started = 0;
    while (started < boxes.length && boxes[started].w.start <= t) started++;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      ctx.save();
      if (i < started) {
        ctx.shadowColor = rgba(o.accent, 0.6);
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#FFFFFF';
      } else ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(b.w.text, b.x, b.y);
      ctx.restore();
    }
    const R = Math.max(5, fs * 0.15);
    const spot = (b: Box) => ({ x: b.x + b.width / 2, y: b.y - R * 0.35 });
    const cur = Math.max(0, started - 1);
    let p = spot(boxes[cur]);
    let sx = 1;
    let sy = 1;
    const next = started < boxes.length ? started : -1;
    if (next >= 0 && !still) {
      const hop = hopS(
        boxes.map((b) => b.w),
        next
      );
      const until = boxes[next].w.start - t;
      if (until < hop) {
        const k = clamp01(1 - until / hop);
        const q = spot(boxes[next]);
        const H = Math.max(fs * 0.7, R * 4);
        p = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k - H * 4 * k * (1 - k) };
      }
    }
    const age = started > 0 ? t - boxes[cur].w.start : 1;
    if (age >= 0 && age < 0.16 && !still) {
      const k = 1 - age / 0.16;
      sx = 1 + 0.35 * k;
      sy = 1 - 0.32 * k;
    }
    ctx.save();
    ctx.shadowColor = o.accent;
    ctx.shadowBlur = 10;
    ctx.fillStyle = o.accent;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + R * (1 - sy), R * sx, R * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (fx === 'pen') {
    // Handwriting: italic ink uncovered by a pen nib that follows the voice
    ctx.font = `italic 800 ${fs}px ${FONT}`;
    for (const b of boxes) {
      const f = clamp01((t - b.w.start) / penS(b.w));
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillText(b.w.text, b.x, b.y);
      if (f <= 0) continue;
      const iw = (b.width + fs * 0.3) * f;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - 4, b.y - 8, iw + 4, fs * 1.3 + 16);
      ctx.clip();
      ctx.shadowColor = rgba(o.accent, 0.55);
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.w.text, b.x, b.y);
      ctx.restore();
      if (f < 1 && !still) {
        ctx.save();
        ctx.shadowColor = o.accent;
        ctx.shadowBlur = 12;
        ctx.fillStyle = o.accent;
        ctx.beginPath();
        ctx.arc(b.x + (b.width + fs * 0.1) * f, b.y + fs * 0.92, Math.max(3, fs * 0.09), 0, 7);
        ctx.fill();
        ctx.restore();
      }
    }
  } else if (fx === 'bubble') {
    // Chat: the line arrives as a message bubble (a spring from its corner); words fill in
    const age = t - o.lineStart;
    const k = clamp01(age / 0.42);
    // ease-out-back: overshoots a touch, like the app's spring
    const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    const sc = still ? 1 : 0.55 + 0.45 * back;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.width);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + fs * 1.2);
    }
    const px = fs * 0.6;
    const py = fs * 0.32;
    const bx = minX - px;
    const by = minY - py;
    const bw = maxX - minX + px * 2;
    const bh = maxY - minY + py * 2;
    ctx.save();
    ctx.globalAlpha = clamp01(age / 0.15);
    ctx.translate(bx, by + bh);
    ctx.scale(sc, sc);
    ctx.translate(-bx, -(by + bh));
    ctx.shadowColor = rgba(o.accent, 0.5);
    ctx.shadowBlur = 16;
    ctx.fillStyle = o.accent;
    const r = Math.min(bh / 2, fs * 0.9);
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
    ctx.lineTo(bx + 6, by + bh);
    ctx.arcTo(bx, by + bh, bx, by + bh - 6, 6); // the tucked-in corner (a speech tail)
    ctx.lineTo(bx, by + r);
    ctx.arcTo(bx, by, bx + r, by, r);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    const ink = inkOn(o.accent);
    for (const b of boxes) {
      ctx.fillStyle = lit(b.w)
        ? ink
        : ink === '#FFFFFF'
          ? 'rgba(255,255,255,0.55)'
          : 'rgba(17,17,22,0.5)';
      ctx.fillText(b.w.text, b.x, b.y);
    }
    ctx.restore();
  } else {
    // depth / minimal: bright and dim (depth adds a soft white halo to the sung words)
    for (const b of boxes) {
      const on = lit(b.w);
      if (fx === 'depth' && on) {
        ctx.shadowColor = 'rgba(255,255,255,0.35)';
        ctx.shadowBlur = 10;
      } else ctx.shadowColor = 'transparent';
      ctx.fillStyle = on ? '#FFFFFF' : 'rgba(255,255,255,0.4)';
      ctx.fillText(b.w.text, b.x, b.y);
    }
  }
  ctx.restore();
}

/** How a neighbouring (not sung) line looks in this effect */
export function contextLine(
  effect: string,
  _accent: string,
  distance: number
): { color: string; blur: number } {
  const d = Math.max(1, distance);
  switch (effect) {
    case 'depth':
      return { color: `rgba(255,255,255,${[0, 0.5, 0.32, 0.2][Math.min(3, d)]})`, blur: 0 };
    case 'focus':
      return { color: `rgba(255,255,255,${d === 1 ? 0.6 : 0.4})`, blur: 7 + d * 2 };
    case 'typewriter':
    case 'scramble':
    case 'pen':
    case 'rain':
      return { color: `rgba(255,255,255,${d === 1 ? 0.24 : 0.14})`, blur: 0 };
    default:
      return { color: `rgba(255,255,255,${d === 1 ? 0.5 : 0.28})`, blur: 0 };
  }
}

export { blurText };
