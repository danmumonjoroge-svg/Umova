// Offline-mode checks (POS module). Run from src/pos-erp:   node schema/tests/offline_js_checks.mjs
//
// Copies the real offline files (offline/*.js, the sale/shift hooks' pure helpers) into a temp folder, wires them to
//   * a small in-memory stand-in for Dexie  (see offline_harness/dexie_standin.js -- used because Dexie could not be
//     downloaded where these were written; pass --real on a machine that has dexie + fake-indexeddb installed), and
//   * a fake "server" (saleService / cashierService stubs) that can be told to drop the connection, refuse, expire the
//     sign-in, or behave idempotently -- so every retry/duplicate/ordering rule is exercised, not just described.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url'; import { register } from 'module';

let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const REAL = process.argv.includes('--real');
const root = path.resolve('.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-'));
const cp = (from, to) => { fs.mkdirSync(path.dirname(path.join(tmp, to)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(tmp, to)); };
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
for (const f of ['db', 'idGenerator', 'netErrors', 'offlineIdentity', 'offlineCache', 'offlineShift', 'offlineSaleService', 'syncEngine', 'queueLabels']) cp(`offline/${f}.js`, `offline/${f}.js`);
if (!REAL) {
  fs.mkdirSync(path.join(tmp, 'node_modules/dexie'), { recursive: true });
  fs.copyFileSync(path.join(root, 'schema/tests/offline_harness/dexie_standin.js'), path.join(tmp, 'node_modules/dexie/index.js'));
  fs.writeFileSync(path.join(tmp, 'node_modules/dexie/package.json'), JSON.stringify({ name: 'dexie', type: 'module', main: 'index.js' }));
} else { await import('fake-indexeddb/auto'); }

// ---- fake server -----------------------------------------------------------------------------------------------
fs.mkdirSync(path.join(tmp, 'services'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'services/fakeServer.js'), `
export const server = { sales: [], shifts: [], mode: 'ok', calls: [], failFor: null, reset() { this.sales.length = 0; this.shifts.length = 0; this.mode = 'ok'; this.calls.length = 0; this.failFor = null; } };
const netErr = () => ({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }); // exactly what supabase-js hands back
export function maybeFail(key) {
  if (server.mode === 'network') throw netErr();
  if (server.mode === 'jwt') throw { code: 'PGRST301', message: 'JWT expired', status: 401 };
  if (server.mode === 'refuse' && (!server.failFor || server.failFor(key))) throw { code: '23514', message: 'new row violates check constraint' };
}
`);
fs.writeFileSync(path.join(tmp, 'services/saleService.js'), `
import { server, maybeFail } from './fakeServer.js';
export const saleService = { async create(sale) {
  server.calls.push({ kind: 'sale', ref: sale.client_reference, fromOfflineQueue: !!sale.fromOfflineQueue, shift_id: sale.shift_id });
  maybeFail(sale);
  if (!sale.fromOfflineQueue) { /* online path: server would run its stock pre-check */ }
  if (server.shifts.length && sale.shift_id && !server.shifts.some(s => s.id === sale.shift_id) && sale.requireShift !== false && server.requireShiftOnServer) throw { code: '23503', message: 'foreign key violation: shift' };
  const existing = server.sales.find(s => s.client_reference === sale.client_reference);
  if (existing) return existing;
  const row = { id: 'srv-' + (server.sales.length + 1), sale_number: 'S-' + String(server.sales.length + 1).padStart(6, '0'), client_reference: sale.client_reference, completed_at: sale.completed_at, payload: sale };
  server.sales.push(row); return row;
} };
`);
fs.writeFileSync(path.join(tmp, 'services/cashierService.js'), `
import { server, maybeFail } from './fakeServer.js';
export const cashierService = { async openShift(shift) {
  server.calls.push({ kind: 'shift', id: shift.id });
  maybeFail(shift);
  if (server.shifts.some(s => s.id === shift.id)) throw { code: '23505', message: 'duplicate key value violates unique constraint "lb_cashier_shifts_pkey"' };
  server.shifts.push(shift); return shift;
} };
`);
// environment the browser would provide
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
let onLine = true;
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => onLine, configurable: true });
globalThis.window = { dispatchEvent() {} };

