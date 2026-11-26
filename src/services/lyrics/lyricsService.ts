// Synchronized Lyrics Engine — ported from LrcLib.kt, YouLyPlus.kt & BetterLyrics.kt in realidkroo/Mochy-Music

import { BUILTIN_LYRICS_MAP } from '../../data/curatedCatalog';
import { LyricLine, LyricsData, LyricWord, Track } from '../../types/music';
import { isLocalTrack, LocalLibrary } from '../local/localLibrary';

const TITLE_CLEANUP_PATTERNS = [
  /\s*\(.*?(official|video|audio|lyrics|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit).*?\)/gi,
  /\s*\[.*?(official|video|audio|lyrics|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit).*?\]/gi,
  /\s*【.*?】/g,
  /\s*\|.*$/g,
  /\s*-\s*(official|video|audio|lyrics|lyric|visualizer).*$/gi,
  /\s*\(feat\..*?\)/gi,
  /\s*\(ft\..*?\)/gi,
  /\s*feat\..*$/gi,
  /\s*ft\..*$/gi,
];

const ARTIST_SEPARATORS = [
  ' & ',
  ' and ',
  ', ',
  ' x ',
  ' X ',
  ' feat. ',
  ' feat ',
  ' ft. ',
  ' ft ',
  ' featuring ',
  ' with ',
];

const YOULYPLUS_SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.binimum.org',
];

const lyricsCache = new Map<string, LyricsData>();

export function cleanLyricsTitle(title: string): string {
  let cleaned = title.trim();
  for (const pat of TITLE_CLEANUP_PATTERNS) {
    cleaned = cleaned.replace(pat, '');
  }
  return cleaned.trim();
}

export function cleanLyricsArtist(artist: string): string {
  let cleaned = artist.trim();
  for (const sep of ARTIST_SEPARATORS) {
    const idx = cleaned.toLowerCase().indexOf(sep.toLowerCase());
    if (idx > 0) {
      cleaned = cleaned.slice(0, idx);
      break;
    }
  }
  return cleaned.trim();
}

function parseTimestampToSec(minStr: string, secStr: string, fracStr?: string): number {
  const mins = parseInt(minStr, 10) || 0;
  const secs = parseInt(secStr, 10) || 0;
  let frac = 0;
  if (fracStr) {
    frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
  }
  return mins * 60 + secs + frac;
}

export function parseLrcText(rawLrc: string): { lines: LyricLine[]; wordSynced: boolean } {
  const rawLines = rawLrc.split(/\r?\n/);
  const parsed: LyricLine[] = [];
  let hasWords = false;

  const lineTimeRegex = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;
  const inlineWordRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;
    const match = raw.match(lineTimeRegex);
    if (!match) continue;

    const startSec = parseTimestampToSec(match[1], match[2], match[3]);
    let content = match[4].trim();

    let isBackground = false;
    let agent: string | undefined;

    if (content.startsWith('{bg}')) {
      isBackground = true;
      content = content.slice(4).trim();
    } else {
      const agentMatch = content.match(/^\{agent:([^}]+)\}/);
      if (agentMatch) {
        agent = agentMatch[1];
        content = content.slice(agentMatch[0].length).trim();
      }
    }

    const words: LyricWord[] = [];
    let wordMatch: RegExpExecArray | null;
    inlineWordRegex.lastIndex = 0;
    while ((wordMatch = inlineWordRegex.exec(content)) !== null) {
      const wStart = parseTimestampToSec(wordMatch[1], wordMatch[2], wordMatch[3]);
      const wText = wordMatch[4].trim();
      if (wText) {
        words.push({
          text: wText,
          startSec: wStart,
          endSec: wStart + 0.45,
        });
      }
    }

    if (words.length > 0) {
      hasWords = true;
      for (let w = 0; w < words.length - 1; w++) {
        words[w].endSec = Math.max(words[w].startSec + 0.08, words[w + 1].startSec);
      }
      content = words.map((w) => w.text).join(' ');
    }

    // Skip empty metadata lines at 0:00 if no words
    if (!content && parsed.length === 0) continue;

    parsed.push({
      id: `line-${i}-${startSec.toFixed(2)}`,
      startSec,
      text: content || '•••', // Musical interlude marker
      words: words.length > 0 ? words : undefined,
      agent,
      isBackground,
    });
  }

  parsed.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < parsed.length; i++) {
    const nextStart = parsed[i + 1]?.startSec;
    parsed[i].endSec = nextStart !== undefined ? nextStart : parsed[i].startSec + 6;
    if (parsed[i].words && parsed[i].words!.length > 0) {
      const lastW = parsed[i].words![parsed[i].words!.length - 1];
      lastW.endSec = Math.min(parsed[i].endSec!, Math.max(lastW.startSec + 0.35, lastW.endSec));
    }
  }

  return { lines: parsed, wordSynced: hasWords };
}

