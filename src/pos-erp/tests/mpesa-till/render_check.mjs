// Renders the real MpesaPayPanel to HTML in several states (server-side render, no browser) and checks what the
// cashier would see. Needs esbuild + react + react-dom (not project dependencies):
//   node tests/mpesa-till/render_check.mjs <path-to-a-node_modules-dir-containing-esbuild-react-react-dom>
import path from 'path'; import fs from 'fs'; import os from 'os'; import { createRequire } from 'module'; import { pathToFileURL } from 'url';
const nm = path.resolve(process.argv[2] || 'node_modules'); const req = createRequire(path.join(nm, 'x.js'));
const esbuild = req('esbuild'); const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
const root = path.resolve('.'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-'));
fs.writeFileSync(path.join(tmp, 'stubs.js'), `import React from 'react'; export const Link = (p) => React.createElement('a', { href: p.to }, p.children);
const I = (n) => () => React.createElement('i', { 'data-icon': n }); export const Send = I('send'), Loader2 = I('spin'), CheckCircle2 = I('ok'), WifiOff = I('wifi'), Info = I('info');`);
await esbuild.build({ entryPoints: [path.join(root, 'components/MpesaPayPanel.jsx')], bundle: true, format: 'esm', outfile: path.join(tmp, 'panel.mjs'),
  loader: { '.js': 'jsx' }, external: ['react'], alias: { 'react-router-dom': path.join(tmp, 'stubs.js'), 'lucide-react': path.join(tmp, 'stubs.js') }, nodePaths: [nm] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
// load panel with React resolved from the supplied node_modules
fs.symlinkSync(nm, path.join(tmp, 'node_modules'));
const Panel = (await import(pathToFileURL(path.join(tmp, 'panel.mjs')).href)).default;
const FULL = { is_active: true, has_consumer_key: true, has_consumer_secret: true, has_passkey: true };
const base = { code: '', onCodeChange() {}, phone: '0712345678', onPhoneChange() {}, phoneFromCustomer: true, total: 500, isOnline: true, config: FULL, phase: 'idle', onPrompt() {}, error: '' };
const html = (o) => renderToStaticMarkup(React.createElement(Panel, { ...base, ...o }));
const btn = (h) => h.match(/<button[^>]*>/)[0];
const dis = (tag) => /\sdisabled=""/.test(tag); // the attribute, not Tailwind's disabled: class
const count = (h, re) => (h.match(re) || []).length;

let h = html({ config: null });
ok(/id="mpesa-code"/.test(h) && /Prompt/.test(h), 'no Daraja at all: the code field and the Prompt button are both on screen');
ok(dis(btn(h)) && /M-Pesa prompts are unavailable\. You can still record a manual M-Pesa payment\./.test(h), 'no Daraja: Prompt is off and says why; the code field is NOT disabled');
ok(!dis(h.match(/<input[^>]*id="mpesa-code"[^>]*>/)[0]), 'no Daraja: code field is editable');
ok(count(h, /<button/g) === 1 && count(h, /<input/g) === 1, 'one input + one button (phone box hidden while no prompt is possible)');
ok(!/Already paid|Manual payment|Verify payment|Record manual/i.test(h), 'none of the banned extra buttons/labels');
h = html({ isOnline: false });
ok(dis(btn(h)) && /internet/i.test(h) && !dis(h.match(/<input[^>]*id="mpesa-code"[^>]*>/)[0]), 'offline: Prompt blocked with a short internet message; code field still works');
h = html({});
ok(!dis(btn(h)), 'configured + online: Prompt enabled');
h = html({ phoneFromCustomer: false, phone: '' });
ok(count(h, /<input/g) === 2 && /Buyer&#x27;s M-Pesa number|Buyer's M-Pesa number/.test(h), 'phone box appears only when the customer record has no number');
h = html({ phase: 'pending' });
ok(dis(btn(h)) && /Waiting for the buyer/.test(h) && !/Payment confirmed/.test(h), 'pending: shows waiting, never paid; Prompt locked');
h = html({ phase: 'paid', code: 'SHK7X9ABCD' });
ok(/value="SHK7X9ABCD"/.test(h) && /readOnly|readonly/i.test(h) && /Payment confirmed by M-Pesa/.test(h), 'confirmed: the real code is in the SAME field, locked, with the confirmed message');
h = html({ phase: 'failed' });
ok(/Payment failed\. You can enter a manual M-Pesa code\./.test(h) && !dis(h.match(/<input[^>]*id="mpesa-code"[^>]*>/)[0]) && !/readonly/i.test(h.match(/<input[^>]*id="mpesa-code"[^>]*>/)[0]), 'failed: short explanation; code field stays usable');
h = html({ phase: 'failed', transaction: null, txStatus: 'TIMED_OUT' });
ok(dis(btn(h)) && /late confirmation/.test(h), 'timed out: uncertain wording, second prompt held back');
h = html({ code: 'AB' });
ok(/A code is 8 to 12 letters and numbers/.test(h), 'bad code gets a format hint');
console.log(fail ? `\nFAILURES: ${fail}` : '\nALL PANEL RENDER CHECKS PASSED'); process.exit(fail ? 1 : 0);
