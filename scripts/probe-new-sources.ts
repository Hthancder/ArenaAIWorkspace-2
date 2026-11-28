// HolySic — probe for the Zing MP3 and Invidious sources, run on GitHub Actions with the app's own
// provider code (bundled by esbuild into probe-new-sources.bundle.mjs, react-native stubbed).
//   npx esbuild scripts/probe-new-sources.ts --bundle --platform=node --format=esm \
//     --alias:react-native=./scripts/probe-stubs/react-native.js \
//     --alias:@react-native-async-storage/async-storage=./scripts/probe-stubs/async-storage.js \
//     --outfile=scripts/probe-new-sources.bundle.mjs
// The runner is outside Vietnam: Zing's streams may be refused there (the app runs in Vietnam);
// the point is that signed calls are accepted (err 0) and what the answers look like.

(globalThis as any).__HS_NODE_PROBE__ = true;

import {
  fetchZingLink,
  resolveZingStream,
  searchZingTracks,
  zingCall,
  zingLyricsById,
  zingStream,
} from '../src/services/providers/zingProvider';
import {
  invidiousAudio,
  invidiousInstances,
  resolveInvidiousStream,
  searchInvidiousVideos,
  videoCandidates,
} from '../src/services/providers/invidiousProvider';
import { rankCandidates } from '../src/services/trackMatcher';

const log = (...a: unknown[]) => console.log(...a);
const short = (s: unknown, n = 160) => String(JSON.stringify(s)).slice(0, n);

async function rangeProbe(url: string, at = 1_048_576) {
  try {
    const r = await fetch(url, { headers: { Range: `bytes=${at}-${at + 1}` } });
    return `${r.status} ctype=${r.headers.get('content-type')} len=${r.headers.get('content-range')}`;
  } catch (e: any) {
    return `ERR ${e?.cause?.code || e?.message}`;
  }
}

async function zing() {
  log('\n=== Zing MP3 ===');
  const raw = await zingCall('/api/v2/search', { q: 'Chúng Ta Của Hiện Tại', type: 'song', page: 1, count: 5 });
  log('search raw err=', raw?.err, 'msg=', raw?.msg, 'items=', (raw?.data as any)?.items?.length);
  const multi = await zingCall('/api/v2/search/multi', { q: 'Sơn Tùng' });
  log('multi err=', multi?.err, 'msg=', multi?.msg, 'songs=', (multi?.data as any)?.songs?.length);
  for (const q of ['Chúng Ta Của Hiện Tại Sơn Tùng', 'Bảo Thy Xa Mãi Xa', 'Ed Sheeran Shape of You']) {
    const list = await searchZingTracks(q, 5);
    log(`searchZingTracks("${q}") ->`, list.length, list.slice(0, 3).map((t) => `${t.id} ${t.title} — ${t.artist} ${t.durationSec}s`).join(' | '));
    if (list[0]) log('   art', list[0].artworkUrl);
    const id = list[0]?.id.slice(5);
    if (id) {
      const st = await zingStream(id);
      log('   stream', st.s ? `${st.s.qualityLabel} ${st.s.url.slice(0, 90)}` : `none err=${st.err} msg=${st.msg}`);
      if (st.s) log('   range', await rangeProbe(st.s.url));
      const ly = await zingLyricsById(id);
      log('   lyrics', ly ? `lines=${ly.lines.length} word=${ly.wordSynced} first=${short(ly.lines[0]?.text, 80)} words0=${short(ly.lines[0]?.words?.slice(0, 3), 160)} lrc=${!!ly.lrc}` : 'none');
    }
  }
  const steps: any[] = [];
  const res = await resolveZingStream({ title: 'Xa Mãi Xa', artists: ['Bảo Thy'], durationSec: 255 }, (s) => steps.push(s));
  log('resolveZingStream ->', res.length, short(steps, 300));
  const link = await fetchZingLink('https://zingmp3.vn/bai-hat/Xa-Mai-Xa-Bao-Thy/ZWZB9WAB.html');
  log('link song ->', link ? `${link.name} tracks=${link.tracks.length} ${link.tracks[0]?.artist}` : 'null');
  const album = await fetchZingLink('https://zingmp3.vn/album/Special-Album-Bao-Thy/Dw7v1MMIRBSU.html');
  log('link album ->', album ? `${album.name} tracks=${album.tracks.length}` : 'null');
  const ly = await zingLyricsById('ZWZB9WAB');
  log('lyrics ZWZB9WAB ->', ly ? `lines=${ly.lines.length} word=${ly.wordSynced} lrc=${!!ly.lrc}` : 'none');
}

