// Format sniffer — what a file really is, from its first bytes.
//
// Songs arrive misnamed all the time (an AAC saved as ".mp3", a FLAC with an ID3 block in front, a
// MIDI that an older import renamed to ".m4a", an iCloud placeholder that is still all zeros), and
// AVPlayer trusts the extension. This looks at the magic numbers instead and says which container
// / codec it is, whether iOS can play it as-is, and which extension a playable copy should get.

export type SniffKind = 'audio' | 'video' | 'midi' | 'playlist' | 'image' | 'document' | 'empty';

export interface SniffResult {
  /** extension a correctly named copy should carry (lower-case, no dot) */
  ext: string;
  /** human label for Stream Diagnostics, e.g. "MP3 (MPEG-1 Layer III)" */
  label: string;
  /** AVPlayer can open it (MIDI is "playable" through the built-in synthesizer) */
  playable: boolean;
  kind: SniffKind;
  /** the app renders it to WAV first (MIDI) */
  synth?: boolean;
  /** extra hint shown with the label */
  note?: string;
}

/** How many leading bytes a caller should read (big enough for most ID3 tags + Ogg page 1) */
export const SNIFF_BYTES = 4096;

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
const at = (b: Uint8Array, o: number, txt: string) => {
  if (b.length < o + txt.length) return false;
  for (let i = 0; i < txt.length; i++) if (b[o + i] !== txt.charCodeAt(i)) return false;
  return true;
};
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Size of a leading ID3v2 block (header + body + footer), or 0 */
export function id3Size(b: Uint8Array): number {
  if (!at(b, 0, 'ID3') || b.length < 10) return 0;
  const size = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127);
  return size + 10 + (b[5] & 0x10 ? 10 : 0);
}

/** ISO-BMFF (MP4 family) by its ftyp major / compatible brands */
function isoBrand(b: Uint8Array): SniffResult {
  const major = ascii(b, 8, 4);
  const boxLen = Math.min(u32be(b, 0), b.length, 64);
  const brands = [major];
  for (let o = 16; o + 4 <= boxLen; o += 4) brands.push(ascii(b, o, 4));
  const has = (...xs: string[]) => brands.some((x) => xs.includes(x));
  if (has('M4P '))
    return {
      ext: 'm4a',
      label: 'MPEG-4 (iTunes DRM)',
      playable: false,
      kind: 'audio',
      note: 'FairPlay-protected — only the Music app can play it',
    };
  if (major === 'M4A ')
    return { ext: 'm4a', label: 'MPEG-4 Audio (AAC/ALAC)', playable: true, kind: 'audio' };
  if (major === 'M4B ')
    return { ext: 'm4b', label: 'MPEG-4 Audiobook', playable: true, kind: 'audio' };
  if (major === 'qt  ') return { ext: 'mov', label: 'QuickTime', playable: true, kind: 'video' };
  if (/^3g/.test(major)) return { ext: '3gp', label: '3GPP', playable: true, kind: 'audio' };
  if (major === 'M4V ' || major === 'M4VH' || major === 'M4VP')
    return { ext: 'm4v', label: 'MPEG-4 Video', playable: true, kind: 'video' };
  if (has('heic', 'heix', 'heis', 'mif1', 'msf1', 'avif', 'avis'))
    return { ext: 'heic', label: 'HEIF/AVIF image', playable: false, kind: 'image' };
  if (major === 'crx ') return { ext: 'cr3', label: 'Camera RAW', playable: false, kind: 'image' };
  if (has('dash', 'msdh', 'cmfc'))
    return { ext: 'mp4', label: 'Fragmented MP4 (DASH)', playable: true, kind: 'audio' };
  if (has('M4A '))
    return { ext: 'm4a', label: 'MPEG-4 Audio (AAC/ALAC)', playable: true, kind: 'audio' };
  return { ext: 'mp4', label: `MPEG-4 (${major.trim() || 'isom'})`, playable: true, kind: 'audio' };
}

