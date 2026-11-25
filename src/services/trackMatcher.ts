// Direct TypeScript port of TrackMatcher.kt from realidkroo/Mochy-Music

export interface TrackQueryInput {
  title: string;
  artists: string[];
  album?: string;
  durationSec?: number;
  isrc?: string;
  videoId?: string;
}

export interface CatalogCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  isrc?: string;
  artworkUrl?: string;
  streamUrl?: string;
  encryptedUrl?: string;
  has320?: boolean;
  downloadUrls?: { quality: string; url: string }[];
}

const VERSION_WORDS = [
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'karaoke',
  'sped up',
  'slowed',
  'nightcore',
  'demo',
  'cover',
  'edit',
  'mix',
  'version',
  'unplugged',
  'orchestral',
  'piano',
];

const VERSION_PATTERNS = VERSION_WORDS.map(
  (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && w !== 'the' && w !== 'and');
}

export function coreTitle(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi, ' ');
  t = t.replace(
    /\s[-–]\s.*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv)\b.*$/gi,
    ' '
  );
  t = t.replace(
    /[([][^)\]]*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv|explicit|clean)\b[^)\]]*[)\]]/gi,
    ' '
  );
  t = t.replace(/\b(?:feat|ft)\.?\s.*$/gi, ' ');
  return words(t).join(' ');
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  wa.forEach((w) => {
    if (wb.has(w)) inter++;
  });
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

export function scoreTrackMatch(query: TrackQueryInput, song: CatalogCandidate): number {
  if (query.isrc && song.isrc && query.isrc.toLowerCase() === song.isrc.toLowerCase()) {
    return 1;
  }

  const qTitle = coreTitle(query.title);
  const sTitle = coreTitle(song.title);
  const titleScore = similarity(qTitle, sTitle);
  if (titleScore < 0.52) return 0;

  const songArtistWords = new Set(words(song.artist));
  let artistScore = 0;
  for (const a of query.artists) {
    const w = words(a);
    if (w.length === 0) continue;
    const hit = w.filter((tok) => songArtistWords.has(tok)).length / w.length;
    if (hit > artistScore) artistScore = hit;
  }
  if (artistScore < 0.45) return 0;

  let durationScore = 0.65;
  if (query.durationSec && song.durationSec && query.durationSec > 40 && song.durationSec > 40) {
    const diff = Math.abs(query.durationSec - song.durationSec);
    if (diff <= 2.5) durationScore = 1;
    else if (diff >= 18) durationScore = 0.1;
    else durationScore = 1 - (diff - 2.5) / 17.5;
  }

  const qRaw = query.title.toLowerCase();
  const sRaw = song.title.toLowerCase();
  let mismatchCount = 0;
  for (const pat of VERSION_PATTERNS) {
    if (pat.test(qRaw) !== pat.test(sRaw)) {
      mismatchCount++;
    }
  }
  const penalty = 0.25 * mismatchCount;

  return Math.max(0, Math.min(1, 0.5 * titleScore + 0.3 * artistScore + 0.2 * durationScore - penalty));
}

export function rankCandidates<T extends CatalogCandidate>(
  query: TrackQueryInput,
  candidates: T[],
  minScore = 0.66
): { track: T; score: number }[] {
  return candidates
    .map((track) => ({ track, score: scoreTrackMatch(query, track) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
