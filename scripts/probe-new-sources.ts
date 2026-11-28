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
} from '../src/services/providers/invidiousProvider';

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
  const vid = hits[0]?.videoId || 'psZ1g9fMfeo';
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
