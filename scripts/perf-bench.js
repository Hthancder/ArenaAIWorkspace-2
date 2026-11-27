// HolySic perf bench (web preview). Needs playwright-core + @sparticuz/chromium installed next to it.
// Run with the dev server on :8081:  node perf-bench.js <tag>   (HEAVY=1 = Poster player + visualizer
// backdrop + dock bars). Reads the dev-only counters from src/services/perfProbe.ts.
// HolySic perf bench: counts work per second in each scenario
const chromium = require('@sparticuz/chromium');
const { chromium: pw } = require('playwright-core');
const fs = require('fs');
const TAG = process.argv[2] || 'run';
const WIN = 8000;
(async () => {
  const c = chromium.default || chromium;
  const browser = await pw.launch({ executablePath: await c.executablePath(), args: [...c.args, '--autoplay-policy=no-user-gesture-required'], headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  await page.addInitScript(() => {
    globalThis.__HS_PERF__ = {};
    globalThis.__HS_LT__ = { n: 0, ms: 0 };
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (this.tagName !== 'VIDEO') globalThis.__HS_AUD__ = this; return op.apply(this, arguments); };
    globalThis.__HS_TRUEPOS__ = () => { const a = globalThis.__HS_AUD__; return a && !a.paused ? a.currentTime : null; };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { __HS_LT__.n++; __HS_LT__.ms += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  const lrc = Array.from({ length: 16 }, (_, i) => `[00:${String(i * 2).padStart(2, '0')}.00]Dòng thứ ${i + 1} của bài hát`).join('\n');
  await page.route(/lrclib\.net/, (route) => {
    const u = route.request().url();
    const hit = { id: 21, trackName: 'Neon Rain in Shibuya', artistName: 'HolySic Sound Lab', duration: 32, syncedLyrics: lrc, plainLyrics: 'x' };
    if (u.includes('/api/search')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([hit]) });
    if (u.includes('/api/get')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(hit) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await page.route(/music\.163\.com|kugou|lyricsplus|lyrics\.ovh/, (r) => r.fulfill({ status: 500, headers: cors, body: '' }));
  await page.goto('http://localhost:8081/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(7000);
  await page.getByText('Bỏ qua', { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (process.env.HEAVY) {
    // the "pretty" setup: Poster player with 32-band bars, visualizer backdrop, dock bars
    await page.evaluate(() => {
      const k = '@holysic/preferences_v1';
      const p = JSON.parse(localStorage.getItem(k) || '{}');
      Object.assign(p, { playerStyle: 'POSTER', appBackdrop: 'visualizer', dockVisualizer: 'bars', appBgReactive: true });
      localStorage.setItem(k, JSON.stringify(p));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(7000);
  }
  if (process.env.NOGATE) await page.evaluate(() => { globalThis.__HS_NOGATE__ = true; });
  const metrics = async () => {
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const p = await page.evaluate(() => ({ c: { ...globalThis.__HS_PERF__ }, lt: { ...globalThis.__HS_LT__ } }));
    return { m, ...p };
  };
  const fps = () => page.evaluate((ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n / (ms / 1000)); }; requestAnimationFrame(f); setTimeout(() => res(n / (ms / 1000)), ms + 500); }), 2000);
  const rows = [];
  const measure = async (name) => {
    const a = await metrics();
    await page.waitForTimeout(WIN);
    const b = await metrics();
    const s = WIN / 1000;
    const per = {};
    for (const k of new Set([...Object.keys(a.c), ...Object.keys(b.c)])) {
      const d = (b.c[k] || 0) - (a.c[k] || 0);
      if (d) per[k] = +(d / s).toFixed(1);
    }
    const row = {
      scenario: name,
      scriptMsPerS: +(((b.m.ScriptDuration - a.m.ScriptDuration) * 1000) / s).toFixed(1),
      taskMsPerS: +(((b.m.TaskDuration - a.m.TaskDuration) * 1000) / s).toFixed(1),
      layoutMsPerS: +(((b.m.LayoutDuration - a.m.LayoutDuration) * 1000) / s).toFixed(1),
      longTasks: b.lt.n - a.lt.n,
      perSec: per,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  };
  await measure('1 idle, home, nothing playing');
  // start playback
  await page.getByText(/Neon Rain in Shibu/).last().click().catch(() => {});
  await page.waitForTimeout(2500);
  const playerOpen = await page.getByText('Lời nhạc', { exact: true }).count();
  if (playerOpen) { await page.keyboard.press('Escape').catch(() => {}); }
  await page.waitForTimeout(1500);
  await measure('2 playing, home, player closed');
  await page.getByText(/Neon Rain in Shibu/).last().click().catch(() => {});
  await page.waitForTimeout(2500);
  await measure('3 playing, full player (cover)');
  await page.getByText('Lời nhạc', { exact: true }).last().click().catch(() => {});
  await page.waitForTimeout(2000);
  await measure('4 playing, full player (synced lyrics)');
  // back to the cover pane (Poster bars visible) before leaving the app
  await page.getByText('Lời nhạc', { exact: true }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await measure('4b playing, full player cover again');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1000);
  await measure('5 playing, app in background (player left open)');
  const samples = await page.evaluate(() => globalThis.__HS_PERF_S__ || {});
  const stat = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; return { n: a.length, min: s[0], median: s[s.length >> 1], max: s[s.length - 1], avg: Math.round(avg), spread: s[s.length - 1] - s[0] }; };
  const lyr = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, stat(v)]));
  console.log('LYRICS', JSON.stringify(lyr));
  fs.writeFileSync(`./bench-${TAG}.json`, JSON.stringify({ rows, lyr, samples }, null, 1));
  console.log(errs.slice(0, 5));
  await browser.close();
})();
