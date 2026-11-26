// Real artwork colours for HolySic's ambient light. Samples the actual pixels of the cover —
// not a hash of the title — so a red cover glows red and a blue one glows blue.
//  • Web: draws a tiny copy of the image on a canvas.
//  • iOS: fetches a small thumbnail (most CDNs serve resized covers) and decodes the JPEG in
//    pure JS (jpeg-js), so no native module is needed and Expo Go keeps working.
//  • Built-in SVG covers: reads their gradient colours straight from the markup.

import { Platform } from 'react-native';
import { decodeSvgDataUri, normalizeArtworkUrl } from '../../components/ArtworkImage';

export interface ArtColors {
  /** Most prominent vivid colour */
  primary: string;
  /** Second colour from a different part of the cover (for the mesh / second glow lobe) */
  secondary: string;
  /** Overall dark tone of the cover */
  dark: string;
  /** Hue (0–360) and saturation (0–1) of the primary colour */
  hue: number;
  sat: number;
  /** True when the cover is almost greyscale */
  mono: boolean;
  /** Glow-ready colour of each region of the cover: top-left, top-right, bottom-left, bottom-right */
  corners: [string, string, string, string];
}

type RGB = [number, number, number];
const cache = new Map<string, ArtColors | null>();
const inflight = new Map<string, Promise<ArtColors | null>>();

// ---------- colour helpers ----------
const hex = ([r, g, b]: RGB) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('');

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, Math.min(1, s), l];
}

function parseHex(h: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Hue-bucket quantiser: favours vivid, mid-light colours, like Android's Palette "vibrant". */
export function analysePixels(pixels: RGB[], gridWidth = 0): ArtColors | null {
  if (pixels.length === 0) return null;
  const base = analyseCore(pixels);
  if (!base) return null;
  let corners: [string, string, string, string];
  if (gridWidth > 1 && pixels.length >= gridWidth * 2) {
    const rows = Math.floor(pixels.length / gridWidth);
    const quad: RGB[][] = [[], [], [], []];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < gridWidth; x++) {
        const q = (y < rows / 2 ? 0 : 2) + (x < gridWidth / 2 ? 0 : 1);
        quad[q].push(pixels[y * gridWidth + x]);
      }
    corners = quad.map((q) => glowTone(q, base)) as [string, string, string, string];
  } else {
    corners = [base.primary, base.secondary, base.secondary, base.primary].map((c) =>
      glowTone([parseHex(c)!], base)
    ) as [string, string, string, string];
  }
  return { ...base, corners };
}

/** A region's colour made glow-friendly: its dominant vivid hue (averaging opposite hues would
 *  give mud), lightness kept mid-range so the glow is visible on the dark UI. */
function glowTone(px: RGB[], base: Omit<ArtColors, 'corners'>): string {
  const B = 18;
  const w = new Array(B).fill(0);
  const acc: RGB[] = Array.from({ length: B }, () => [0, 0, 0] as RGB);
  const n = new Array(B).fill(0);
  const all: RGB = [0, 0, 0];
  let vivid = 0;
  for (const p of px) {
    all[0] += p[0];
    all[1] += p[1];
    all[2] += p[2];
    const [h, s, l] = rgbToHsl(p);
    if (s < 0.2 || l < 0.08 || l > 0.92) continue;
    vivid++;
    const b = Math.floor(h / (360 / B)) % B;
    w[b] += s * (1 - Math.abs(l - 0.5));
    acc[b][0] += p[0];
    acc[b][1] += p[1];
    acc[b][2] += p[2];
    n[b]++;
  }
  let src: RGB;
  if (vivid >= px.length * 0.08) {
    const best = w.indexOf(Math.max(...w));
    src = [acc[best][0] / n[best], acc[best][1] / n[best], acc[best][2] / n[best]];
  } else {
    src = [all[0] / px.length, all[1] / px.length, all[2] / px.length];
  }
  const [h, s, l] = rgbToHsl(src);
  // near-grey region: borrow the cover's main hue lightly so the glow stays coloured
  const hh = s < 0.12 && !base.mono ? base.hue : h;
  const ss = base.mono ? Math.min(0.15, s) : Math.max(0.35, Math.min(0.95, s * 1.25));
  const ll = Math.max(0.38, Math.min(0.66, l));
  return hex(hslRgb(hh, ss, ll));
}

