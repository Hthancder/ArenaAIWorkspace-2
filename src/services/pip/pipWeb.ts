// Picture in Picture on the web: the same live card as iOS, drawn on a canvas.
//
// Chrome / Edge 116+ (Document Picture-in-Picture): the canvas moves into a real floating window
// with HTML controls under it — a draggable seek bar, previous / play / next. Elsewhere (Safari,
// Firefox) the canvas is streamed into a hidden <video> and floated with video PiP; its
// play/pause comes back as commands, prev/next/seek go through the Media Session handlers the
// app already sets, and the seek bar is drawn into the picture.

import type { PipCommandEvent, PipMeta } from '../../../modules/holysic-pip';
import { PlaybackClock } from '../audio/playbackClock';
import {
  ANIMATED_FX,
  blurText,
  contextLine,
  drawAmbient,
  drawSeekBar,
  drawSung,
  fxBusy,
  lineWords,
  wordsStarted,
  type PipWord,
} from './pipLyricsFx';

/** canvas (= PiP window shape) per style — same as the iOS module */
export function pipCanvasSize(style: string): [number, number] {
  if (style === 'square') return [720, 720];
  if (style === 'bar') return [1080, 300];
  if (style === 'stack') return [600, 800];
  return [960, 540];
}

let W = 960;
let H = 540;
const LEAD = 0.15;

type Listener<T> = (e: T) => void;

interface Lyr {
  starts: number[];
  texts: string[];
  offset: number;
  synced: boolean;
}

function lineAt(l: Lyr, pos: number): number {
  const s = l.starts;
  if (!l.synced || !s.length) return -1;
  const t = pos - l.offset + LEAD;
  let lo = 0;
  let hi = s.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';

/** word-wrap `text` into at most `max` lines of width `w` (last one ellipsised) */
function wrap(ctx: CanvasRenderingContext2D, text: string, w: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(tryLine).width <= w || !cur) cur = tryLine;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = kept[max - 1] + '…';
    while (last.length > 1 && ctx.measureText(last).width > w) last = last.slice(0, -2) + '…';
    kept[max - 1] = last;
    return kept;
  }
  return lines.map((ln) => {
    if (ctx.measureText(ln).width <= w) return ln;
    let s = ln;
    while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  });
}

class WebPip {
  private canvas: HTMLCanvasElement | null = null;
  private video: HTMLVideoElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private meta: PipMeta | null = null;
  private lyr: Lyr = { starts: [], texts: [], offset: 0, synced: false };
  /** real word timing per line (null = estimate from the line) */
  private words: (PipWord[] | null)[] = [];
  /** the ambient backdrop, drawn once per song / look */
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  /** Document PiP window (Chrome / Edge) — the canvas lives in it while open */
  private docWin: Window | null = null;
  private docUi: {
    range: HTMLInputElement;
    cur: HTMLElement;
    left: HTMLElement;
    play: HTMLButtonElement;
    dragging: boolean;
  } | null = null;
  private pos = 0;
  private at = 0;
  private playing = false;
  private art: HTMLImageElement | null = null;
  private artUri = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastKey = '';
  private ours = false;
  active = false;
  stateSubs = new Set<Listener<{ active: boolean; possible: boolean; error?: string }>>();
  cmdSubs = new Set<Listener<PipCommandEvent>>();

  supported(): boolean {
    if (typeof document === 'undefined') return false;
    const d = document as Document & { pictureInPictureEnabled?: boolean };
    if (!d.pictureInPictureEnabled) return false;
    try {
      return typeof HTMLCanvasElement.prototype.captureStream === 'function';
    } catch {
      return false;
    }
  }

  private ensure(): boolean {
    if (this.video && this.canvas && this.ctx) return true;
    if (!this.supported()) return false;
    const c = document.createElement('canvas');
    if (this.meta) [W, H] = pipCanvasSize(this.meta.style);
    c.width = W;
    c.height = H;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    // on the page (some browsers only stream / float attached elements) but invisible
    for (const el of [c, v]) {
      Object.assign(el.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '2px',
        height: '2px',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '-1',
      });
      document.body.appendChild(el);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    v.srcObject = c.captureStream(30);
    v.addEventListener('enterpictureinpicture', () => this.setActive(true));
    v.addEventListener('leavepictureinpicture', () => this.setActive(false));
    // the PiP window's own play/pause button
    v.addEventListener('pause', () => {
      if (this.ours || !this.active) return;
      this.cmdSubs.forEach((f) => f({ type: 'pause' }));
    });
    v.addEventListener('play', () => {
      if (this.ours || !this.active) return;
      this.cmdSubs.forEach((f) => f({ type: 'play' }));
    });
    this.canvas = c;
    this.video = v;
    this.ctx = ctx;
    this.render(true);
    return true;
  }

