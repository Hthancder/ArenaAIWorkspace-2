// Artist biographies from Wikipedia (free REST API, CORS-enabled, no key). Vietnamese first when the
// app is in Vietnamese, English as a fallback. Results are cached for the session.

export interface ArtistBio {
  title: string;
  extract: string;
  imageUrl?: string;
  pageUrl: string;
  lang: 'vi' | 'en';
}

const cache = new Map<string, ArtistBio | null>();
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MUSIC_HINT =
  /(singer|rapper|musician|band|group|duo|songwriter|producer|dj|composer|ca sĩ|nhạc sĩ|ban nhạc|nhóm nhạc|rapper|nhà sản xuất)/i;

async function lookup(name: string, lang: 'vi' | 'en'): Promise<ArtistBio | null> {
  const hint = lang === 'vi' ? 'ca sĩ' : 'singer';
  const s = await getJson(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=${encodeURIComponent(`${name} ${hint}`)}`
  );
  const hits: { title: string; snippet: string }[] = s?.query?.search || [];
  const target = norm(name);
  const pick =
    hits.find((h) => norm(h.title).startsWith(target) && MUSIC_HINT.test(h.snippet)) ||
    hits.find((h) => norm(h.title).startsWith(target)) ||
    hits.find((h) => norm(h.title).includes(target) && MUSIC_HINT.test(h.snippet));
  if (!pick) return null;
  const sum = await getJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pick.title.replace(/ /g, '_'))}`
  );
  if (!sum || sum.type === 'disambiguation' || !sum.extract) return null;
  if (!MUSIC_HINT.test(`${sum.description || ''} ${sum.extract}`)) return null;
  return {
    title: sum.title,
    extract: String(sum.extract),
    imageUrl: sum.thumbnail?.source,
    pageUrl:
      sum.content_urls?.mobile?.page ||
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pick.title)}`,
    lang,
  };
}

export async function fetchArtistBio(name: string, uiLang: 'vi' | 'en'): Promise<ArtistBio | null> {
  const clean = name.split(/,|&| feat\.| ft\.| x /i)[0].trim();
  if (!clean) return null;
  const key = `${uiLang}|${clean.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;
  const order: ('vi' | 'en')[] = uiLang === 'vi' ? ['vi', 'en'] : ['en', 'vi'];
  let bio: ArtistBio | null = null;
  for (const l of order) {
    bio = await lookup(clean, l);
    if (bio) break;
  }
  cache.set(key, bio);
  return bio;
}
