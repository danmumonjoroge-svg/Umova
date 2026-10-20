// Phase 1 offline checks: saved copies (readThrough), retention, tenant isolation, outbox safety.
// Run from src/pos-erp:  node schema/tests/offline_readthrough_checks.mjs   (uses the Dexie stand-in)
import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url'; import { register } from 'module';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const root = path.resolve('.'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
fs.mkdirSync(path.join(tmp, 'offline'), { recursive: true });
for (const f of ['db', 'netErrors', 'offlineCache', 'readThrough', 'retention', 'idGenerator']) fs.copyFileSync(path.join(root, `offline/${f}.js`), path.join(tmp, `offline/${f}.js`));
fs.mkdirSync(path.join(tmp, 'node_modules/dexie'), { recursive: true });
fs.copyFileSync(path.join(root, 'schema/tests/offline_harness/dexie_standin.js'), path.join(tmp, 'node_modules/dexie/index.js'));
fs.writeFileSync(path.join(tmp, 'node_modules/dexie/package.json'), JSON.stringify({ name: 'dexie', type: 'module', main: 'index.js' }));
register(pathToFileURL(path.join(root, 'schema/tests/offline_harness/ext_loader.mjs')));
const imp = (f) => import(pathToFileURL(path.join(tmp, f)));
const { db } = await imp('offline/db.js');
const rt = await imp('offline/readThrough.js'); const ret = await imp('offline/retention.js'); const cache = await imp('offline/offlineCache.js');
const net = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' };
const refuse = { code: '42501', message: 'permission denied for table lb_expenses' };

// --- retention ---
let r = await ret.getRetention();
ok(r.salesDays === 30 && r.expensesDays === 90, 'retention defaults: 30 days sales, 90 days expenses');
r = await ret.setRetention({ salesDays: 45 });
ok(r.salesDays === 45 && r.expensesDays === 90, 'retention can be changed, other value kept');
r = await ret.setRetention({ salesDays: 0, expensesDays: 9999 });
ok(r.salesDays === 45 && r.expensesDays === 90, 'out-of-range retention values are ignored');
r = await ret.setRetention({ expensesDays: 'abc' });
ok(r.expensesDays === 90, 'non-numeric retention ignored');
ok(ret.sinceDate(30, new Date(2026, 9, 19)) === '2026-09-19', 'sinceDate gives the right local date: ' + ret.sinceDate(30, new Date(2026, 9, 19)));

// --- snapshots + read-through ---
const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, description: i % 2 ? 'Rent' : 'Fuel', amount: i }));
ok(await rt.saveSnapshot('expenses', 'T1', rows, { complete: true }), 'snapshot saved');
ok((await rt.readSnapshot('expenses', 'T2')) === null, 'TENANT ISOLATION: another business never gets this copy');
ok((await rt.readSnapshot('expenses', undefined)) === null, 'no business id -> no copy');
let calls = 0;
let o = await rt.readThrough('expenses', async () => { calls++; return { data: ['live'] }; }, { tenantId: 'T1' });
ok(!o.fromCache && o.result.data[0] === 'live', 'online: live result returned, not the copy');
o = await rt.readThrough('expenses', async () => { throw net; }, { tenantId: 'T1', params: { search: 'rent', limit: 10, page: 1 }, searchFields: ['description'] });
ok(o.fromCache && o.result.count === 60 && o.result.data.length === 10 && o.savedAt, 'no connection: saved copy shown, searched and paged (60 matches, 10 on page)');
o = await rt.readThrough('expenses', async () => { throw net; }, { tenantId: 'T1', params: { page: 3, limit: 50 } });
ok(o.result.data.length === 20 && o.result.count === 120, 'paging last page correct');
let err = null;
try { await rt.readThrough('expenses', async () => { throw refuse; }, { tenantId: 'T1' }); } catch (e) { err = e; }
ok(err === refuse, 'a REFUSAL (permission) is NOT hidden behind old data');
err = null;
try { await rt.readThrough('expenses', async () => { throw net; }, { tenantId: 'T2' }); } catch (e) { err = e; }
ok(err === net, 'other business offline: gets the normal error, not T1 data');
err = null;
try { await rt.readThrough('suppliers', async () => { throw net; }, { tenantId: 'T1' }); } catch (e) { err = e; }
ok(err === net, 'nothing saved yet: normal error (page shows its own message)');
await rt.saveSnapshot('suppliers', 'T1', [{ id: 1 }], { complete: false });
o = await rt.readThrough('suppliers', async () => { throw net; }, { tenantId: 'T1', shape: 'list' });
ok(o.fromCache && Array.isArray(o.result) && o.complete === false, 'incomplete copy is flagged complete=false; list shape returned as array');

// --- pullPages ---
const mk = (n) => async (page, size) => ({ data: Array.from({ length: Math.max(0, Math.min(size, n - (page - 1) * size)) }, (_, i) => i) });
let p = await rt.pullPages(mk(1200), { pageSize: 500, maxPages: 4 });
ok(p.rows.length === 1200 && p.complete, 'pullPages gets everything under the cap');
p = await rt.pullPages(mk(5000), { pageSize: 500, maxPages: 4 });
ok(p.rows.length === 2000 && p.complete === false, 'pullPages hitting the cap reports incomplete');
p = await rt.pullPages(mk(1000), { pageSize: 500, maxPages: 2 });
ok(p.rows.length === 1000, 'exactly at cap fetched');

// --- outbox safety: clearing/changing owner never touches unsent work ---
await db.outbox.add({ id: 'OB1', kind: 'sale', status: 'PENDING', tenant_id: 'T1', payload: { x: 1 }, created_at: new Date().toISOString() });
await cache.clearOfflineCaches();
ok((await db.outbox.count()) === 1, 'sign-out cache clear leaves the unsent sale in the outbox');
ok((await rt.readSnapshot('expenses', 'T1')) === null, 'sign-out cache clear empties saved copies');
await rt.saveSnapshot('expenses', 'T1', rows);
await cache.ensureCacheOwner('T2');
ok((await db.outbox.count()) === 1, 'business change leaves the outbox alone');
ok((await rt.readSnapshot('expenses', 'T1')) === null && (await rt.readSnapshot('expenses', 'T2')) === null, 'business change empties the previous business copy');
await rt.saveSnapshot('expenses', 'T2', [{ id: 9 }]);
await ret.setRetention({ expensesDays: 10 });
await cache.clearOfflineCaches();
ok((await ret.getRetention()).expensesDays === 10, 'retention setting survives sign-out');

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL OFFLINE READ-THROUGH CHECKS PASSED (Dexie stand-in)');
process.exit(fail ? 1 : 0);
