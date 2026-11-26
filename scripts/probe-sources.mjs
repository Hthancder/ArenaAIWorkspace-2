#!/usr/bin/env node
// HolySic iOS — source probe (runs on GitHub Actions, where YouTube/JioSaavn/Monochrome are reachable)
// It checks every full-length source with the same requests the app sends, then range-probes the stream
// past the ~786 KB "untokened window" (≈30 s) that googlevideo cuts unauthenticated IOS/IPADOS links at.
// Usage: node --openssl-legacy-provider scripts/probe-sources.mjs
// Protocol details ported from realidkroo/Mochy-Music (GPL-3.0): YouTubeClient.kt, InnerTube.kt,
// YTPlayerUtils.kt, JioSaavnModule.kt, MonochromeModule.kt.

import crypto from 'node:crypto';

const UNTOKENED_PROBE_BYTE = 1_048_576;
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const CLIENTS = {
  VISIONOS: {
    clientName: 'VISIONOS', clientVersion: '1.04', clientId: '101',
    userAgent: 'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; US)',
    osName: 'visionOS', osVersion: '26.6.0.23O770', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
    apiFormatVersion: '2', clientScreen: 'WATCH', platform: 'MOBILE', ownVisitorId: true,
  },
  IPADOS: {
    clientName: 'IOS', clientVersion: '21.03.3', clientId: '5',
    userAgent: 'com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)',
    osName: 'iPadOS', osVersion: '17.7.10.21H450', deviceMake: 'Apple', deviceModel: 'iPad7,6',
  },
  IOS: {
    clientName: 'IOS', clientVersion: '21.03.1', clientId: '5',
    userAgent: 'com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)',
    osVersion: '18.2.22C152',
  },
  ANDROID_VR: {
    clientName: 'ANDROID_VR', clientVersion: '1.61.48', clientId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Oculus Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
  },
  TV_EMBED: {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', clientId: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    embedded: true,
  },
};

