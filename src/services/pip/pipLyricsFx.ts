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
export const ANIMATED_FX = new Set(['glow', 'wave', 'focus', 'typewriter', 'glitch']);

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
const calm = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function drawSung(ctx: CanvasRenderingContext2D, o: SungOpts) {
  const real = !!(o.words && o.words.length);
  const words = real ? (o.words as PipWord[]) : estimateWords(o.text, o.lineStart, o.lineEnd);
  if (!words.length) return;
  const { boxes, fs } = layout(ctx, words, o.x, o.y, o.w, o.h, o.size, o.maxLines, o.align);
  const fx = o.effect;
  const t = o.t;
  const frac = (wd: PipWord) => clamp01((t - wd.start) / Math.max(0.12, wd.end - wd.start));
  // line-level effects light the whole line unless the lyrics have real word timing
  const wholeLine = !real && (fx === 'glow' || fx === 'depth' || fx === 'neon' || fx === 'minimal');
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
  } else if (fx === 'karaoke') {
    for (const b of boxes) {
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(b.w.text, b.x, b.y);
      const f = frac(b.w);
      if (f <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - 2, b.y - 8, (b.width + 4) * f, fs * 1.2 + 16);
      ctx.clip();
      ctx.shadowColor = rgba(o.accent, 0.7);
      ctx.shadowBlur = 12;
      ctx.fillStyle = o.accent;
      ctx.fillText(b.w.text, b.x, b.y);
      ctx.restore();
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
  } else if (fx === 'neon') {
    for (const b of boxes) {
      if (lit(b.w)) {
        ctx.shadowColor = o.accent;
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(b.w.text, b.x, b.y);
        ctx.shadowBlur = 10;
        ctx.fillText(b.w.text, b.x, b.y);
      } else {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = rgba(o.accent, 0.6);
        ctx.fillText(b.w.text, b.x, b.y);
      }
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
      const f = frac(b.w);
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
  accent: string,
  distance: number
): { color: string; blur: number } {
  const d = Math.max(1, distance);
  switch (effect) {
    case 'depth':
      return { color: `rgba(255,255,255,${[0, 0.5, 0.32, 0.2][Math.min(3, d)]})`, blur: 0 };
    case 'neon':
      return { color: rgba(accent, d === 1 ? 0.55 : 0.32), blur: 0 };
    case 'focus':
      return { color: `rgba(255,255,255,${d === 1 ? 0.6 : 0.4})`, blur: 7 + d * 2 };
    case 'typewriter':
      return { color: `rgba(255,255,255,${d === 1 ? 0.22 : 0.14})`, blur: 0 };
    default:
      return { color: `rgba(255,255,255,${d === 1 ? 0.5 : 0.28})`, blur: 0 };
  }
}

export { blurText };
