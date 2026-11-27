// Custom backgrounds: a photo, GIF or video behind the tabs (Settings › Background) or behind one
// album / playlist / artist page. Everything about how it is shown (framing, style, blur, veil,
// motion) lives in one small `BgMedia` object, so the same renderer draws the app, the page and
// the editor's live preview.
//
// Files are copied into Documents/.holysic-backdrops (hidden from the music library scan and from
// Files' Music folders) and referenced as `bgfile:<name>`: iOS moves the app container on every
// update, so absolute paths would break; the name is resolved at draw time.

import { Image, PixelRatio, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

export type BgKind = 'image' | 'gif' | 'video';
/** fill = cover (crop), fit = whole picture on a blurred copy, stretch, center = actual size,
 *  tile = repeat (still pictures only) */
export type BgFit = 'fill' | 'fit' | 'stretch' | 'center' | 'tile';
export type BgStyle = 'clear' | 'soft' | 'dreamy' | 'frosted' | 'cinema' | 'fade' | 'tint';
export type BgMotion = 'none' | 'drift' | 'pulse';

export interface BgMedia {
  /** `bgfile:<name>`, an https URL, or (web preview) a blob:/data: URI */
  ref: string;
  kind: BgKind;
  /** natural size in pixels (0 = not known yet, measured on first draw) */
  w: number;
  h: number;
  fit: BgFit;
  style: BgStyle;
  /** 0…1 */
  blur: number;
  /** 0…1 — how much of the page colour lies over the picture (legibility) */
  veil: number;
  /** 1…4 */
  zoom: number;
  /** focal point 0…1 (0.5 = centre): which part stays in view when cropped */
  fx: number;
  fy: number;
  motion: BgMotion;
  /** video: hold the picture while the music is paused */
  pauseWithMusic?: boolean;
  /** shown in the editor */
  name?: string;
  bytes?: number;
}

export const BG_STYLES: {
  id: BgStyle;
  vi: string;
  en: string;
  icon: string;
  blur: number;
  veil: number;
  descVi: string;
  descEn: string;
}[] = [
  {
    id: 'clear',
    vi: 'Rõ nét',
    en: 'Clear',
    icon: 'image-outline',
    blur: 0,
    veil: 0.35,
    descVi: 'Ảnh giữ nguyên, phủ nhẹ để chữ dễ đọc',
    descEn: 'The picture as it is, lightly veiled',
  },
  {
    id: 'soft',
    vi: 'Dịu nhẹ',
    en: 'Soft',
    icon: 'water-outline',
    blur: 0.2,
    veil: 0.45,
    descVi: 'Hơi nhoè, êm mắt khi đọc danh sách',
    descEn: 'Slightly softened, calm behind lists',
  },
  {
    id: 'dreamy',
    vi: 'Mơ màng',
    en: 'Dreamy',
    icon: 'cloudy-night-outline',
    blur: 0.6,
    veil: 0.25,
    descVi: 'Mờ ảo, sáng lan như sương',
    descEn: 'Hazy and glowing, like mist',
  },
  {
    id: 'frosted',
    vi: 'Kính mờ',
    en: 'Frosted',
    icon: 'snow-outline',
    blur: 0.85,
    veil: 0.15,
    descVi: 'Như nhìn qua lớp kính mờ của iOS',
    descEn: 'Seen through iOS frosted glass',
  },
  {
    id: 'cinema',
    vi: 'Điện ảnh',
    en: 'Cinematic',
    icon: 'film-outline',
    blur: 0,
    veil: 0.2,
    descVi: 'Viền tối hai đầu, giữa rõ',
    descEn: 'Dark vignette, clear middle',
  },
  {
    id: 'fade',
    vi: 'Tan dần',
    en: 'Fade',
    icon: 'contrast-outline',
    blur: 0.05,
    veil: 0.1,
    descVi: 'Ảnh ở trên, tan dần vào màu nền',
    descEn: 'Picture on top, melting into the page',
  },
  {
    id: 'tint',
    vi: 'Nhuộm màu',
    en: 'Tinted',
    icon: 'color-palette-outline',
    blur: 0.1,
    veil: 0.3,
    descVi: 'Nhuộm theo màu nhấn của app',
    descEn: 'Washed in the app’s accent colour',
  },
];

export const BG_FITS: { id: BgFit; vi: string; en: string; icon: string }[] = [
  { id: 'fill', vi: 'Lấp đầy', en: 'Fill', icon: 'expand-outline' },
  { id: 'fit', vi: 'Vừa khung', en: 'Fit', icon: 'contract-outline' },
  { id: 'stretch', vi: 'Kéo giãn', en: 'Stretch', icon: 'resize-outline' },
  { id: 'center', vi: 'Kích thước gốc', en: 'Actual size', icon: 'scan-outline' },
  { id: 'tile', vi: 'Lặp lại', en: 'Tile', icon: 'grid-outline' },
];

export const BG_MOTIONS: { id: BgMotion; vi: string; en: string }[] = [
  { id: 'none', vi: 'Đứng yên', en: 'Still' },
  { id: 'drift', vi: 'Trôi chậm', en: 'Slow drift' },
  { id: 'pulse', vi: 'Nhịp theo nhạc', en: 'Beat pulse' },
];

export function styleMeta(id: BgStyle) {
  return BG_STYLES.find((s) => s.id === id) ?? BG_STYLES[0];
}

export function newBgMedia(p: Pick<BgMedia, 'ref' | 'kind'> & Partial<BgMedia>): BgMedia {
  const st = styleMeta(p.style ?? 'soft');
  return {
    w: 0,
    h: 0,
    fit: 'fill',
    style: st.id,
    blur: st.blur,
    veil: st.veil,
    zoom: 1,
    fx: 0.5,
    fy: 0.5,
    motion: 'none',
    pauseWithMusic: false,
    ...p,
  };
}

/** a still picture can be tiled; GIF and video can't (and the "tile" choice falls back to fill) */
export const effectiveFit = (m: BgMedia): BgFit =>
  m.fit === 'tile' && m.kind !== 'image' ? 'fill' : m.fit;

// ─────────────────────────── files ───────────────────────────

const DIR = '.holysic-backdrops';
const FILE_REF = 'bgfile:';

function dir(): Directory {
  const d = new Directory(Paths.document, DIR);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Display URI for a stored reference ('' when its file is gone). */
export function resolveBgUri(ref: string | undefined | null): string {
  if (!ref) return '';
  if (!ref.startsWith(FILE_REF)) return ref;
  if (Platform.OS === 'web') return '';
  try {
    const f = new File(Paths.document, DIR, ref.slice(FILE_REF.length));
    return f.exists ? f.uri : '';
  } catch {
    return '';
  }
}

export function kindOf(name: string, mime?: string | null): BgKind {
  const m = (mime || '').toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)(?:$|\?)/i)?.[1] || '').toLowerCase();
  if (m.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', '3gp'].includes(ext)) return 'video';
  if (m === 'image/gif' || ext === 'gif' || ext === 'apng') return 'gif';
  return 'image';
}