function analyseCore(pixels: RGB[]): Omit<ArtColors, 'corners'> | null {
  const BUCKETS = 24;
  const w = new Array(BUCKETS).fill(0);
  const sum: RGB[] = Array.from({ length: BUCKETS }, () => [0, 0, 0] as RGB);
  const cnt = new Array(BUCKETS).fill(0);
  const all: RGB = [0, 0, 0];
  let vivid = 0;
  for (const p of pixels) {
    all[0] += p[0];
    all[1] += p[1];
    all[2] += p[2];
    const [h, s, l] = rgbToHsl(p);
    if (s < 0.2 || l < 0.1 || l > 0.9) continue;
    vivid++;
    const b = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
    const weight = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    w[b] += weight;
    sum[b][0] += p[0];
    sum[b][1] += p[1];
    sum[b][2] += p[2];
    cnt[b]++;
  }
  const avg: RGB = [all[0] / pixels.length, all[1] / pixels.length, all[2] / pixels.length];
  const darkOf = (c: RGB): RGB => {
    const [h, s] = rgbToHsl(c);
    return hslRgb(h, Math.min(0.55, s), 0.09);
  };
  // Mostly greyscale cover → a soft neutral glow tinted by the average colour
  if (vivid < pixels.length * 0.04) {
    const [h, s] = rgbToHsl(avg);
    return {
      primary: hex(hslRgb(h, Math.min(0.18, s), 0.62)),
      secondary: hex(hslRgb(h, Math.min(0.12, s), 0.38)),
      dark: hex(darkOf(avg)),
      hue: h,
      sat: Math.min(0.18, s),
      mono: true,
    };
  }
  // Smooth across neighbouring buckets so a hue split across a boundary still wins
  const score = w.map((v, i) => v + 0.5 * (w[(i + 1) % BUCKETS] + w[(i + BUCKETS - 1) % BUCKETS]));
  const order = score.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0]);
  const mean = (i: number): RGB =>
    cnt[i] ? [sum[i][0] / cnt[i], sum[i][1] / cnt[i], sum[i][2] / cnt[i]] : avg;
  const pi = cnt[order[0][1]] ? order[0][1] : order.find(([, i]) => cnt[i])![1];
  const primary = mean(pi);
  const [ph, ps] = rgbToHsl(primary);
  let secondary: RGB | null = null;
  for (const [v, i] of order) {
    if (!cnt[i] || v < order[0][0] * 0.12) continue;
    const c = mean(i);
    if (hueDist(rgbToHsl(c)[0], ph) >= 35) {
      secondary = c;
      break;
    }
  }
  return {
    primary: hex(primary),
    secondary: hex(secondary || hslRgb(ph, ps * 0.85, 0.3)), // single-hue cover: a deeper shade, never an invented hue
    dark: hex(darkOf(avg)),
    hue: ph,
    sat: ps,
    mono: false,
  };
}

function hslRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
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
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ---------- sources ----------

/** Ask the CDN for a small copy of the cover — far less to download and decode. */
export function smallArtworkUrl(url: string): string {
  if (/mzstatic\.com/.test(url))
    return url.replace(/\/\d+x\d+[a-z]*\.(jpe?g|png|webp)$/i, '/64x64bb.jpg');
  if (/(googleusercontent|ggpht)\.com/.test(url) && /=[wsh]\d+/.test(url))
    return url.replace(/=[^/=]*$/, '=w64-h64-l90-rj');
  if (/ytimg\.com/.test(url))
    return url.replace(
      /\/(maxresdefault|hq720|sddefault|hqdefault)(_live)?\.(jpg|webp)/,
      '/mqdefault.jpg'
    );
  if (/saavncdn\.com/.test(url)) return url.replace(/-\d+x\d+\.(jpg|png)/, '-50x50.$1');
  if (/audius|creatornode|content-node/.test(url))
    return url.replace(/(480x480|1000x1000)\.jpg/, '150x150.jpg');
  return url;
}