async function invidious() {
  log('\n=== Invidious ===');
  const inst = await invidiousInstances();
  log('instances', inst.join(' '));
  for (const base of inst) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${base}/api/v1/stats`, { signal: AbortSignal.timeout(6000) });
      log(`  ${base} stats ${r.status} ${Date.now() - t0}ms cors=${r.headers.get('access-control-allow-origin')}`);
    } catch (e: any) {
      log(`  ${base} stats ERR ${e?.cause?.code || e?.name}`);
    }
  }
  const hits = await searchInvidiousVideos('Sơn Tùng M-TP Chúng Ta Của Hiện Tại', 5);
  log('search ->', hits.length, hits.slice(0, 3).map((h) => `${h.videoId} ${h.title} — ${h.author} ${h.lengthSeconds}s`).join(' | '));
  const ranked = rankCandidates({ title: 'Chúng Ta Của Hiện Tại', artists: ['Sơn Tùng M-TP'], durationSec: 302 }, hits.flatMap(videoCandidates), 0);
  log('ranked', ranked.slice(0, 4).map((r) => `${r.score.toFixed(2)} ${r.track.title} / ${r.track.artist}`).join(' | '));
  const vid = hits[0]?.videoId || 'psZ1g9fMfeo';
  // what each instance answers for the video (local=true: proxied links)
  for (const base of inst) {
    try {
      const r = await fetch(`${base}/api/v1/videos/${vid}?local=true`, { signal: AbortSignal.timeout(8000) });
      const txt = await r.text();
      let j: any = null;
      try { j = JSON.parse(txt); } catch {}
      const af: any[] = j?.adaptiveFormats || [];
      const au = af.filter((f) => /^audio\//.test(String(f.type || '')));
      const m4a = au.find((f) => /audio\/mp4/.test(String(f.type)));
      log(`  ${base} videos ${r.status} err=${short(j?.error, 120)} adaptive=${af.length} audio=${au.length} hls=${!!j?.hlsUrl} m4a=${m4a ? String(m4a.url).slice(0, 110) : '-'}`);
      if (m4a) {
        const u = String(m4a.url).startsWith('http') ? String(m4a.url) : base + m4a.url;
        log('     range', await rangeProbe(u, 1_048_576), 'clen', m4a.clen);
      }
      if (!j) log('     body', txt.slice(0, 160).replace(/\s+/g, ' '));
      if (af.length) {
        const variants = [
          `${base}/latest_version?id=${vid}&itag=140&local=true`,
          `${base}/latest_version?id=${vid}&itag=140`,
          m4a ? (String(m4a.url).startsWith('http') ? String(m4a.url) : base + m4a.url) : '',
        ].filter(Boolean);
        for (const v of variants) {
          for (const range of ['bytes=0-1', 'bytes=1048576-1048577']) {
            try {
              const r2 = await fetch(v, { headers: { Range: range, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
              log(`     ${v.replace(base, '').slice(0, 60)} ${range} -> ${r2.status} ${r2.headers.get('content-type')} final=${r2.url.slice(0, 70)}`);
            } catch (e: any) { log(`     ${v.slice(0, 60)} ERR ${e?.cause?.code || e?.name}`); }
          }
        }
        if (j?.hlsUrl) {
          try {
            const hu = String(j.hlsUrl).startsWith('http') ? String(j.hlsUrl) : base + j.hlsUrl;
            const h = await fetch(hu, { signal: AbortSignal.timeout(8000) });
            const ht = await h.text();
            log(`     hls ${h.status} ${hu.slice(0, 80)} lines=${ht.split('\n').length} audio=${(ht.match(/TYPE=AUDIO/g) || []).length} head=${ht.slice(0, 120).replace(/\s+/g, ' ')}`);
          } catch (e: any) { log(`     hls ERR ${e?.cause?.code || e?.name}`); }
        }
        try {
          const d = await fetch(`${base}/api/manifest/dash/id/${vid}?local=true`, { signal: AbortSignal.timeout(8000) });
          const dt = await d.text();
          const bu = (dt.match(/<BaseURL>([^<]+)<\/BaseURL>/) || [])[1] || '';
          log(`     dash ${d.status} len=${dt.length} baseurl=${bu.slice(0, 80)}`);
          if (bu) {
            const u2 = (bu.startsWith('http') ? bu : base + bu).replace(/&amp;/g, '&');
            const r3 = await fetch(u2, { headers: { Range: 'bytes=0-1' }, signal: AbortSignal.timeout(8000) });
            log(`     dash seg ${r3.status} ${r3.headers.get('content-type')}`);
          }
        } catch (e: any) { log(`     dash ERR ${e?.cause?.code || e?.name}`); }
      }
    } catch (e: any) {
      log(`  ${base} videos ERR ${e?.cause?.code || e?.name}`);
    }
  }
  for (const base of inst) {
    for (const path of ['/latest_version', '/companion/latest_version']) {
      try {
        const u = `${base}${path}?id=${vid}&itag=140&local=true`;
        const r = await fetch(u, { headers: { Range: 'bytes=1048576-1048577' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        log(`  ${base}${path} -> ${r.status} ${r.headers.get('content-type')} range=${r.headers.get('content-range')} final=${r.url.replace(base, '').slice(0, 60)}`);
      } catch (e: any) {
        log(`  ${base}${path} ERR ${e?.cause?.code || e?.name}`);
      }
    }
  }
  const a = await invidiousAudio(vid);
  log('audio ->', a ? `${a.qualityLabel} @${a.instance} ${a.url.slice(0, 100)}` : 'null');
  if (a) log('   range 3MiB', await rangeProbe(a.url, 3 * 1_048_576));
  const steps: any[] = [];
  const res = await resolveInvidiousStream({ title: 'Shape of You', artists: ['Ed Sheeran'], durationSec: 233 }, (s) => steps.push(s));
  log('resolveInvidiousStream ->', res.length, short(steps, 300));
}

(async () => {
  log(`Probe @ ${new Date().toISOString()} node ${process.version}`);
  try {
    const ip = await fetch('https://api.ipify.org?format=json');
    log('runner IP', await ip.text());
  } catch {}
  await zing().catch((e) => log('zing FAIL', e?.stack || e));
  await invidious().catch((e) => log('invidious FAIL', e?.stack || e));
  log('\nProbe done.');
})();