register(pathToFileURL(path.join(root, 'schema/tests/offline_harness/ext_loader.mjs')));
const imp = (f) => import(pathToFileURL(path.join(tmp, f)).href);
const { db, getMeta } = await imp('offline/db.js');
const net = await imp('offline/netErrors.js');
const ident = await imp('offline/offlineIdentity.js');
const cache = await imp('offline/offlineCache.js');
const shiftMod = await imp('offline/offlineShift.js');
const sales = await imp('offline/offlineSaleService.js');
const sync = await imp('offline/syncEngine.js');
const labels = await imp('offline/queueLabels.js');
const { server } = await imp('services/fakeServer.js');

const ob = async (n) => (await db.outbox.orderBy('id').toArray())[n - 1];            // n-th saved item (1 = oldest) -- ids are not reused after a clear
const idOf = async (n) => (await ob(n)).id;
const reset = async () => { for (const t of ['outbox', 'products_cache', 'customers_cache', 'meta']) await db[t].clear(); server.reset(); onLine = true; store.clear(); };
const mkSale = (o = {}) => ({ tenant_id: 'T1', business_id: 'B1', cashier_id: 'U1', shift_id: 'SH1', customer_id: null,
  items: [{ product_id: 'P1', name: 'Sugar', quantity: 2, unit_price: 100, cost_price: 80 }], payments: [{ payment_method: 'CASH', amount: 200, change_amount: 0 }], ...o });

// ---- 1 error classification --------------------------------------------------------------------------------------
await reset();
ok(net.isNetworkFailure({ message: 'TypeError: Failed to fetch' }), 'supabase-style "TypeError: Failed to fetch" object is a network failure (old name==="TypeError" check missed it)');
ok(net.isNetworkFailure({ message: 'Load failed' }) && net.isNetworkFailure({ name: 'AuthRetryableFetchError', message: 'x' }), 'Safari "Load failed" and AuthRetryableFetchError are network failures');
ok(!net.isNetworkFailure({ code: '23514', message: 'check constraint' }), 'a real constraint refusal is NOT a network failure');
onLine = false; ok(net.isNetworkFailure({ message: 'anything' }), 'navigator offline => network failure'); onLine = true;
ok(net.isAuthFailure({ code: 'PGRST301', message: 'JWT expired' }) && !net.isAuthFailure({ code: '23514' }), 'expired sign-in is an auth failure, a constraint is not');
ok(net.isDuplicateKey({ code: '23505' }) && !net.isDuplicateKey({ code: '23514' }), 'duplicate key detected');

// ---- 2 saved sign-in ---------------------------------------------------------------------------------------------
const staff = { id: 'S1', name: 'Wanjiru', role: 'cashier' }, tenant = { id: 'T1', business_id: 'B1' };
ok(ident.loadOfflineIdentity() === null, 'no saved sign-in => cannot open offline');
ident.saveOfflineIdentity({ staff, tenant }, 1000);
ok(ident.loadOfflineIdentity(1000 + 13 * 864e5)?.staff.name === 'Wanjiru', 'saved sign-in works 13 days later');
ok(ident.loadOfflineIdentity(1000 + 15 * 864e5) === null, 'saved sign-in EXPIRES after 14 days');
ident.clearOfflineIdentity(); ok(ident.loadOfflineIdentity(1000) === null, 'sign-out erases the saved sign-in');
ident.saveOfflineIdentity({ staff: { ...staff, must_change_password: true }, tenant }, 1000);
ok(ident.loadOfflineIdentity(1000) === null, 'a person who must change their password is never let in offline');
ok(!JSON.stringify([...store.values()]).match(/password|token|secret/i) || !/"password"|access_token/i.test(JSON.stringify([...store.values()])), 'saved sign-in holds no password or token');

