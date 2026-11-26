// "Skip non-music parts" — Spotube's SponsorBlock integration, reimplemented.
// Community-submitted `music_offtopic` segments (talking intros, skits, outros in music videos)
// are skipped automatically, but only when the audio really comes from that YouTube video —
// a FLAC/320k copy from another source has different timing, so it is never touched.

const API = 'https://sponsor.ajay.app/api/skipSegments';
const cache = new Map<string, [number, number][]>();

export async function fetchNonMusicSegments(videoId: string): Promise<[number, number][]> {
  if (!/^[\w-]{11}$/.test(videoId)) return [];
  const hit = cache.get(videoId);
  if (hit) return hit;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `${API}?videoID=${videoId}&categories=${encodeURIComponent('["music_offtopic"]')}`,
      { signal: ctrl.signal }
    );
    // 404 = no segments submitted for this video
    if (!res.ok) {
      if (res.status === 404) cache.set(videoId, []);
      return [];
    }
    const json = (await res.json()) as { segment?: [number, number]; actionType?: string }[];
    const segs = (Array.isArray(json) ? json : [])
      .filter((s) => Array.isArray(s.segment) && (s.actionType ?? 'skip') === 'skip')
      .map((s) => [Number(s.segment![0]), Number(s.segment![1])] as [number, number])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b - a >= 1)
      .sort((x, y) => x[0] - y[0]);
    cache.set(videoId, segs);
    return segs;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** The segment the playhead is inside (with a little slack at the end), if any. */
export function segmentAt(segs: [number, number][], pos: number): [number, number] | null {
  for (const s of segs) if (pos >= s[0] && pos < s[1] - 0.6) return s;
  return null;
}
