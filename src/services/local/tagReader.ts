// Tag reader for on-device music files (HolySic Local Files).
// Reads only the bytes it needs through a random-access reader, so a 60 MB FLAC never has to be
// loaded into memory. Supports:
//   • MP3  — ID3v2.2 / 2.3 / 2.4 (text, track, year, genre, APIC/PIC cover), ID3v1 fallback,
//            duration from the Xing/Info or VBRI header, or the CBR bitrate as a last resort
//   • M4A / MP4 / AAC-in-MP4 / ALAC — iTunes ilst atoms (©nam ©ART aART ©alb ©day ©gen trkn covr)
//            and duration from mvhd (works when moov is at the end of the file too)
//   • FLAC — STREAMINFO duration, VORBIS_COMMENT, PICTURE (front cover preferred)
//   • WAV / AIFF — duration from the format header (+ LIST/INFO tags in WAV)
//   • MIDI / RMID / karaoke .kar — length from the tempo map, title, and syllable lyrics as LRC

import { parseMidi } from '../audio/midiSynth';

export interface TagPicture {
  mime: string;
  data: Uint8Array;
}

export interface TagMeta {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  genre?: string;
  durationSec?: number;
  sampleRateHz?: number;
  bitrateKbps?: number;
  codec?: string;
  picture?: TagPicture;
  /** embedded lyrics (ID3 USLT, Vorbis LYRICS, MP4 ©lyr) — may be LRC-timed */
  lyrics?: string;
  /** ReplayGain track gain in dB and sample peak (0..1+) */
  replayGainDb?: number;
  replayPeak?: number;
}

/** Random-access byte source (native FileHandle, or a browser File/Blob). */
export interface ByteReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const MAX_TAG_BYTES = 12 * 1024 * 1024; // embedded cover art can be large, but cap it
const MAX_PICTURE_BYTES = 6 * 1024 * 1024;

// ---------- text decoding (Hermes has no full TextDecoder) ----------

function latin1(b: Uint8Array, s = 0, e = b.length): string {
  let out = '';
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i]);
  return out;
}

export function utf8(b: Uint8Array, s = 0, e = b.length): string {
  let out = '';
  let i = s;
  while (i < e) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c >= 0xc0 && c < 0xe0 && i < e)
      out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < e) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i] & 0x3f) << 6) | (b[i + 1] & 0x3f));
      i += 2;
    } else if (c >= 0xf0 && i + 2 < e) {
      let cp =
        ((c & 0x07) << 18) | ((b[i] & 0x3f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      i += 3;
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else out += String.fromCharCode(c); // malformed: treat as latin1
  }
  return out;
}

function utf16(b: Uint8Array, s: number, e: number, bigEndian: boolean): string {
  let out = '';
  for (let i = s; i + 1 < e; i += 2) {
    const code = bigEndian ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8);
    out += String.fromCharCode(code);
  }
  return out;
}

const clean = (s: string | undefined): string | undefined => {
  if (!s) return undefined;
  // eslint-disable-next-line no-control-regex
  const t = s
    .replace(/\u0000+$/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
  return t || undefined;
};

/** Multi-line text (lyrics): keeps line breaks, drops other control characters */
const cleanMultiline = (str: string | undefined): string | undefined => {
  if (!str) return undefined;
  const t = str
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .trim();
  return t || undefined;
};

/** Decode a text file (.lrc): UTF-8 / UTF-16 with BOM. */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return utf16(b, 2, b.length, false);
  if (b[0] === 0xfe && b[1] === 0xff) return utf16(b, 2, b.length, true);
  const s = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  return utf8(b, s, b.length);
}

/** Raw ID3 string in a given encoding (no splitting at NULs) */
function id3Decode(b: Uint8Array, s: number, e: number, enc: number): string {
  if (s >= e) return '';
  if (enc === 0) return latin1(b, s, e);
  if (enc === 3) return utf8(b, s, e);
  if (enc === 1) {
    if (b[s] === 0xfe && b[s + 1] === 0xff) return utf16(b, s + 2, e, true);
    if (b[s] === 0xff && b[s + 1] === 0xfe) return utf16(b, s + 2, e, false);
    return utf16(b, s, e, false);
  }
  return utf16(b, s, e, true);
}

