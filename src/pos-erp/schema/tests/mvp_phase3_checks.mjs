// MVP audit Phase 2-3 checks (D-01 sale key, D-02 print, D-06 Back). Run from src/pos-erp:
//   TOOLING=/path/to/dir-with-node_modules node schema/tests/mvp_phase3_checks.mjs
// TOOLING needs: jsdom react@18 react-dom@18 esbuild lucide-react  (npm i in any scratch folder; NOT added to the project).
// Without TOOLING only the code-shape and id checks run; the browser-simulation checks are reported as SKIPPED, never as passed.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { createRequire, register } from 'module'; import { pathToFileURL } from 'url';

let fail = 0, skipped = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const skip = (m) => { console.log('SKIP ' + m); skipped++; };
const root = path.resolve('.'); const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ---------- code shape ----------
const pd = rd('utils/printDocument.js');
ok(!/window\.open\(/.test(pd.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'D-02 printDocument no longer opens a new window');
ok((pd.match(/\.print\(\)/g) || []).length === 1, 'D-02 print() is called from exactly one place (was two: onload + timer)');
ok(/afterprint/.test(pd) && /cleanup/.test(pd), 'D-02 hidden frame removes itself');
const sale = rd('services/saleService.js');
ok(/\.eq\('tenant_id', sale\.tenant_id\)\s*\n\s*\.eq\('client_reference'/.test(sale), 'D-01 duplicate lookup is scoped to the business');
ok(/already used by a different sale/.test(sale), 'D-01 same key + different total is refused, not treated as saved');
ok(/tenant_id, client_reference/.test(rd('schema/phase33_offline_key_per_tenant.sql')), 'D-01 migration scopes the unique index per business (written, NOT run)');
ok(/REVOKE ALL ON FUNCTION confirm_mpesa_payment/.test(rd('schema/phase34_mpesa_confirm_lockdown.sql')), 'D-03 lock-down migration written (NOT run)');

// ---------- id generator, on the Dexie stand-in ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-'));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
fs.mkdirSync(path.join(tmp, 'offline'), { recursive: true });
for (const f of ['db', 'idGenerator']) fs.copyFileSync(path.join(root, `offline/${f}.js`), path.join(tmp, `offline/${f}.js`));
fs.mkdirSync(path.join(tmp, 'node_modules/dexie'), { recursive: true });
fs.copyFileSync(path.join(root, 'schema/tests/offline_harness/dexie_standin.js'), path.join(tmp, 'node_modules/dexie/index.js'));
fs.writeFileSync(path.join(tmp, 'node_modules/dexie/package.json'), JSON.stringify({ name: 'dexie', type: 'module', main: 'index.js' }));
register(pathToFileURL(path.join(root, 'schema/tests/offline_harness/ext_loader.mjs')));
const { nextLocalId, getDeviceId } = await import(pathToFileURL(path.join(tmp, 'offline/idGenerator.js')));
const { db } = await import(pathToFileURL(path.join(tmp, 'offline/db.js')));

const phoneA1 = await nextLocalId('SALE'); const phoneA2 = await nextLocalId('SALE');
const devA = await getDeviceId();
ok(phoneA1 !== phoneA2 && phoneA1.includes(devA), 'D-01 same phone: ids are distinct and carry the phone id: ' + phoneA1);
await db.meta.clear(); // a second, brand-new phone: counter back to 1, new device id
const phoneB1 = await nextLocalId('SALE');
ok(phoneB1.endsWith('-000001') && phoneA1.endsWith('-000001') && phoneA1 !== phoneB1, 'D-01 two phones both on sale #1 of the day no longer collide');
const many = await Promise.all(Array.from({ length: 25 }, () => nextLocalId('SALE')));
ok(new Set(many).size === 25, 'D-01 25 rapid taps give 25 distinct ids');
ok(/^LOCAL-SALE-\d{8}-[0-9A-F]{8}-\d{6}$/.test(phoneB1), 'D-01 id format is stable: ' + phoneB1);

// ---------- browser simulation (jsdom) ----------
const TOOLING = process.env.TOOLING;
if (!TOOLING || !fs.existsSync(path.join(TOOLING, 'node_modules/jsdom'))) {
  skip('printDocument + receipt Back behaviour in a simulated browser (set TOOLING)');
} else {
  const req = createRequire(path.join(TOOLING, 'x.js'));
  const { JSDOM } = req('jsdom');
  const esbuild = req('esbuild');

  // ---- printDocument ----
  const bundle = async (entry, outName, extra = {}) => {
    fs.mkdirSync(path.join(TOOLING, '.build'), { recursive: true });
    const out = path.join(TOOLING, '.build', outName); // inside TOOLING so 'react' resolves to ONE copy
    await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: out, logLevel: 'silent', nodePaths: [path.join(TOOLING, 'node_modules')], external: ['react', 'react-dom', 'react-dom/client', 'react-dom/test-utils'], ...extra });
    return out;
  };
  const pdOut = await bundle(path.join(root, 'utils/printDocument.js'), 'pd.cjs');
  const run = (fn) => {
    const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
    global.window = dom.window; global.document = dom.window.document;
    return fn(dom);
  };
  const { printDocument } = req(pdOut);
  const frames = () => document.querySelectorAll('iframe').length;

  await run(async (dom) => {
    const sandbox = []; // capture print() calls on the frame window
    const origAppend = document.body.appendChild.bind(document.body);
    document.body.appendChild = (el) => { const r = origAppend(el); if (el.tagName === 'IFRAME') { el.contentWindow.print = () => { sandbox.push('print'); }; } return r; };
    printDocument('Receipt X', '<div>hello</div>');
    ok(frames() === 1, 'D-02 a hidden frame is added in the SAME page (no new window)');
    await new Promise((r) => setTimeout(r, 300));
    ok(sandbox.length === 1, 'D-02 the print sheet is requested once, not twice (got ' + sandbox.length + ')');
    await new Promise((r) => setTimeout(r, 1000));
    ok(sandbox.length === 1, 'D-02 still once after the old 700 ms fallback time');
    document.querySelector('iframe').contentWindow.dispatchEvent(new dom.window.Event('afterprint'));
    await new Promise((r) => setTimeout(r, 700));
    ok(frames() === 0, 'D-02 frame is removed after the print sheet closes');
  });
  await run(async () => {
    let got = null;
    const origAppend = document.body.appendChild.bind(document.body);
    document.body.appendChild = (el) => { const r = origAppend(el); if (el.tagName === 'IFRAME') el.contentWindow.print = () => { throw new Error('blocked'); }; return r; };
    printDocument('Receipt Y', '<div>hi</div>', '', { onError: (e) => { got = e; } });
    await new Promise((r) => setTimeout(r, 300));
    ok(got && /Printing did not start/.test(got.message), 'D-02 a failing print reports a clear message instead of hanging');
    ok(frames() === 0, 'D-02 a failed print leaves no frame behind');
  });

  // ---- ReceiptModal Back behaviour ----
  const stubDir = path.join(tmp, 'stubs'); fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'receiptService.js'), `export const receiptService = { printed: 0, print() { this.printed++; }, sendWhatsApp: async () => ({url:'x'}), buildEmailLink: () => 'mailto:x' };`);
  const modalOut = await bundle(path.join(root, 'components/ReceiptModal.jsx'), 'modal.cjs', {
    loader: { '.js': 'jsx' },
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /services\/receiptService$/ }, () => ({ path: path.join(stubDir, 'receiptService.js') })); } }],
  });
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://app.test/pos', pretendToBeVisual: true });
  global.window = dom.window; global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = req('react'); const { createRoot } = req('react-dom/client'); const { act } = req('react-dom/test-utils');
  const ReceiptModal = req(modalOut).default;
  const receipt = { receipt_number: 'LOCAL-SALE-1', receipt_data: { items: [{ name: 'Soap', quantity: 1, unit_price: 50 }], subtotal: 50, total_amount: 50 } };
  const mount = async (open) => {
    const el = document.getElementById('root'); const rt = createRoot(el); let closed = 0;
    const App = () => { const [on, setOn] = React.useState(true); return on ? React.createElement(ReceiptModal, { receipt, business: { name: 'Shop' }, isOnline: false, isOffline: true, onClose: () => { closed++; setOn(false); } }) : React.createElement('div', { id: 'till' }, 'till'); };
    await act(async () => { rt.render(React.createElement(App)); });
    return { rt, closedCount: () => closed };
  };
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

  const startLen = window.history.length;
  let m = await mount();
  ok(window.history.length === startLen + 1, 'D-06 opening the receipt adds one history entry');
  await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 50)); });
  ok(m.closedCount() === 1 && !!document.getElementById('till'), 'D-06 Back closes the receipt and shows the till again');
  ok(window.location.pathname === '/pos', 'D-06 Back stays on the till page (does not leave it)');
  await act(async () => { m.rt.unmount(); });

  document.getElementById('root').innerHTML = '';
  m = await mount();
  const done = [...document.querySelectorAll('button')].find((b) => /Done/.test(b.textContent));
  ok(!!done && /back to sale/i.test(done.textContent), 'D-02 a clear "Done — back to sale" button is on the receipt');
  await act(async () => { done.click(); await new Promise((r) => setTimeout(r, 80)); });
  ok(m.closedCount() === 1 && !!document.getElementById('till'), 'D-02 Done returns to the till');
  await new Promise((r) => setTimeout(r, 400)); // history.back() lands asynchronously
  ok(window.history.state?.posReceipt !== true, 'D-06 closing with Done leaves no stray history entry behind');
  await act(async () => { m.rt.unmount(); });

  document.getElementById('root').innerHTML = '';
  m = await mount();
  const pbtn = [...document.querySelectorAll('button')].find((b) => /Print/.test(b.textContent));
  await act(async () => { pbtn.click(); pbtn.click(); });
  ok(pbtn.disabled === true, 'D-02 Print button is disabled while the print sheet opens (double tap guard)');
}

console.log(fail ? `\n${fail} CHECK(S) FAILED` : `\nALL MVP PHASE 2-3 CHECKS PASSED${skipped ? ` (${skipped} skipped)` : ''}`);
process.exit(fail ? 1 : 0);