async function timed(url, init = {}, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, redirect: 'follow' });
    return { res, ms: Date.now() - t0 };
  } catch (e) {
    return { err: String(e?.cause?.code || e?.name || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

function ctx(c, visitorData) {
  return {
    client: {
      clientName: c.clientName, clientVersion: c.clientVersion,
      ...(c.clientScreen ? { clientScreen: c.clientScreen, utcOffsetMinutes: 0 } : {}),
      ...(c.platform ? { platform: c.platform } : {}),
      ...(c.osName ? { osName: c.osName } : {}),
      ...(c.osVersion ? { osVersion: c.osVersion } : {}),
      ...(c.deviceMake ? { deviceMake: c.deviceMake } : {}),
      ...(c.deviceModel ? { deviceModel: c.deviceModel } : {}),
      hl: 'en', gl: 'US',
      ...(visitorData ? { visitorData } : {}),
    },
  };
}

function ytHeaders(c, visitorData) {
  const h = {
    'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': c.userAgent, 'X-YouTube-Client-Name': c.clientId, 'X-YouTube-Client-Version': c.clientVersion,
    'X-Goog-Api-Format-Version': c.apiFormatVersion || '1',
  };
  if (visitorData) h['X-Goog-Visitor-Id'] = visitorData;
  return h;
}

async function mintVisitor(c) {
  const { res, err } = await timed('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
    method: 'POST', headers: ytHeaders(c), body: JSON.stringify({ context: ctx(c) }),
  });
  if (err || !res.ok) return { error: err || res.status };
  const j = await res.json().catch(() => null);
  return { visitor: j?.responseContext?.visitorData };
}

async function rangeProbe(url, headers, byte) {
  const { res, err, ms } = await timed(url, { headers: { ...headers, Range: `bytes=${byte}-${byte}` } }, 10000);
  if (err) return `ERR ${err}`;
  await res.arrayBuffer().catch(() => null);
  return `${res.status} (${ms}ms)`;
}

async function probeYouTube(videoId, label) {
  console.log(`\n=== YouTube ${label} (${videoId}) ===`);
  const variants = [
    ['VISIONOS+visitor', CLIENTS.VISIONOS, true],
    ['VISIONOS bare', CLIENTS.VISIONOS, false],
    ['IPADOS', CLIENTS.IPADOS, false],
    ['IOS', CLIENTS.IOS, false],
    ['ANDROID_VR', CLIENTS.ANDROID_VR, false],
    ['TV_EMBED', CLIENTS.TV_EMBED, false],
  ];
  for (const [name, c, useVisitor] of variants) {
    let visitor;
    if (useVisitor) {
      const v = await mintVisitor(c);
      visitor = v.visitor;
      if (!visitor) console.log(`  [${name}] visitor_id mint failed: ${v.error}`);
    }
    const body = {
      context: ctx(c, visitor), videoId, contentCheckOk: true, racyCheckOk: true,
      ...(c.embedded ? { context: { ...ctx(c, visitor), thirdParty: { embedUrl: `https://www.youtube.com/watch?v=${videoId}` } } } : {}),
    };
    const { res, err, ms } = await timed('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', headers: ytHeaders(c, visitor), body: JSON.stringify(body),
    });
    if (err) { console.log(`  [${name}] player ERR ${err}`); continue; }
    const j = await res.json().catch(() => null);
    const ps = j?.playabilityStatus;
    const fmts = j?.streamingData?.adaptiveFormats || [];
    const audio = fmts.filter((f) => String(f.mimeType || '').startsWith('audio/'));
    const direct = audio.filter((f) => f.url);
    const mp4 = direct.filter((f) => f.mimeType.startsWith('audio/mp4')).sort((a, b) => b.bitrate - a.bitrate)[0];
    console.log(`  [${name}] http=${res.status} ${ms}ms status=${ps?.status} reason=${(ps?.reason || '').slice(0, 80)} audio=${audio.length} direct=${direct.length} ciphered=${audio.length - direct.length} hls=${!!j?.streamingData?.hlsManifestUrl}`);
    const headers = { 'User-Agent': c.userAgent, Accept: '*/*' };
    if (mp4) {
      const len = Number(mp4.contentLength) || 0;
      const early = await rangeProbe(mp4.url, headers, 1000);
      const past = await rangeProbe(mp4.url, headers, UNTOKENED_PROBE_BYTE);
      const last = len > 1 ? await rangeProbe(mp4.url, headers, len - 1) : 'n/a';
      const noUA = await rangeProbe(mp4.url, { 'User-Agent': DESKTOP_UA }, UNTOKENED_PROBE_BYTE);
      console.log(`     m4a itag=${mp4.itag} ${Math.round(mp4.bitrate / 1000)}kbps len=${len} | byte1000=${early} byte1MiB=${past} lastByte=${last} | 1MiB w/ desktop UA=${noUA}`);
    }
    const hls = j?.streamingData?.hlsManifestUrl;
    if (hls) {
      const m = await timed(hls, { headers });
      if (m.err) { console.log(`     hls master ERR ${m.err}`); continue; }
      const text = await m.res.text();
      const audioUri = (text.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"]+)"/) || [])[1]
        || text.split('\n').find((l) => l.startsWith('http'));
      let detail = '';
      if (audioUri) {
        const pl = await timed(audioUri, { headers });
        if (pl.res) {
          const pt = await pl.res.text();
          const segs = pt.split('\n').filter((l) => l && !l.startsWith('#'));
          const segUrl = (u) => (u.startsWith('http') ? u : new URL(u, audioUri).href);
          const mid = segs[Math.floor(segs.length / 2)];
          const lastSeg = segs[segs.length - 1];
          const midR = mid ? await timed(segUrl(mid), { headers: { ...headers, Range: 'bytes=0-1' } }) : null;
          const lastR = lastSeg ? await timed(segUrl(lastSeg), { headers: { ...headers, Range: 'bytes=0-1' } }) : null;
          detail = `media=${pl.res.status} segs=${segs.length} midSeg=${midR?.res?.status ?? midR?.err} lastSeg=${lastR?.res?.status ?? lastR?.err}`;
        } else detail = `media ERR ${pl.err}`;
      }
      console.log(`     hls master=${m.res.status} ${detail}`);
    }
  }
}

async function ytMusicSearch(q) {
  const { res, err } = await timed('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': DESKTOP_UA },
    body: JSON.stringify({ query: q, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'vi', gl: 'VN' } } }),
  });
  if (err) { console.log(`  WEB_REMIX search "${q}" ERR ${err}`); return null; }
  const text = await res.text();
  const vid = (text.match(/"videoId":"([A-Za-z0-9_-]{11})"/) || [])[1];
  console.log(`  WEB_REMIX search "${q}" http=${res.status} firstVideoId=${vid}`);
  return vid;
}

function desDecrypt(b64) {
  try {
    const d = crypto.createDecipheriv('des-ecb', Buffer.from('38346591'), null);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString().trim();
  } catch (e) {
    return `DES-ERR ${e.code || e.message}`;
  }
}

