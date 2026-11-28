// Synchronized Lyrics Engine — ported from LrcLib.kt, YouLyPlus.kt & BetterLyrics.kt in realidkroo/Mochy-Music

import { LyricLine, LyricsData, LyricWord } from '../../types/music';

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

const YOULYPLUS_SERVERS = ['https://lyricsplus.prjktla.my.id', 'https://lyricsplus.binimum.org'];

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

/** YouLyPlus (word-timed) for a cleaned title / artist — used by the lyrics sources */
export async function tryYouLyPlusLyrics(
  title: string,
  artist: string,
  durationSec: number,
  album?: string
): Promise<LyricsData | null> {
  return tryYouLyPlus(title, artist, durationSec, album);
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

const STAMP_RE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META_RE = /^\[[a-z]+:.*\]$/i;

const fmtStamp = (s: number) => {
  const c = Math.max(0, s);
  const m = Math.floor(c / 60);
  return `[${String(m).padStart(2, '0')}:${(c - m * 60).toFixed(2).padStart(5, '0')}]`;
};

/**
 * Half-timed text (the lyrics editor, mid-way through timing a song): every line without a time
 * gets one spread evenly between its timed neighbours, in the order written. Returns LRC text
 * plus the keys ("<time>|<text>") of the estimated lines; null when nothing needs filling.
 */
function fillUntimed(text: string, durationSec: number): { lrc: string; est: Set<string> } | null {
  const offMs = Number(text.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im)?.[1] || 0);
  const rows: { t: number | null; raw: string; body: string }[] = [];
  const meta: string[] = [];
  for (const raw0 of text.split(/\r?\n/)) {
    const raw = raw0.trim();
    if (!raw) continue;
    if (META_RE.test(raw)) {
      meta.push(raw); // [offset:…] still has to reach expandLrc
      continue;
    }
    const m = raw.match(STAMP_RE);
    if (m) {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      rows.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac - offMs / 1000, raw, body: '' });
    } else rows.push({ t: null, raw, body: raw });
  }
  if (!rows.some((r) => r.t === null) || !rows.some((r) => r.t !== null)) return null;
  const end = Math.max(durationSec || 0, ...rows.map((r) => r.t ?? 0)) || 180;
  const est = new Set<string>();
  const out: string[] = [...meta];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== null) {
      // keep the original line (multi-stamp / word timing intact); expandLrc applies [offset]
      out.push(rows[i].raw);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].t === null) j++;
    const before = i > 0 ? rows[i - 1].t! : 0;
    let after = j < rows.length ? rows[j].t! : end;
    // a run before the first time starts at 0; one after the last runs ~3 s a line
    if (j >= rows.length) after = Math.min(end, before + 3 * (j - i + 1));
    if (after <= before) after = before + 0.5 * (j - i + 1);
    const step = (after - before) / (j - i + 1);
    for (let k = i; k < j; k++) {
      const t = before + step * (k - i + 1);
      est.add(`${fmtStamp(t)}|${rows[k].body}`);
      // written as if it carried the file's [offset] too (expandLrc takes it off again)
      out.push(fmtStamp(t + offMs / 1000) + rows[k].body);
    }
    i = j;
  }
  return { lrc: out.join('\n'), est };
}

/** LRC text (timed) or plain lyrics → LyricsData; plain lines are spread across the song.
 *  `keepUntimed`: lines without a time in otherwise timed text are kept (estimated) instead of
 *  dropped — for the user's own lyrics, half-way through timing them. */
export function lyricsFromText(
  text: string,
  durationSec: number,
  opts: { keepUntimed?: boolean } = {}
): LyricsData | null {
  if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) {
    const filled = opts.keepUntimed ? fillUntimed(text, durationSec) : null;
    const parsed = parseLrcText(expandLrc(filled ? filled.lrc : text));
    if (filled) {
      for (const l of parsed.lines) {
        if (filled.est.has(`${fmtStamp(l.startSec)}|${l.text}`)) l.estimated = true;
      }
    }
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
