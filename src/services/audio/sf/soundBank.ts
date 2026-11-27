// HolySic sample bank (.hsb) — a flattened, 22 kHz copy of GeneralUser GS built by
// scripts/soundbank/build_bank.py. Every preset is a list of self-contained regions (key/velocity
// range, sample window, 61 summed SF2 generators, merged modulators), so the renderer never has to
// walk preset/instrument zones. The C reader in modules/holysic-dsp/ios/HSSampleSynth.m mirrors
// this file — keep the two in step with the build script.

export const GEN_COUNT = 61;
/** sOff of a sample whose pack is not loaded (assembled banks) — the renderers skip it */
export const MISSING_SAMPLE = 0xffffffff;
const REGION_BYTES = 152;
const MOD_BYTES = 10;

export interface BankPreset {
  bank: number;
  program: number;
  name: string;
  regionStart: number;
  regionCount: number;
}

export interface SoundBank {
  sampleRate: number;
  /** all samples back to back, 2 guard frames around each */
  pool: Int16Array;
  /** per sample: pool offset, frame count */
  sOff: Uint32Array;
  sLen: Uint32Array;
  sRate: Float32Array;
  presets: BankPreset[];
  /** bank * 128 + program → preset index */
  byKey: Map<number, number>;
  // regions, struct-of-arrays
  rKey: Uint8Array; // keyLo, keyHi, velLo, velHi × n
  rSample: Uint16Array;
  rModStart: Uint32Array;
  rModCount: Uint16Array;
  rMode: Uint8Array;
  /** start, end, loopStart, loopEnd × n (frames, relative to the sample) */
  rPos: Uint32Array;
  /** GEN_COUNT × n */
  rGen: Int16Array;
  // modulators
  mSrc: Uint16Array;
  mDst: Uint16Array;
  mAmt: Int16Array;
  mAmtSrc: Uint16Array;
  mTrans: Uint16Array;
}

export function parseSoundBank(buf: ArrayBuffer): SoundBank {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'HSBK') throw new Error('Not a HolySic sound bank');
  const u32 = (o: number) => dv.getUint32(o, true);
  if (u32(4) !== 1) throw new Error('Unsupported sound bank version');
  const nS = u32(8);
  const nP = u32(12);
  const nR = u32(16);
  const nM = u32(20);
  const poolFrames = u32(24);
  const sampleRate = u32(28);
  let o = 32;
  const sOff = new Uint32Array(nS);
  const sLen = new Uint32Array(nS);
  const sRate = new Float32Array(nS);
  for (let i = 0; i < nS; i++, o += 16) {
    sOff[i] = u32(o);
    sLen[i] = u32(o + 4);
    sRate[i] = dv.getFloat32(o + 8, true);
  }
  const presets: BankPreset[] = [];
  const byKey = new Map<number, number>();
  for (let i = 0; i < nP; i++, o += 36) {
    let name = '';
    for (let k = 0; k < 24; k++) {
      const c = dv.getUint8(o + 12 + k);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    const p: BankPreset = {
      bank: dv.getUint16(o, true),
      program: dv.getUint16(o + 2, true),
      regionStart: u32(o + 4),
      regionCount: u32(o + 8),
      name,
    };
    if (!byKey.has(p.bank * 128 + p.program)) byKey.set(p.bank * 128 + p.program, presets.length);
    presets.push(p);
  }
  const rKey = new Uint8Array(nR * 4);
  const rSample = new Uint16Array(nR);
  const rModStart = new Uint32Array(nR);
  const rModCount = new Uint16Array(nR);
  const rMode = new Uint8Array(nR);
  const rPos = new Uint32Array(nR * 4);
  const rGen = new Int16Array(nR * GEN_COUNT);
  for (let i = 0; i < nR; i++, o += REGION_BYTES) {
    for (let k = 0; k < 4; k++) rKey[i * 4 + k] = dv.getUint8(o + k);
    rSample[i] = dv.getUint16(o + 4, true);
    rModCount[i] = dv.getUint16(o + 6, true);
    rModStart[i] = u32(o + 8);
    for (let k = 0; k < 4; k++) rPos[i * 4 + k] = u32(o + 12 + k * 4);
    for (let k = 0; k < GEN_COUNT; k++) rGen[i * GEN_COUNT + k] = dv.getInt16(o + 28 + k * 2, true);
    rMode[i] = dv.getUint8(o + 150);
  }
  const mSrc = new Uint16Array(nM);
  const mDst = new Uint16Array(nM);
  const mAmt = new Int16Array(nM);
  const mAmtSrc = new Uint16Array(nM);
  const mTrans = new Uint16Array(nM);
  for (let i = 0; i < nM; i++, o += MOD_BYTES) {
    mSrc[i] = dv.getUint16(o, true);
    mDst[i] = dv.getUint16(o + 2, true);
    mAmt[i] = dv.getInt16(o + 4, true);
    mAmtSrc[i] = dv.getUint16(o + 6, true);
    mTrans[i] = dv.getUint16(o + 8, true);
  }
  o = (o + 3) & ~3;
  const pool = new Int16Array(buf, o, poolFrames);
  return {
    sampleRate,
    pool,
    sOff,
    sLen,
    sRate,
    presets,
    byKey,
    rKey,
    rSample,
    rModStart,
    rModCount,
    rMode,
    rPos,
    rGen,
    mSrc,
    mDst,
    mAmt,
    mAmtSrc,
    mTrans,
  };
}