/** Position after an encoding-dependent NUL-terminated string */
function skipId3String(b: Uint8Array, q: number, e: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    while (q + 1 < e && !(b[q] === 0 && b[q + 1] === 0)) q += 2;
    return q + 2;
  }
  while (q < e && b[q] !== 0) q++;
  return q + 1;
}

/** "-7.32 dB" → -7.32 */
const parseGain = (v: string | undefined): number | undefined => {
  const n = v ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 60 ? n : undefined;
};
const parsePeak = (v: string | undefined): number | undefined => {
  const n = v ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10 ? n : undefined;
};

/** ID3 text with an encoding byte; returns the first string (multi-value → first) */
function id3Text(b: Uint8Array, s: number, e: number): string | undefined {
  if (s >= e) return undefined;
  const enc = b[s];
  const body = s + 1;
  let str: string;
  if (enc === 0) str = latin1(b, body, e);
  else if (enc === 3) str = utf8(b, body, e);
  else if (enc === 1) {
    // UTF-16 with BOM
    let be = false;
    let p = body;
    if (b[p] === 0xfe && b[p + 1] === 0xff) {
      be = true;
      p += 2;
    } else if (b[p] === 0xff && b[p + 1] === 0xfe) p += 2;
    str = utf16(b, p, e, be);
  } else str = utf16(b, body, e, true);
  return clean(str.split('\u0000')[0]);
}

const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u24be = (b: Uint8Array, o: number) => (b[o] << 16) + (b[o + 1] << 8) + b[o + 2];
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u32le = (b: Uint8Array, o: number) =>
  b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0);
const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function numPart(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const ID3_GENRES = [
  'Blues',
  'Classic Rock',
  'Country',
  'Dance',
  'Disco',
  'Funk',
  'Grunge',
  'Hip-Hop',
  'Jazz',
  'Metal',
  'New Age',
  'Oldies',
  'Other',
  'Pop',
  'R&B',
  'Rap',
  'Reggae',
  'Rock',
  'Techno',
  'Industrial',
  'Alternative',
  'Ska',
  'Death Metal',
  'Pranks',
  'Soundtrack',
  'Euro-Techno',
  'Ambient',
  'Trip-Hop',
  'Vocal',
  'Jazz+Funk',
  'Fusion',
  'Trance',
  'Classical',
  'Instrumental',
  'Acid',
  'House',
  'Game',
  'Sound Clip',
  'Gospel',
  'Noise',
  'Alt. Rock',
  'Bass',
  'Soul',
  'Punk',
  'Space',
  'Meditative',
  'Instrumental Pop',
  'Instrumental Rock',
  'Ethnic',
  'Gothic',
  'Darkwave',
  'Techno-Industrial',
  'Electronic',
  'Pop-Folk',
  'Eurodance',
  'Dream',
  'Southern Rock',
  'Comedy',
  'Cult',
  'Gangsta Rap',
  'Top 40',
  'Christian Rap',
  'Pop/Funk',
  'Jungle',
  'Native American',
  'Cabaret',
  'New Wave',
  'Psychedelic',
  'Rave',
  'Showtunes',
  'Trailer',
  'Lo-Fi',
  'Tribal',
  'Acid Punk',
  'Acid Jazz',
  'Polka',
  'Retro',
  'Musical',
  'Rock & Roll',
  'Hard Rock',
];

function genreName(g: string | undefined): string | undefined {
  if (!g) return undefined;
  const m = g.match(/^\(?(\d{1,3})\)?$/);
  if (m) return ID3_GENRES[parseInt(m[1], 10)] || undefined;
  return g.replace(/^\(\d+\)/, '').trim() || undefined;
}

function sniffImageMime(d: Uint8Array, fallback = 'image/jpeg'): string {
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return 'image/png';
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg';
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return 'image/gif';
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[8] === 0x57) return 'image/webp';
  return fallback;
}

// ---------- MP3 / ID3 ----------

function removeUnsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function parseId3v2(tag: Uint8Array, major: number, flags: number, meta: TagMeta): void {
  let b = tag;
  if (flags & 0x80 && major < 4) b = removeUnsync(b);
  let p = 0;
  if (flags & 0x40) {
    // extended header
    const extSize = major === 4 ? syncsafe(b, 0) : u32be(b, 0) + 4;
    p = extSize;
  }
  const idLen = major === 2 ? 3 : 4;
  const hdrLen = major === 2 ? 6 : 10;
  let bestPic: { type: number; pic: TagPicture } | null = null;
  while (p + hdrLen <= b.length) {
    if (b[p] === 0) break; // padding
    const id = latin1(b, p, p + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size: number;
    let fflags = 0;
    if (major === 2) size = u24be(b, p + 3);
    else if (major === 4) size = syncsafe(b, p + 4);
    else size = u32be(b, p + 4);
    if (major > 2) fflags = u16be(b, p + 8);
    const s = p + hdrLen;
    const e = Math.min(b.length, s + size);
    p = s + size;
    if (size <= 0 || s >= b.length) continue;
    let fs = s;
    let frame = b;
    if (major === 4) {
      if (fflags & 0x0001) fs += 4; // data length indicator
      if (fflags & 0x0002) {
        frame = removeUnsync(b.subarray(fs, e));
        fs = 0;
      }
      if (fflags & 0x000c) continue; // compressed / encrypted: skip
    } else if (major === 3 && fflags & 0x00c0) continue;
    const fe = frame === b ? e : frame.length;
    switch (id) {
      case 'TIT2':
      case 'TT2':
        meta.title = meta.title || id3Text(frame, fs, fe);
        break;
      case 'TPE1':
      case 'TP1':
        meta.artist = meta.artist || id3Text(frame, fs, fe);
        break;
      case 'TPE2':
      case 'TP2':
        meta.albumArtist = meta.albumArtist || id3Text(frame, fs, fe);
        break;
      case 'TALB':
      case 'TAL':
        meta.album = meta.album || id3Text(frame, fs, fe);
        break;
      case 'TRCK':
      case 'TRK':
        meta.trackNo = meta.trackNo || numPart(id3Text(frame, fs, fe));
        break;
      case 'TPOS':
      case 'TPA':
        meta.discNo = meta.discNo || numPart(id3Text(frame, fs, fe));
        break;
      case 'TYER':
      case 'TDRC':
      case 'TYE':
      case 'TDOR':
        meta.year = meta.year || numPart(id3Text(frame, fs, fe)?.slice(0, 4));
        break;
      case 'TCON':
      case 'TCO':
        meta.genre = meta.genre || genreName(id3Text(frame, fs, fe));
        break;
      case 'TLEN':
      case 'TLE': {
        const ms = numPart(id3Text(frame, fs, fe));
        if (ms && ms > 1000) meta.durationSec = meta.durationSec || Math.round(ms / 1000);
        break;
      }
      case 'USLT':
      case 'ULT': {
        // encoding, 3-byte language, descriptor, text
        const enc = frame[fs];
        const q = skipId3String(frame, fs + 4, fe, enc);
        if (!meta.lyrics && q < fe) meta.lyrics = cleanMultiline(id3Decode(frame, q, fe, enc));
        break;
      }
      case 'TXXX':
      case 'TXX': {
        const enc = frame[fs];
        const q = skipId3String(frame, fs + 1, fe, enc);
        const desc = clean(id3Decode(frame, fs + 1, q, enc).split('\u0000')[0])?.toUpperCase();
        const val = clean(id3Decode(frame, q, fe, enc).split('\u0000')[0]);
        if (desc === 'REPLAYGAIN_TRACK_GAIN') meta.replayGainDb = parseGain(val);
        else if (desc === 'REPLAYGAIN_TRACK_PEAK') meta.replayPeak = parsePeak(val);
        else if ((desc === 'LYRICS' || desc === 'UNSYNCEDLYRICS') && !meta.lyrics)
          meta.lyrics = cleanMultiline(id3Decode(frame, q, fe, enc));
        break;
      }
      case 'APIC':
      case 'PIC': {
        const enc = frame[fs];
        let q = fs + 1;
        let mime: string;
        if (id === 'PIC') {
          const fmt = latin1(frame, q, q + 3).toUpperCase();
          mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
          q += 3;
        } else {
          const z = frame.indexOf(0, q);
          if (z < 0) break;
          mime = latin1(frame, q, z).toLowerCase() || 'image/jpeg';
          if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
          q = z + 1;
        }
        const type = frame[q++];
        // skip description (encoding dependent terminator)
        if (enc === 1 || enc === 2) {
          while (q + 1 < fe && !(frame[q] === 0 && frame[q + 1] === 0)) q += 2;
          q += 2;
        } else {
          while (q < fe && frame[q] !== 0) q++;
          q += 1;
        }
        if (q >= fe || fe - q > MAX_PICTURE_BYTES) break;
        const data = frame.slice(q, fe);
        const pic = { mime: sniffImageMime(data, mime), data };
        // prefer the front cover (type 3), otherwise the first picture
        if (!bestPic || (type === 3 && bestPic.type !== 3)) bestPic = { type, pic };
        break;
      }
    }
  }
  if (bestPic) meta.picture = bestPic.pic;
}

const MPEG_BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps by index
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

/** Duration from the first MPEG audio frame (Xing/Info, VBRI, else CBR estimate). */
function mp3Duration(
  buf: Uint8Array,
  _audioStart: number,
  audioBytes: number,
  meta: TagMeta
): void {
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (buf[i + 1] >> 3) & 3; // 0=2.5, 2=2, 3=1
    const layerBits = (buf[i + 1] >> 1) & 3; // 1=III, 2=II, 3=I
    const brIdx = buf[i + 2] >> 4;
    const srIdx = (buf[i + 2] >> 2) & 3;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
    const layer = 4 - layerBits;
    const kbps = MPEG_BITRATES[`${version === 1 ? 1 : 2}-${layer}`][brIdx];
    const sr = MPEG_RATES[version][srIdx];
    const mono = buf[i + 3] >> 6 === 3;
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
    meta.sampleRateHz = sr;
    meta.codec = layer === 3 ? 'MP3' : `MPEG L${layer}`;
    // Xing / Info header sits after the side info
    const sideInfo = version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = i + 4 + sideInfo;
    const tag = latin1(buf, x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && x + 12 <= buf.length) {
      const flags = u32be(buf, x + 4);
      if (flags & 1) {
        const frames = u32be(buf, x + 8);
        if (frames > 0) {
          meta.durationSec = meta.durationSec || Math.round((frames * samplesPerFrame) / sr);
          const bytes = flags & 2 ? u32be(buf, x + 12) : audioBytes;
          meta.bitrateKbps = Math.round((bytes * 8) / ((frames * samplesPerFrame) / sr) / 1000);
          return;
        }
      }
    }
    const v = i + 4 + 32;
    if (latin1(buf, v, v + 4) === 'VBRI' && v + 18 <= buf.length) {
      const bytes = u32be(buf, v + 10);
      const frames = u32be(buf, v + 14);
      if (frames > 0) {
        meta.durationSec = meta.durationSec || Math.round((frames * samplesPerFrame) / sr);
        meta.bitrateKbps = Math.round((bytes * 8) / ((frames * samplesPerFrame) / sr) / 1000);
        return;
      }
    }
    meta.bitrateKbps = kbps;
    if (kbps > 0)
      meta.durationSec = meta.durationSec || Math.round((audioBytes * 8) / (kbps * 1000));
    return;
  }
}