  private setActive(on: boolean, error?: string) {
    this.active = on;
    this.schedule();
    this.stateSubs.forEach((f) => f({ active: on, possible: this.supported(), error }));
  }

  /** create the hidden video and get its first frame in, so a later tap floats it at once */
  prepare(): void {
    if (!this.ensure() || !this.video) return;
    this.render(true);
    if (this.video.paused) {
      this.ours = true;
      this.video.play().catch(() => undefined);
      setTimeout(() => (this.ours = false), 120);
    }
  }

  /** Chrome / Edge: a real floating window with the card and live controls */
  private async startDocument(): Promise<boolean> {
    const dpip = (
      window as unknown as {
        documentPictureInPicture?: {
          requestWindow(o: { width: number; height: number }): Promise<Window>;
        };
      }
    ).documentPictureInPicture;
    if (!dpip || !this.canvas) return false;
    const scale = W > 1000 ? 0.42 : W > 700 ? 0.5 : 0.55;
    const win = await dpip.requestWindow({
      width: Math.round(W * scale),
      height: Math.round(H * scale) + 64,
    });
    const d = win.document;
    d.title = this.meta?.title || 'HolySic';
    const st = d.createElement('style');
    const accent = this.meta?.accent || '#8B5CF6';
    st.textContent = `
      html,body{margin:0;height:100%;background:#050507;color:#fff;overflow:hidden;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
      body{display:flex;flex-direction:column}
      canvas{flex:1;min-height:0;width:100%;object-fit:contain;display:block}
      .bar{display:flex;align-items:center;gap:10px;padding:8px 12px 10px;background:#0b0b10}
      button{all:unset;cursor:pointer;width:32px;height:32px;border-radius:16px;display:grid;
        place-items:center;font-size:15px;color:#fff}
      button:hover{background:rgba(255,255,255,.1)}
      button.play{background:${accent};color:#000;width:36px;height:36px;border-radius:18px}
      .t{font-size:12px;font-variant-numeric:tabular-nums;opacity:.75;min-width:38px}
      input[type=range]{flex:1;accent-color:${accent};height:4px;cursor:pointer}`;
    d.head.appendChild(st);
    d.body.appendChild(this.canvas);
    Object.assign(this.canvas.style, {
      position: 'static',
      width: '100%',
      height: 'auto',
      opacity: '1',
      pointerEvents: 'auto',
      zIndex: 'auto',
    });
    const bar = d.createElement('div');
    bar.className = 'bar';
    const mk = (label: string, text: string, cls = '') => {
      const b = d.createElement('button');
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label);
      if (cls) b.className = cls;
      return b;
    };
    const prev = mk('Previous', '⏮');
    const play = mk('Play / pause', this.playing ? '❚❚' : '▶', 'play');
    const next = mk('Next', '⏭');
    const cur = d.createElement('span');
    cur.className = 't';
    const range = d.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.step = '0.1';
    range.setAttribute('aria-label', 'Seek');
    const left = d.createElement('span');
    left.className = 't';
    bar.append(prev, play, next, cur, range, left);
    d.body.appendChild(bar);
    const ui = { range, cur, left, play, dragging: false };
    this.docUi = ui;
    const send = (c: PipCommandEvent) => this.cmdSubs.forEach((f) => f(c));
    prev.onclick = () => send({ type: 'previous' });
    next.onclick = () => send({ type: 'next' });
    play.onclick = () => send({ type: this.playing ? 'pause' : 'play' });
    range.oninput = () => {
      ui.dragging = true;
      cur.textContent = mmss(Number(range.value));
    };
    range.onchange = () => {
      ui.dragging = false;
      send({ type: 'seekTo', position: Number(range.value) });
    };
    // keyboard: space plays / pauses, arrows skip 5 s
    d.addEventListener('keydown', (e) => {
      if (e.target === range) return;
      if (e.key === ' ') {
        e.preventDefault();
        send({ type: this.playing ? 'pause' : 'play' });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        send({ type: 'seek', delta: e.key === 'ArrowLeft' ? -5 : 5 });
    });
    win.addEventListener('pagehide', () => this.closeDocument());
    this.docWin = win;
    this.setActive(true);
    this.render(true);
    return true;
  }