function riff(b: Uint8Array): SniffResult | undefined {
  const form = ascii(b, 8, 4);
  if (form === 'RMID')
    return { ext: 'rmi', label: 'MIDI (RIFF RMID)', playable: true, kind: 'midi', synth: true };
  if (form === 'AVI ') return { ext: 'avi', label: 'AVI video', playable: false, kind: 'video' };
  if (form === 'WEBP') return { ext: 'webp', label: 'WebP image', playable: false, kind: 'image' };
  if (form !== 'WAVE') return undefined;
  // walk to the fmt chunk for the codec tag
  let p = 12;
  for (let guard = 0; guard < 16 && p + 8 <= b.length; guard++) {
    const id = ascii(b, p, 4);
    const len = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    if (id === 'fmt ' && p + 24 <= b.length) {
      let tag = u16le(b, p + 8);
      const bits = u16le(b, p + 22);
      if (tag === 0xfffe && p + 34 <= b.length) tag = u16le(b, p + 32); // extensible: sub-format
      const name: Record<number, string> = {
        1: `PCM ${bits}-bit`,
        2: 'MS ADPCM',
        3: '32-bit float',
        6: 'A-law',
        7: 'µ-law',
        0x11: 'IMA ADPCM',
        0x31: 'GSM 6.10',
        0x55: 'MP3',
        0x2000: 'AC-3',
      };
      const ok = [1, 2, 3, 6, 7, 0x11, 0x55].includes(tag);
      return {
        ext: 'wav',
        label: `WAV (${name[tag] || `codec 0x${tag.toString(16)}`})`,
        playable: ok,
        kind: 'audio',
      };
    }
    if (len < 0) break;
    p += 8 + len + (len & 1);
  }
  return { ext: 'wav', label: 'WAV', playable: true, kind: 'audio' };
}

function ogg(b: Uint8Array): SniffResult {
  // first page: 27-byte header + segment table, then the codec's identification packet
  const segs = b[26] || 0;
  const o = 27 + segs;
  if (at(b, o, 'OpusHead'))
    return { ext: 'opus', label: 'Ogg Opus', playable: false, kind: 'audio' };
  if (at(b, o + 1, 'vorbis'))
    return { ext: 'ogg', label: 'Ogg Vorbis', playable: false, kind: 'audio' };
  if (at(b, o + 1, 'FLAC'))
    return { ext: 'oga', label: 'Ogg FLAC', playable: false, kind: 'audio' };
  if (at(b, o, 'Speex')) return { ext: 'spx', label: 'Ogg Speex', playable: false, kind: 'audio' };
  if (at(b, o + 1, 'theora'))
    return { ext: 'ogv', label: 'Ogg Theora video', playable: false, kind: 'video' };
  return { ext: 'ogg', label: 'Ogg', playable: false, kind: 'audio' };
}

/** MPEG audio frame header at `o` (rejects most random 0xFFEx noise) */
function mpegFrame(b: Uint8Array, o: number): SniffResult | undefined {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return undefined;
  const ver = (b[o + 1] >> 3) & 3; // 0 = 2.5, 1 = reserved, 2 = 2, 3 = 1
  const layer = (b[o + 1] >> 1) & 3; // 0 = reserved (ADTS AAC), 1 = III, 2 = II, 3 = I
  if (layer === 0) {
    // ADTS: sampling index 0..12, never 15
    if (((b[o + 2] >> 2) & 15) > 12) return undefined;
    return { ext: 'aac', label: 'AAC (ADTS)', playable: true, kind: 'audio' };
  }
  if (ver === 1) return undefined;
  const brIdx = b[o + 2] >> 4;
  const srIdx = (b[o + 2] >> 2) & 3;
  if (brIdx === 15 || brIdx === 0 || srIdx === 3) return undefined;
  const v = ver === 3 ? '1' : ver === 2 ? '2' : '2.5';
  const l = layer === 1 ? 'III' : layer === 2 ? 'II' : 'I';
  const ext = layer === 1 ? 'mp3' : layer === 2 ? 'mp2' : 'mp1';
  return {
    ext,
    label: `${ext.toUpperCase()} (MPEG-${v} Layer ${l})`,
    playable: true,
    kind: 'audio',
  };
}

/**
 * Identify a file from its first bytes (pass ≥ SNIFF_BYTES when you can). `after` is what follows
 * a long ID3 block that did not fit in `b` (the caller reads it separately), when known.
 */