// ---- 3 offline sale queued ---------------------------------------------------------------------------------------
await reset();
await cache.cacheProducts([{ id: 'P1', name: 'Sugar', selling_price: 100, barcode: '616', track_inventory: true, selling_mode: 'WEIGHT' }]);
await cache.cacheServerStockLevels([{ productId: 'P1', quantity: 5 }]);
let r = await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
ok(r._offlineStatus === 'LOCAL_PENDING' && /^LOCAL-SALE-\d{8}-[0-9A-F]{8}-000001$/.test(r.sale_number), 'offline sale gets a LOCAL id, status LOCAL_PENDING (never looks synced)');
let rows = await db.outbox.toArray();
ok(rows.length === 1 && rows[0].status === 'PENDING' && rows[0].tenantId === 'T1' && rows[0].payload.completed_at === r.completed_at, 'queued PENDING with business id and the real sale time');
ok((await db.products_cache.get('P1')).quantity === 3, 'cached stock went 5 -> 3 so the same phone cannot sell it twice');
ok((await db.products_cache.get('P1')).selling_mode === 'WEIGHT', 'cached item keeps its selling mode (weight items still work offline)');
await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'P1', name: 'Sugar', quantity: 3, unit_price: 100 }] }), { isOnline: false });
let threw = ''; try { await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'P1', name: 'Sugar', quantity: 1, unit_price: 100 }] }), { isOnline: false }); } catch (e) { threw = e.message; }
ok(/Insufficient stock/.test(threw), 'offline sale refused when cached stock is used up (no overselling on this phone)');
threw = ''; try { await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'PX', name: 'Tea', quantity: 1, unit_price: 50 }], payments: [{ payment_method: 'CREDIT', amount: 50 }] }), { isOnline: false }); } catch (e) { threw = e.message; }
ok(/Select a customer/.test(threw), 'offline credit sale without a customer is refused immediately');
threw = ''; try { await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'PX', name: 'Tea', quantity: 1, unit_price: 50 }], folio_id: 'F1', customer_id: null, payments: [] }), { isOnline: false }); } catch (e) { threw = e.message; }
ok(/folio/.test(threw), 'offline folio sale without a customer is refused');
ok((await db.outbox.count()) === 2, 'refused sales were NOT queued');

// ---- 4 online attempt that loses the connection ------------------------------------------------------------------
await reset();
server.mode = 'network';
r = await sales.createOfflineAwareSale(mkSale(), { isOnline: true });
ok(r._offlineStatus === 'LOCAL_PENDING' && (await db.outbox.count()) === 1, 'online sale that drops mid-way is queued instead of lost (regression: supabase error objects are not TypeErrors)');
server.reset();
server.mode = 'refuse';
threw = ''; try { await sales.createOfflineAwareSale(mkSale(), { isOnline: true }); } catch (e) { threw = e.code || e.message; }
ok(threw === '23514' && (await db.outbox.count()) === 1, 'a REAL server refusal is shown to the cashier and NOT queued');
server.reset();
r = await sales.createOfflineAwareSale(mkSale({ client_reference: 'LOCAL-SALE-X-1' }), { isOnline: true });
ok(r._offlineStatus === 'SYNCED' && server.sales[0].client_reference === 'LOCAL-SALE-X-1', 'online sale carries its idempotency key');

// ---- 5 sync: send, idempotency, order ----------------------------------------------------------------------------
await reset();
for (let i = 0; i < 3; i++) await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'P' + i, name: 'I' + i, quantity: 1, unit_price: 10 }], payments: [{ payment_method: 'CASH', amount: 10 }] }), { isOnline: false });
let res = await sync.runSync({ tenantId: 'T1' });
ok(res.synced === 3 && server.sales.length === 3 && (await sync.countUnsent()) === 0, 'three offline sales are all sent and marked sent');
ok(server.sales.map(s => s.client_reference).join() === (await db.outbox.orderBy('id').toArray()).map(r => r.clientReference).join(), 'sent in the order they were made');
ok(server.sales[0].completed_at === (await ob(1)).payload.completed_at, 'the server receives the time of the SALE, not of the upload');
ok(server.calls.every(c => c.fromOfflineQueue), 'sync marks sales as coming from the offline queue (skips server stock pre-check)');
const before = server.sales.length;
await db.outbox.update(await idOf(1), { status: 'PENDING' }); // pretend the reply was lost and the phone tries again
res = await sync.runSync({ tenantId: 'T1' });
ok(server.sales.length === before && res.synced === 1, 'resending the same sale does NOT create a second one (idempotent)');