async function probeJioSaavn(q) {
  console.log(`\n=== JioSaavn "${q}" ===`);
  const headers = { Accept: 'application/json', 'User-Agent': DESKTOP_UA, Cookie: 'explicit_content=1' };
  const api = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=android&p=1&n=5&q=${encodeURIComponent(q)}`;
  for (const [name, h] of [['with UA+cookie', headers], ['no UA', { Accept: 'application/json' }]]) {
    const { res, err, ms } = await timed(api, { headers: h });
    if (err) { console.log(`  api.php (${name}) ERR ${err}`); continue; }
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    const first = j?.results?.[0];
    console.log(`  api.php (${name}) http=${res.status} ${ms}ms results=${j?.results?.length ?? 'non-JSON: ' + text.slice(0, 60)} first="${first?.title}"`);
    if (first?.more_info?.encrypted_media_url && name === 'with UA+cookie') {
      const url = desDecrypt(first.more_info.encrypted_media_url);
      console.log(`     decrypted=${url.slice(0, 90)}`);
      if (url.startsWith('http')) {
        for (const kbps of [320, 160, 96]) {
          const u = url.replace(/_(12|48|96|160|320)\.(mp4|m4a|aac|mp3)(?=[?#]|$)/i, `_${kbps}.$2`);
          const r1 = await rangeProbe(u, { 'User-Agent': DESKTOP_UA }, 0);
          const r2 = await rangeProbe(u, { 'User-Agent': 'AppleCoreMedia/1.0.0.19H12 (iPhone; U; CPU OS 15_7 like Mac OS X; en_us)' }, UNTOKENED_PROBE_BYTE);
          console.log(`     _${kbps}: byte0=${r1} byte1MiB(iOS UA)=${r2}`);
        }
      }
    }
  }
  for (const mirror of ['https://saavn.sumit.co/api/search/songs', 'https://jiosaavn-api-privatecvc2.vercel.app/search/songs']) {
    const { res, err, ms } = await timed(`${mirror}?query=${encodeURIComponent(q)}&limit=3`);
    if (err) { console.log(`  mirror ${mirror} ERR ${err}`); continue; }
    const j = await res.json().catch(() => null);
    const item = (j?.data?.results || j?.results || [])[0];
    const dl = (item?.downloadUrl || []).slice(-1)[0];
    const url = dl?.url || dl?.link;
    const probe = url ? await rangeProbe(url, {}, UNTOKENED_PROBE_BYTE) : 'n/a';
    console.log(`  mirror ${mirror} http=${res.status} ${ms}ms first="${item?.name || item?.title}" stream1MiB=${probe}`);
  }
}

async function probeMonochrome(q) {
  console.log(`\n=== Monochrome "${q}" ===`);
  const base = 'https://tracks.monochrome.st';
  for (const [name, h] of [['with UA', { Accept: 'application/json', 'User-Agent': DESKTOP_UA }], ['no UA', { Accept: 'application/json' }]]) {
    const { res, err, ms } = await timed(`${base}/search/tracks?q=${encodeURIComponent(q)}&limit=5`, { headers: h });
    if (err) { console.log(`  search (${name}) ERR ${err}`); continue; }
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    const t = j?.tracks?.[0];
    const id = t?.trackId ?? t?.id;
    console.log(`  search (${name}) http=${res.status} ${ms}ms tracks=${j?.tracks?.length ?? 'non-JSON: ' + text.slice(0, 80)} first="${t?.title}" id=${id} keys=${t ? Object.keys(t).join(',') : ''}`);
    if (id && name === 'with UA') {
      const url = `${base}/track/${id}`;
      const head = await timed(url, { headers: { 'User-Agent': DESKTOP_UA, Range: 'bytes=0-41' } });
      if (head.res) {
        const buf = Buffer.from(await head.res.arrayBuffer());
        console.log(`     /track/${id} http=${head.res.status} ${head.ms}ms ctype=${head.res.headers.get('content-type')} magic=${buf.subarray(0, 4).toString()} len=${head.res.headers.get('content-range')}`);
        const past = await rangeProbe(url, { 'User-Agent': 'AppleCoreMedia/1.0.0.19H12 (iPhone; U; CPU OS 15_7 like Mac OS X; en_us)' }, UNTOKENED_PROBE_BYTE * 3);
        console.log(`     byte3MiB (iOS UA)=${past}`);
        for (const v of [`${url}.flac`, `${url}/track.flac`, `${url}?f=.flac`, `${url}?format=flac`]) {
          const r = await timed(v, { headers: { 'User-Agent': DESKTOP_UA, Range: 'bytes=0-3' } });
          const b = r.res ? Buffer.from(await r.res.arrayBuffer()).toString() : '';
          console.log(`     variant ${v.replace(base, '')} -> ${r.res?.status ?? r.err} ctype=${r.res?.headers.get('content-type')} magic=${b}`);
        }
        const hd = await timed(url, { method: 'HEAD', headers: { 'User-Agent': DESKTOP_UA } });
        console.log(`     HEAD ${hd.res?.status} ctype=${hd.res?.headers.get('content-type')} len=${hd.res?.headers.get('content-length')} accept-ranges=${hd.res?.headers.get('accept-ranges')} disp=${hd.res?.headers.get('content-disposition')}`);
        console.log(`     artwork=${t.artwork}`);
      } else console.log(`     /track ERR ${head.err}`);
    }
  }
}

async function probeDiscovery() {
  console.log('\n=== Discovery endpoints ===');
  const show = async (label, url, init = {}, peek = (t) => t.slice(0, 160)) => {
    const { res, err, ms } = await timed(url, init);
    if (err) return console.log(`  ${label}: ERR ${err}`);
    const text = await res.text();
    console.log(`  ${label}: ${res.status} ${ms}ms cors=${res.headers.get('access-control-allow-origin')} ctype=${res.headers.get('content-type')} | ${peek(text).replace(/\s+/g, ' ')}`);
    return text;
  };
  for (const cc of ['vn', 'us', 'kr', 'jp']) {
    await show(`appleRSS v2 ${cc}`, `https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/25/songs.json`, {}, (t) => {
      try { const j = JSON.parse(t); return `${j.feed.results.length} items; first=${j.feed.results[0].name} — ${j.feed.results[0].artistName} keys=${Object.keys(j.feed.results[0]).join(',')}`; } catch { return t.slice(0, 120); }
    });
  }
  await show('itunes legacy RSS vn genre 14 (pop)', 'https://itunes.apple.com/vn/rss/topsongs/limit=10/genre=14/json', {}, (t) => {
    try { const j = JSON.parse(t); const e = j.feed.entry; return `${e.length} entries; first=${e[0]['im:name'].label} — ${e[0]['im:artist'].label} keys=${Object.keys(e[0]).join(',')}`; } catch { return t.slice(0, 120); }
  });
  await show('itunes legacy RSS vn all', 'https://itunes.apple.com/vn/rss/topsongs/limit=10/json', {}, (t) => {
    try { const j = JSON.parse(t); return `${j.feed.entry.length} entries`; } catch { return t.slice(0, 120); }
  });
  // public Spotify playlist (Today's Top Hits)
  const pid = '37i9dQZF1DXcBWIGoYBM5M';
  await show('spotify embed playlist', `https://open.spotify.com/embed/playlist/${pid}`, { headers: { 'User-Agent': DESKTOP_UA } }, (t) => {
    const m = t.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return 'no __NEXT_DATA__; len=' + t.length;
    try {
      const j = JSON.parse(m[1]);
      const ent = j?.props?.pageProps?.state?.data?.entity;
      return `entity name=${ent?.name} tracks=${ent?.trackList?.length} first=${JSON.stringify(ent?.trackList?.[0]).slice(0, 200)}`;
    } catch (e) { return 'parse err ' + e.message; }
  });
  await show('spotify oembed track', 'https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3'));
  await show('piped playlist', 'https://pipedapi.kavin.rocks/playlists/PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', {}, (t) => t.slice(0, 120));
  await show('listenbrainz validate', 'https://api.listenbrainz.org/1/validate-token', { headers: { Authorization: 'Token invalid' } });
  await show('innertube music browse (VL playlist) WEB_REMIX', 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP_UA, Origin: 'https://music.youtube.com' },
    body: JSON.stringify({ browseId: 'VLPLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'en', gl: 'US' } } }),
  }, (t) => `len=${t.length} videoIds=${(t.match(/"videoId":"/g) || []).length}`);
  await show('lrclib', 'https://lrclib.net/api/search?q=shape%20of%20you', {}, (t) => t.slice(0, 80));
}