async function readMp3(r: ByteReader, meta: TagMeta, head: Uint8Array): Promise<void> {
  let audioStart = 0;
  if (latin1(head, 0, 3) === 'ID3') {
    const major = head[3];
    const flags = head[5];
    const size = syncsafe(head, 6);
    const total = 10 + size + (flags & 0x10 ? 10 : 0);
    if (major >= 2 && major <= 4 && size > 0) {
      const tag = await r.read(10, Math.min(size, MAX_TAG_BYTES));
      parseId3v2(tag, major, flags, meta);
    }
    audioStart = total;
  }
  // ID3v1 at the end (fallback for old files)
  let tail = 0;
  if (r.size > 128 && (!meta.title || !meta.artist)) {
    const v1 = await r.read(r.size - 128, 128);
    if (latin1(v1, 0, 3) === 'TAG') {
      tail = 128;
      meta.title = meta.title || clean(latin1(v1, 3, 33));
      meta.artist = meta.artist || clean(latin1(v1, 33, 63));
      meta.album = meta.album || clean(latin1(v1, 63, 93));
      meta.year = meta.year || numPart(latin1(v1, 93, 97));
      if (v1[125] === 0 && v1[126]) meta.trackNo = meta.trackNo || v1[126];
      meta.genre = meta.genre || ID3_GENRES[v1[127]];
    }
  }
  const frameBuf = await r.read(audioStart, Math.min(16384, Math.max(0, r.size - audioStart)));
  mp3Duration(frameBuf, audioStart, Math.max(0, r.size - audioStart - tail), meta);
}

// ---------- MP4 / M4A ----------

const CONTAINER_ATOMS = new Set(['moov', 'udta', 'ilst', 'trak', 'mdia', 'minf', 'stbl']);

