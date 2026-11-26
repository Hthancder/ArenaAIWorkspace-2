// Apple / iTunes Catalog & High-Quality AAC Stream Provider
// Works 100% natively on iOS AND with open CORS (*) in every browser!

import { AlbumSummary, ArtistSummary, Track } from '../../types/music';

function upgradeArtwork(url?: string, size = 600): string {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/i, `/${size}x${size}bb.$1`);
}

async function fetchWithTimeout(url: string, timeoutMs = 5500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function mapItunesTrack(item: any): Track | null {
  if (!item || (!item.trackId && !item.collectionId)) return null;
  const title = item.trackName || item.collectionName;
  const artist = item.artistName || 'Unknown Artist';
  if (!title) return null;

  const fullDurationSec = item.trackTimeMillis
    ? Math.max(15, Math.round(item.trackTimeMillis / 1000))
    : 180;

  return {
    id: `itunes-${item.trackId || item.collectionId}`,
    title,
    artist,
    artists: [artist],
    album: item.collectionName || undefined,
    albumId: item.collectionId ? String(item.collectionId) : undefined,
    artistId: item.artistId ? String(item.artistId) : undefined,
    artworkUrl: upgradeArtwork(item.artworkUrl100 || item.artworkUrl60, 600),
    durationSec: fullDurationSec,
    explicit: item.trackExplicitness === 'explicit',
    streamUrl: item.previewUrl || undefined,
    source: 'itunes',
    qualityBadge: 'AAC 256 kbps',
    genre: item.primaryGenreName || undefined,
    releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
  };
}

export async function searchItunesTracks(
  query: string,
  limit = 24,
  country: 'VN' | 'US' = 'VN'
): Promise<Track[]> {
  if (!query.trim()) return [];
  try {
    const encoded = encodeURIComponent(query.trim());
    const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=song&limit=${limit}&country=${country}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    const list: Track[] = [];
    for (const raw of data?.results || []) {
      const mapped = mapItunesTrack(raw);
      if (mapped) list.push(mapped);
    }
    return list;
  } catch {
    return [];
  }
}

export async function searchItunesAlbums(
  query: string,
  limit = 10,
  country: 'VN' | 'US' = 'VN'
): Promise<AlbumSummary[]> {
  if (!query.trim()) return [];
  try {
    const encoded = encodeURIComponent(query.trim());
    const url = `https://itunes.apple.com/search?term=${encoded}&media=music&entity=album&limit=${limit}&country=${country}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.results || [])
      .filter((r: any) => r.collectionId && r.collectionName)
      .map((r: any): AlbumSummary => ({
        id: String(r.collectionId),
        title: r.collectionName,
        artist: r.artistName || 'Unknown Artist',
        artworkUrl: upgradeArtwork(r.artworkUrl100, 600),
        year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined,
        trackCount: r.trackCount,
        genre: r.primaryGenreName,
      }));
  } catch {
    return [];
  }
}

export async function fetchAlbumDetails(collectionId: string): Promise<AlbumSummary | null> {
  try {
    const cleanId = collectionId.replace(/^itunes-album-/, '');
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(cleanId)}&entity=song&country=VN`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data?.results || [];
    const col = results.find((r) => r.wrapperType === 'collection');
    const songs = results
      .filter((r) => r.wrapperType === 'track')
      .map(mapItunesTrack)
      .filter((t): t is Track => Boolean(t));

    if (!col && songs.length === 0) return null;
    return {
      id: cleanId,
      title: col?.collectionName || songs[0]?.album || 'Album',
      artist: col?.artistName || songs[0]?.artist || 'Unknown Artist',
      artworkUrl: upgradeArtwork(col?.artworkUrl100 || songs[0]?.artworkUrl, 600),
      year: col?.releaseDate ? new Date(col.releaseDate).getFullYear() : undefined,
      trackCount: col?.trackCount || songs.length,
      genre: col?.primaryGenreName,
      tracks: songs,
    };
  } catch {
    return null;
  }
}

export async function fetchArtistDetails(artistNameOrId: string): Promise<ArtistSummary | null> {
  try {
    const isNumeric = /^\d+$/.test(artistNameOrId);
    if (isNumeric) {
      const url = `https://itunes.apple.com/lookup?id=${artistNameOrId}&entity=song&limit=20&country=VN`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = await res.json();
        const results: any[] = data?.results || [];
        const artistRow = results.find((r) => r.wrapperType === 'artist');
        const tracks = results
          .filter((r) => r.wrapperType === 'track')
          .map(mapItunesTrack)
          .filter((t): t is Track => Boolean(t));
        if (artistRow || tracks.length > 0) {
          return {
            id: artistNameOrId,
            name: artistRow?.artistName || tracks[0]?.artist || 'Artist',
            artworkUrl: tracks[0]?.artworkUrl || '',
            genre: artistRow?.primaryGenreName || tracks[0]?.genre,
            topTracks: tracks,
          };
        }
      }
    }
    const tracks = await searchItunesTracks(artistNameOrId, 18, 'VN');
    const albums = await searchItunesAlbums(artistNameOrId, 8, 'VN');
    if (tracks.length === 0) return null;
    return {
      id: tracks[0].artistId || artistNameOrId,
      name: tracks[0].artist,
      artworkUrl: tracks[0].artworkUrl,
      genre: tracks[0].genre,
      topTracks: tracks,
      albums,
    };
  } catch {
    return null;
  }
}