// ---- 6 sync: connection drops, sign-in expires, server refuses ---------------------------------------------------
await reset();
for (let i = 0; i < 3; i++) await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'Q' + i, name: 'I', quantity: 1, unit_price: 10 }], payments: [{ payment_method: 'CASH', amount: 10 }] }), { isOnline: false });
server.mode = 'network';
res = await sync.runSync({ tenantId: 'T1' });
rows = await db.outbox.orderBy('id').toArray();
ok(res.deferred === 1 && rows.every(r => r.status === 'PENDING') && server.calls.length === 1, 'dropped connection: everything stays PENDING (not "needs attention"), and it stops after the first try');
server.mode = 'ok';
res = await sync.runSync({ tenantId: 'T1' });
ok(res.synced === 3, 'when the connection returns the rest is sent automatically');
await reset();
await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
server.mode = 'jwt';
res = await sync.runSync({ tenantId: 'T1' });
ok(res.authRequired && (await ob(1)).status === 'PENDING' && (await sync.needsSignIn()) === true, 'expired sign-in: sale stays PENDING and the owner is told to sign in again');
server.mode = 'ok'; await sync.runSync({ tenantId: 'T1' });
ok((await sync.needsSignIn()) === false && (await ob(1)).status === 'SYNCED', 'after signing in it is sent and the warning clears');
await reset();
await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
server.mode = 'refuse';
res = await sync.runSync({ tenantId: 'T1' });
let row = await ob(1);
ok(res.failed === 1 && row.status === 'FAILED' && /check constraint/.test(row.error), 'a refused sale becomes FAILED with the server\'s reason, and is not retried blindly');
ok((await sync.countUnsent()) === 1, 'a FAILED sale still counts as not-yet-sent (it has not vanished)');
server.mode = 'ok';
res = await sync.runSync({ tenantId: 'T1' });
ok(res.synced === 0 && (await ob(1)).status === 'FAILED', 'FAILED rows are not retried automatically');
await sync.retryFailed(await idOf(1)); res = await sync.runSync({ tenantId: 'T1' });
ok((await ob(1)).status === 'SYNCED' && !((await ob(1)).error), 'owner presses "Try again" => sent');

// ---- 7 stuck SYNCING, other business, set aside, tidy ------------------------------------------------------------
await reset();
await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
await db.outbox.update(await idOf(1), { status: 'SYNCING' }); // page was closed mid-send
res = await sync.runSync({ tenantId: 'T1' });
ok((await ob(1)).status === 'SYNCED', 'a sale stuck in "sending" after the page was closed is picked up again (it used to be stranded forever)');
await reset();
await sales.createOfflineAwareSale(mkSale({ tenant_id: 'OTHER' }), { isOnline: false });
res = await sync.runSync({ tenantId: 'T1' });
ok(server.sales.length === 0 && (await ob(1)).status === 'PENDING', 'a different business signed in on the same phone does not send this business\'s sales');
await reset();
await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
let t2 = ''; try { await sync.setAsideFailed(await idOf(1)); } catch (e) { t2 = e.message; }
ok(/needs attention/.test(t2), 'a sale still waiting cannot be set aside');
server.mode = 'refuse'; await sync.runSync({ tenantId: 'T1' });
await sync.setAsideFailed(await idOf(1), { by: 'Owner', note: 'entered by hand' });
row = await ob(1);
ok(row.status === 'DISCARDED' && row.discardedBy === 'Owner' && (await sync.countUnsent()) === 0 && row.payload.items.length === 1, 'set aside keeps the record (who/when), stops counting as waiting');
await reset();
await db.outbox.add({ kind: 'sale', status: 'SYNCED', clientReference: 'old', syncedAt: new Date(Date.now() - 20 * 864e5).toISOString(), payload: {}, createdAt: 'x' });
await db.outbox.add({ kind: 'sale', status: 'SYNCED', clientReference: 'new', syncedAt: new Date().toISOString(), payload: {}, createdAt: 'x' });
await sync.runSync({ tenantId: 'T1' });
ok((await db.outbox.count()) === 1 && (await ob(1)).clientReference === 'new', 'sent items older than 14 days are tidied away, recent ones kept');