function fromSvg(uri: string): ArtColors | null {
  const xml = decodeSvgDataUri(uri);
  if (!xml) return null;
  const px: RGB[] = [];
  const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const c = parseHex(m[0]);
    // repeat each colour a few times so every stop counts
    if (c) for (let i = 0; i < 8; i++) px.push(c);
  }
  return analysePixels(px);
}

function fromCanvas(url: string): Promise<ArtColors | null> {
  return new Promise((resolve) => {
    const g: any = globalThis as any;
    if (typeof g.document === 'undefined' || typeof g.Image === 'undefined') return resolve(null);
    const img = new g.Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const S = 32;
        const canvas = g.document.createElement('canvas');
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data as Uint8ClampedArray;
        const px: RGB[] = [];
        for (let i = 0; i < d.length; i += 4)
          px.push(d[i + 3] > 128 ? [d[i], d[i + 1], d[i + 2]] : [0, 0, 0]);
        resolve(analysePixels(px, S));
      } catch {
        resolve(null); // tainted canvas (no CORS)
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

async function fromJpeg(url: string): Promise<ArtColors | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    let bytes: Uint8Array;
    if (url.startsWith('data:image/jpeg;base64,') || url.startsWith('data:image/jpg;base64,')) {
      const g: any = globalThis as any;
      if (typeof g.atob !== 'function') return null;
      const bin = g.atob(url.slice(url.indexOf(',') + 1));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    // Only baseline/progressive JPEG (FF D8); PNG/WebP covers fall back to the hashed palette
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    // decoder only (the encoder needs Node's Buffer); useTArray keeps it Buffer-free on Hermes
    const decode = require('jpeg-js/lib/decoder') as typeof import('jpeg-js').decode;
    const img = decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 1.5,
      maxMemoryUsageInMB: 96,
      tolerantDecoding: true,
    });
    const total = img.width * img.height;
    const step = Math.max(1, Math.floor(Math.sqrt(total / 1600)));
    const px: RGB[] = [];
    const cols = Math.ceil(img.width / step);
    for (let y = 0; y < img.height; y += step)
      for (let x = 0; x < img.width; x += step) {
        const i = (y * img.width + x) * 4;
        px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
      }
    return analysePixels(px, cols);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Colours of a cover, cached per URL. Resolves null when the image can't be read. */
export function extractArtworkColors(raw?: string | null): Promise<ArtColors | null> {
  const uri = normalizeArtworkUrl(raw);
  if (!uri) return Promise.resolve(null);
  if (cache.has(uri)) return Promise.resolve(cache.get(uri)!);
  const pending = inflight.get(uri);
  if (pending) return pending;
  const job = (async () => {
    let out: ArtColors | null = null;
    if (uri.startsWith('data:image/svg+xml')) out = fromSvg(uri);
    else {
      const small = smallArtworkUrl(uri);
      if (Platform.OS === 'web') out = (await fromCanvas(small)) || (await fromCanvas(uri));
      else out = (await fromJpeg(small)) || (small !== uri ? await fromJpeg(uri) : null);
    }
    if (cache.size > 120) cache.delete(cache.keys().next().value as string);
    cache.set(uri, out);
    inflight.delete(uri);
    return out;
  })();
  inflight.set(uri, job);
  return job;
}

/** Synchronous peek at the cache (lets the UI paint instantly for covers seen before). */
export function cachedArtworkColors(raw?: string | null): ArtColors | null | undefined {
  return cache.get(normalizeArtworkUrl(raw));
}