function walkAtoms(
  b: Uint8Array,
  s: number,
  e: number,
  path: string,
  meta: TagMeta,
  ctx: { stsd?: boolean }
): void {
  let p = s;
  while (p + 8 <= e) {
    let size = u32be(b, p);
    const type = latin1(b, p + 4, p + 8);
    let hdr = 8;
    if (size === 1 && p + 16 <= e) {
      size = u32be(b, p + 12); // 64-bit size (high word ignored; tags never that big)
      hdr = 16;
    } else if (size === 0) size = e - p;
    if (size < hdr || p + size > e) break;
    const cs = p + hdr;
    const ce = p + size;
    const here = path ? `${path}.${type}` : type;
    if (type === 'meta') walkAtoms(b, cs + 4, ce, here, meta, ctx);
    else if (CONTAINER_ATOMS.has(type)) walkAtoms(b, cs, ce, here, meta, ctx);
    else if (type === 'mvhd') {
      const ver = b[cs];
      const ts = ver === 1 ? u32be(b, cs + 20) : u32be(b, cs + 12);
      const dur =
        ver === 1 ? u32be(b, cs + 24) * 4294967296 + u32be(b, cs + 28) : u32be(b, cs + 16);
      if (ts > 0 && dur > 0) meta.durationSec = Math.round(dur / ts);
    } else if (type === 'stsd' && !ctx.stsd) {
      ctx.stsd = true;
      const fmt = latin1(b, cs + 12, cs + 16);
      meta.codec = fmt === 'alac' ? 'ALAC' : fmt === 'mp4a' ? 'AAC' : fmt === 'fLaC' ? 'FLAC' : fmt;
      if (cs + 8 + 36 <= ce) {
        const sr = u16be(b, cs + 8 + 32);
        if (sr > 0) meta.sampleRateHz = sr;
      }
    } else if (path.endsWith('ilst')) {
      // item atom → find its 'data' child ('----' freeform items carry mean/name first)
      let q = cs;
      let freeName = '';
      while (q + 16 <= ce) {
        const ds = u32be(b, q);
        const dt = latin1(b, q + 4, q + 8);
        if (ds < 12 || q + ds > ce) break;
        if (dt === 'name') freeName = utf8(b, q + 12, q + ds).toLowerCase();
        if (dt === 'data') {
          const kind = u24be(b, q + 9);
          const vs = q + 16;
          const ve = q + ds;
          const text = () => clean(utf8(b, vs, ve));
          switch (type) {
            case '\u00a9nam':
              meta.title = text();
              break;
            case '\u00a9ART':
              meta.artist = text();
              break;
            case 'aART':
              meta.albumArtist = text();
              break;
            case '\u00a9alb':
              meta.album = text();
              break;
            case '\u00a9day':
              meta.year = numPart(text()?.slice(0, 4));
              break;
            case '\u00a9gen':
              meta.genre = text();
              break;
            case 'gnre':
              if (ve - vs >= 2) meta.genre = ID3_GENRES[u16be(b, vs) - 1];
              break;
            case 'trkn':
              if (ve - vs >= 4) meta.trackNo = u16be(b, vs + 2) || undefined;
              break;
            case 'disk':
              if (ve - vs >= 4) meta.discNo = u16be(b, vs + 2) || undefined;
              break;
            case '\u00a9lyr':
              meta.lyrics = meta.lyrics || cleanMultiline(utf8(b, vs, ve));
              break;
            case '----':
              if (freeName === 'replaygain_track_gain') meta.replayGainDb = parseGain(text());
              else if (freeName === 'replaygain_track_peak') meta.replayPeak = parsePeak(text());
              break;
            case 'covr':
              if (!meta.picture && ve - vs <= MAX_PICTURE_BYTES) {
                const data = b.slice(vs, ve);
                meta.picture = {
                  mime: sniffImageMime(data, kind === 14 ? 'image/png' : 'image/jpeg'),
                  data,
                };
              }
              break;
          }
          break;
        }
        q += ds;
      }
    }
    p = ce;
  }
}

async function readMp4(r: ByteReader, meta: TagMeta): Promise<void> {
  let p = 0;
  for (let guard = 0; guard < 64 && p + 8 <= r.size; guard++) {
    const h = await r.read(p, 16);
    let size = u32be(h, 0);
    const type = latin1(h, 4, 8);
    if (size === 1) size = u32be(h, 8) * 4294967296 + u32be(h, 12);
    else if (size === 0) size = r.size - p;
    if (size < 8) break;
    if (type === 'moov') {
      const moov = await r.read(p, Math.min(size, MAX_TAG_BYTES));
      walkAtoms(moov, 0, moov.length, '', meta, {});
      return;
    }
    p += size;
  }
}