// ---- 8 shifts opened offline -------------------------------------------------------------------------------------
await reset();
const sh = await shiftMod.queueShiftOpen({ tenant: { id: 'T1', business_id: 'B1' }, staffId: 'U1', openingFloat: 500, shiftNumber: 'DEMO-1' });
ok(sh._local === true && /^[0-9a-f-]{36}$/.test(sh.id) && (await shiftMod.getCachedActiveShift('U1')).id === sh.id, 'offline shift gets a phone-made id and is remembered as the active shift');
await sales.createOfflineAwareSale(mkSale({ shift_id: sh.id }), { isOnline: false });
ok((await shiftMod.unsentForShift(sh.id)) === 2, 'shift + its sale are counted as unsent (closing the shift is blocked until both are sent)');
res = await sync.runSync({ tenantId: 'T1' });
ok(server.calls.map(c => c.kind).join() === 'shift,sale' && server.shifts.length === 1 && server.sales.length === 1, 'the shift is sent BEFORE the sale that uses it');
ok((await shiftMod.unsentForShift(sh.id)) === 0 && (await shiftMod.getCachedActiveShift('U1'))._local === false, 'once sent, the shift is a normal shift and nothing is waiting');
await db.outbox.update(await idOf(1), { status: 'PENDING' }); res = await sync.runSync({ tenantId: 'T1' });
ok(server.shifts.length === 1 && (await ob(1)).status === 'SYNCED', 'resending the shift (reply lost) is "already saved", not an error and not a second shift');
await reset();
const sh2 = await shiftMod.queueShiftOpen({ tenant: { id: 'T1' }, staffId: 'U1', openingFloat: 0, shiftNumber: 'X' });
await sales.createOfflineAwareSale(mkSale({ shift_id: sh2.id }), { isOnline: false });
server.mode = 'refuse'; server.failFor = (k) => !!k.opening_float === false || k.id === sh2.id;
await sync.runSync({ tenantId: 'T1' });
server.mode = 'ok'; res = await sync.runSync({ tenantId: 'T1' });
ok((await ob(1)).status === 'FAILED' && (await ob(2)).status === 'PENDING' && server.sales.length === 0 && res.blocked === 1, 'if the shift is refused its sales WAIT (not lost, not failed with a confusing error)');

// ---- 9 caches ----------------------------------------------------------------------------------------------------
await reset();
await cache.cacheProducts([{ id: 'P1', name: 'Sugar', selling_price: 100, barcode: '616', track_inventory: true }]);
await cache.cacheServerStockLevels([{ productId: 'P1', quantity: 10 }]);
await cache.cacheProducts([{ id: 'P1', name: 'Sugar 1kg', selling_price: 110, barcode: '616', track_inventory: true }]);
let p = await db.products_cache.get('P1');
ok(p.quantity === 10 && p.name === 'Sugar 1kg' && p.selling_price === 110, 'refreshing the item list keeps the last known stock (it used to wipe it to blank)');
await sales.createOfflineAwareSale(mkSale({ items: [{ product_id: 'P1', name: 'Sugar', quantity: 4, unit_price: 100 }] }), { isOnline: false });
await cache.cacheServerStockLevels([{ productId: 'P1', quantity: 10 }]); // server still thinks 10 (does not know about the unsent sale)
ok((await db.products_cache.get('P1')).quantity === 6, 'stock refreshed from the server has the still-unsent sales taken off (no "stock coming back")');
const hit = await cache.findCachedByBarcode('616');
ok(hit?.product.id === 'P1' && hit.stock.quantity === 6 && (await cache.findCachedByBarcode('999')) === null, 'barcode scan works from the phone\'s saved list; unknown barcode => not found');
await cache.cacheValue('business:B1', { name: 'Mama Njeri Shop' });
ok((await cache.readCachedValue('business:B1')).name === 'Mama Njeri Shop' && (await cache.readCachedValue('nope')) === null, 'business/settings copy round-trips');

