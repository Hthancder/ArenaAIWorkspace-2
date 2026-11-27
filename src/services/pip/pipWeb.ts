// Picture in Picture on the web: the same live card as iOS, drawn on a canvas, streamed into a
// hidden <video> and floated with the browser's video PiP (Chrome, Edge, Safari).
// The PiP window's play/pause comes back as commands; prev/next/seek go through the Media
// Session handlers the app already sets.

import type { PipCommandEvent, PipMeta } from '../../../modules/holysic-pip';
import { PlaybackClock } from '../audio/playbackClock';

const W = 960;
const H = 540;
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

  async start(): Promise<boolean> {
    if (!this.ensure() || !this.video) return false;
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
    const d = document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };
    if (d.pictureInPictureElement && d.exitPictureInPicture)
      await d.exitPictureInPicture().catch(() => undefined);
  }

  setMeta(m: PipMeta) {
    this.meta = m;
    if (m.artwork !== this.artUri) this.loadArt(m.artwork);
    this.render(true);
  }

  setLyrics(starts: number[], texts: string[], offset: number, synced: boolean) {
    const n = Math.min(starts.length, texts.length);
    this.lyr = {
      starts: starts.slice(0, n),
      texts: texts.slice(0, n),
      offset,
      synced: synced && n > 0,
    };
    this.render(true);
    this.schedule();
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
    if (this.timer) return;
    this.timer = setInterval(() => this.render(false), 80);
  }

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
    const progressPx = m.duration > 0 ? Math.floor((pos / m.duration) * 400) : 0;
    const key = `${idx}|${Math.floor(fill * 60)}|${progressPx}|${this.playing}|${Math.floor(pos)}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.draw(ctx, m, pos, idx, fill);
  }

  private draw(ctx: CanvasRenderingContext2D, m: PipMeta, pos: number, idx: number, fill: number) {
    const l = this.lyr;
    const hasLyrics = m.showLyrics && l.synced;
    const line = idx >= 0 ? l.texts[idx] || '' : '';
    const next = hasLyrics && idx + 1 < l.texts.length ? l.texts[Math.max(0, idx + 1)] : '';

    // backdrop
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, m.accent);
    g.addColorStop(1, '#0A0A12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (this.art && m.style !== 'minimal') {
      const a = this.art;
      const s = Math.max(W / a.width, H / a.height) * 1.1;
      try {
        ctx.filter = 'blur(28px)';
        ctx.drawImage(a, (W - a.width * s) / 2, (H - a.height * s) / 2, a.width * s, a.height * s);
        ctx.filter = 'none';
      } catch {
        // ignore
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
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

    /** the sung line, centred in its box, karaoke fill on a one-line text */
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
      let fs = size;
      let lines: string[] = [];
      for (;;) {
        ctx.font = `800 ${fs}px ${FONT}`;
        lines = wrap(ctx, s, w, max);
        if (fs <= 22 || lines.length * fs * 1.2 <= h) break;
        fs -= 4;
      }
      const total = lines.length * fs * 1.2;
      const top = y + (h - total) / 2;
      ctx.textAlign = align;
      const ax = align === 'center' ? x + w / 2 : x;
      if (lines.length === 1 && fill > 0 && fill < 1) {
        const tw = ctx.measureText(lines[0]).width;
        const x0 = align === 'center' ? x + (w - tw) / 2 : x;
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fillText(lines[0], ax, top);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top - 10, tw * fill, fs * 1.2 + 20);
        ctx.clip();
        ctx.fillStyle = '#FFF';
        ctx.fillText(lines[0], ax, top);
        ctx.restore();
      } else {
        ctx.fillStyle = '#FFF';
        lines.forEach((ln, i) => ctx.fillText(ln, ax, top + i * fs * 1.2));
      }
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

    const progress = (x: number, y: number, w: number) => {
      const f = m.duration > 0 ? Math.max(0, Math.min(1, pos / m.duration)) : 0;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x, y, w, 6);
      ctx.fillStyle = m.accent;
      ctx.fillRect(x, y, Math.max(6, w * f), 6);
      ctx.restore();
      text(mmss(pos), x, y + 12, 120, 18, 600, 'rgba(255,255,255,0.7)', 'left');
      text(
        m.duration > 0 ? '-' + mmss(Math.max(0, m.duration - pos)) : this.playing ? '' : '❚❚',
        x + w - 120,
        y + 12,
        120,
        18,
        600,
        'rgba(255,255,255,0.7)',
        'right'
      );
    };

    if (m.style === 'card') {
      cover(40, 40, 400, 26);
      const x = 470;
      const w = W - x - 40;
      text(m.title, x, 60, w, 38, 800, '#FFF', 'left', 2);
      text(m.artist, x, 165, w, 26, 600, 'rgba(255,255,255,0.7)', 'left');
      if (hasLyrics) {
        sung(line || '♪', x, 230, w, 150, 32, 3, 'left');
        text(next, x, 392, w, 22, 600, 'rgba(255,255,255,0.5)', 'left');
      } else if (m.upNext) text(m.upNext, x, 380, w, 21, 600, 'rgba(255,255,255,0.6)', 'left', 2);
      progress(x, 470, w);
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
        sung(line, 60, 130, W - 120, 230, 56, 3, 'center');
        text(next, 60, 380, W - 120, 28, 600, 'rgba(255,255,255,0.45)', 'center');
      } else text(m.title, 60, 200, W - 120, 50, 800, '#FFF', 'center', 2);
      const f = m.duration > 0 ? Math.max(0, Math.min(1, pos / m.duration)) : 0;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, H - 6, W, 6);
      ctx.fillStyle = m.accent;
      ctx.fillRect(0, H - 6, W * f, 6);
    } else {
      cover(40, 32, 84, 14);
      text(m.title, 142, 40, W - 190, 30, 700, '#FFF', 'left');
      text(m.artist, 142, 80, W - 190, 22, 500, 'rgba(255,255,255,0.65)', 'left');
      if (hasLyrics) {
        sung(line || '♪', 48, 150, W - 96, 200, 48, 2, 'center');
        text(next, 48, 365, W - 96, 27, 600, 'rgba(255,255,255,0.5)', 'center');
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
      progress(48, 470, W - 96);
    }
  }
}

export const webPip = new WebPip();
