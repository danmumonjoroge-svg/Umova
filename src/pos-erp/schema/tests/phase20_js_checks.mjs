// Phase 20 JS checks (no browser, no network). Run from anywhere:
//   node schema/tests/phase20_js_checks.mjs
// It copies roomService.js and navConfig.js into a scratch folder with stand-ins for the
// packages and the Supabase/Dexie modules, then checks the date maths, the preview a
// cashier sees before check-out, the capability rules and that every menu entry has a route.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p20-'));
const put = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

put('package.json', '{"type":"module"}');
// the app is bundled by a tool that resolves extensionless imports; plain Node needs ".js"
const copyWithExt = (rel) => put(rel, fs.readFileSync(path.join(root, rel), 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]*?)(['"])/g, (m, a, q) => (/\.[a-z]+$/.test(a) ? m : `${a}.js${q}`)));
copyWithExt('services/roomService.js');
copyWithExt('navigation/navConfig.js');
copyWithExt('services/folioService.js');
copyWithExt('services/auditService.js');
copyWithExt('utils/folioDocument.js');
copyWithExt('utils/printDocument.js');
put('services/posSupabaseClient.js', 'export const posSupabase = {};');
put('offline/db.js', 'export const db = {};');
// every icon navConfig imports from lucide-react becomes a stub export
const navSrc = fs.readFileSync(path.join(root, 'navigation/navConfig.js'), 'utf8');
const icons = navSrc.match(/import \{([^}]+)\} from 'lucide-react'/)[1].split(',').map((s) => s.trim()).filter(Boolean);
put('node_modules/lucide-react/package.json', '{"name":"lucide-react","type":"module","main":"index.js"}');
put('node_modules/lucide-react/index.js', icons.map((i) => `export const ${i} = '${i}';`).join('\n'));

const room = await import(pathToFileURL(path.join(tmp, 'services/roomService.js')).href);
const nav = await import(pathToFileURL(path.join(tmp, 'navigation/navConfig.js')).href);
const { folioService } = await import(pathToFileURL(path.join(tmp, 'services/folioService.js')).href);
const { buildFolioDocumentHtml } = await import(pathToFileURL(path.join(tmp, 'utils/folioDocument.js')).href);

let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  -> ' + info}`); if (!cond) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- dates (must agree with the database: calendar nights, minimum 1) ----
ok('2 nights Oct 6 -> Oct 8', room.nightsBetween('2026-10-06', '2026-10-08') === 2);
ok('same-day stay is 1 night', room.nightsBetween('2026-10-06', '2026-10-06') === 1);
ok('a backwards range never gives 0 or negative nights', room.nightsBetween('2026-10-08', '2026-10-06') === 1);
ok('nights across a year end', room.nightsBetween('2026-12-31', '2027-01-02') === 2);
ok('nights across a leap day', room.nightsBetween('2028-02-28', '2028-03-01') === 2);
ok('addDays crosses a month end', room.addDays('2026-10-31', 1) === '2026-11-01');
ok('addDays goes backwards over a leap day', room.addDays('2028-03-01', -1) === '2028-02-29');
const eatToday = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
ok('todayLocal is the Nairobi calendar day', room.todayLocal() === eatToday, `${room.todayLocal()} vs ${eatToday}`);
ok('formatDay prints a short day', /6/.test(room.formatDay('2026-10-06')) && room.formatDay('') === '');

// ---- what the cashier sees before check-out ----
const T = room.todayLocal();
const stay = (inOffset, outOffset, rate = 4000) => ({ check_in_date: room.addDays(T, inOffset), expected_check_out: room.addDays(T, outOffset), rate });
let p = room.roomService.previewCheckOut(stay(-1, 2));
ok('early leaver is charged the 1 night used', p.nights === 1 && p.room_total === 4000 && p.leavingEarly === true, JSON.stringify(p));
p = room.roomService.previewCheckOut(stay(-1, 2), { chargeBooked: true });
ok('"charge the booked nights" = 3 x 4,000', p.nights === 3 && p.room_total === 12000, JSON.stringify(p));
p = room.roomService.previewCheckOut(stay(0, 1));
ok('arrived today, leaving today = 1 night', p.nights === 1 && p.room_total === 4000, JSON.stringify(p));
p = room.roomService.previewCheckOut(stay(-3, -1));
ok('an overstay is charged every night actually used (3)', p.nights === 3 && p.leavingEarly === false, JSON.stringify(p));
p = room.roomService.previewCheckOut(stay(-2, 0, 2500));
ok('leaving on the booked day is not "early"', p.nights === 2 && p.room_total === 5000 && p.leavingEarly === false, JSON.stringify(p));

// ---- capabilities ----
ok('Rooms & Stays is opt-in', nav.CAPABILITIES.rooms.optIn === true);
ok('Rooms & Stays requires Customer Folios', eq(nav.CAPABILITIES.rooms.requires, ['folios']));
ok('an owner who never chose sees no Rooms and no Folios', !nav.DEFAULT_CAPABILITY_KEYS.includes('rooms') && !nav.DEFAULT_CAPABILITY_KEYS.includes('folios'));
ok('turning Rooms on brings Folios with it', eq([...nav.withRequired(['retail', 'rooms'])].sort(), ['folios', 'retail', 'rooms']));
ok('withRequired does not duplicate or invent', eq([...nav.withRequired(['retail'])], ['retail']) && nav.withRequired(['rooms', 'folios']).length === 2);

const keys = (caps) => nav.visibleModules(caps).map((m) => m.key);
ok('EXISTING MENU UNCHANGED for a business that never chose', eq(keys(nav.DEFAULT_CAPABILITY_KEYS), ['home', 'sell', 'retail', 'rentals', 'salon', 'money', 'people', 'messages', 'more']), keys(nav.DEFAULT_CAPABILITY_KEYS).join());
ok('a retailer sees no Rooms module', !keys(['retail']).includes('rooms'));
ok('a hotel (Rooms on) sees the Rooms module', keys(nav.withRequired(['retail', 'rooms'])).includes('rooms'));
const people = nav.MODULES.find((m) => m.key === 'people');
ok('Guest Folios entry is hidden without the capability', !nav.visibleChildren(people, nav.DEFAULT_CAPABILITY_KEYS).some((c) => c.to === '/pos/folios'));
ok('...and shown when Rooms switched it on', nav.visibleChildren(people, nav.withRequired(['rooms'])).some((c) => c.to === '/pos/folios'));

// ---- routing / titles ----
ok('/pos/rooms is the Rooms workspace', nav.resolveLocation('/pos/rooms').isWorkspaceRoot && nav.resolveLocation('/pos/rooms').module.key === 'rooms');
ok('/pos/room-list belongs to Rooms', nav.resolveLocation('/pos/room-list').module?.key === 'rooms');
ok('/pos/stays belongs to Rooms', nav.resolveLocation('/pos/stays').module?.key === 'rooms');
ok('/pos/folios still belongs to Customers', nav.resolveLocation('/pos/folios').module?.key === 'people');
ok('Rooms has two pages, not a pile of sidebar entries', nav.MODULES.find((m) => m.key === 'rooms').children.length === 2);
ok('Rooms lives under More on a phone (no bottom tab added)', !nav.MOBILE_TABS.some((t) => t.key === 'rooms') && nav.MOBILE_TABS.length === 5);


// ---- Phase 4 / 5: Activities and Production are opt-in and routed ----
ok('Production is opt-in', nav.CAPABILITIES.production?.optIn === true);
ok('Services & Activities is opt-in', nav.CAPABILITIES.services?.optIn === true);
ok('default menu has no Production or Activities', !keys(nav.DEFAULT_CAPABILITY_KEYS).includes('production') && !keys(nav.DEFAULT_CAPABILITY_KEYS).includes('activities'));
ok('a bakery (Production on) sees Production', keys(nav.withRequired(['retail', 'production'])).includes('production'));
ok('a retailer does not see Production', !keys(['retail']).includes('production'));
const prod = nav.MODULES.find((m) => m.key === 'production');
ok('Production has Runs + Recipes pages', eq(prod.children.map((c) => c.to).sort(), ['/pos/production-runs', '/pos/recipes']));
ok('/pos/recipes belongs to Production', nav.resolveLocation('/pos/recipes').module?.key === 'production');
ok('/pos/production-runs belongs to Production', nav.resolveLocation('/pos/production-runs').module?.key === 'production');
ok('/pos/activities belongs to Activities', nav.resolveLocation('/pos/activities').module?.key === 'activities');
ok('Production and Activities add no bottom tab', nav.MOBILE_TABS.length === 5 && !nav.MOBILE_TABS.some((t) => ['production', 'activities'].includes(t.key)));


// ---- Phase 6 / 7: Packages and Efficiency are opt-in and routed ----
ok('Packages is opt-in and needs Folios', nav.CAPABILITIES.packages?.optIn === true && eq(nav.CAPABILITIES.packages.requires, ['folios']));
ok('Efficiency is opt-in', nav.CAPABILITIES.efficiency?.optIn === true);
ok('default menu has no Packages or Efficiency', !keys(nav.DEFAULT_CAPABILITY_KEYS).includes('packages') && !keys(nav.DEFAULT_CAPABILITY_KEYS).includes('efficiency'));
ok('turning Packages on brings Folios', eq([...nav.withRequired(['packages'])].sort(), ['folios', 'packages']));
ok('a hotel with Packages on sees Packages', keys(nav.withRequired(['retail', 'packages'])).includes('packages'));
ok('a retailer sees neither', !keys(['retail']).includes('packages') && !keys(['retail']).includes('efficiency'));
ok('/pos/packages and /pos/efficiency resolve to their modules', nav.resolveLocation('/pos/packages').module?.key === 'packages' && nav.resolveLocation('/pos/efficiency').module?.key === 'efficiency');
ok('no new bottom tab', nav.MOBILE_TABS.length === 5);


// ---- Phase 8: one account, one invoice, one receipt ----
const L = (o) => ({ id: Math.random().toString(36).slice(2), quantity: 1, unit_price: o.amount, status: 'POSTED', ...o });
const lines = [
  L({ line_type: 'ROOM', description: 'Room 204 · 2 nights', quantity: 2, unit_price: 4000, amount: 8000 }),
  L({ line_type: 'PRODUCT', category: 'Food', description: 'Pilau', amount: 1800 }),
  L({ line_type: 'PRODUCT', category: 'Beverages', description: 'Soda', amount: 1100 }),
  L({ line_type: 'ACTIVITY', description: 'Swimming', amount: 500 }),
  L({ line_type: 'ACTIVITY', description: 'Football', amount: 300 }),
  L({ line_type: 'ADJUSTMENT', description: 'Goodwill', amount: -200 }),
  L({ line_type: 'SERVICE', description: 'Laundry', amount: 300 }),
  L({ line_type: 'PRODUCT', description: 'Soap', amount: 150 }),
  L({ line_type: 'PRODUCT', description: 'Family Package · Swimming', package_charge_id: 'c1', package_name: 'Family Package', package_qty: 2, amount: 900 }),
  L({ line_type: 'PRODUCT', description: 'Family Package · Lunch', package_charge_id: 'c1', package_name: 'Family Package', package_qty: 2, amount: 1600 }),
];
const secs = folioService.sections(lines);
ok('sections come in the order a guest reads: Room, Food, Drinks, Items, Services, Activities, Package, Discounts', eq(secs.map((x) => x.label), ['Room', 'Food', 'Drinks', 'Items', 'Services', 'Activities', 'Family Package × 2', 'Discounts & adjustments']), secs.map((x) => x.label).join(' | '));
ok('Food/Drinks come from the real category; uncategorised keeps its type group', secs.find((x) => x.key === 'food').subtotal === 1800 && secs.find((x) => x.key === 'drinks').subtotal === 1100 && secs.find((x) => x.key === 'items').subtotal === 150);
ok('a package is ONE block of its components and its subtotal is the package price', secs.filter((x) => x.isPackage).length === 1 && secs.find((x) => x.isPackage).subtotal === 2500 && secs.find((x) => x.isPackage).lines.map((l) => l.shown).join() === 'Swimming,Lunch');
const total = lines.reduce((a, l) => a + l.amount, 0);
ok('section subtotals add up to the folio total exactly (nothing lost or doubled)', secs.reduce((a, x) => a + x.subtotal, 0) === total, `${secs.reduce((a, x) => a + x.subtotal, 0)} vs ${total}`);
ok('every line appears once', secs.reduce((a, x) => a + x.lines.length, 0) === lines.length);
ok('old bills with no category still group by type (no Food/Drinks invented)', eq(folioService.sections([L({ line_type: 'PRODUCT', description: 'Soda', amount: 100 }), L({ line_type: 'SERVICE', description: 'Cut', amount: 700 })]).map((x) => x.label), ['Items', 'Services']));
const folio = { status: 'SETTLED', folio_number: 'FOL-1', invoice_number: 'INV-0001', receipt_number: 'RCT-0001', opened_at: '2026-10-06T08:00:00Z', settled_at: '2026-10-08T09:00:00Z',
  customer: { name: 'John Kamau' }, business: { name: 'Umova Resort' }, title: 'Room 204', total_charges: total, balance_due: 0, lines,
  payments: [{ id: 'p1', payment_method: 'MOBILE_MONEY', amount: total, reference_no: 'SHK7X9ABCD' }],
  stays: [{ room_number: '204', check_in_date: '2026-10-06', expected_check_out: '2026-10-08', status: 'CHECKED_OUT', nights_charged: 2, nights_booked: 2 }] };
const rct = buildFolioDocumentHtml(folio, 'receipt'); const inv = buildFolioDocumentHtml(folio, 'invoice');
ok('receipt carries the receipt number, invoice carries the invoice number', rct.includes('RCT-0001') && !rct.includes('INV-0001') && inv.includes('INV-0001'));
ok('one document shows Room, Food, Drinks, Activities, the package and the payment', ['Room', 'Food', 'Drinks', 'Activities', 'Family Package × 2', 'SHK7X9ABCD', 'John Kamau'].every((t) => rct.includes(t)));
ok('the stay is stated (Room 204, 2 nights)', rct.includes('Room 204') && /2 nights/.test(rct));
ok('the total is printed once as the sum of everything (' + total.toLocaleString() + ') and the bill reads PAID', rct.includes(total.toLocaleString()) && rct.includes('PAID'));
ok('package components show no separate prices (one price for the block)', !rct.includes('>900<') && !rct.includes('>1,600<') && rct.includes('2,500'));
ok('no NaN/undefined anywhere in the document', !/NaN|undefined/.test(rct + inv));
const open = buildFolioDocumentHtml({ ...folio, status: 'OPEN', balance_due: 500, payments: [] }, 'invoice');
ok('an unpaid invoice shows BALANCE DUE', open.includes('BALANCE DUE'));

// ---- every menu link has a route ----
const app = fs.readFileSync(path.join(root, 'POSApp.jsx'), 'utf8');
const routes = new Set([...app.matchAll(/<Route\s+(?:index|path="([^"]*)")/g)].map((m) => (m[1] === undefined ? '' : m[1])));
const links = nav.MODULES.flatMap((m) => [m.to, ...m.children.map((c) => c.to)]);
const missing = links.filter((to) => !routes.has(to.replace(/^\/pos\/?/, '')));
ok('every menu entry has a route in POSApp', missing.length === 0, missing.join(', '));

console.log(fails === 0 ? '\nALL JS CHECKS PASSED' : `\n${fails} JS CHECK(S) FAILED`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