// ---- 9b one business per saved copy -------------------------------------------------------------------------------------
await reset();
await cache.ensureCacheOwner('REAL'); await cache.cacheCustomers([{ id: 'c1', tenant_id: 'REAL', name: 'Real Customer' }]); await cache.cacheProducts([{ id: 'p1', name: 'Real item', selling_price: 1 }]);
await cache.ensureCacheOwner('REAL');
ok((await cache.getCachedCustomers()).length === 1, 'same business signing in again keeps its saved copy');
await cache.ensureCacheOwner('DEMO');
ok((await cache.getCachedCustomers()).length === 0 && (await cache.getCachedProducts()).length === 0 && (await getMeta('cacheOwner')) === 'DEMO', 'a DIFFERENT business (demo) signing in on the same phone empties the first one\'s saved customers and items (no mixing)');
await cache.cacheCustomers([{ id: 'c2', tenant_id: 'DEMO', name: 'Demo Customer' }]); await cache.cacheValue('business:X', { a: 1 });
await sales.createOfflineAwareSale(mkSale(), { isOnline: false });
await cache.clearOfflineCaches();
ok((await cache.getCachedCustomers()).length === 0 && (await cache.readCachedValue('business:X')) === null && (await db.outbox.count()) === 1, 'sign-out empties the saved copy but NEVER the unsent sales');

// ---- 10 wording --------------------------------------------------------------------------------------------------
const d = labels.describeRow({ id: 1, kind: 'sale', status: 'PENDING', clientReference: 'LOCAL-SALE-1', createdAt: '2026-10-17T10:00:00Z', payload: { items: [{ name: 'Sugar', quantity: 2, unit_price: 100 }, { name: 'Milk', quantity: 1, unit_price: 60 }, { name: 'Soap', quantity: 1, unit_price: 40 }], payments: [{ payment_method: 'MOBILE_MONEY' }] } });
ok(d.statusLabel === 'Saved on this phone' && /KES 300/.test(d.title) && /M-Pesa/.test(d.detail) && /\+1 more/.test(d.detail), 'queue wording: "Saved on this phone", total, M-Pesa label, "+1 more"');
ok(labels.describeRow({ kind: 'sale', status: 'SYNCED', payload: {} }).statusLabel === 'Sent' && labels.describeRow({ kind: 'sale', status: 'FAILED', payload: {} }).statusLabel === 'Needs attention' && labels.describeRow({ kind: 'sale', status: 'DISCARDED', payload: {} }).statusLabel === 'Set aside', 'each state keeps its own honest label (Sent / Needs attention / Set aside)');
ok(labels.countWords([{ kind: 'sale' }, { kind: 'sale' }]) === '2 sales' && labels.countWords([{ kind: 'sale' }, { kind: 'shift_open' }]) === '2 items', 'count wording');