async function fetchTimeout(url: string, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryYouLyPlus(
  title: string,
  artist: string,
  durationSec: number,
  album?: string
): Promise<LyricsData | null> {
  for (const srv of YOULYPLUS_SERVERS) {
    try {
      const params = new URLSearchParams({
        title,
        artist,
        duration: String(Math.round(durationSec || 200)),
      });
      if (album) params.set('album', album);
      const res = await fetchTimeout(`${srv}/v2/lyrics/get?${params.toString()}`, 3800);
      if (!res.ok) continue;
      const data = await res.json();

      if (Array.isArray(data?.lyrics) && data.lyrics.length > 0) {
        const lines: LyricLine[] = [];
        let wordSynced = false;
        data.lyrics.forEach((item: any, idx: number) => {
          const startSec = (Number(item?.time) || 0) / 1000;
          const durSec = (Number(item?.duration) || 4000) / 1000;
          const syllabus: any[] = Array.isArray(item?.syllabus) ? item.syllabus : [];
          const isBg = syllabus.some((s) => s?.isBackground === true);
          const singer = item?.element?.singer ? String(item.element.singer) : undefined;

          let words: LyricWord[] | undefined;
          if (syllabus.length > 0) {
            wordSynced = true;
            words = syllabus
              .map((s) => {
                const ws = (Number(s?.time) || 0) / 1000;
                const wd = (Number(s?.duration) || 350) / 1000;
                return {
                  text: String(s?.text || '').trim(),
                  startSec: ws,
                  endSec: ws + wd,
                };
              })
              .filter((w) => w.text.length > 0);
          }

          const lineText = words?.length
            ? words.map((w) => w.text).join(' ')
            : String(item?.text || '').trim();

          if (lineText) {
            lines.push({
              id: `ylp-${idx}`,
              startSec,
              endSec: startSec + durSec,
              text: lineText,
              words,
              isBackground: isBg,
              agent: !isBg ? singer : undefined,
            });
          }
        });

        if (lines.length > 0) {
          return {
            trackId: '',
            provider: 'YouLyPlus',
            synced: true,
            wordSynced,
            lines,
          };
        }
      }

      if (typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim()) {
        const parsed = parseLrcText(data.syncedLyrics);
        if (parsed.lines.length > 0) {
          return {
            trackId: '',
            provider: 'YouLyPlus',
            synced: true,
            wordSynced: parsed.wordSynced,
            lines: parsed.lines,
          };
        }
      }
    } catch {
      // try next server
    }
  }
  return null;
}

async function tryLrcLib(
  title: string,
  artist: string,
  durationSec: number,
  album?: string
): Promise<LyricsData | null> {
  const cleanedTitle = cleanLyricsTitle(title);
  const cleanedArtist = cleanLyricsArtist(artist);

  const attempts: URLSearchParams[] = [
    new URLSearchParams({
      track_name: cleanedTitle,
      artist_name: cleanedArtist,
      ...(album ? { album_name: album } : {}),
    }),
    new URLSearchParams({
      q: `${cleanedArtist} ${cleanedTitle}`.trim(),
    }),
    new URLSearchParams({
      track_name: cleanedTitle,
    }),
  ];

  for (const params of attempts) {
    try {
      const res = await fetchTimeout(`https://lrclib.net/api/search?${params.toString()}`, 4800);
      if (!res.ok) continue;
      const list: any[] = await res.json();
      if (!Array.isArray(list) || list.length === 0) continue;

      const withSynced = list.filter((item) => typeof item?.syncedLyrics === 'string' && item.syncedLyrics.trim());
      if (withSynced.length > 0) {
        withSynced.sort((a, b) => {
          const da = Math.abs((Number(a.duration) || durationSec) - durationSec);
          const db = Math.abs((Number(b.duration) || durationSec) - durationSec);
          return da - db;
        });
        const best = withSynced[0];
        const parsed = parseLrcText(best.syncedLyrics);
        if (parsed.lines.length > 0) {
          return {
            trackId: '',
            provider: 'LRCLib',
            synced: true,
            wordSynced: parsed.wordSynced,
            lines: parsed.lines,
            plainText: best.plainLyrics || undefined,
          };
        }
      }

      const withPlain = list.find((item) => typeof item?.plainLyrics === 'string' && item.plainLyrics.trim());
      if (withPlain) {
        const rawLines = String(withPlain.plainLyrics)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const step = Math.max(3, (durationSec || 180) / Math.max(1, rawLines.length));
        return {
          trackId: '',
          provider: 'LRCLib',
          synced: false,
          wordSynced: false,
          plainText: withPlain.plainLyrics,
          lines: rawLines.map((text, idx) => ({
            id: `plain-${idx}`,
            startSec: idx * step,
            endSec: (idx + 1) * step,
            text,
          })),
        };
      }
    } catch {
      // try next search query
    }
  }
  return null;
}

/**
 * Normalise hand-made .lrc files: "[00:12.00][01:30.00]Chorus" → one line per timestamp,
 * [offset:±ms] applied, lines sorted by time.
 */
function expandLrc(text: string): string {
  const offMs = Number(text.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im)?.[1] || 0);
  const out: { t: number; line: string }[] = [];
  const stamp = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    const times: number[] = [];
    let m: RegExpMatchArray | null;
    while ((m = rest.match(stamp))) {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac - offMs / 1000); // +offset = earlier
      rest = rest.slice(m[0].length);
    }
    for (const t of times) {
      const c = Math.max(0, t);
      const mm = Math.floor(c / 60);
      const ss = (c - mm * 60).toFixed(2).padStart(5, '0');
      out.push({ t: c, line: `[${String(mm).padStart(2, '0')}:${ss}]${rest}` });
    }
  }
  out.sort((x, y) => x.t - y.t);
  return out.map((o) => o.line).join('\n');
}