const LIMIT = { image: 60e6, gif: 45e6, video: 400e6 } as const;

/** Bigger still pictures are scaled to ~2× the screen (sharp on any iPhone, a fraction of the
 *  memory and a cheaper blur). GIFs and videos are kept as they are. */
async function shrinkStill(uri: string): Promise<string> {
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    const { width, height } = probe;
    const max = 2400;
    probe.release?.();
    if (Math.max(width, height) <= max && !/\.(heic|heif)($|\?)/i.test(uri)) return uri;
    const ctx = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > max)
      ctx.resize(width >= height ? { width: max } : { height: max });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    img.release?.();
    return saved.uri;
  } catch {
    return uri;
  }
}

export type PickSource = 'photos' | 'videos' | 'files';
export type PickResult =
  | { ok: true; media: Pick<BgMedia, 'ref' | 'kind' | 'w' | 'h' | 'name' | 'bytes'> }
  | { ok: false; reason: 'cancel' | 'too-big' | 'failed' };

/** Opens Photos / Files and keeps a private copy of what was chosen. */
export async function pickBackdropMedia(source: PickSource): Promise<PickResult> {
  try {
    let uri = '';
    let name = '';
    let mime: string | null | undefined;
    let w = 0;
    let h = 0;
    let bytes: number | undefined;
    if (source === 'files') {
      const DocumentPicker = await import('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const a = res.canceled ? undefined : res.assets?.[0];
      if (!a) return { ok: false, reason: 'cancel' };
      uri = a.uri;
      name = a.name || '';
      mime = a.mimeType;
      bytes = a.size ?? undefined;
    } else {
      const ImagePicker = await import('expo-image-picker');
      const video = source === 'videos';
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [video ? 'videos' : 'images'],
        // videos: the system trimmer, so a long clip can be cut to the loop you want
        allowsEditing: video,
        // keep GIFs animated (the default hands back a flattened JPEG)
        preferredAssetRepresentationMode: video
          ? ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic
          : ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        // a background never needs more than 1080p; HEVC is decoded in hardware (battery)
        videoExportPreset: ImagePicker.VideoExportPreset.HEVC_1920x1080,
        quality: 1,
        shouldDownloadFromNetwork: true,
      });
      const a = res.canceled ? undefined : res.assets?.[0];
      if (!a) return { ok: false, reason: 'cancel' };
      uri = a.uri;
      name = a.fileName || uri.split('/').pop() || '';
      mime = a.mimeType;
      w = a.width || 0;
      h = a.height || 0;
      bytes = a.fileSize ?? undefined;
      if (a.type === 'video') mime = mime || 'video/mp4';
    }
    const kind = kindOf(name || uri, mime);
    if (bytes && bytes > LIMIT[kind]) return { ok: false, reason: 'too-big' };

    if (Platform.OS === 'web') {
      return { ok: true, media: { ref: uri, kind, w, h, name, bytes } };
    }
    const src = kind === 'image' ? await shrinkStill(uri) : uri;
    if (src !== uri) {
      w = 0;
      h = 0;
    }
    const ext =
      kind === 'video'
        ? (name.match(/\.(mp4|mov|m4v)$/i)?.[1] || 'mp4').toLowerCase()
        : kind === 'gif'
          ? 'gif'
          : (src.match(/\.(jpe?g|png|webp|heic|heif)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase();
    const file = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    new File(src).copy(new File(dir(), file));
    return { ok: true, media: { ref: FILE_REF + file, kind, w, h, name, bytes } };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Delete stored files no longer used by any background. */
export function sweepBackdropFiles(inUse: (string | undefined | null)[]) {
  if (Platform.OS === 'web') return;
  try {
    const keep = new Set(
      inUse.filter((r): r is string => !!r && r.startsWith(FILE_REF)).map((r) => r.slice(7))
    );
    const d = new Directory(Paths.document, DIR);
    if (!d.exists) return;
    for (const it of d.list()) {
      if (it instanceof File && !keep.has(it.name)) {
        try {
          it.delete();
        } catch {
          // in use / already gone
        }
      }
    }
  } catch {
    // nothing to sweep
  }
}

/** Natural pixel size of a still/animated picture. */
export function measureImage(uri: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!uri) return resolve(null);
    Image.getSize(
      uri,
      (w, h) => resolve({ w, h }),
      () => resolve(null)
    );
  });
}

