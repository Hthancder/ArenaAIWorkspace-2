// Real charts by country & genre — the "Trending in 75+ countries" idea from OpenSpot Music and
// "Browse by genre" from Musike, served by Apple's public iTunes RSS feed (CORS-enabled, no key,
// works for Vietnam; verified by scripts/probe-sources.mjs). Songs play through HolySic's
// full-length source modules — the RSS preview is only kept as an opt-in fallback.

import { Track } from '../../types/music';

export interface ChartCountry {
  code: string;
  flag: string;
  vi: string;
  en: string;
}

export const CHART_COUNTRIES: ChartCountry[] = [
  { code: 'vn', flag: '🇻🇳', vi: 'Việt Nam', en: 'Vietnam' },
  { code: 'us', flag: '🇺🇸', vi: 'Mỹ', en: 'United States' },
  { code: 'kr', flag: '🇰🇷', vi: 'Hàn Quốc', en: 'South Korea' },
  { code: 'jp', flag: '🇯🇵', vi: 'Nhật Bản', en: 'Japan' },
  { code: 'gb', flag: '🇬🇧', vi: 'Anh', en: 'United Kingdom' },
  { code: 'th', flag: '🇹🇭', vi: 'Thái Lan', en: 'Thailand' },
  { code: 'tw', flag: '🇹🇼', vi: 'Đài Loan', en: 'Taiwan' },
  { code: 'hk', flag: '🇭🇰', vi: 'Hồng Kông', en: 'Hong Kong' },
  { code: 'cn', flag: '🇨🇳', vi: 'Trung Quốc', en: 'China' },
  { code: 'ph', flag: '🇵🇭', vi: 'Philippines', en: 'Philippines' },
  { code: 'id', flag: '🇮🇩', vi: 'Indonesia', en: 'Indonesia' },
  { code: 'my', flag: '🇲🇾', vi: 'Malaysia', en: 'Malaysia' },
  { code: 'sg', flag: '🇸🇬', vi: 'Singapore', en: 'Singapore' },
  { code: 'in', flag: '🇮🇳', vi: 'Ấn Độ', en: 'India' },
  { code: 'au', flag: '🇦🇺', vi: 'Úc', en: 'Australia' },
  { code: 'ca', flag: '🇨🇦', vi: 'Canada', en: 'Canada' },
  { code: 'fr', flag: '🇫🇷', vi: 'Pháp', en: 'France' },
  { code: 'de', flag: '🇩🇪', vi: 'Đức', en: 'Germany' },
  { code: 'es', flag: '🇪🇸', vi: 'Tây Ban Nha', en: 'Spain' },
  { code: 'it', flag: '🇮🇹', vi: 'Ý', en: 'Italy' },
  { code: 'nl', flag: '🇳🇱', vi: 'Hà Lan', en: 'Netherlands' },
  { code: 'se', flag: '🇸🇪', vi: 'Thuỵ Điển', en: 'Sweden' },
  { code: 'no', flag: '🇳🇴', vi: 'Na Uy', en: 'Norway' },
  { code: 'dk', flag: '🇩🇰', vi: 'Đan Mạch', en: 'Denmark' },
  { code: 'fi', flag: '🇫🇮', vi: 'Phần Lan', en: 'Finland' },
  { code: 'pl', flag: '🇵🇱', vi: 'Ba Lan', en: 'Poland' },
  { code: 'pt', flag: '🇵🇹', vi: 'Bồ Đào Nha', en: 'Portugal' },
  { code: 'ie', flag: '🇮🇪', vi: 'Ireland', en: 'Ireland' },
  { code: 'at', flag: '🇦🇹', vi: 'Áo', en: 'Austria' },
  { code: 'ch', flag: '🇨🇭', vi: 'Thuỵ Sĩ', en: 'Switzerland' },
  { code: 'be', flag: '🇧🇪', vi: 'Bỉ', en: 'Belgium' },
  { code: 'tr', flag: '🇹🇷', vi: 'Thổ Nhĩ Kỳ', en: 'Türkiye' },
  { code: 'ru', flag: '🇷🇺', vi: 'Nga', en: 'Russia' },
  { code: 'ua', flag: '🇺🇦', vi: 'Ukraina', en: 'Ukraine' },
  { code: 'br', flag: '🇧🇷', vi: 'Brazil', en: 'Brazil' },
  { code: 'mx', flag: '🇲🇽', vi: 'Mexico', en: 'Mexico' },
  { code: 'ar', flag: '🇦🇷', vi: 'Argentina', en: 'Argentina' },
  { code: 'cl', flag: '🇨🇱', vi: 'Chile', en: 'Chile' },
  { code: 'co', flag: '🇨🇴', vi: 'Colombia', en: 'Colombia' },
  { code: 'pe', flag: '🇵🇪', vi: 'Peru', en: 'Peru' },
  { code: 'za', flag: '🇿🇦', vi: 'Nam Phi', en: 'South Africa' },
  { code: 'ng', flag: '🇳🇬', vi: 'Nigeria', en: 'Nigeria' },
  { code: 'eg', flag: '🇪🇬', vi: 'Ai Cập', en: 'Egypt' },
  { code: 'sa', flag: '🇸🇦', vi: 'Ả Rập Xê Út', en: 'Saudi Arabia' },
  { code: 'ae', flag: '🇦🇪', vi: 'UAE', en: 'UAE' },
  { code: 'il', flag: '🇮🇱', vi: 'Israel', en: 'Israel' },
  { code: 'nz', flag: '🇳🇿', vi: 'New Zealand', en: 'New Zealand' },
  { code: 'kh', flag: '🇰🇭', vi: 'Campuchia', en: 'Cambodia' },
  { code: 'la', flag: '🇱🇦', vi: 'Lào', en: 'Laos' },
  { code: 'mn', flag: '🇲🇳', vi: 'Mông Cổ', en: 'Mongolia' },
  { code: 'kz', flag: '🇰🇿', vi: 'Kazakhstan', en: 'Kazakhstan' },
  { code: 'pk', flag: '🇵🇰', vi: 'Pakistan', en: 'Pakistan' },
  { code: 'lk', flag: '🇱🇰', vi: 'Sri Lanka', en: 'Sri Lanka' },
  { code: 'np', flag: '🇳🇵', vi: 'Nepal', en: 'Nepal' },
  { code: 'gr', flag: '🇬🇷', vi: 'Hy Lạp', en: 'Greece' },
  { code: 'cz', flag: '🇨🇿', vi: 'Séc', en: 'Czechia' },
  { code: 'hu', flag: '🇭🇺', vi: 'Hungary', en: 'Hungary' },
  { code: 'ro', flag: '🇷🇴', vi: 'Romania', en: 'Romania' },
];