/** LRC text (timed) or plain lyrics → LyricsData; plain lines are spread across the song */
export function lyricsFromText(text: string, durationSec: number): LyricsData | null {
  if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) {
    const parsed = parseLrcText(expandLrc(text));
    if (parsed.lines.length > 0) {
      return {
        trackId: '',
        provider: 'Local',
        synced: true,
        wordSynced: parsed.wordSynced,
        lines: parsed.lines,
      };
    }
  }
  const rawLines = text
    .split(/\r?\n/)
    .map((s) => s.replace(/^\[[a-z]+:.*\]$/i, '').trim())
    .filter(Boolean);
  if (rawLines.length === 0) return null;
  const step = Math.max(3, (durationSec || 180) / Math.max(1, rawLines.length));
  return {
    trackId: '',
    provider: 'Local',
    synced: false,
    wordSynced: false,
    plainText: rawLines.join('\n'),
    lines: rawLines.map((t, idx) => ({
      id: `local-${idx}`,
      startSec: idx * step,
      endSec: (idx + 1) * step,
      text: t,
    })),
  };
}

export async function fetchLyricsForTrack(track: Track): Promise<LyricsData> {
  const cached = lyricsCache.get(track.id);
  if (cached) return cached;

  if (BUILTIN_LYRICS_MAP[track.id]) {
    const builtIn: LyricsData = {
      trackId: track.id,
      provider: 'Built-in',
      synced: true,
      wordSynced: true,
      lines: BUILTIN_LYRICS_MAP[track.id],
    };
    lyricsCache.set(track.id, builtIn);
    return builtIn;
  }

  // Local Files: a sidecar .lrc next to the song, or lyrics embedded in its tags, win over online
  if (isLocalTrack(track)) {
    const own = await LocalLibrary.lyricsFor(track).catch(() => null);
    const local = own ? lyricsFromText(own.text, track.durationSec) : null;
    if (local) {
      const finalLocal = { ...local, trackId: track.id };
      lyricsCache.set(track.id, finalLocal);
      return finalLocal;
    }
  }

  // Race / cascade: YouLyPlus (word-timed syllable lyrics) -> LRCLib (LRC synced lyrics)
  const ylp = await tryYouLyPlus(track.title, track.artist, track.durationSec, track.album);
  if (ylp) {
    const finalYlp = { ...ylp, trackId: track.id };
    lyricsCache.set(track.id, finalYlp);
    return finalYlp;
  }

  const lrc = await tryLrcLib(track.title, track.artist, track.durationSec, track.album);
  if (lrc) {
    const finalLrc = { ...lrc, trackId: track.id };
    lyricsCache.set(track.id, finalLrc);
    return finalLrc;
  }

  const none: LyricsData = {
    trackId: track.id,
    provider: 'None',
    synced: false,
    wordSynced: false,
    lines: [],
  };
  return none;
}
