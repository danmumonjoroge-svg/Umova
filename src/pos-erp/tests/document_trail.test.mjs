// Three-way match + printable documents. node --test tests/document_trail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPurchase } from '../utils/triangulation.js';

const po = { total_amount: 1000, items: [{ id: 'i1', product_id: 'p1', quantity: 10, unit_cost: 100, product: { name: 'Rice' } }] };
const grn = (q, amt, extra = {}) => ({ status: 'RECEIVED', invoice_no: amt == null ? null : 'INV-9', supplier_invoice_amount: amt, items: [{ purchase_order_item_id: 'i1', quantity: q, unit_cost: 100 }], ...extra });

test('nothing received yet', () => assert.equal(matchPurchase({ po, grns: [] }).status, 'NO_DELIVERY'));
test('all three agree', () => assert.equal(matchPurchase({ po, grns: [grn(10, 1000)] }).status, 'MATCHED'));
test('delivery without an invoice waits for the invoice', () => assert.equal(matchPurchase({ po, grns: [grn(10, null)] }).status, 'NO_INVOICE'));
test('short delivery and short-delivery invoice mismatch are both flagged', () => {
  const m = matchPurchase({ po, grns: [grn(8, 1000)] });
  assert.equal(m.status, 'NEEDS_REVIEW');
  assert.ok(m.issues.some((i) => i.includes('2 short')));
  assert.ok(m.issues.some((i) => i.includes('invoiced KES 1,000')));
});
test('split deliveries add up and still match', () => assert.equal(matchPurchase({ po, grns: [grn(6, 600), grn(4, 400)] }).status, 'MATCHED'));
test('price differences are caught', () => {
  const g = grn(10, 1100); g.items[0].unit_cost = 110;
  const m = matchPurchase({ po, grns: [g] });
  assert.ok(m.issues.some((i) => i.includes('ordered at')));
});
test('cancelled deliveries are ignored', () => assert.equal(matchPurchase({ po, grns: [grn(10, 1000, { status: 'CANCELLED' })] }).status, 'NO_DELIVERY'));
test('an invoice number with no amount cannot be compared', () => {
  const m = matchPurchase({ po, grns: [{ ...grn(10, null), invoice_no: 'X1' }] });
  assert.ok(m.issues.some((i) => i.includes('without its amount')));
});
