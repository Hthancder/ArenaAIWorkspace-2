#!/usr/bin/env python3
"""Build HolySic's compact sample bank (modules/holysic-dsp/ios/SoundBank/holysic-gm.hsb) from GeneralUser GS.

    python3 scripts/soundbank/build_bank.py GeneralUser-GS.sf2 modules/holysic-dsp/ios/SoundBank/holysic-gm.hsb

GeneralUser GS (S. Christian Collins, https://www.schristiancollins.com/generaluser) — free to use,
modify and redistribute in software; see modules/holysic-dsp/ios/SoundBank/LICENSE-GeneralUser-GS.txt.

What this does
  * flattens every preset (preset zone x instrument zone) into self-contained "regions" whose 61
    generators are already summed (preset + instrument + defaults), with the address offsets
    resolved and the SF2 modulator lists merged (defaults overridden per the spec);
  * resamples every sample to <= 22050 Hz (the renderer's rate) with a Kaiser-windowed sinc, nudging
    the rate so loop lengths stay whole samples, and wrapping the kernel around loops;
  * stores the samples as raw 16-bit PCM in one pool (2 guard frames around each sample), so the
    runtime can use it in place — lossless coding only saved ~10% on 22 kHz material.

File layout (little endian):
  'HSBK' u32 version, nSamples, nPresets, nRegions, nMods, poolFrames, sampleRate
  samples  nSamples x { u32 poolOffset, u32 frames, f32 rateHz, u32 reserved }
  presets  nPresets x { u16 bank, u16 program, u32 regionStart, u32 regionCount, char name[24] }
  regions  nRegions x { u8 keyLo, keyHi, velLo, velHi; u16 sample, modCount; u32 modStart;
                        u32 start, end, loopStart, loopEnd (frames, relative to the sample);
                        i16 gens[61]; u8 loopMode, pad }   (152 bytes)
  mods     nMods x { u16 src, u16 dest, i16 amount, u16 amountSrc, u16 transform }
  (pad to 4)  pool i16[poolFrames]

The runtime decoders/renderers are src/services/audio/sf/ (TypeScript) and
modules/holysic-dsp/ios/HSSampleSynth.m (C) — they must stay in step with this format.
Requires numpy.
"""
import struct, sys, math
import numpy as np

OUT_SR = 22050
EMU_ATTEN = 0.4

# ---------------------------------------------------------------- SF2 parsing
def chunks(b, off, end):
    while off < end:
        cid = b[off:off + 4].decode('latin1')
        sz = struct.unpack('<I', b[off + 4:off + 8])[0]
        yield cid, off + 8, sz
        off += 8 + sz + (sz & 1)

