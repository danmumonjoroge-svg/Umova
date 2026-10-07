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
put('services/posSupabaseClient.js', 'export const posSupabase = {};');
put('offline/db.js', 'export const db = {};');
// every icon navConfig imports from lucide-react becomes a stub export
const navSrc = fs.readFileSync(path.join(root, 'navigation/navConfig.js'), 'utf8');
const icons = navSrc.match(/import \{([^}]+)\} from 'lucide-react'/)[1].split(',').map((s) => s.trim()).filter(Boolean);
put('node_modules/lucide-react/package.json', '{"name":"lucide-react","type":"module","main":"index.js"}');
put('node_modules/lucide-react/index.js', icons.map((i) => `export const ${i} = '${i}';`).join('\n'));

const room = await import(pathToFileURL(path.join(tmp, 'services/roomService.js')).href);
const nav = await import(pathToFileURL(path.join(tmp, 'navigation/navConfig.js')).href);

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

// ---- every menu link has a route ----
const app = fs.readFileSync(path.join(root, 'POSApp.jsx'), 'utf8');
const routes = new Set([...app.matchAll(/<Route\s+(?:index|path="([^"]*)")/g)].map((m) => (m[1] === undefined ? '' : m[1])));
const links = nav.MODULES.flatMap((m) => [m.to, ...m.children.map((c) => c.to)]);
const missing = links.filter((to) => !routes.has(to.replace(/^\/pos\/?/, '')));
ok('every menu entry has a route in POSApp', missing.length === 0, missing.join(', '));

console.log(fails === 0 ? '\nALL JS CHECKS PASSED' : `\n${fails} JS CHECK(S) FAILED`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