export function sniffBytes(b: Uint8Array, after?: Uint8Array): SniffResult | undefined {
  if (!b || b.length < 4) return b && b.length === 0 ? EMPTY : undefined;

  // ID3v2 sits in front of MP3 — and sometimes of FLAC / AAC (some taggers do that)
  const tag = id3Size(b);
  if (tag) {
    const rest = tag + 16 <= b.length ? b.subarray(tag) : after;
    const inner = rest && rest.length >= 4 ? sniffBytes(rest) : undefined;
    if (inner?.ext === 'flac') return { ...inner, label: 'FLAC + ID3' };
    if (inner?.ext === 'aac') return { ...inner, label: 'AAC (ADTS) + ID3' };
    if (inner && inner.kind === 'audio') return inner;
    return { ext: 'mp3', label: 'MP3', playable: true, kind: 'audio' };
  }

  if (at(b, 0, 'MThd'))
    return { ext: 'mid', label: 'MIDI', playable: true, kind: 'midi', synth: true };
  if (at(b, 0, 'fLaC')) return { ext: 'flac', label: 'FLAC', playable: true, kind: 'audio' };
  if (at(b, 4, 'ftyp')) return isoBrand(b);
  if (at(b, 4, 'moov') || at(b, 4, 'mdat') || at(b, 4, 'wide') || at(b, 4, 'free'))
    return { ext: 'mov', label: 'QuickTime', playable: true, kind: 'video' };
  if (at(b, 0, 'RIFF')) {
    const r = riff(b);
    if (r) return r;
  }
  if (at(b, 0, 'RF64') || at(b, 0, 'BW64'))
    return { ext: 'wav', label: 'WAV 64 (RF64)', playable: true, kind: 'audio' };
  if (at(b, 0, 'FORM') && (at(b, 8, 'AIFF') || at(b, 8, 'AIFC')))
    return {
      ext: 'aiff',
      label: at(b, 8, 'AIFC') ? 'AIFF-C' : 'AIFF',
      playable: true,
      kind: 'audio',
    };
  if (at(b, 0, 'FRM8'))
    return { ext: 'dff', label: 'DSD (DSDIFF)', playable: false, kind: 'audio' };
  if (at(b, 0, 'caff'))
    return { ext: 'caf', label: 'CAF (Core Audio)', playable: true, kind: 'audio' };
  if (at(b, 0, 'OggS')) return ogg(b);
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = ascii(b, 0, Math.min(64, b.length));
    return head.includes('webm')
      ? { ext: 'webm', label: 'WebM (Opus/Vorbis)', playable: false, kind: 'audio' }
      : { ext: 'mka', label: 'Matroska (MKV/MKA)', playable: false, kind: 'audio' };
  }
  if (at(b, 0, '#!AMR-WB\n'))
    return { ext: 'awb', label: 'AMR-WB', playable: false, kind: 'audio' };
  if (at(b, 0, '#!AMR\n')) return { ext: 'amr', label: 'AMR-NB', playable: true, kind: 'audio' };
  if (b[0] === 0x0b && b[1] === 0x77) {
    const bsid = b.length > 5 ? b[5] >> 3 : 8;
    return bsid > 10
      ? { ext: 'ec3', label: 'E-AC-3 (Dolby Digital Plus)', playable: true, kind: 'audio' }
      : { ext: 'ac3', label: 'AC-3 (Dolby Digital)', playable: true, kind: 'audio' };
  }
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75)
    return { ext: 'wma', label: 'Windows Media (WMA/ASF)', playable: false, kind: 'audio' };
  if (at(b, 0, 'MAC '))
    return { ext: 'ape', label: "Monkey's Audio (APE)", playable: false, kind: 'audio' };
  if (at(b, 0, 'wvpk')) return { ext: 'wv', label: 'WavPack', playable: false, kind: 'audio' };
  if (at(b, 0, 'DSD ')) return { ext: 'dsf', label: 'DSD (DSF)', playable: false, kind: 'audio' };
  if (at(b, 0, 'TTA1'))
    return { ext: 'tta', label: 'True Audio (TTA)', playable: false, kind: 'audio' };
  if (at(b, 0, 'MPCK') || at(b, 0, 'MP+'))
    return { ext: 'mpc', label: 'Musepack', playable: false, kind: 'audio' };
  if (at(b, 0, '.snd')) return { ext: 'au', label: 'Sun/NeXT AU', playable: true, kind: 'audio' };
  if (at(b, 0, 'XMF_'))
    return { ext: 'xmf', label: 'Mobile XMF (MIDI)', playable: false, kind: 'midi' };
  if (at(b, 0, 'MMMD'))
    return { ext: 'mmf', label: 'SMAF ringtone', playable: false, kind: 'midi' };

  const mpeg = mpegFrame(b, 0);
  if (mpeg) return mpeg;

  // not audio at all — useful to say so instead of "can't play"
  if (at(b, 0, '#EXTM3U') || at(b, 0, '[playlist]'))
    return { ext: 'm3u', label: 'Playlist text, not audio', playable: false, kind: 'playlist' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { ext: 'jpg', label: 'JPEG image', playable: false, kind: 'image' };
  if (at(b, 1, 'PNG')) return { ext: 'png', label: 'PNG image', playable: false, kind: 'image' };
  if (at(b, 0, 'GIF8')) return { ext: 'gif', label: 'GIF image', playable: false, kind: 'image' };
  if (at(b, 0, '%PDF'))
    return { ext: 'pdf', label: 'PDF document', playable: false, kind: 'document' };
  if (at(b, 0, 'PK\u0003\u0004'))
    return { ext: 'zip', label: 'ZIP archive', playable: false, kind: 'document' };
  if (at(b, 0, 'Rar!'))
    return { ext: 'rar', label: 'RAR archive', playable: false, kind: 'document' };
  const lead = ascii(b, 0, 16).replace(/^[\s\ufeff\u00ef\u00bb\u00bf]+/, '');
  if (/^<(!doctype|html|\?xml|head|body)/i.test(lead))
    return { ext: 'html', label: 'Web page, not audio', playable: false, kind: 'document' };
  if (/^[{[]/.test(lead))
    return { ext: 'json', label: 'JSON text, not audio', playable: false, kind: 'document' };

  // an iCloud file that was never downloaded / a copy that was cut short: all zeros
  let zeros = 0;
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) if (b[i] === 0) zeros++;
  if (zeros === n) return EMPTY;

  // MP3 without ID3 whose first frame is not at byte 0 (junk / padding in front)
  for (let o = 1; o < Math.min(b.length - 4, 2048); o++) {
    if (b[o] !== 0xff) continue;
    const f = mpegFrame(b, o);
    if (f && f.ext !== 'aac' && mpegFrame(b, o + frameLen(b, o))) return f;
  }
  return undefined;
}

const EMPTY: SniffResult = {
  ext: '',
  label: 'Empty / not downloaded',
  playable: false,
  kind: 'empty',
  note: 'All zeros — an iCloud file that is not downloaded yet, or an interrupted copy',
};

function frameLen(b: Uint8Array, o: number): number {
  const ver = (b[o + 1] >> 3) & 3;
  const layer = (b[o + 1] >> 1) & 3;
  const brIdx = b[o + 2] >> 4;
  const srIdx = (b[o + 2] >> 2) & 3;
  const pad = (b[o + 2] >> 1) & 1;
  const v1 = ver === 3;
  const rates = v1
    ? [44100, 48000, 32000]
    : ver === 2
      ? [22050, 24000, 16000]
      : [11025, 12000, 8000];
  const l3 = v1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const l2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
  const kbps = layer === 2 && v1 ? l2[brIdx] : l3[brIdx];
  const sr = rates[srIdx] || 44100;
  if (layer === 3) return Math.max(4, Math.floor((12 * kbps * 1000) / sr + pad) * 4);
  return Math.max(4, Math.floor(((v1 || layer === 2 ? 144 : 72) * kbps * 1000) / sr) + pad);
}

/** Extensions that name the same container family (no copy needed when they differ) */
const FAMILY: string[][] = [
  ['m4a', 'mp4', 'm4b', 'm4r', 'm4v', 'mov', 'qt', '3gp', '3g2', 'alac', 'm4p'],
  ['mp3', 'mpga', 'mp2', 'mp1', 'mpa'],
  ['aiff', 'aif', 'aifc'],
  ['wav', 'wave', 'bwf'],
  ['mid', 'midi', 'kar', 'smf', 'rmi'],
  ['au', 'snd'],
  ['ac3', 'ec3', 'eac3'],
  ['ogg', 'oga', 'opus', 'spx'],
];
export function sameFamily(a: string, b: string): boolean {
  if (a === b) return true;
  return FAMILY.some((f) => f.includes(a) && f.includes(b));
}

/** Extension for a picker MIME type (when the file name has none) */
export function extForMime(mime?: string | null): string | undefined {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'audio/midi': 'mid',
    'audio/mid': 'mid',
    'audio/x-midi': 'mid',
    'audio/sp-midi': 'mid',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mpeg3': 'mp3',
    'audio/x-mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4b': 'm4b',
    'audio/aac': 'aac',
    'audio/x-aac': 'aac',
    'audio/aacp': 'aac',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/vnd.wave': 'wav',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
    'audio/x-caf': 'caf',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/webm': 'webm',
    'audio/amr': 'amr',
    'audio/3gpp': '3gp',
    'audio/3gpp2': '3g2',
    'audio/ac3': 'ac3',
    'audio/eac3': 'ec3',
    'audio/basic': 'au',
    'audio/x-ms-wma': 'wma',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };
  return map[m];
}

/** What iOS (or the app's MIDI synth) can play by extension — used to list library files */
export const PLAYABLE_EXT =
  /\.(mp3|m4a|aac|flac|wav|aif|aiff|aifc|caf|alac|mp4|m4b|m4r|3gp|amr|ac3|ec3|au|snd|mp2|mid|midi|kar|rmi|smf)$/i;
/** Audio we recognise but iOS cannot decode — skipped on import with a clear reason */
export const UNPLAYABLE_EXT = /\.(ogg|oga|opus|spx|webm|mka|wma|ape|wv|dsf|dff|tta|mpc)$/i;
export const MIDI_EXT = /\.(mid|midi|kar|rmi|smf)$/i;