def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'RIFF' and b[8:12] == b'sfbk'
    L = {}
    for cid, o, sz in chunks(b, 12, len(b)):
        if cid == 'LIST':
            t = b[o:o + 4].decode()
            for c2, o2, s2 in chunks(b, o + 4, o + sz):
                L[(t, c2)] = (o2, s2)
    o, s = L[('sdta', 'smpl')]
    smpl = np.frombuffer(b, dtype='<i2', count=s // 2, offset=o)

    def recs(name, fmt):
        o, s = L[('pdta', name)]
        n = struct.calcsize(fmt)
        return [struct.unpack(fmt, b[o + i:o + i + n]) for i in range(0, s, n)]

    return dict(
        phdr=recs('phdr', '<20sHHHIII'), pbag=recs('pbag', '<HH'), pmod=recs('pmod', '<HHhHH'),
        pgen=recs('pgen', '<HH'), inst=recs('inst', '<20sH'), ibag=recs('ibag', '<HH'),
        imod=recs('imod', '<HHhHH'), igen=recs('igen', '<HH'),
        shdr=recs('shdr', '<20sIIIIIBbHH'), smpl=smpl)

def s16(v):
    return v - 65536 if v >= 32768 else v

def zone_list(d, bag, gen, mod, a, b):
    out = []
    for i in range(a, b):
        g = {}
        for j in range(d[bag][i][0], d[bag][i + 1][0]):
            op, amt = d[gen][j]
            g[op] = amt
        m = [d[mod][j] for j in range(d[bag][i][1], d[bag][i + 1][1])]
        out.append((g, m))
    return out

# generator defaults (SF2 2.04 §8.1.3)
DEF = [0] * 61
for k in (21, 23, 25, 26, 27, 28, 30, 33, 34, 35, 36, 38):
    DEF[k] = -12000
DEF[8] = 13500
DEF[56] = 100
DEF[58] = -1
NON_ADDITIVE = {0, 1, 2, 3, 4, 12, 45, 50, 41, 43, 44, 46, 47, 53, 54, 57, 58}
RANGE = {43, 44}

DEFAULT_MODS = [
    (0x0502, 48, 960, 0x0, 0),   # velocity -> attenuation (concave, negative)
    (0x0102, 8, -2400, 0x0, 0),  # velocity -> filter cutoff
    (0x00DB, 16, 200, 0x0, 0),   # CC91 -> reverb send
    (0x00DD, 15, 200, 0x0, 0),   # CC93 -> chorus send
]
# CC7/CC10/CC11, pitch wheel and CC1 vibrato are applied by the renderer's channel logic

def mod_key(m):
    src, dst, amt, asrc, tr = m
    if src == 0x0102 and dst == 8:   # both the 2.01 and 2.04 velocity->cutoff forms
        return (src, dst, 0, tr)
    return (src, dst, asrc, tr)

def merge_mods(base, over):
    out = list(base)
    for m in over:
        k = mod_key(m)
        out = [x for x in out if mod_key(x) != k]
        out.append(m)
    return out

def signed_gen(op, raw):
    if op in RANGE:
        return (raw & 0xff, raw >> 8)
    if op in (41, 53):
        return raw
    return s16(raw)

def build_regions(d, pi):
    P = d['phdr']
    pz = zone_list(d, 'pbag', 'pgen', 'pmod', P[pi][3], P[pi + 1][3])
    pglob, pglobm = {}, []
    if pz and 41 not in pz[0][0]:
        pglob, pglobm = pz[0]
        pz = pz[1:]
    regions = []
    for pg, pm in pz:
        if 41 not in pg:
            continue
        pgen = dict(pglob)
        pgen.update(pg)
        pmods = merge_mods(pglobm, pm)
        ii = pgen[41]
        I = d['inst']
        iz = zone_list(d, 'ibag', 'igen', 'imod', I[ii][1], I[ii + 1][1])
        iglob, iglobm = {}, []
        if iz and 53 not in iz[0][0]:
            iglob, iglobm = iz[0]
            iz = iz[1:]
        for ig, im in iz:
            if 53 not in ig:
                continue
            igen = dict(iglob)
            igen.update(ig)
            imods = merge_mods(merge_mods(DEFAULT_MODS, iglobm), im)
            kr = [0, 127]
            vr = [0, 127]
            for src in (igen, pgen):
                if 43 in src:
                    lo, hi = signed_gen(43, src[43])
                    kr = [max(kr[0], lo), min(kr[1], hi)]
                if 44 in src:
                    lo, hi = signed_gen(44, src[44])
                    vr = [max(vr[0], lo), min(vr[1], hi)]
            if kr[0] > kr[1] or vr[0] > vr[1]:
                continue
            g = list(DEF)
            for op, raw in igen.items():
                if op < 61 and op not in RANGE:
                    g[op] = signed_gen(op, raw)
            for op, raw in pgen.items():
                if op < 61 and op not in NON_ADDITIVE:
                    g[op] += signed_gen(op, raw)
            sid = igen[53]
            sh = d['shdr'][sid]
            start = sh[1] + g[0] + 32768 * g[4]
            end = sh[2] + g[1] + 32768 * g[12]
            ls = sh[3] + g[2] + 32768 * g[45]
            le = sh[4] + g[3] + 32768 * g[50]
            root = g[58] if g[58] >= 0 else (sh[6] if sh[6] <= 127 else 60)
            g[58] = root
            g[52] += sh[7]               # sample pitch correction folds into fine tune
            g[48] = int(round(g[48] * EMU_ATTEN))
            mods = [m for m in imods + pmods if m[0] != 0 and m[2] != 0 and m[1] < 61]
            regions.append(dict(kr=kr, vr=vr, sid=sid, g=g, mods=mods,
                                start=start - sh[1], end=end - sh[1],
                                ls=ls - sh[1], le=le - sh[1], mode=g[54] & 3))
    return regions

# ---------------------------------------------------------------- resampling
def kaiser(t, half, beta=8.6):
    x = np.clip(1 - (t / half) ** 2, 0, None)
    return np.i0(beta * np.sqrt(x)) / np.i0(beta)

def resample(src, ratio, n_out, src_at=None):
    """src: float64 input; output n_out samples at positions j/ratio (input samples)."""
    if ratio >= 0.999999:
        return src[:n_out].copy()
    fc = 0.94 * ratio            # cutoff relative to the input rate's Nyquist (0..1)
    half = int(math.ceil(18 / ratio))
    out = np.empty(n_out)
    taps = np.arange(-half + 1, half + 1)
    step = 16384
    padded = np.concatenate([np.zeros(half + 2), src, np.zeros(half + 2)])
    for a in range(0, n_out, step):
        j = np.arange(a, min(n_out, a + step))
        x = j / ratio
        i0 = np.floor(x).astype(np.int64)
        frac = x - i0
        idx = i0[:, None] + taps[None, :]
        t = taps[None, :] - frac[:, None]
        h = fc * np.sinc(fc * t) * kaiser(t, half)
        out[a:a + len(j)] = (padded[idx + half + 2] * h).sum(axis=1)
    return out

def process_sample(d, sid, uses):
    sh = d['shdr'][sid]
    raw = d['smpl'][sh[1]:sh[2]].astype(np.float64)
    sr = sh[5] or 22050
    n = len(raw)
    looped = [u for u in uses if u['mode'] in (1, 3) and 0 <= u['ls'] < u['le'] <= n]
    ratio = 1.0 if sr <= OUT_SR else OUT_SR / sr
    loop_ref = None
    if looped:
        u = looped[0]
        L = u['le'] - u['ls']
        if ratio < 1:
            ratio = max(1, round(L * ratio)) / L
        loop_ref = (u['ls'], u['le'])
    only_loop1 = bool(uses) and all(u['mode'] == 1 for u in uses) and loop_ref is not None
    n_out = max(1, int(math.floor((n - 1) * ratio)) + 1)
    if ratio >= 0.999999:
        out = raw.copy()
    else:
        out = resample(raw, ratio, n_out)
        if loop_ref:
            ls, le = loop_ref
            L = le - ls
            # periodic source for the loop body so the kernel wraps cleanly at the seam
            reps = int(math.ceil(40 / ratio / L)) + 2
            ext = np.concatenate([raw[:le]] + [raw[ls:le]] * reps)
            ls_o, le_o = int(round(ls * ratio)), int(round(le * ratio))
            body = resample(ext, ratio, le_o + int(math.ceil(8)))
            lo = max(0, ls_o - 4)
            out[lo:min(le_o, n_out)] = body[lo:min(le_o, n_out)]
    rate = sr * ratio
    # trim samples that are only ever played as sustained loops
    if only_loop1:
        le_o = int(round(loop_ref[1] * ratio))
        ls_o = int(round(loop_ref[0] * ratio))
        keep = min(len(out), le_o)
        guard = [out[ls_o + k] if ls_o + k < keep else 0.0 for k in range(4)]
        out = np.concatenate([out[:keep], np.array(guard)])
    pcm = np.clip(np.round(out), -32768, 32767).astype(np.int32)
    return pcm, rate, ratio

# ---------------------------------------------------------------- main
def main(src, dst):
    d = load(src)
    P = d['phdr']
    presets = []
    for pi in range(len(P) - 1):
        name = P[pi][0].split(b'\0')[0].decode('latin1')
        presets.append((P[pi][2], P[pi][1], name, build_regions(d, pi)))
    presets.sort(key=lambda p: (p[0], p[1]))
    uses = {}
    for _, _, _, regs in presets:
        for r in regs:
            uses.setdefault(r['sid'], []).append(r)
    sids = sorted(uses)
    sample_meta = []
    streams = []
    pool_off = 0
    for n_done, sid in enumerate(sids):
        pcm, rate, ratio = process_sample(d, sid, uses[sid])
        for r in uses[sid]:
            n = len(pcm)
            r['s'] = min(n - 1, max(0, int(round(r['start'] * ratio))))
            r['e'] = min(n, max(r['s'] + 1, int(round(r['end'] * ratio))))
            r['l0'] = min(n - 1, max(0, int(round(r['ls'] * ratio))))
            r['l1'] = min(n, max(r['l0'] + 1, int(round(r['le'] * ratio))))
        sample_meta.append((pool_off, len(pcm), rate))
        streams.append(pcm)
        pool_off += len(pcm) + 4        # 2 guard frames before and after each sample
        if n_done % 100 == 0:
            print(f'  sample {n_done}/{len(sids)}', file=sys.stderr)
    sidx = {sid: i for i, sid in enumerate(sids)}
    regions = []
    mods = []
    pre = []
    for bank, prog, name, regs in presets:
        pre.append((bank, prog, len(regions), len(regs), name))
        for r in regs:
            regions.append((r, len(mods)))
            mods.extend(r['mods'])
    out = bytearray()
    out += b'HSBK'
    out += struct.pack('<7I', 1, len(sids), len(pre), len(regions), len(mods), pool_off + 2, OUT_SR)
    for po, n, rate in sample_meta:
        out += struct.pack('<IIfI', po + 2, n, rate, 0)
    for bank, prog, rs, rc, name in pre:
        out += struct.pack('<HHII24s', bank, prog, rs, rc, name.encode('latin1')[:23])
    for r, ms in regions:
        out += struct.pack('<4BHHIIIII', r['kr'][0], r['kr'][1], r['vr'][0], r['vr'][1],
                           sidx[r['sid']], len(r['mods']), ms,
                           r['s'], r['e'], r['l0'], r['l1'])
        out += struct.pack('<61h', *[max(-32768, min(32767, int(v))) for v in r['g']])
        out += struct.pack('<BB', r['mode'], 0)   # 152 bytes per region
    for m in mods:
        out += struct.pack('<HHhHH', *m)
    while len(out) % 4:
        out += b'\0'
    pool = np.zeros(pool_off + 2, dtype='<i2')
    for (po, n, _), pcm in zip(sample_meta, streams):
        pool[po + 2:po + 2 + n] = pcm
    out += pool.tobytes()
    open(dst, 'wb').write(bytes(out))
    print(f'{dst}: {len(out)/1e6:.2f} MB  samples={len(sids)} presets={len(pre)} '
          f'regions={len(regions)} mods={len(mods)} pool={pool_off} frames', file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
