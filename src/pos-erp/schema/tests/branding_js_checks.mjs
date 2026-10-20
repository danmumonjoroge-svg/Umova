// Branding JS checks (no browser, no network). Run from anywhere:  node schema/tests/branding_js_checks.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
const put = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
put('package.json', '{"type":"module"}');
const copyWithExt = (rel) => put(rel, fs.readFileSync(path.join(root, rel), 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]*?)(['"])/g, (m, a, q) => (/\.[a-z]+$/.test(a) ? m : `${a}.js${q}`)));
copyWithExt('utils/logoImage.js'); copyWithExt('utils/businessHeader.js'); copyWithExt('utils/printDocument.js'); copyWithExt('services/settingsService.js');
// stand-in storage client that records what is asked of it
put('services/posSupabaseClient.js', `
export const calls = [];
const chain = (r) => { const o = { update: (v) => { calls.push(['update', v]); return o; }, eq: () => o, select: () => o, single: async () => ({ data: { id: 'b1', logo_url: calls.at(-1)?.[1]?.logo_url ?? null }, error: null }) }; return o; };
export const posSupabase = {
  from: () => chain(),
  storage: { from: (bucket) => ({
    upload: async (path, blob, opts) => { calls.push(['upload', bucket, path, opts]); return { error: null }; },
    remove: async (paths) => { calls.push(['remove', paths]); return { error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }),
  }) },
};`);
const L = await import(pathToFileURL(path.join(tmp, 'utils/logoImage.js')).href);
const H = await import(pathToFileURL(path.join(tmp, 'utils/businessHeader.js')).href);
const S = await import(pathToFileURL(path.join(tmp, 'services/settingsService.js')).href);
const C = await import(pathToFileURL(path.join(tmp, 'services/posSupabaseClient.js')).href);

let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  -> ' + info}`); if (!cond) fails++; };
const bytes = (...a) => Uint8Array.from([...a, ...new Array(Math.max(0, 16 - a.length)).fill(0)]);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// ---- the file's REAL type, not the name or the type the browser claims ----
ok('PNG recognised by its bytes', L.sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) === 'png');
ok('JPEG recognised', L.sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)) === 'jpeg');
ok('WebP recognised', L.sniffImageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'))) === 'webp');
ok('SVG text is not an image we accept', L.sniffImageType(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"'))) === null);
ok('an HTML/script file renamed logo.png is refused', L.sniffImageType(bytes(...ascii('<script>alert(1)</script>'))) === null);
ok('GIF is refused', L.sniffImageType(bytes(...ascii('GIF89a'))) === null);
ok('a PDF is refused', L.sniffImageType(bytes(...ascii('%PDF-1.7'))) === null);
ok('too-short / empty input is refused', L.sniffImageType(new Uint8Array(3)) === null && L.sniffImageType(null) === null);

// ---- size and dimensions ----
ok('empty file refused', /empty/.test(L.checkLogoFile({ size: 0, type: 'image/png' }) || ''));
ok('4 MB file refused with a plain message', /too big/.test(L.checkLogoFile({ size: 4 * 1048576, type: 'image/png' }) || ''));
ok('SVG refused by declared type with a plain message', /SVG/.test(L.checkLogoFile({ size: 1000, type: 'image/svg+xml' }) || ''));
ok('a normal PNG passes the file check', L.checkLogoFile({ size: 120000, type: 'image/png' }) === null);
ok('32x32 is too small', /too small/.test(L.checkLogoLimits(32, 32) || ''));
ok('one short side is enough to be too small (4000x40)', /too small/.test(L.checkLogoLimits(4000, 40) || ''));
ok('7000x7000 is too large', /too large/.test(L.checkLogoLimits(7000, 7000) || ''));
ok('600x400 passes', L.checkLogoLimits(600, 400) === null);
ok('unreadable size refused', L.checkLogoLimits(0, 0) !== null);

// ---- fit / crop maths ----
ok('a big logo is scaled down to 512 on its long side, shape kept', JSON.stringify(L.fitSize(2000, 1000)) === JSON.stringify({ width: 512, height: 256 }));
ok('a small logo is never enlarged', JSON.stringify(L.fitSize(200, 100)) === JSON.stringify({ width: 200, height: 100 }));
ok('square crop takes the middle', JSON.stringify(L.cropRect(800, 400)) === JSON.stringify({ sx: 200, sy: 0, side: 400 }) && JSON.stringify(L.cropRect(300, 500)) === JSON.stringify({ sx: 0, sy: 100, side: 300 }));

// ---- storage: only a processed logo, always inside the business's own folder ----
let threw = ''; try { await S.settingsService.uploadLogo('b1', new Uint8Array(4), { ext: 'svg', contentType: 'image/svg+xml' }); } catch (e) { threw = e.message; }
ok('an unprocessed / SVG upload is refused by the service itself', /processed logo/.test(threw), threw);
C.calls.length = 0;
const url = await S.settingsService.uploadLogo('biz-A', new Uint8Array([1]), { ext: 'png', contentType: 'image/png' });
const up = C.calls.find((c) => c[0] === 'upload');
ok('upload goes to <business_id>/logo.png in business-logos, with the processed content type', up && up[1] === 'business-logos' && up[2] === 'biz-A/logo.png' && up[3].contentType === 'image/png', JSON.stringify(up));
ok('the other-extension copy is removed so only one logo exists', C.calls.some((c) => c[0] === 'remove' && c[1][0] === 'biz-A/logo.jpg'));
ok('returned address points at that business and is cache-busted', url.includes('/business-logos/biz-A/logo.png?v='), url);
C.calls.length = 0;
await S.settingsService.removeLogo('biz-A');
ok('removing the logo deletes that business\'s files and clears the address', C.calls.some((c) => c[0] === 'remove' && c[1].every((p) => p.startsWith('biz-A/'))) && C.calls.some((c) => c[0] === 'update' && c[1].logo_url === null));

// ---- document header: each business shows only itself ----
const A = { name: 'Mwangi Hardware', phone: '0711 000 111', address: 'Kitale Rd', email: 'a@x.co', logo_url: 'https://cdn.example/a.png' };
const B = { name: 'Zawadi Salon', phone: '0722 222 222', address: 'Moi Ave', logo_url: null };
const hA = H.businessHeaderHtml(A); const hB = H.businessHeaderHtml(B);
ok('hardware shop header carries its own name, logo, phone and address', ['Mwangi Hardware', 'a.png', '0711 000 111', 'Kitale Rd'].every((t) => hA.includes(t)));
ok('salon header carries only the salon (no hardware name/phone/logo)', hB.includes('Zawadi Salon') && !/Mwangi|0711|a\.png/.test(hB));
ok('a business without a logo shows its name alone (no broken image)', !hB.includes('<img'));
ok('no business given = no header, never another business', H.businessHeaderHtml(null) === '' && H.businessHeaderHtml({}) === '');
const evil = H.businessHeaderHtml({ name: '<img src=x onerror=alert(1)>', address: '"><script>x</script>', logo_url: 'https://a.co/x.png" onerror="alert(1)' });
ok('names and addresses are escaped (no HTML injection)', !/<img src=x|<script>/.test(evil) && evil.includes('&lt;'), evil);
ok('a logo address that tries to break out of the attribute cannot', !/onerror="alert/.test(evil), evil);
ok('only https logo addresses are used (javascript:/data:/http refused)', H.safeLogoUrl('javascript:alert(1)') === null && H.safeLogoUrl('data:image/png;base64,AAAA') === null && H.safeLogoUrl('http://a.co/x.png') === null && H.safeLogoUrl('https://a.co/x.png') === 'https://a.co/x.png');

// ---- wiring in the source files ----
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
ok('Settings page uses the new branding card and the old broken handler is gone', read('pages/SettingsPage.jsx').includes('BusinessBrandingCard') && !read('pages/SettingsPage.jsx').includes('handleLogoChange'));
ok('customer statement carries the business header', read('pages/CustomersPage.jsx').includes('businessHeaderHtml(biz)'));
ok('supplier statement carries the business header', read('pages/SupplierStatementModal.jsx').includes('businessHeaderHtml(biz)'));
ok('sidebar clears the previous business logo before loading', read('POSLayout.jsx').includes('setLogoUrl(null)'));
const visible = ['auth/POSLogin.jsx', 'auth/POSTenantSignup.jsx', 'auth/POSAccountStatus.jsx'].map(read).join('\n');
ok('screens a user sees say My Business, not "POS"', !/POS Sign In|Umova POS|POS Account|This POS account/.test(visible) && visible.includes('My Business sign in') && visible.includes('My Business'));
ok('the separate Umova SACCO app is not renamed or confused (login text names it as separate)', read('auth/POSLogin.jsx').includes('separate from the Umova SACCO login'));

console.log(fails === 0 ? '\nALL BRANDING JS CHECKS PASSED' : `\n${fails} BRANDING CHECK(S) FAILED`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
