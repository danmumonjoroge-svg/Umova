import http from 'http'; import fs from 'fs'; import path from 'path';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const here = path.dirname(new URL(import.meta.url).pathname); const dir = path.join(here, 'service_worker_fixture'); fs.copyFileSync(path.join(here, '../../../public/service-worker.js'), path.join(dir, 'service-worker.js')); fs.copyFileSync(path.join(here, '../../../public/offline.html'), path.join(dir, 'offline.html')); let hits = 0;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((q, s) => {
  hits++; let p = q.url.split('?')[0]; if (p === '/' || !path.extname(p)) p = '/index.html';
  const f = path.join(dir, p);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end('nf'); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); s.end(fs.readFileSync(f));
}).listen(0);
const port = srv.address().port, base = `http://localhost:${port}`;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }).catch(async () => chromium.launch({ args: ['--no-sandbox'] }));
const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto(base + '/'); 
await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; });
await page.waitForTimeout(1500);
ok((await page.textContent('#r')) === 'APP LOADED v1', 'online: app loads');
const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
ok(cached.includes('/index.html') && cached.includes('/static/js/main.abc123.js'), 'shell + main script saved: ' + cached.join(' '));
ok(cached.includes('/static/js/9.lazy1.chunk.js'), 'lazy chunk from asset-manifest saved before it was ever visited');
ok(!cached.some(c => c.endsWith('.map')), 'source maps not saved');
await page.reload(); await page.waitForTimeout(500);
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is controlled by the worker');
await ctx.setOffline(true); srv.close(); // truly no server
await page.goto(base + '/pos/some/deep/route').catch(() => {});
ok((await page.textContent('#r').catch(() => '')) === 'APP LOADED v1', 'OFFLINE: deep route /pos/some/deep/route still opens the app');
const lazy = await page.evaluate(async () => { const s = document.createElement('script'); s.src = '/static/js/9.lazy1.chunk.js'; document.body.appendChild(s); await new Promise(r => { s.onload = r; s.onerror = r; }); return window.__chunk; });
ok(lazy === 'lazy chunk ok', 'OFFLINE: a lazy-loaded chunk still loads');
const xo = await page.evaluate(() => fetch('https://example.invalid/x').then(() => 'reached', () => 'failed-normally'));
ok(xo === 'failed-normally', 'cross-site requests (Supabase) are not touched by the worker');
await b.close(); console.log(fail ? 'FAILURES ' + fail : 'ALL SERVICE-WORKER CHECKS PASSED'); process.exit(fail ? 1 : 0);