// ─────────────────────────── layout ───────────────────────────

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the picture goes inside a `cw × ch` box. The focal point is applied the same way for
 * every mode: `left = (cw - w) * fx` keeps the chosen spot in view when the picture is larger
 * than the box, and places it along the free space when it is smaller.
 */
export function frameFor(m: BgMedia, cw: number, ch: number, previewScale = 1): Rect {
  const fit = effectiveFit(m);
  const mw = m.w > 0 ? m.w : cw;
  const mh = m.h > 0 ? m.h : ch;
  const zoom = Math.max(1, Math.min(4, m.zoom || 1));
  if (fit === 'stretch' || fit === 'tile') return { left: 0, top: 0, width: cw, height: ch };
  let s: number;
  if (fit === 'fill') s = Math.max(cw / mw, ch / mh) * zoom;
  else if (fit === 'fit') s = Math.min(cw / mw, ch / mh) * zoom;
  // actual size: one image pixel per screen pixel (the preview shows it scaled down with the box)
  else s = (zoom / PixelRatio.get()) * previewScale;
  const width = mw * s;
  const height = mh * s;
  return {
    left: (cw - width) * clamp01(m.fx),
    top: (ch - height) * clamp01(m.fy),
    width,
    height,
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0.5);

/** Key of a page's own background (prefs.pageBackdrops). */
export function pageBgKey(
  t:
    | { kind: 'album'; id: string }
    | { kind: 'artist'; id: string }
    | { kind: 'playlist'; playlistId: string }
    | { kind: 'liked' }
    | { kind: 'offline' }
): string {
  if (t.kind === 'playlist') return `playlist:${t.playlistId}`;
  if (t.kind === 'album' || t.kind === 'artist') return `${t.kind}:${t.id}`;
  return t.kind;
}