const SONGS = [
  { q: 'Sơn Tùng M-TP Chúng Ta Của Hiện Tại', saavn: 'Shape of You Ed Sheeran', mono: 'Ed Sheeran Shape of You' },
  { q: 'Ed Sheeran Shape of You' },
];

(async () => {
  console.log(`Probe @ ${new Date().toISOString()} node ${process.version}`);
  const ip = await timed('https://api.ipify.org?format=json');
  if (ip.res) console.log('runner IP', await ip.res.text());
  if (process.env.ONLY_DISCOVERY) { await probeDiscovery(); console.log('\nProbe done.'); return; }
  const ids = [];
  for (const s of SONGS) {
    const vid = await ytMusicSearch(s.q);
    if (vid) ids.push([vid, s.q]);
  }
  if (ids.length === 0) ids.push(['JGwWNGJdvx8', 'Shape of You (fallback id)']);
  if (!process.env.SKIP_YT) for (const [vid, label] of ids) await probeYouTube(vid, label);
  if (!process.env.SKIP_SAAVN) { await probeJioSaavn('Shape of You Ed Sheeran'); await probeJioSaavn('Chúng Ta Của Hiện Tại'); }
  await probeMonochrome('Ed Sheeran Shape of You');
  await probeMonochrome('Sơn Tùng M-TP Chúng Ta Của Hiện Tại');
  console.log('\nProbe done.');
})();
