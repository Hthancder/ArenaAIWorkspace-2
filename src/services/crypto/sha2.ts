// SHA-256, SHA-512 and HMAC-SHA512 in plain TypeScript (hex out), like scrobble/md5.ts: the app
// has no crypto module on iOS and the inputs here are tiny (Zing MP3 request signatures), so a
// small dependency-free version is enough. SHA-512 works on 32-bit halves (no BigInt needed).

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const hex = (bytes: number[]) => bytes.map((b) => (b & 255).toString(16).padStart(2, '0')).join('');

// ── SHA-256 ──

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Bytes(msg: number[]): number[] {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = msg.slice();
  const bitLen = msg.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length (inputs here are far below 2^32 bits)
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  const out: number[] = [];
  for (const x of h) out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255);
  return out;
}

export const sha256Hex = (s: string): string => hex(sha256Bytes(utf8(s)));

// ── SHA-512 (64-bit words as [hi, lo] 32-bit pairs) ──

const K512 = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
];

function sha512Bytes(msg: number[]): number[] {
  const h = [
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
  ];
  const bytes = msg.slice();
  const bitLen = msg.length * 8;
  bytes.push(0x80);
  while (bytes.length % 128 !== 112) bytes.push(0);
  // 128-bit big-endian length
  for (let i = 0; i < 12; i++) bytes.push(0);
  bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

  const W = new Array<number>(160);
  // 64-bit helpers on (hi, lo)
  const add = (...xs: number[]): [number, number] => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < xs.length; i += 2) {
      lo += xs[i + 1] >>> 0;
      hi += xs[i] >>> 0;
    }
    hi += Math.floor(lo / 0x100000000);
    return [hi >>> 0, lo >>> 0];
  };
  // rotate right by n (n < 32) / (n >= 32)
  const rotr = (hi: number, lo: number, n: number): [number, number] =>
    n < 32
      ? [(hi >>> n) | (lo << (32 - n)), (lo >>> n) | (hi << (32 - n))]
      : [(lo >>> (n - 32)) | (hi << (64 - n)), (hi >>> (n - 32)) | (lo << (64 - n))];
  const shr = (hi: number, lo: number, n: number): [number, number] =>
    n < 32 ? [hi >>> n, (lo >>> n) | (hi << (32 - n))] : [0, hi >>> (n - 32)];
  const xor3 = (a: [number, number], b: [number, number], c: [number, number]) =>
    [a[0] ^ b[0] ^ c[0], a[1] ^ b[1] ^ c[1]] as [number, number];

  for (let off = 0; off < bytes.length; off += 128) {
    for (let i = 0; i < 32; i++) {
      const j = off + i * 4;
      W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 80; i++) {
      const xh = W[(i - 15) * 2];
      const xl = W[(i - 15) * 2 + 1];
      const s0 = xor3(rotr(xh, xl, 1), rotr(xh, xl, 8), shr(xh, xl, 7));
      const yh = W[(i - 2) * 2];
      const yl = W[(i - 2) * 2 + 1];
      const s1 = xor3(rotr(yh, yl, 19), rotr(yh, yl, 61), shr(yh, yl, 6));
      const r = add(
        W[(i - 16) * 2],
        W[(i - 16) * 2 + 1],
        s0[0],
        s0[1],
        W[(i - 7) * 2],
        W[(i - 7) * 2 + 1],
        s1[0],
        s1[1]
      );
      W[i * 2] = r[0];
      W[i * 2 + 1] = r[1];
    }
    let ah = h[0],
      al = h[1],
      bh = h[2],
      bl = h[3],
      ch = h[4],
      cl = h[5],
      dh = h[6],
      dl = h[7],
      eh = h[8],
      el = h[9],
      fh = h[10],
      fl = h[11],
      gh = h[12],
      gl = h[13],
      hh = h[14],
      hl = h[15];
    for (let i = 0; i < 80; i++) {
      const S1 = xor3(rotr(eh, el, 14), rotr(eh, el, 18), rotr(eh, el, 41));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1 = add(
        hh,
        hl,
        S1[0],
        S1[1],
        chh,
        chl,
        K512[i * 2],
        K512[i * 2 + 1],
        W[i * 2],
        W[i * 2 + 1]
      );
      const S0 = xor3(rotr(ah, al, 28), rotr(ah, al, 34), rotr(ah, al, 39));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2 = add(S0[0], S0[1], majh, majl);
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      [eh, el] = add(dh, dl, t1[0], t1[1]);
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      [ah, al] = add(t1[0], t1[1], t2[0], t2[1]);
    }
    const st = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const r = add(h[i], h[i + 1], st[i], st[i + 1]);
      h[i] = r[0];
      h[i + 1] = r[1];
    }
  }
  const out: number[] = [];
  for (const x of h) out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255);
  return out;
}

export const sha512Hex = (s: string): string => hex(sha512Bytes(utf8(s)));

/** HMAC-SHA512(key, message) as hex */
export function hmacSha512Hex(key: string, message: string): string {
  const block = 128;
  let k = utf8(key);
  if (k.length > block) k = sha512Bytes(k);
  while (k.length < block) k.push(0);
  const inner = sha512Bytes([...k.map((b) => b ^ 0x36), ...utf8(message)]);
  return hex(sha512Bytes([...k.map((b) => b ^ 0x5c), ...inner]));
}
