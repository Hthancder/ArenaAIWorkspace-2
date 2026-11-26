// Smart shelves for Home, computed on the device from your own listening — nothing leaves the
// phone. "Mới thêm" (songs that just arrived: local files, downloads, new likes), "Nghe nhiều"
// (your most played lately) and "Lâu chưa nghe" (favourites you haven't played in a while).

import { DownloadedTrackMeta, ListeningEvent, Track } from '../../types/music';

export interface ShelfItem {
  track: Track;
  /** short caption under the title ("12 lần", "3 ngày trước"…) */
  note: string;
}

const DAY = 86400000;

/** A play counts when it lasted 30 s or half the song (or it was not measured: older entries). */
const counted = (e: ListeningEvent) =>
  !e.listenedSec ||
  e.listenedSec >= 30 ||
  (e.track.durationSec > 0 && e.listenedSec >= e.track.durationSec / 2);

const keyOf = (t: Track) => t.id;

function ago(ts: number, vi: boolean, now: number): string {
  const d = Math.floor((now - ts) / DAY);
  if (d <= 0) return vi ? 'Hôm nay' : 'Today';
  if (d === 1) return vi ? 'Hôm qua' : 'Yesterday';
  if (d < 7) return vi ? `${d} ngày trước` : `${d} days ago`;
  if (d < 60) {
    const w = Math.round(d / 7);
    return vi ? `${w} tuần trước` : `${w} week${w > 1 ? 's' : ''} ago`;
  }
  const m = Math.round(d / 30);
  return vi ? `${m} tháng trước` : `${m} months ago`;
}

export function mostPlayed(
  history: ListeningEvent[],
  vi: boolean,
  opts: { days?: number; max?: number; now?: number } = {}
): ShelfItem[] {
  const now = opts.now ?? Date.now();
  const since = now - (opts.days ?? 30) * DAY;
  const tally = new Map<string, { track: Track; n: number; last: number }>();
  for (const e of history) {
    if (e.playedAt < since || !counted(e) || e.track.isLive) continue;
    const k = keyOf(e.track);
    const cur = tally.get(k);
    if (cur) {
      cur.n++;
      cur.last = Math.max(cur.last, e.playedAt);
    } else tally.set(k, { track: e.track, n: 1, last: e.playedAt });
  }
  return [...tally.values()]
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, opts.max ?? 12)
    .map((x) => ({ track: x.track, note: vi ? `${x.n} lần nghe` : `${x.n} plays` }));
}

export function forgotten(
  history: ListeningEvent[],
  liked: Track[],
  vi: boolean,
  opts: { quietDays?: number; max?: number; now?: number } = {}
): ShelfItem[] {
  const now = opts.now ?? Date.now();
  const quiet = (opts.quietDays ?? 21) * DAY;
  const stats = new Map<string, { track: Track; n: number; last: number }>();
  for (const e of history) {
    if (!counted(e) || e.track.isLive) continue;
    const k = keyOf(e.track);
    const cur = stats.get(k);
    if (cur) {
      cur.n++;
      cur.last = Math.max(cur.last, e.playedAt);
    } else stats.set(k, { track: e.track, n: 1, last: e.playedAt });
  }
  const likedIds = new Set(liked.map(keyOf));
  const out = [...stats.values()]
    .filter((x) => now - x.last > quiet && (x.n >= 3 || (likedIds.has(keyOf(x.track)) && x.n >= 1)))
    // loved most, waited longest
    .sort(
      (a, b) =>
        b.n +
          (likedIds.has(keyOf(b.track)) ? 3 : 0) -
          (a.n + (likedIds.has(keyOf(a.track)) ? 3 : 0)) || a.last - b.last
    )
    .slice(0, opts.max ?? 12)
    .map((x) => ({
      track: x.track,
      note: (vi ? 'Lần cuối: ' : 'Last: ') + ago(x.last, vi, now).toLowerCase(),
    }));
  return out;
}

export function recentlyAdded(
  sources: {
    local: { track: Track; addedAt: number }[];
    downloads: Record<string, DownloadedTrackMeta>;
    liked: Track[];
  },
  vi: boolean,
  opts: { days?: number; max?: number; now?: number } = {}
): ShelfItem[] {
  const now = opts.now ?? Date.now();
  const since = now - (opts.days ?? 45) * DAY;
  const max = opts.max ?? 12;
  const timed: { track: Track; at: number; how: string }[] = [];
  for (const l of sources.local)
    if (l.addedAt >= since)
      timed.push({ track: l.track, at: l.addedAt, how: vi ? 'Trên máy' : 'On device' });
  for (const d of Object.values(sources.downloads))
    if (d.downloadedAt >= since)
      timed.push({ track: d.track, at: d.downloadedAt, how: vi ? 'Đã tải' : 'Downloaded' });
  timed.sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const out: ShelfItem[] = [];
  for (const x of timed) {
    if (seen.has(keyOf(x.track))) continue;
    seen.add(keyOf(x.track));
    out.push({ track: x.track, note: `${x.how} · ${ago(x.at, vi, now).toLowerCase()}` });
    if (out.length >= max) return out;
  }
  // newest likes (the list is kept newest-first)
  for (const t of sources.liked.slice(0, 8)) {
    if (seen.has(keyOf(t))) continue;
    seen.add(keyOf(t));
    out.push({ track: t, note: vi ? 'Mới thích' : 'Just liked' });
    if (out.length >= max) break;
  }
  return out;
}