export interface ChartGenre {
  id: number | null;
  vi: string;
  en: string;
  icon: string;
  tint: string;
}

/** iTunes genre ids (stable since the iTunes Store days) */
export const CHART_GENRES: ChartGenre[] = [
  { id: null, vi: 'Tất cả', en: 'All', icon: 'flame', tint: '#F472B6' },
  { id: 14, vi: 'Pop', en: 'Pop', icon: 'sparkles', tint: '#EC4899' },
  { id: 18, vi: 'Hip-Hop / Rap', en: 'Hip-Hop / Rap', icon: 'mic', tint: '#F59E0B' },
  { id: 15, vi: 'R&B / Soul', en: 'R&B / Soul', icon: 'heart', tint: '#A855F7' },
  { id: 51, vi: 'K-Pop', en: 'K-Pop', icon: 'star', tint: '#38BDF8' },
  { id: 27, vi: 'J-Pop', en: 'J-Pop', icon: 'flower', tint: '#FB7185' },
  { id: 20, vi: 'Alternative / Indie', en: 'Alternative', icon: 'leaf', tint: '#22C55E' },
  { id: 21, vi: 'Rock', en: 'Rock', icon: 'flash', tint: '#EF4444' },
  { id: 7, vi: 'Electronic', en: 'Electronic', icon: 'pulse', tint: '#06B6D4' },
  { id: 17, vi: 'Dance', en: 'Dance', icon: 'disc', tint: '#8B5CF6' },
  { id: 11, vi: 'Jazz', en: 'Jazz', icon: 'cafe', tint: '#D97706' },
  { id: 5, vi: 'Cổ điển', en: 'Classical', icon: 'musical-note', tint: '#94A3B8' },
  { id: 6, vi: 'Country', en: 'Country', icon: 'sunny', tint: '#CA8A04' },
  { id: 12, vi: 'Latin', en: 'Latin', icon: 'bonfire', tint: '#F97316' },
  { id: 16, vi: 'Nhạc phim', en: 'Soundtrack', icon: 'film', tint: '#64748B' },
  { id: 24, vi: 'Reggae', en: 'Reggae', icon: 'color-palette', tint: '#16A34A' },
  { id: 19, vi: 'World', en: 'World', icon: 'earth', tint: '#0EA5E9' },
];

const cache = new Map<string, { at: number; tracks: Track[] }>();
const CACHE_MS = 30 * 60 * 1000;

function upscale(url: string): string {
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x600bb.$2');
}

export async function fetchTopSongs(
  country: string,
  genreId: number | null,
  limit = 50
): Promise<Track[]> {
  const key = `${country}|${genreId ?? 'all'}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tracks;

  const url = `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}${genreId ? `/genre=${genreId}` : ''}/json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json = await res.json();
    const entries: any[] = Array.isArray(json?.feed?.entry)
      ? json.feed.entry
      : json?.feed?.entry
        ? [json.feed.entry]
        : [];
    const tracks: Track[] = [];
    entries.forEach((e, idx) => {
      const id = e?.id?.attributes?.['im:id'];
      const title = e?.['im:name']?.label;
      const artist = e?.['im:artist']?.label;
      if (!id || !title || !artist) return;
      const images: any[] = e?.['im:image'] || [];
      const links: any[] = Array.isArray(e?.link) ? e.link : [e?.link];
      const preview = links.find((l) => l?.attributes?.['im:assetType'] === 'preview');
      const durMs = Number(preview?.['im:duration']?.label) || 0;
      tracks.push({
        id: `itunes-${id}`,
        title,
        artist,
        artists: [artist],
        album: e?.['im:collection']?.['im:name']?.label,
        artworkUrl: upscale(images[images.length - 1]?.label || ''),
        // RSS only carries the 30 s preview length; the full length comes from the matched source
        durationSec: durMs > 45000 ? Math.round(durMs / 1000) : 210,
        streamUrl: preview?.attributes?.href,
        source: 'itunes',
        genre: e?.category?.attributes?.label,
        releaseYear: e?.['im:releaseDate']?.label
          ? new Date(e['im:releaseDate'].label).getFullYear()
          : undefined,
        qualityBadge: `#${idx + 1}`,
      });
    });
    cache.set(key, { at: Date.now(), tracks });
    return tracks;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
