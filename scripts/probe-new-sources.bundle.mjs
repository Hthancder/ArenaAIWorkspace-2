// scripts/probe-stubs/react-native.js
var Platform = { OS: "ios", select: (o) => o.ios ?? o.default };

// src/services/crypto/sha2.ts
function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 55296 && c < 56320 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d < 57344) {
        c = 65536 + (c - 55296 << 10) + (d - 56320);
        i++;
      }
    }
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else
      out.push(
        240 | c >> 18,
        128 | c >> 12 & 63,
        128 | c >> 6 & 63,
        128 | c & 63
      );
  }
  return out;
}
var hex = (bytes) => bytes.map((b) => (b & 255).toString(16).padStart(2, "0")).join("");
var K256 = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function sha256Bytes(msg) {
  const h = [
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ];
  const bytes = msg.slice();
  const bitLen = msg.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0);
  bytes.push(bitLen >>> 24 & 255, bitLen >>> 16 & 255, bitLen >>> 8 & 255, bitLen & 255);
  const w = new Array(64);
  const rotr = (x, n) => x >>> n | x << 32 - n;
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
    }
    let [a, b, c, d, e, f, g2, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g2;
      const t1 = hh + S1 + ch + K256[i] + w[i] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      hh = g2;
      g2 = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h[0] = h[0] + a | 0;
    h[1] = h[1] + b | 0;
    h[2] = h[2] + c | 0;
    h[3] = h[3] + d | 0;
    h[4] = h[4] + e | 0;
    h[5] = h[5] + f | 0;
    h[6] = h[6] + g2 | 0;
    h[7] = h[7] + hh | 0;
  }
  const out = [];
  for (const x of h) out.push(x >>> 24 & 255, x >>> 16 & 255, x >>> 8 & 255, x & 255);
  return out;
}
var sha256Hex = (s) => hex(sha256Bytes(utf8(s)));
var K512 = [
  1116352408,
  3609767458,
  1899447441,
  602891725,
  3049323471,
  3964484399,
  3921009573,
  2173295548,
  961987163,
  4081628472,
  1508970993,
  3053834265,
  2453635748,
  2937671579,
  2870763221,
  3664609560,
  3624381080,
  2734883394,
  310598401,
  1164996542,
  607225278,
  1323610764,
  1426881987,
  3590304994,
  1925078388,
  4068182383,
  2162078206,
  991336113,
  2614888103,
  633803317,
  3248222580,
  3479774868,
  3835390401,
  2666613458,
  4022224774,
  944711139,
  264347078,
  2341262773,
  604807628,
  2007800933,
  770255983,
  1495990901,
  1249150122,
  1856431235,
  1555081692,
  3175218132,
  1996064986,
  2198950837,
  2554220882,
  3999719339,
  2821834349,
  766784016,
  2952996808,
  2566594879,
  3210313671,
  3203337956,
  3336571891,
  1034457026,
  3584528711,
  2466948901,
  113926993,
  3758326383,
  338241895,
  168717936,
  666307205,
  1188179964,
  773529912,
  1546045734,
  1294757372,
  1522805485,
  1396182291,
  2643833823,
  1695183700,
  2343527390,
  1986661051,
  1014477480,
  2177026350,
  1206759142,
  2456956037,
  344077627,
  2730485921,
  1290863460,
  2820302411,
  3158454273,
  3259730800,
  3505952657,
  3345764771,
  106217008,
  3516065817,
  3606008344,
  3600352804,
  1432725776,
  4094571909,
  1467031594,
  275423344,
  851169720,
  430227734,
  3100823752,
  506948616,
  1363258195,
  659060556,
  3750685593,
  883997877,
  3785050280,
  958139571,
  3318307427,
  1322822218,
  3812723403,
  1537002063,
  2003034995,
  1747873779,
  3602036899,
  1955562222,
  1575990012,
  2024104815,
  1125592928,
  2227730452,
  2716904306,
  2361852424,
  442776044,
  2428436474,
  593698344,
  2756734187,
  3733110249,
  3204031479,
  2999351573,
  3329325298,
  3815920427,
  3391569614,
  3928383900,
  3515267271,
  566280711,
  3940187606,
  3454069534,
  4118630271,
  4000239992,
  116418474,
  1914138554,
  174292421,
  2731055270,
  289380356,
  3203993006,
  460393269,
  320620315,
  685471733,
  587496836,
  852142971,
  1086792851,
  1017036298,
  365543100,
  1126000580,
  2618297676,
  1288033470,
  3409855158,
  1501505948,
  4234509866,
  1607167915,
  987167468,
  1816402316,
  1246189591
];
function sha512Bytes(msg) {
  const h = [
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ];
  const bytes = msg.slice();
  const bitLen = msg.length * 8;
  bytes.push(128);
  while (bytes.length % 128 !== 112) bytes.push(0);
  for (let i = 0; i < 12; i++) bytes.push(0);
  bytes.push(bitLen >>> 24 & 255, bitLen >>> 16 & 255, bitLen >>> 8 & 255, bitLen & 255);
  const W = new Array(160);
  const add = (...xs) => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < xs.length; i += 2) {
      lo += xs[i + 1] >>> 0;
      hi += xs[i] >>> 0;
    }
    hi += Math.floor(lo / 4294967296);
    return [hi >>> 0, lo >>> 0];
  };
  const rotr = (hi, lo, n) => n < 32 ? [hi >>> n | lo << 32 - n, lo >>> n | hi << 32 - n] : [lo >>> n - 32 | hi << 64 - n, hi >>> n - 32 | lo << 64 - n];
  const shr = (hi, lo, n) => n < 32 ? [hi >>> n, lo >>> n | hi << 32 - n] : [0, hi >>> n - 32];
  const xor3 = (a, b, c) => [a[0] ^ b[0] ^ c[0], a[1] ^ b[1] ^ c[1]];
  for (let off = 0; off < bytes.length; off += 128) {
    for (let i = 0; i < 32; i++) {
      const j = off + i * 4;
      W[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3];
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
    let ah = h[0], al = h[1], bh = h[2], bl = h[3], ch = h[4], cl = h[5], dh = h[6], dl = h[7], eh = h[8], el = h[9], fh = h[10], fl = h[11], gh = h[12], gl = h[13], hh = h[14], hl = h[15];
    for (let i = 0; i < 80; i++) {
      const S1 = xor3(rotr(eh, el, 14), rotr(eh, el, 18), rotr(eh, el, 41));
      const chh = eh & fh ^ ~eh & gh;
      const chl = el & fl ^ ~el & gl;
      const t1 = add(hh, hl, S1[0], S1[1], chh, chl, K512[i * 2], K512[i * 2 + 1], W[i * 2], W[i * 2 + 1]);
      const S0 = xor3(rotr(ah, al, 28), rotr(ah, al, 34), rotr(ah, al, 39));
      const majh = ah & bh ^ ah & ch ^ bh & ch;
      const majl = al & bl ^ al & cl ^ bl & cl;
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
  const out = [];
  for (const x of h) out.push(x >>> 24 & 255, x >>> 16 & 255, x >>> 8 & 255, x & 255);
  return out;
}
function hmacSha512Hex(key, message) {
  const block = 128;
  let k = utf8(key);
  if (k.length > block) k = sha512Bytes(k);
  while (k.length < block) k.push(0);
  const inner = sha512Bytes([...k.map((b) => b ^ 54), ...utf8(message)]);
  return hex(sha512Bytes([...k.map((b) => b ^ 92), ...inner]));
}

// src/services/trackMatcher.ts
var VERSION_WORDS = [
  "remix",
  "live",
  "acoustic",
  "instrumental",
  "karaoke",
  "sped up",
  "slowed",
  "nightcore",
  "demo",
  "cover",
  "edit",
  "mix",
  "version",
  "unplugged",
  "orchestral",
  "piano"
];
var VERSION_PATTERNS = VERSION_WORDS.map(
  (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
);
function words(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0 && w !== "the" && w !== "and");
}
function coreTitle(title) {
  let t = title.toLowerCase();
  t = t.replace(/[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi, " ");
  t = t.replace(
    /\s[-–]\s.*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv)\b.*$/gi,
    " "
  );
  t = t.replace(
    /[([][^)\]]*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv|explicit|clean)\b[^)\]]*[)\]]/gi,
    " "
  );
  t = t.replace(/\b(?:feat|ft)\.?\s.*$/gi, " ");
  return words(t).join(" ");
}
function similarity(a, b) {
  if (a === b) return 1;
  const wa = new Set(a.split(" ").filter(Boolean));
  const wb = new Set(b.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  wa.forEach((w) => {
    if (wb.has(w)) inter++;
  });
  const union = (/* @__PURE__ */ new Set([...wa, ...wb])).size;
  return union === 0 ? 0 : inter / union;
}
function scoreTrackMatch(query, song) {
  if (query.isrc && song.isrc && query.isrc.toLowerCase() === song.isrc.toLowerCase()) {
    return 1;
  }
  const qTitle = coreTitle(query.title);
  const sTitle = coreTitle(song.title);
  const titleScore = similarity(qTitle, sTitle);
  if (titleScore < 0.52) return 0;
  const songArtistWords = new Set(words(song.artist));
  let artistScore = 0;
  for (const a of query.artists) {
    const w = words(a);
    if (w.length === 0) continue;
    const hit = w.filter((tok) => songArtistWords.has(tok)).length / w.length;
    if (hit > artistScore) artistScore = hit;
  }
  if (artistScore < 0.45) return 0;
  let durationScore = 0.65;
  if (query.durationSec && song.durationSec && query.durationSec > 40 && song.durationSec > 40) {
    const diff = Math.abs(query.durationSec - song.durationSec);
    if (diff <= 2.5) durationScore = 1;
    else if (diff >= 18) durationScore = 0.1;
    else durationScore = 1 - (diff - 2.5) / 17.5;
  }
  const qRaw = query.title.toLowerCase();
  const sRaw = song.title.toLowerCase();
  let mismatchCount = 0;
  for (const pat of VERSION_PATTERNS) {
    if (pat.test(qRaw) !== pat.test(sRaw)) {
      mismatchCount++;
    }
  }
  const penalty = 0.25 * mismatchCount;
  return Math.max(
    0,
    Math.min(1, 0.5 * titleScore + 0.3 * artistScore + 0.2 * durationScore - penalty)
  );
}
function rankCandidates(query, candidates, minScore = 0.66) {
  return candidates.map((track) => ({ track, score: scoreTrackMatch(query, track) })).filter((item) => item.score >= minScore).sort((a, b) => b.score - a.score);
}

// src/services/providers/zingProvider.ts
var DOMAIN = "https://zingmp3.vn";
var API_KEY = "X5BM3w8N7MKozC0B85o4KMlzLZKhV00y";
var SECRET_KEY = "acOrvUS15XRW2o9JksiK1KgQ6Vbds8ZW";
var VERSION = "1.22.4";
var VN_IP = "118.69.135.1";
var SIGNED_PARAMS = ["count", "ctime", "id", "page", "type", "version"];
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var FALLBACK_COOKIE = "zmp3_app_version.1=1224; zmp3_rqid=MHwxMTgdUngNjkdUngMTM1LjF8djEdUngMjIdUngNHwxNzk0MTAzNTmUsIC2MjQw";
var g = globalThis;
var native = () => Platform.OS !== "web" || !!g.__HS_NODE_PROBE__;
function zingApiUrl(path, params) {
  const all = {};
  for (const [k, v] of Object.entries(params)) all[k] = String(v);
  all.ctime = String(Math.floor(Date.now() / 1e3));
  all.version = VERSION;
  const signed = Object.keys(all).filter((k) => SIGNED_PARAMS.includes(k) && all[k] !== "").sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join("");
  all.sig = hmacSha512Hex(SECRET_KEY, path + sha256Hex(signed));
  all.apiKey = API_KEY;
  const qs = Object.entries(all).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${DOMAIN}${path}?${qs}`;
}
async function http(url, headers, withJar, timeoutMs = 8e3) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      // the native cookie jar keeps zingmp3.vn's session cookies between calls
      credentials: withJar ? "include" : "omit",
      headers: { "User-Agent": UA, "X-Forwarded-For": VN_IP, ...headers }
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
var session = null;
var sessionTask = null;
function ensureSession(force = false) {
  if (!force && session && Date.now() - session.at < 30 * 6e4) return Promise.resolve();
  if (!sessionTask) {
    sessionTask = (async () => {
      const res = await http(DOMAIN, { Accept: "text/html" }, true);
      const raw = res?.headers.get("set-cookie") || "";
      const cookie = raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
      session = { cookie, at: Date.now() };
    })().finally(() => {
      sessionTask = null;
    });
  }
  return sessionTask;
}
async function zingCall(path, params = {}) {
  if (!native()) return null;
  await ensureSession();
  const once = async (manualCookie) => {
    const res = await http(
      zingApiUrl(path, params),
      {
        Accept: "application/json",
        Referer: `${DOMAIN}/`,
        ...manualCookie ? { Cookie: manualCookie } : {}
      },
      !manualCookie
    );
    if (!res || !res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  };
  let body = await once(session?.cookie || "");
  if (!body || body.err === -201 || body.err === -403 || body.err === -102) {
    await ensureSession(true);
    body = await once(session?.cookie || "") || body;
    if (!body || body.err === -201 || body.err === -403 || body.err === -102)
      body = await once(FALLBACK_COOKIE) || body;
  }
  return body;
}
var bigCover = (u) => u ? u.replace(/\/w\d+_r1x1_(jpeg|webp|jpg)\//, "/w600_r1x1_jpeg/") : "";
var toTrack = (s) => {
  const artists = (s.artists || []).map((a) => String(a?.name || "").trim()).filter(Boolean);
  const artist = artists.length ? artists.join(", ") : String(s.artistsNames || "Zing MP3");
  return {
    id: `zing-${s.encodeId}`,
    title: String(s.title).trim(),
    artist,
    artists: artists.length ? artists : [artist],
    album: s.album?.title || void 0,
    artworkUrl: bigCover(s.thumbnailM || s.thumbnail),
    durationSec: Number(s.duration) || 0,
    source: "zing",
    qualityBadge: "MP3 \xB7 Zing MP3",
    releaseYear: s.releaseDate ? new Date(s.releaseDate * 1e3).getFullYear() : void 0
  };
};
var playable = (s) => !!s?.encodeId && !!s?.title && s.streamingStatus !== 2;
async function searchSongs(q, count) {
  const r = await zingCall("/api/v2/search", {
    q,
    type: "song",
    page: 1,
    count: Math.min(30, Math.max(5, count))
  });
  let items = r?.err === 0 && Array.isArray(r.data?.items) ? r.data.items : [];
  if (!items.length) {
    const m2 = await zingCall("/api/v2/search/multi", { q });
    items = m2?.err === 0 && Array.isArray(m2.data?.songs) ? m2.data.songs : [];
  }
  return items.filter(playable);
}
async function searchZingTracks(q, limit = 20) {
  const query = q.trim();
  if (!query || !native()) return [];
  const songs = await searchSongs(query, limit).catch(() => []);
  return songs.slice(0, limit).map(toTrack);
}
async function zingStream(id) {
  const r = await zingCall("/api/v2/song/get/streaming", { id });
  if (!r) return { s: null, msg: "No answer from zingmp3.vn" };
  if (r.err !== 0 || !r.data) return { s: null, err: r.err, msg: r.msg };
  const ok = (u) => typeof u === "string" && /^https?:\/\//.test(u);
  const u320 = r.data["320"];
  const u128 = r.data["128"];
  if (ok(u320)) return { s: { url: u320, qualityLabel: "MP3 320 kbps" } };
  if (ok(u128)) return { s: { url: u128, qualityLabel: "MP3 128 kbps" } };
  return { s: null, err: r.err, msg: "VIP only" };
}
var why = (err, msg) => err === -1150 || msg === "VIP only" ? "Zing keeps this song for VIP accounts" : err === -1110 || /quốc gia|country|region/i.test(msg || "") ? "Not available in this region (Zing serves Vietnam)" : msg || (err != null ? `Zing error ${err}` : "No stream");
async function resolveZingStream(query, pushStep) {
  const t0 = Date.now();
  if (!native()) {
    pushStep({ module: "Zing MP3", step: "Catalog match", ok: null, detail: "iOS app only" });
    return [];
  }
  const songs = await searchSongs(`${query.title} ${query.artists[0] || ""}`.trim(), 10).catch(
    () => []
  );
  const ranked = rankCandidates(
    query,
    songs.map((s) => ({
      id: s.encodeId,
      title: s.title,
      artist: s.artistsNames || (s.artists || []).map((a) => a?.name).join(", "),
      durationSec: Number(s.duration) || void 0,
      song: s
    })),
    0.72
  );
  let found = null;
  let last = {};
  for (const { track } of ranked.slice(0, 2)) {
    if (query.durationSec && track.durationSec && query.durationSec > 40 && Math.abs(query.durationSec - track.durationSec) > 6)
      continue;
    const r = await zingStream(track.id);
    if (r.s) {
      found = { s: { ...r.s, durationSec: track.durationSec }, title: track.title };
      break;
    }
    last = r;
  }
  pushStep({
    module: "Zing MP3",
    step: "Catalog match",
    ok: !!found,
    detail: found ? `${found.title} \xB7 ${found.s.qualityLabel}` : ranked.length ? why(last.err, last.msg) : songs.length ? "No matching song (title / artist / length)" : "No result",
    latencyMs: Date.now() - t0
  });
  return found ? [found.s] : [];
}
async function fetchZingLink(url) {
  if (!native()) return null;
  const m2 = url.match(/zing(?:mp3)?\.vn\/(bai-hat|album|playlist|embed\/song)\/(?:[^/?#]+\/)?([A-Z0-9]{6,12})(?:\.html)?/i);
  if (!m2) return null;
  const kind = m2[1].toLowerCase();
  const id = m2[2];
  if (kind === "bai-hat" || kind === "embed/song") {
    const r2 = await zingCall("/api/v2/page/get/song", { id });
    const s = r2?.err === 0 ? r2.data : null;
    if (!s?.encodeId || !s.title) return null;
    const t = toTrack(s);
    return { name: t.title, coverUrl: t.artworkUrl, tracks: [t], single: true };
  }
  const r = await zingCall(
    "/api/v2/page/get/playlist",
    { id }
  );
  const p = r?.err === 0 ? r.data : null;
  const items = (p?.song?.items || []).filter((s) => s?.encodeId && s.title);
  if (!p || !items.length) return null;
  return {
    name: p.title || "Zing MP3",
    coverUrl: bigCover(p.thumbnailM),
    // VIP-only songs stay in the list: they play through the other sources
    tracks: items.map(toTrack),
    single: false
  };
}
async function zingLyricsById(id) {
  const r = await zingCall("/api/v2/lyric/get/lyric", { id });
  if (!r || r.err !== 0 || !r.data) return null;
  const sentences = Array.isArray(r.data.sentences) ? r.data.sentences : [];
  const lines = [];
  sentences.forEach((sen, i) => {
    const words2 = (sen.words || []).filter((w) => typeof w?.data === "string" && w.data.trim() && Number.isFinite(w.startTime)).map((w) => ({
      text: String(w.data).trim(),
      startSec: Number(w.startTime) / 1e3,
      endSec: Math.max(Number(w.startTime), Number(w.endTime) || 0) / 1e3
    }));
    if (!words2.length) return;
    lines.push({
      id: `zing-${i}`,
      startSec: words2[0].startSec,
      endSec: words2[words2.length - 1].endSec,
      text: words2.map((w) => w.text).join(" "),
      words: words2
    });
  });
  if (lines.length) return { lines, wordSynced: true };
  if (typeof r.data.file === "string" && /^https?:/.test(r.data.file)) {
    const res = await http(r.data.file, {}, false).catch(() => null);
    const lrc = res && res.ok ? await res.text() : "";
    if (lrc.trim()) return { lines: [], wordSynced: false, lrc };
  }
  return null;
}

// scripts/probe-stubs/async-storage.js
var m = /* @__PURE__ */ new Map();
var AsyncStorage = {
  getItem: async (k) => m.has(k) ? m.get(k) : null,
  setItem: async (k, v) => void m.set(k, v),
  removeItem: async (k) => void m.delete(k)
};
var async_storage_default = AsyncStorage;

// src/services/providers/invidiousProvider.ts
var INVIDIOUS_FALLBACK = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
  "https://invidious.f5.si"
];
var DIRECTORY = "https://api.invidious.io/instances.json?sort_by=health";
var CACHE_KEY = "@holysic/invidious_instances_v1";
var DAY = 24 * 3600 * 1e3;
var discovered = null;
var discoveredAt = 0;
var lastGood = null;
var loading = null;
async function getJson(url, ms = 5e3) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
function parseDirectory(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => Array.isArray(row) ? row[1] : null).filter((i) => i && i.type === "https" && i.api === true && typeof i.uri === "string").filter((i) => Platform.OS !== "web" || i.cors !== false).map((i) => String(i.uri).replace(/\/+$/, "")).slice(0, 8);
}
function loadDirectory() {
  if (discovered && Date.now() - discoveredAt < DAY) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        if (!discovered) {
          const raw = await async_storage_default.getItem(CACHE_KEY).catch(() => null);
          const saved = raw ? JSON.parse(raw) : null;
          if (saved?.list?.length) {
            discovered = saved.list;
            discoveredAt = saved.at || 0;
            lastGood = saved.lastGood || null;
          }
        }
        if (!discovered || Date.now() - discoveredAt > DAY) {
          const list = parseDirectory(await getJson(DIRECTORY, 6e3));
          if (list.length) {
            discovered = list;
            discoveredAt = Date.now();
            save();
          }
        }
      } catch {
      }
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}
function save() {
  async_storage_default.setItem(
    CACHE_KEY,
    JSON.stringify({ list: discovered || [], at: discoveredAt, lastGood })
  ).catch(() => {
  });
}
async function invidiousInstances() {
  await Promise.race([loadDirectory(), new Promise((r) => setTimeout(r, 1500))]);
  const all = [...lastGood ? [lastGood] : [], ...INVIDIOUS_FALLBACK, ...discovered || []];
  return [...new Set(all)].slice(0, 7);
}
function markInvidiousGood(base) {
  if (lastGood === base) return;
  lastGood = base;
  save();
}
var invidiousAbs = (base, u) => u.startsWith("http") ? u : base + u;
async function searchInvidiousVideos(q, limit = 12) {
  const query = q.trim();
  if (!query) return [];
  for (const base of await invidiousInstances()) {
    const list = await getJson(
      `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
      5e3
    );
    if (!Array.isArray(list)) continue;
    markInvidiousGood(base);
    return list.filter((v) => v?.type === "video" && v.videoId && v.title).slice(0, limit).map((v) => {
      const thumbs = Array.isArray(v.videoThumbnails) ? v.videoThumbnails : [];
      const th = thumbs.find((x) => x?.quality === "high") || thumbs.find((x) => x?.quality === "medium") || thumbs[0];
      return {
        videoId: String(v.videoId),
        title: String(v.title),
        author: String(v.author || ""),
        lengthSeconds: Number(v.lengthSeconds) || 0,
        thumbnail: th?.url ? invidiousAbs(base, String(th.url)) : void 0
      };
    });
  }
  return [];
}
async function serves(url, clen) {
  const at = clen && clen > 1 ? Math.min(clen - 1, 1048576) : 1048576;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5e3);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Range: `bytes=${at}-${at}` } });
    return res.status === 206 || res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