// ---- 11 static checks on the files that change existing behaviour -----------------------------------------------------
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ss = rd('services/saleService.js');
ok(/sale\.fromOfflineQueue \? \[\] : sale\.items/.test(ss) && /completed_at: sale\.completed_at \|\| new Date\(\)/.test(ss), 'saleService: offline-queue skip of stock pre-check + keeps real sale time');
ok(/\.\.\.shift \}\)/.test(rd('services/cashierService.js')) || /opened_at: new Date\(\)\.toISOString\(\), \.\.\.shift/.test(rd('services/cashierService.js')), 'cashierService.openShift honours an offline shift\'s own id and time');
const ctx = rd('context/POSAuthContext.js');
ok(/saveOfflineIdentity\(\{ staff: profile\.staff/.test(ctx) && /clearOfflineIdentity\(\)/.test(ctx) && /addEventListener\("online"/.test(ctx), 'auth: saves identity after an online check, clears it on sign-out, re-checks when internet returns');
ok(/const clientReference = sale\.client_reference \|\| await nextLocalId/.test(rd('offline/offlineSaleService.js')), 'one idempotency key shared by online attempt and queued copy (unchanged guarantee)');
ok(/OfflinePageGate/.test(rd('POSLayout.jsx')) && /useWarmPosCache/.test(rd('offline/ConnectionStatus.jsx')) && /OfflineQueuePanel/.test(rd('offline/ConnectionStatus.jsx')), 'gate, cache warm-up and queue panel are wired in');
const pc = rd('navigation/PermissionsContext.jsx');
ok(/owner \|\| !state\.loaded \? true/.test(pc) && /signedInAsOwner/.test(pc), 'the business owner can open every page even if the permission list is missing/empty');
ok(/c\.tenant_id === tenant\.id/.test(rd('hooks/useCustomers.js')) && /ensureCacheOwner\(profile\.tenant/.test(ctx), 'customers fallback is filtered to the signed-in business; sign-in empties another business\'s copy');
const pg = await import(pathToFileURL(path.join(root, 'offline/OfflinePageGate.jsx')).href).catch(() => null); // JSX cannot be imported by node; checked textually
const gate = rd('offline/OfflinePageGate.jsx');
ok(/OFFLINE_READY_PATHS = \['\/pos'\]/.test(gate), 'only the Sell page can WRITE offline (declared offline-ready)');
// ---- M-Pesa "already paid" (manual code): needs no setup, works offline, code guarded ---------------------------------
{
  const mp = await import(pathToFileURL(path.join(root, 'utils/mpesa.js')).href);
  const none = mp.resolveMpesa({ isOnline: true, config: null });
  ok(none.stkStatus === 'not_setup' && none.effectiveMode === 'MANUAL', 'M-Pesa with NO setup at all: till uses "Already paid" (no prompt, no setup needed)');
  ok(mp.resolveMpesa({ isOnline: false, config: { is_active: true, has_consumer_key: true, has_consumer_secret: true, has_passkey: true } }).effectiveMode === 'MANUAL', 'M-Pesa offline: "Already paid" even if a prompt is set up');
  ok(mp.resolveMpesa({ isOnline: true, config: undefined }).effectiveMode === 'MANUAL', 'M-Pesa while the setup check is still running: "Already paid"');
  ok(mp.resolveMpesa({ isOnline: true, config: { is_active: true, has_consumer_key: true, has_consumer_secret: true, has_passkey: false } }).effectiveMode === 'MANUAL', 'M-Pesa with half-finished setup: "Already paid"');
  ok(mp.resolveMpesa({ isOnline: true, config: { is_active: true, has_consumer_key: true, has_consumer_secret: true, has_passkey: true }, chosenMode: 'PROMPT' }).effectiveMode === 'PROMPT', 'prompt only when internet AND full setup');
  ok(mp.isValidMpesaCode('shk7x9abcd') && mp.normalizeMpesaCode(' shk-7x9abcd ') === 'SHK7X9ABCD' && !mp.isValidMpesaCode('12'), 'code is cleaned to capitals and a too-short code is refused');
  ok(mp.paymentLabel({ payment_method: 'MOBILE_MONEY', reference_no: 'shk7x9abcd' }) === 'M-Pesa SHK7X9ABCD' && mp.paymentLabel({ payment_method: 'CASH' }) === 'Cash', 'receipt says "M-Pesa <code>", not "MOBILE MONEY"');

  await reset();
  await cache.cacheProducts([{ id: 'P1', name: 'Sugar', selling_price: 100, track_inventory: true }]);
  await cache.cacheServerStockLevels([{ productId: 'P1', quantity: 20 }]);
  const mpay = (code) => [{ payment_method: 'MOBILE_MONEY', amount: 200, change_amount: 0, reference_no: code }];
  const m1 = await sales.createOfflineAwareSale(mkSale({ payments: mpay('SHK7X9ABCD') }), { isOnline: false });
  ok(m1._offlineStatus === 'LOCAL_PENDING' && m1.payments[0].reference_no === 'SHK7X9ABCD', 'offline M-Pesa (code) sale is saved on the phone with its code');
  ok(await sales.findQueuedMpesaCode('shk7x9abcd', 'T1') === true, 'the same code typed again on this phone is caught, even offline');
  ok(await sales.findQueuedMpesaCode('SHK7X9ZZZZ', 'T1') === false, 'a different code is not blocked');
  ok(await sales.findQueuedMpesaCode('SHK7X9ABCD', 'OTHER') === false, 'another business\'s code is not mixed in');
  onLine = true;
  const s1 = await sync.runSync({ tenantId: 'T1' });
  ok(s1.synced === 1 && server.sales[0].payload.payments[0].reference_no === 'SHK7X9ABCD' && server.sales[0].payload.payments[0].payment_method === 'MOBILE_MONEY', 'when internet returns the M-Pesa sale is sent once, with its code');
  ok(await sales.findQueuedMpesaCode('SHK7X9ABCD', 'T1') === false, 'once sent, the server (not the phone queue) guards the code');
}

console.log(fail ? '\nFAILURES: ' + fail : '\nALL OFFLINE (POS) CHECKS PASSED' + (REAL ? ' (real Dexie)' : ' (Dexie stand-in)')); process.exit(fail ? 1 : 0);