/**
 * Rebuild a bank from the downloadable pieces (scripts/soundbank/split_bank.py): the index (bank
 * without its pool, magic 'HSBI') plus any number of sample packs ('HSPK'). Samples of packs not
 * given are marked MISSING_SAMPLE. Mirrors HSBankLoadParts in HSSampleSynth.m.
 */
export function assembleBank(index: ArrayBuffer, packs: ArrayBuffer[]): SoundBank {
  const idv = new DataView(index);
  const magic = String.fromCharCode(
    idv.getUint8(0),
    idv.getUint8(1),
    idv.getUint8(2),
    idv.getUint8(3)
  );
  if (magic !== 'HSBI') throw new Error('Not a HolySic bank index');
  const nS = idv.getUint32(8, true);
  const head = (index.byteLength + 3) & ~3;
  let frames = 2;
  const metas: { dv: DataView; count: number }[] = [];
  for (const p of packs) {
    const dv = new DataView(p);
    if (dv.getUint32(0, true) !== 0x4b505348 || dv.getUint32(4, true) !== 1)
      throw new Error('Not a HolySic sample pack');
    metas.push({ dv, count: dv.getUint32(8, true) });
    frames += dv.getUint32(12, true);
  }
  const out = new ArrayBuffer(head + frames * 2);
  const bytes = new Uint8Array(out);
  bytes.set(new Uint8Array(index), 0);
  bytes[0] = 0x48; // 'HSBK'
  bytes[1] = 0x53;
  bytes[2] = 0x42;
  bytes[3] = 0x4b;
  const odv = new DataView(out);
  odv.setUint32(24, frames, true);
  for (let i = 0; i < nS; i++) odv.setUint32(32 + i * 16, MISSING_SAMPLE, true);
  const pool = new Int16Array(out, head, frames);
  let cur = 0;
  for (const { dv, count } of metas) {
    let data = 16 + count * 8;
    for (let k = 0; k < count; k++) {
      const sid = dv.getUint32(16 + k * 8, true);
      const n = dv.getUint32(20 + k * 8, true);
      if (sid < nS) odv.setUint32(32 + sid * 16, cur + 2, true);
      pool.set(new Int16Array(dv.buffer, dv.byteOffset + data, n), cur);
      data += n * 2;
      cur += n;
    }
  }
  return parseSoundBank(out);
}