async function invidiousAudio(videoId) {
  for (const base of await invidiousInstances()) {
    const data = await getJson(`${base}/api/v1/videos/${videoId}?local=true`, 6e3);
    const fmts = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [];
    const audio = fmts.filter((f) => f?.url && /^audio\//.test(String(f.type || ""))).sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    const m4a = audio.filter((f) => /audio\/mp4/.test(String(f.type)));
    const picks = Platform.OS === "web" ? [...m4a, ...audio] : m4a;
    for (const f of picks.slice(0, 2)) {
      const url = invidiousAbs(base, String(f.url));
      if (!await serves(url, Number(f.clen) || void 0)) continue;
      markInvidiousGood(base);
      const kbps = Math.round((Number(f.bitrate) || 128e3) / 1e3);
      const aac = /mp4/.test(String(f.type));
      return {
        url,
        qualityLabel: `${aac ? "AAC" : "Opus"} ${kbps} kbps \xB7 Invidious`,
        codec: aac ? "AAC" : "Opus",
        instance: base.replace(/^https?:\/\//, "")
      };
    }
  }
  return null;
}
var cleanAuthor = (a) => a.replace(/\s*-\s*Topic$/i, "").replace(/\s*(VEVO|Official( Channel)?)$/i, "").trim();
function videoCandidates(h) {
  const author = cleanAuthor(h.author);
  const parts = h.title.split(/\s+[-–—]\s+|\s*[|｜]\s*/).map((p) => p.trim()).filter(Boolean);
  const titles = parts.length > 1 ? [h.title, ...parts] : [h.title];
  return titles.map((title, i) => ({
    id: `${h.videoId}#${i}`,
    vid: h.videoId,
    title,
    artist: [author, ...parts.filter((p) => p !== title)].join(" "),
    durationSec: h.lengthSeconds || void 0
  }));
}
async function resolveInvidiousStream(query, pushStep) {
  const t0 = Date.now();
  let videoId = query.videoId;
  if (!videoId) {
    const hits = await searchInvidiousVideos(
      `${query.artists[0] || ""} ${coreTitle(query.title)} audio`.trim(),
      8
    );
    const ranked = rankCandidates(query, hits.flatMap(videoCandidates), 0.6);
    videoId = ranked[0]?.track.vid;
    if (!videoId) {
      pushStep({
        module: "Invidious",
        step: "YouTube lookup",
        ok: false,
        detail: hits.length ? "No matching video" : "No instance answered",
        latencyMs: Date.now() - t0
      });
      return [];
    }
  }
  const s = await invidiousAudio(videoId).catch(() => null);
  pushStep({
    module: "Invidious",
    step: "Audio stream",
    ok: !!s,
    detail: s ? `${s.qualityLabel} \xB7 ${s.instance}` : "No instance served the audio",
    latencyMs: Date.now() - t0
  });
  return s ? [s] : [];
}

// scripts/probe-new-sources.ts
globalThis.__HS_NODE_PROBE__ = true;
var log = (...a) => console.log(...a);
var short = (s, n = 160) => String(JSON.stringify(s)).slice(0, n);
async function rangeProbe(url, at = 1048576) {
  try {
    const r = await fetch(url, { headers: { Range: `bytes=${at}-${at + 1}` } });
    return `${r.status} ctype=${r.headers.get("content-type")} len=${r.headers.get("content-range")}`;
  } catch (e) {
    return `ERR ${e?.cause?.code || e?.message}`;
  }
}
async function zing() {
  log("\n=== Zing MP3 ===");
  const raw = await zingCall("/api/v2/search", { q: "Ch\xFAng Ta C\u1EE7a Hi\u1EC7n T\u1EA1i", type: "song", page: 1, count: 5 });
  log("search raw err=", raw?.err, "msg=", raw?.msg, "items=", raw?.data?.items?.length);
  const multi = await zingCall("/api/v2/search/multi", { q: "S\u01A1n T\xF9ng" });
  log("multi err=", multi?.err, "msg=", multi?.msg, "songs=", multi?.data?.songs?.length);
  for (const q of ["Ch\xFAng Ta C\u1EE7a Hi\u1EC7n T\u1EA1i S\u01A1n T\xF9ng", "B\u1EA3o Thy Xa M\xE3i Xa", "Ed Sheeran Shape of You"]) {
    const list = await searchZingTracks(q, 5);
    log(`searchZingTracks("${q}") ->`, list.length, list.slice(0, 3).map((t) => `${t.id} ${t.title} \u2014 ${t.artist} ${t.durationSec}s`).join(" | "));
    if (list[0]) log("   art", list[0].artworkUrl);
    const id = list[0]?.id.slice(5);
    if (id) {
      const st = await zingStream(id);
      log("   stream", st.s ? `${st.s.qualityLabel} ${st.s.url.slice(0, 90)}` : `none err=${st.err} msg=${st.msg}`);
      if (st.s) log("   range", await rangeProbe(st.s.url));
      const ly2 = await zingLyricsById(id);
      log("   lyrics", ly2 ? `lines=${ly2.lines.length} word=${ly2.wordSynced} first=${short(ly2.lines[0]?.text, 80)} words0=${short(ly2.lines[0]?.words?.slice(0, 3), 160)} lrc=${!!ly2.lrc}` : "none");
    }
  }
  const steps = [];
  const res = await resolveZingStream({ title: "Xa M\xE3i Xa", artists: ["B\u1EA3o Thy"], durationSec: 255 }, (s) => steps.push(s));
  log("resolveZingStream ->", res.length, short(steps, 300));
  const link = await fetchZingLink("https://zingmp3.vn/bai-hat/Xa-Mai-Xa-Bao-Thy/ZWZB9WAB.html");
  log("link song ->", link ? `${link.name} tracks=${link.tracks.length} ${link.tracks[0]?.artist}` : "null");
  const album = await fetchZingLink("https://zingmp3.vn/album/Special-Album-Bao-Thy/Dw7v1MMIRBSU.html");
  log("link album ->", album ? `${album.name} tracks=${album.tracks.length}` : "null");
  const ly = await zingLyricsById("ZWZB9WAB");
  log("lyrics ZWZB9WAB ->", ly ? `lines=${ly.lines.length} word=${ly.wordSynced} lrc=${!!ly.lrc}` : "none");
}
async function invidious() {
  log("\n=== Invidious ===");
  const inst = await invidiousInstances();
  log("instances", inst.join(" "));
  for (const base of inst) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${base}/api/v1/stats`, { signal: AbortSignal.timeout(6e3) });
      log(`  ${base} stats ${r.status} ${Date.now() - t0}ms cors=${r.headers.get("access-control-allow-origin")}`);
    } catch (e) {
      log(`  ${base} stats ERR ${e?.cause?.code || e?.name}`);
    }
  }
  const hits = await searchInvidiousVideos("S\u01A1n T\xF9ng M-TP Ch\xFAng Ta C\u1EE7a Hi\u1EC7n T\u1EA1i", 5);
  log("search ->", hits.length, hits.slice(0, 3).map((h) => `${h.videoId} ${h.title} \u2014 ${h.author} ${h.lengthSeconds}s`).join(" | "));
  const ranked = rankCandidates({ title: "Ch\xFAng Ta C\u1EE7a Hi\u1EC7n T\u1EA1i", artists: ["S\u01A1n T\xF9ng M-TP"], durationSec: 302 }, hits.flatMap(videoCandidates), 0);
  log("ranked", ranked.slice(0, 4).map((r) => `${r.score.toFixed(2)} ${r.track.title} / ${r.track.artist}`).join(" | "));
  const vid = hits[0]?.videoId || "psZ1g9fMfeo";
  for (const base of inst) {
    try {
      const r = await fetch(`${base}/api/v1/videos/${vid}?local=true`, { signal: AbortSignal.timeout(8e3) });
      const txt = await r.text();
      let j = null;
      try {
        j = JSON.parse(txt);
      } catch {
      }
      const af = j?.adaptiveFormats || [];
      const au = af.filter((f) => /^audio\//.test(String(f.type || "")));
      const m4a = au.find((f) => /audio\/mp4/.test(String(f.type)));
      log(`  ${base} videos ${r.status} err=${short(j?.error, 120)} adaptive=${af.length} audio=${au.length} hls=${!!j?.hlsUrl} m4a=${m4a ? String(m4a.url).slice(0, 110) : "-"}`);
      if (m4a) {
        const u = String(m4a.url).startsWith("http") ? String(m4a.url) : base + m4a.url;
        log("     range", await rangeProbe(u, 1048576), "clen", m4a.clen);
      }
      if (!j) log("     body", txt.slice(0, 160).replace(/\s+/g, " "));
      if (af.length) {
        const variants = [
          `${base}/latest_version?id=${vid}&itag=140&local=true`,
          `${base}/latest_version?id=${vid}&itag=140`,
          m4a ? String(m4a.url).startsWith("http") ? String(m4a.url) : base + m4a.url : ""
        ].filter(Boolean);
        for (const v of variants) {
          for (const range of ["bytes=0-1", "bytes=1048576-1048577"]) {
            try {
              const r2 = await fetch(v, { headers: { Range: range, "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
              log(`     ${v.replace(base, "").slice(0, 60)} ${range} -> ${r2.status} ${r2.headers.get("content-type")} final=${r2.url.slice(0, 70)}`);
            } catch (e) {
              log(`     ${v.slice(0, 60)} ERR ${e?.cause?.code || e?.name}`);
            }
          }
        }
        if (j?.hlsUrl) {
          try {
            const hu = String(j.hlsUrl).startsWith("http") ? String(j.hlsUrl) : base + j.hlsUrl;
            const h = await fetch(hu, { signal: AbortSignal.timeout(8e3) });
            const ht = await h.text();
            log(`     hls ${h.status} ${hu.slice(0, 80)} lines=${ht.split("\n").length} audio=${(ht.match(/TYPE=AUDIO/g) || []).length} head=${ht.slice(0, 120).replace(/\s+/g, " ")}`);
          } catch (e) {
            log(`     hls ERR ${e?.cause?.code || e?.name}`);
          }
        }
        try {
          const d = await fetch(`${base}/api/manifest/dash/id/${vid}?local=true`, { signal: AbortSignal.timeout(8e3) });
          const dt = await d.text();
          const bu = (dt.match(/<BaseURL>([^<]+)<\/BaseURL>/) || [])[1] || "";
          log(`     dash ${d.status} len=${dt.length} baseurl=${bu.slice(0, 80)}`);
          if (bu) {
            const u2 = (bu.startsWith("http") ? bu : base + bu).replace(/&amp;/g, "&");
            const r3 = await fetch(u2, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(8e3) });
            log(`     dash seg ${r3.status} ${r3.headers.get("content-type")}`);
          }
        } catch (e) {
          log(`     dash ERR ${e?.cause?.code || e?.name}`);
        }
      }
    } catch (e) {
      log(`  ${base} videos ERR ${e?.cause?.code || e?.name}`);
    }
  }
  for (const base of inst) {
    for (const path of ["/latest_version", "/companion/latest_version"]) {
      try {
        const u = `${base}${path}?id=${vid}&itag=140&local=true`;
        const r = await fetch(u, { headers: { Range: "bytes=1048576-1048577" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
        log(`  ${base}${path} -> ${r.status} ${r.headers.get("content-type")} range=${r.headers.get("content-range")} final=${r.url.replace(base, "").slice(0, 60)}`);
      } catch (e) {
        log(`  ${base}${path} ERR ${e?.cause?.code || e?.name}`);
      }
    }
  }
  const a = await invidiousAudio(vid);
  log("audio ->", a ? `${a.qualityLabel} @${a.instance} ${a.url.slice(0, 100)}` : "null");
  if (a) log("   range 3MiB", await rangeProbe(a.url, 3 * 1048576));
  const steps = [];
  const res = await resolveInvidiousStream({ title: "Shape of You", artists: ["Ed Sheeran"], durationSec: 233 }, (s) => steps.push(s));
  log("resolveInvidiousStream ->", res.length, short(steps, 300));
}
(async () => {
  log(`Probe @ ${(/* @__PURE__ */ new Date()).toISOString()} node ${process.version}`);
  try {
    const ip = await fetch("https://api.ipify.org?format=json");
    log("runner IP", await ip.text());
  } catch {
  }
  await zing().catch((e) => log("zing FAIL", e?.stack || e));
  await invidious().catch((e) => log("invidious FAIL", e?.stack || e));
  log("\nProbe done.");
})();