// ---------- FLAC ----------

function parseVorbisComments(b: Uint8Array, s: number, e: number, meta: TagMeta): void {
  let p = s;
  const vlen = u32le(b, p);
  p += 4 + vlen;
  const n = u32le(b, p);
  p += 4;
  for (let i = 0; i < n && p + 4 <= e; i++) {
    const len = u32le(b, p);
    p += 4;
    const kv = utf8(b, p, Math.min(e, p + len));
    p += len;
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    const k = kv.slice(0, eq).toUpperCase();
    const v = clean(kv.slice(eq + 1));
    if (!v) continue;
    if (k === 'TITLE') meta.title = meta.title || v;
    else if (k === 'ARTIST') meta.artist = meta.artist || v;
    else if (k === 'ALBUMARTIST' || k === 'ALBUM ARTIST') meta.albumArtist = meta.albumArtist || v;
    else if (k === 'ALBUM') meta.album = meta.album || v;
    else if (k === 'TRACKNUMBER') meta.trackNo = meta.trackNo || numPart(v);
    else if (k === 'DISCNUMBER') meta.discNo = meta.discNo || numPart(v);
    else if (k === 'DATE' || k === 'YEAR') meta.year = meta.year || numPart(v.slice(0, 4));
    else if (k === 'GENRE') meta.genre = meta.genre || v;
    else if (k === 'REPLAYGAIN_TRACK_GAIN') meta.replayGainDb = parseGain(v);
    else if (k === 'REPLAYGAIN_TRACK_PEAK') meta.replayPeak = parsePeak(v);
    else if ((k === 'LYRICS' || k === 'UNSYNCEDLYRICS' || k === 'UNSYNCED LYRICS') && !meta.lyrics)
      meta.lyrics = cleanMultiline(kv.slice(eq + 1));
  }
}

function parseFlacPicture(b: Uint8Array): { type: number; pic: TagPicture } | null {
  let p = 0;
  const type = u32be(b, p);
  p += 4;
  const ml = u32be(b, p);
  p += 4;
  const mime = latin1(b, p, p + ml);
  p += ml;
  const dl = u32be(b, p);
  p += 4 + dl + 16;
  const len = u32be(b, p);
  p += 4;
  if (len <= 0 || p + len > b.length) return null;
  const data = b.slice(p, p + len);
  return { type, pic: { mime: sniffImageMime(data, mime || 'image/jpeg'), data } };
}

async function readFlac(r: ByteReader, meta: TagMeta, offset = 4): Promise<void> {
  meta.codec = 'FLAC';
  let p = offset;
  let best: { type: number; pic: TagPicture } | null = null;
  for (let guard = 0; guard < 128 && p + 4 <= r.size; guard++) {
    const h = await r.read(p, 4);
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = u24be(h, 1);
    p += 4;
    if (type === 0 && len >= 18) {
      const si = await r.read(p, 18);
      const sr = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
      const total = (si[13] & 0x0f) * 4294967296 + u32be(si, 14);
      if (sr > 0) {
        meta.sampleRateHz = sr;
        if (total > 0) meta.durationSec = Math.round(total / sr);
      }
    } else if (type === 4 && len < MAX_TAG_BYTES) {
      parseVorbisComments(await r.read(p, len), 0, len, meta);
    } else if (type === 6 && len < MAX_PICTURE_BYTES + 4096) {
      const pic = parseFlacPicture(await r.read(p, len));
      if (pic && (!best || (pic.type === 3 && best.type !== 3))) best = pic;
    }
    p += len;
    if (last) break;
  }
  if (best) meta.picture = best.pic;
}

// ---------- WAV / AIFF ----------

