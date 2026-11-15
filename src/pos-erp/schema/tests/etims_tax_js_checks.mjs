// eTIMS tax arithmetic checks (no browser, no network, no KRA). Run:  node schema/tests/etims_tax_js_checks.mjs
// The rates below (16, 8, 0) are TEST INPUTS, not claims about Kenyan tax. Real rates come from KRA's lists.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
fs.copyFileSync(path.join(root, 'utils/taxEngine.js'), path.join(tmp, 'taxEngine.js'));
const { round2, lineGross, splitLine, summarise } = await import(pathToFileURL(path.join(tmp, 'taxEngine.js')).href);
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ' :: ' + e.message); process.exitCode = 1; } };

t('round2: 1.005 rounds up (no float trap)', () => assert.equal(round2(1.005), 1.01));
t('round2: 2.675 -> 2.68', () => assert.equal(round2(2.675), 2.68));
t('round2: negatives round away from zero', () => assert.equal(round2(-1.005), -1.01));
t('round2: refuses NaN', () => assert.throws(() => round2('abc')));
t('gross: qty x price less discount', () => assert.equal(lineGross({ quantity: 3, unit_price: 100, discount_amount: 20 }), 280));
t('gross: discount larger than the line is refused', () => assert.throws(() => lineGross({ quantity: 1, unit_price: 10, discount_amount: 11 })));
t('inclusive: customer pays exactly the line total', () => assert.equal(splitLine({ quantity: 1, unit_price: 116 }, { rate: 16 }).total, 116));
t('inclusive: 116 at a 16 test rate = 100 + 16', () => { const s = splitLine({ quantity: 1, unit_price: 116 }, { rate: 16 }); assert.equal(s.tax, 16); assert.equal(s.taxable, 100); });
t('inclusive: taxable + tax always equals the line total', () => { for (const p of [1, 7, 19.99, 333.33, 1234.5]) { const s = splitLine({ quantity: 3, unit_price: p }, { rate: 16 }); assert.equal(round2(s.taxable + s.tax), s.gross); } });
t('discount comes off BEFORE tax is taken out', () => { const s = splitLine({ quantity: 1, unit_price: 232, discount_amount: 116 }, { rate: 16 }); assert.equal(s.gross, 116); assert.equal(s.tax, 16); });
t('exclusive: tax is added on top', () => { const s = splitLine({ quantity: 1, unit_price: 100 }, { rate: 16, inclusive: false }); assert.equal(s.tax, 16); assert.equal(s.total, 116); });
t('rate 0 (a real percentage of zero): tax is 0, taxable = gross', () => { const s = splitLine({ quantity: 2, unit_price: 50 }, { rate: 0 }); assert.equal(s.tax, 0); assert.equal(s.taxable, 100); });
t('no rate (null): reported with tax 0', () => { const s = splitLine({ quantity: 1, unit_price: 80 }, { rate: null }); assert.deepEqual([s.tax, s.taxable, s.total], [0, 80, 80]); });
t('a taxed line with a negative or missing-number rate is refused', () => { assert.throws(() => splitLine({ quantity: 1, unit_price: 10 }, { rate: -1 })); assert.throws(() => splitLine({ quantity: 1, unit_price: 10 }, { rate: 'x' })); });
t('basket: mixed codes are grouped and the totals agree with the lines', () => {
  const s = summarise([
    { line: { quantity: 1, unit_price: 116 }, code: 'A', rate: 16 },
    { line: { quantity: 2, unit_price: 54 }, code: 'B', rate: 8 },
    { line: { quantity: 1, unit_price: 40 }, code: 'C', rate: 0 },
    { line: { quantity: 1, unit_price: 25 }, code: 'D', rate: null },
  ]);
  assert.equal(s.totals.total, 116 + 108 + 40 + 25);
  assert.equal(round2(s.totals.taxable + s.totals.tax), s.totals.total);
  assert.equal(Object.keys(s.byCode).length, 4);
  assert.equal(s.byCode.A.tax, 16); assert.equal(s.byCode.B.tax, 8);
});
t('basket: invoice tax equals the sum of the rounded line taxes', () => {
  const entries = Array.from({ length: 7 }, (_, i) => ({ line: { quantity: 1, unit_price: 9.99 + i }, code: 'A', rate: 16 }));
  const s = summarise(entries); assert.equal(s.totals.tax, round2(s.lines.reduce((a, l) => a + l.tax, 0)));
});
console.log(`${n} passed` + (process.exitCode ? ', SOME FAILED' : ''));
