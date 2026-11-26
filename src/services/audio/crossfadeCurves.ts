// Crossfade styles: gain curves for the ending song (out) and the next one (in), k = 0 → 1 over
// the fade. Ideas from Apple Music / Spotify (equal power), foobar2000 & Poweramp (S-curve),
// DJ mixers (quick cut in the middle of the window) and classic radio (fade out, then start).

export type CrossfadeCurve = 'equalPower' | 'sCurve' | 'linear' | 'quickCut' | 'fadeThrough';

const HALF_PI = Math.PI / 2;
const clamp01 = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k);
/** smoothstep — gentle start and end */
const smooth = (k: number) => k * k * (3 - 2 * k);
/** map k into [a, b] → 0..1 (flat outside) */
const span = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));

export interface CurveFns {
  in: (k: number) => number;
  out: (k: number) => number;
  /**
   * Share of the fade before the next song becomes audible. The engine holds the next song's
   * start until then (it begins at 0:00), so its opening is never lost under silence.
   */
  inDelay?: number;
}

export const CROSSFADE_CURVES: Record<CrossfadeCurve, CurveFns> = {
  // constant power: in² + out² = 1, so loudness never dips in the middle
  equalPower: {
    in: (k) => Math.sin(clamp01(k) * HALF_PI),
    out: (k) => Math.cos(clamp01(k) * HALF_PI),
  },
  // still constant power, but eased at both ends: the handover happens mostly mid-way
  sCurve: {
    in: (k) => Math.sin(smooth(clamp01(k)) * HALF_PI),
    out: (k) => Math.cos(smooth(clamp01(k)) * HALF_PI),
  },
  // constant gain: a slight dip mid-way; best when both songs share the same mix (live sets)
  linear: {
    in: (k) => clamp01(k),
    out: (k) => 1 - clamp01(k),
  },
  // DJ style: the old song stays full, both swap fast (equal power) in the middle half
  quickCut: {
    in: (k) => Math.sin(span(k, 0.3, 0.7) * HALF_PI),
    out: (k) => Math.cos(span(k, 0.3, 0.7) * HALF_PI),
    inDelay: 0.3,
  },
  // no overlap: the old song fades away, then the next one starts from its first second
  fadeThrough: {
    in: (k) => Math.sin(span(k, 0.7, 1) * HALF_PI),
    out: (k) => Math.cos(span(k, 0, 0.7) * HALF_PI),
    inDelay: 0.7,
  },
};

export const CROSSFADE_CURVE_META: {
  id: CrossfadeCurve;
  vi: string;
  en: string;
  descVi: string;
  descEn: string;
}[] = [
  {
    id: 'equalPower',
    vi: 'Cân bằng',
    en: 'Equal power',
    descVi: 'Âm lượng giữ đều suốt lúc chuyển, không hụt ở giữa — kiểu Apple Music, Spotify',
    descEn: 'Loudness stays even through the change, no dip — like Apple Music and Spotify',
  },
  {
    id: 'sCurve',
    vi: 'Mượt (S)',
    en: 'Smooth (S)',
    descVi:
      'Bắt đầu và kết thúc rất êm, bài mới thay bài cũ chủ yếu ở giữa — kiểu foobar2000, Poweramp',
    descEn: 'Very soft start and end, the swap happens mid-way — like foobar2000 and Poweramp',
  },
  {
    id: 'linear',
    vi: 'Tuyến tính',
    en: 'Linear',
    descVi: 'Đơn giản, hơi lắng ở giữa — hợp khi hai bài cùng một bản phối (live, mix)',
    descEn: 'Simple, slightly quieter mid-way — suits songs from the same mix (live sets)',
  },
  {
    id: 'quickCut',
    vi: 'DJ cắt nhanh',
    en: 'DJ quick cut',
    descVi: 'Bài cũ giữ nguyên tới giữa, hai bài đổi chỗ thật nhanh — giữ năng lượng cho EDM, pop',
    descEn: 'The old song stays full, then a fast swap — keeps the energy for EDM and pop',
  },
  {
    id: 'fadeThrough',
    vi: 'Nhạt rồi vào',
    en: 'Fade through',
    descVi:
      'Bài cũ nhỏ dần hết rồi bài mới vào từ giây đầu, không chồng tiếng — hợp cổ điển, acoustic',
    descEn: 'The old song fades out, then the next starts from its first second — suits classical',
  },
];

export const curveOf = (id: string | undefined): CurveFns =>
  CROSSFADE_CURVES[(id as CrossfadeCurve) || 'equalPower'] || CROSSFADE_CURVES.equalPower;