async function readWav(r: ByteReader, meta: TagMeta): Promise<void> {
  meta.codec = 'WAV';
  let p = 12;
  let byteRate = 0;
  for (let guard = 0; guard < 64 && p + 8 <= r.size; guard++) {
    const h = await r.read(p, 8);
    const id = latin1(h, 0, 4);
    const len = u32le(h, 4);
    if (id === 'fmt ') {
      const f = await r.read(p + 8, 16);
      meta.sampleRateHz = u32le(f, 4);
      byteRate = u32le(f, 8);
    } else if (id === 'data') {
      if (byteRate > 0) meta.durationSec = Math.round(len / byteRate);
    } else if (id === 'LIST' && len < 1 << 20) {
      const l = await r.read(p + 8, len);
      if (latin1(l, 0, 4) === 'INFO') {
        let q = 4;
        while (q + 8 <= l.length) {
          const k = latin1(l, q, q + 4);
          const n = u32le(l, q + 4);
          const v = clean(utf8(l, q + 8, Math.min(l.length, q + 8 + n)));
          if (k === 'INAM') meta.title = v;
          else if (k === 'IART') meta.artist = v;
          else if (k === 'IPRD') meta.album = v;
          else if (k === 'ICRD') meta.year = numPart(v?.slice(0, 4));
          else if (k === 'IGNR') meta.genre = v;
          q += 8 + n + (n & 1);
        }
      }
    }
    p += 8 + len + (len & 1);
  }
}

function float80(b: Uint8Array, o: number): number {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const hi = u32be(b, o + 2);
  const lo = u32be(b, o + 6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 4294967296 + lo) * Math.pow(2, exp - 16383 - 63);
}

async function readAiff(r: ByteReader, meta: TagMeta): Promise<void> {
  meta.codec = 'AIFF';
  let p = 12;
  for (let guard = 0; guard < 64 && p + 8 <= r.size; guard++) {
    const h = await r.read(p, 8);
    const id = latin1(h, 0, 4);
    const len = u32be(h, 4);
    if (id === 'COMM') {
      const c = await r.read(p + 8, 18);
      const frames = u32be(c, 2);
      const sr = float80(c, 8);
      if (sr > 0) {
        meta.sampleRateHz = Math.round(sr);
        meta.durationSec = Math.round(frames / sr);
      }
    } else if (id === 'ID3 ' || id === 'id3 ') {
      const t = await r.read(p + 8, Math.min(len, MAX_TAG_BYTES));
      if (latin1(t, 0, 3) === 'ID3') parseId3v2(t.subarray(10), t[3], t[5], meta);
    }
    p += 8 + len + (len & 1);
  }
}

/** Read tags + duration. Never throws: a broken file just yields what could be read. */
export async function readTags(r: ByteReader, fileName: string): Promise<TagMeta> {
  const meta: TagMeta = {};
  try {
    if (r.size < 16) return meta;
    const head = await r.read(0, Math.min(64, r.size));
    const magic4 = latin1(head, 0, 4);
    const ext = (fileName.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    if (magic4 === 'MThd' || (magic4 === 'RIFF' && latin1(head, 8, 12) === 'RMID')) {
      if (r.size <= 8 * 1024 * 1024) {
        const midi = parseMidi(await r.read(0, r.size));
        meta.durationSec = Math.round(midi.durationSec);
        meta.codec = 'MIDI';
        if (midi.title) meta.title = midi.title;
        if (midi.artist) meta.artist = midi.artist;
        if (midi.lyrics) meta.lyrics = midi.lyrics;
      }
    } else if (magic4 === 'fLaC') await readFlac(r, meta);
    else if (latin1(head, 4, 8) === 'ftyp') await readMp4(r, meta);
    else if (magic4 === 'RIFF' && latin1(head, 8, 12) === 'WAVE') await readWav(r, meta);
    else if (magic4 === 'FORM' && /^AIF[FC]$/.test(latin1(head, 8, 12))) await readAiff(r, meta);
    else if (latin1(head, 0, 3) === 'ID3') {
      // ID3 in front of FLAC happens (some taggers)
      const size = syncsafe(head, 6) + 10;
      const after = await r.read(size, 4);
      if (latin1(after, 0, 4) === 'fLaC') {
        await readMp3Tag(r, head, meta);
        await readFlac(r, meta, size + 4);
      } else await readMp3(r, meta, head);
    } else if (ext === 'mp3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
      await readMp3(r, meta, head);
  } catch {
    // partial metadata is fine
  }
  return meta;
}

async function readMp3Tag(r: ByteReader, head: Uint8Array, meta: TagMeta): Promise<void> {
  const size = syncsafe(head, 6);
  if (size > 0) parseId3v2(await r.read(10, Math.min(size, MAX_TAG_BYTES)), head[3], head[5], meta);
}