  /** the window closed: the canvas goes back to the page, hidden */
  private closeDocument() {
    if (!this.docWin) return;
    this.docWin = null;
    this.docUi = null;
    if (this.canvas) {
      Object.assign(this.canvas.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '2px',
        height: '2px',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '-1',
      });
      document.body.appendChild(this.canvas);
    }
    this.setActive(false);
  }

  private updateDocUi(pos: number) {
    const ui = this.docUi;
    const m = this.meta;
    if (!ui || !m) return;
    const d = m.duration;
    ui.range.disabled = !(d > 0);
    ui.range.max = String(Math.max(1, d));
    if (!ui.dragging) {
      ui.range.value = String(Math.min(d, pos));
      ui.cur.textContent = mmss(pos);
    }
    ui.left.textContent = d > 0 ? '-' + mmss(Math.max(0, d - pos)) : '';
    ui.play.textContent = this.playing ? '❚❚' : '▶';
  }

  async start(): Promise<boolean> {
    if (!this.ensure()) return false;
    try {
      if (await this.startDocument()) return true;
    } catch {
      // not allowed here (no user gesture, iframe…) — fall back to video PiP
    }
    if (!this.video) return false;
    const v = this.video as HTMLVideoElement & { requestPictureInPicture(): Promise<unknown> };
    try {
      this.prepare();
      // the stream needs a frame before the video can float (the browser rejects it otherwise);
      // usually there already is one (prepare() ran when the button showed up)
      if (v.readyState < 1) {
        await new Promise<void>((res) => {
          const done = () => {
            v.removeEventListener('loadedmetadata', done);
            res();
          };
          v.addEventListener('loadedmetadata', done);
          setTimeout(done, 1200);
          // nudge the canvas so the stream emits a frame
          setTimeout(() => this.render(true), 30);
        });
      }
      await v.requestPictureInPicture();
      this.syncVideo();
      return true;
    } catch (e) {
      this.setActive(false, e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.docWin) {
      this.docWin.close();
      this.closeDocument();
      return;
    }
    const d = document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };
    if (d.pictureInPictureElement && d.exitPictureInPicture)
      await d.exitPictureInPicture().catch(() => undefined);
  }

  setMeta(m: PipMeta) {
    this.meta = m;
    const [w, h] = pipCanvasSize(m.style);
    if (w !== W || h !== H) {
      // the floating window follows the stream's new shape
      W = w;
      H = h;
      if (this.canvas) {
        this.canvas.width = W;
        this.canvas.height = H;
      }
    }
    if (m.artwork !== this.artUri) this.loadArt(m.artwork);
    this.render(true);
    this.schedule();
  }

  setLyrics(starts: number[], texts: string[], offset: number, synced: boolean) {
    const n = Math.min(starts.length, texts.length);
    this.lyr = {
      starts: starts.slice(0, n),
      texts: texts.slice(0, n),
      offset,
      synced: synced && n > 0,
    };
    this.words = [];
    this.render(true);
    this.schedule();
  }

  setWords(texts: string[][], starts: number[][], ends: number[][]) {
    this.words = texts.map((ws, i) =>
      ws.length
        ? ws.map((text, k) => ({
            text,
            start: starts[i]?.[k] ?? 0,
            end: ends[i]?.[k] ?? (starts[i]?.[k] ?? 0) + 0.4,
          }))
        : null
    );
    this.render(true);
  }

  setPlayback(pos: number, playing: boolean) {
    const changed = playing !== this.playing;
    this.pos = pos;
    this.at = Date.now();
    this.playing = playing;
    if (changed) {
      this.syncVideo();
      this.render(true);
      this.schedule();
    }
  }

  /** the PiP window's button shows the song's state (a paused video holds the last frame) */
  private syncVideo() {
    const v = this.video;
    if (!v || !this.active) return;
    this.ours = true;
    if (this.playing && v.paused) v.play().catch(() => undefined);
    else if (!this.playing && !v.paused) {
      // draw the "paused" frame first, it stays on screen
      this.render(true);
      setTimeout(() => v.pause(), 60);
    }
    setTimeout(() => (this.ours = false), 120);
  }

  /** the engine's own position (reported 4×/s) — the bridge only sends play / pause / jumps */
  private clock(): number {
    const live = PlaybackClock.now(this.playing);
    if (Number.isFinite(live) && (live > 0 || !this.playing)) return live;
    if (!this.playing) return this.pos;
    return this.pos + (Date.now() - this.at) / 1000;
  }

  private schedule() {
    const need = this.active;
    if (!need) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    const fast =
      this.playing &&
      this.lyr.synced &&
      !!this.meta?.showLyrics &&
      ANIMATED_FX.has(this.meta?.effect || 'glow');
    const every = fast ? 50 : 80;
    if (this.timer && this.timerEvery === every) return;
    if (this.timer) clearInterval(this.timer);
    this.timerEvery = every;
    this.timer = setInterval(() => this.render(false), every);
  }
  private timerEvery = 0;

  private loadArt(uri: string) {
    this.artUri = uri;
    this.art = null;
    if (!uri) return;
    const img = new Image();
    img.crossOrigin = 'anonymous'; // a tainted canvas can't be streamed
    img.onload = () => {
      if (this.artUri !== uri) return;
      this.art = img;
      this.render(true);
    };
    img.src = uri;
  }

  private render(force: boolean) {
    const ctx = this.ctx;
    const m = this.meta;
    if (!ctx || !m) return;
    const pos = this.clock();
    const idx = m.showLyrics ? lineAt(this.lyr, pos) : -1;
    let fill = 0;
    if (idx >= 0) {
      const start = this.lyr.starts[idx] + this.lyr.offset;
      const end =
        idx + 1 < this.lyr.starts.length
          ? this.lyr.starts[idx + 1] + this.lyr.offset
          : m.duration > start
            ? Math.min(start + 8, m.duration - 0.3)
            : start + 5;
      fill = Math.max(0, Math.min(1, (pos - start) / Math.max(0.3, Math.min(end - start, 12))));
    }
    const progressPx = m.duration > 0 ? Math.floor((pos / m.duration) * 600) : 0;
    // a new frame only when something changes: a word starts, an effect is mid-motion, the bar
    // moves a pixel step, the second ticks — a still line between words costs nothing
    let anim = 0;
    let started = 0;
    if (idx >= 0) {
      const l = this.lyr;
      const ls = l.starts[idx];
      const le =
        idx + 1 < l.starts.length
          ? l.starts[idx + 1]
          : m.duration > 0
            ? Math.min(ls + 8, m.duration - l.offset - 0.3)
            : ls + 5;
      const words = lineWords(l.texts[idx] || '', this.words[idx], ls, le);
      const t = pos - l.offset + LEAD;
      started = wordsStarted(words, t);
      if (ANIMATED_FX.has(m.effect || 'glow') && fxBusy(m.effect || 'glow', words, ls, t))
        anim = Math.floor(pos * 20);
    }
    const key = `${idx}|${started}|${progressPx}|${this.playing}|${Math.floor(pos)}|${anim}`;
    this.updateDocUi(pos);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.draw(ctx, m, pos, idx, fill);
  }

  /** the ambient backdrop (or the cover, full-bleed, for the square style), cached */
  private backdrop(m: PipMeta): HTMLCanvasElement | null {
    const amb = m.ambient || [];
    const key = `${W}x${H}|${m.style}|${amb.join()}|${m.ambientLevel ?? 0.8}|${m.accent}|${this.art ? this.artUri : ''}`;
    if (this.base && this.baseKey === key) return this.base;
    const c = this.base || document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, W, H);
    if (this.art && m.style === 'square') {
      const a = this.art;
      const s = Math.max(W / a.width, H / a.height);
      g.drawImage(a, (W - a.width * s) / 2, (H - a.height * s) / 2, a.width * s, a.height * s);
      const sh = g.createLinearGradient(0, H * 0.38, 0, H);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(0.55, 'rgba(0,0,0,0.55)');
      sh.addColorStop(1, 'rgba(0,0,0,0.85)');
      g.fillStyle = sh;
      g.fillRect(0, 0, W, H);
    } else {
      drawAmbient(g, W, H, amb, m.ambientLevel ?? 0.8, this.art, m.accent);
    }
    this.base = c;
    this.baseKey = key;
    return c;
  }

  private draw(ctx: CanvasRenderingContext2D, m: PipMeta, pos: number, idx: number, _fill: number) {
    const l = this.lyr;
    const hasLyrics = m.showLyrics && l.synced;
    const line = idx >= 0 ? l.texts[idx] || '' : '';
    const next = hasLyrics && idx + 1 < l.texts.length ? l.texts[Math.max(0, idx + 1)] : '';
    const effect = m.effect || 'glow';
    // the window's own controls carry the seek bar in Document PiP
    const drawBar = !this.docWin;
    const t = pos - l.offset + LEAD;
    const lineStart = idx >= 0 ? l.starts[idx] : 0;
    const lineEnd =
      idx >= 0 && idx + 1 < l.starts.length
        ? l.starts[idx + 1]
        : m.duration > 0
          ? Math.min(lineStart + 8, m.duration - l.offset - 0.3)
          : lineStart + 5;

    const base = this.backdrop(m);
    if (base) ctx.drawImage(base, 0, 0);
    else {
      ctx.fillStyle = '#0A0A12';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;

    const text = (
      s: string,
      x: number,
      y: number,
      w: number,
      size: number,
      weight: number,
      color: string,
      align: CanvasTextAlign,
      max = 1
    ) => {
      if (!s) return 0;
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
      const lines = wrap(ctx, s, w, max);
      lines.forEach((ln, i) => ctx.fillText(ln, ax, y + i * size * 1.2));
      return lines.length * size * 1.2;
    };

    /** a neighbouring line, in the effect's look (blurred in Focus, accent in Neon…) */
    const ctxLine = (
      s: string,
      x: number,
      y: number,
      w: number,
      size: number,
      align: CanvasTextAlign,
      distance: number,
      max = 1
    ) => {
      if (!s) return;
      const look = contextLine(effect, m.accent, distance);
      if (!look.blur) {
        text(s, x, y, w, size, 700, look.color, align, max);
        return;
      }
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.textAlign = align;
      const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
      wrap(ctx, s, w, max).forEach((ln, i) =>
        blurText(ctx, ln, ax, y + i * size * 1.2, look.color, look.blur)
      );
    };

    /** the sung line, with the lyrics effect */
    const sung = (
      s: string,
      x: number,
      y: number,
      w: number,
      h: number,
      size: number,
      max: number,
      align: CanvasTextAlign
    ) => {
      if (idx < 0 || !line) {
        text(s, x, y + (h - size * 1.2) / 2, w, size, 800, '#FFF', align, max);
        return;
      }
      drawSung(ctx, {
        text: s,
        words: this.words[idx] ?? null,
        lineStart,
        lineEnd,
        t,
        x,
        y,
        w,
        h,
        size,
        maxLines: max,
        align,
        effect,
        accent: m.accent,
      });
    };

    const cover = (x: number, y: number, s: number, r: number) => {
      ctx.save();
      ctx.beginPath();
      const rr = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };
      if (rr.roundRect) rr.roundRect(x, y, s, s, r);
      else ctx.rect(x, y, s, s);
      ctx.clip();
      if (this.art) {
        const a = this.art;
        const k = Math.max(s / a.width, s / a.height);
        ctx.drawImage(
          a,
          x + (s - a.width * k) / 2,
          y + (s - a.height * k) / 2,
          a.width * k,
          a.height * k
        );
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y, s, s);
        ctx.restore();
        text('♪', x, y + s * 0.25, s, s * 0.42, 700, '#FFF', 'center');
        return;
      }
      ctx.restore();
    };

    const bar = (x: number, y: number, w: number, times = true) => {
      if (drawBar) drawSeekBar(ctx, x, y, w, pos, m.duration, m.accent, times, this.playing);
    };

    if (m.style === 'square') {
      if (hasLyrics && line) {
        sung(line, 36, H - 300, W - 72, 150, 44, 3, 'left');
        ctxLine(next, 36, H - 140, W - 72, 24, 'left', 1);
      } else {
        if (!this.art) cover(W / 2 - 150, 90, 300, 30);
        text(m.title, 36, H - 268, W - 72, 44, 800, '#FFF', 'left', 2);
        text(m.artist, 36, H - 146, W - 72, 26, 600, 'rgba(255,255,255,0.7)', 'left');
      }
      bar(36, H - 74, W - 72);
    } else if (m.style === 'bar') {
      if (hasLyrics) sung(line || '♪', 40, 28, W - 80, H - 84, 72, 2, 'center');
      else
        text(
          m.artist ? `${m.title} — ${m.artist}` : m.title,
          40,
          H / 2 - 66,
          W - 80,
          52,
          800,
          '#FFF',
          'center',
          2
        );
      bar(40, H - 30, W - 80, false);
    } else if (m.style === 'stack') {
      cover(40, 40, 96, 16);
      text(m.title, 156, 48, W - 196, 30, 700, '#FFF', 'left');
      text(m.artist, 156, 90, W - 196, 23, 500, 'rgba(255,255,255,0.65)', 'left');
      if (hasLyrics) {
        const prev = idx >= 1 ? l.texts[idx - 1] || '' : '';
        const after = idx + 2 < l.texts.length ? l.texts[idx + 2] : '';
        ctxLine(prev, 40, 168, W - 80, 28, 'left', 1, 2);
        sung(line || '♪', 40, 250, W - 80, 270, 48, 5, 'left');
        ctxLine(next, 40, 534, W - 80, 30, 'left', 1, 2);
        ctxLine(after, 40, 614, W - 80, 30, 'left', 2, 2);
      } else {
        text(
          m.showLyrics ? m.noLyrics : m.artist,
          40,
          300,
          W - 80,
          40,
          700,
          'rgba(255,255,255,0.85)',
          'left',
          3
        );
        text(m.upNext, 40, 480, W - 80, 24, 600, 'rgba(255,255,255,0.55)', 'left', 2);
      }
      bar(40, H - 76, W - 80);
    } else if (m.style === 'card') {
      cover(40, 40, 400, 26);
      const x = 470;
      const w = W - x - 40;
      text(m.title, x, 60, w, 38, 800, '#FFF', 'left', 2);
      text(m.artist, x, 165, w, 26, 600, 'rgba(255,255,255,0.7)', 'left');
      if (hasLyrics) {
        sung(line || '♪', x, 226, w, 150, 32, 3, 'left');
        ctxLine(next, x, 388, w, 22, 'left', 1);
      } else if (m.upNext) text(m.upNext, x, 380, w, 21, 600, 'rgba(255,255,255,0.6)', 'left', 2);
      bar(x, 456, w);
    } else if (m.style === 'minimal') {
      text(
        `${m.title}  ·  ${m.artist}`,
        60,
        40,
        W - 120,
        22,
        600,
        'rgba(255,255,255,0.6)',
        'center'
      );
      if (hasLyrics && line) {
        sung(line, 60, 120, W - 120, 230, 56, 3, 'center');
        ctxLine(next, 60, 366, W - 120, 28, 'center', 1);
      } else text(m.title, 60, 190, W - 120, 50, 800, '#FFF', 'center', 2);
      bar(60, H - 70, W - 120);
    } else {
      cover(40, 32, 84, 14);
      text(m.title, 142, 40, W - 190, 30, 700, '#FFF', 'left');
      text(m.artist, 142, 80, W - 190, 22, 500, 'rgba(255,255,255,0.65)', 'left');
      if (hasLyrics) {
        sung(line || '♪', 48, 146, W - 96, 200, 48, 2, 'center');
        ctxLine(next, 48, 360, W - 96, 27, 'center', 1);
      } else {
        text(
          m.showLyrics ? m.noLyrics : m.artist,
          48,
          200,
          W - 96,
          40,
          700,
          'rgba(255,255,255,0.85)',
          'center',
          2
        );
        text(m.upNext, 48, 330, W - 96, 24, 600, 'rgba(255,255,255,0.55)', 'center');
      }
      bar(48, 456, W - 96);
    }
  }
}

export const webPip = new WebPip();
