// Run: node --test tests/network_helpers.test.mjs   (from src/pos-erp)
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, statusTone, progressFor, money, timeAgo, estTotal, compareBest, newClientRef, orderSignature, mapNetworkError, deliveryText, stockBand } from '../utils/networkHelpers.js';

test('status words differ by side and never call an unanswered order "confirmed"', () => {
  assert.equal(statusLabel('AWAITING_CONFIRMATION', 'PURCHASES'), 'Waiting for supplier');
  assert.equal(statusLabel('AWAITING_CONFIRMATION', 'SALES'), 'Needs your answer');
  assert.equal(statusLabel('DISPATCHED', 'BUYER'), 'On the way');
  assert.equal(statusTone('DISPUTED'), 'bad');
});

test('progress: dispatched is not received; cancelled shows no false progress', () => {
  const p = progressFor('DISPATCHED').steps.map((s) => s.state);
  assert.deepEqual(p, ['done', 'done', 'done', 'now', 'todo']);
  assert.ok(progressFor('CANCELLED').steps.every((s) => s.state === 'todo'));
  assert.ok(progressFor('RECEIVED').steps.every((s) => s.state === 'done'));
  assert.ok(progressFor('DISPUTED').note);
});

test('money and dates are safe on missing values', () => {
  assert.equal(money(1234.5), 'KES 1,234.5');
  assert.equal(money(null), '—'); assert.equal(money('x'), '—');
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(timeAgo('2026-10-27T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-10-27T10:00:00Z', now), '2h ago');
  assert.equal(timeAgo('2026-10-26T10:00:00Z', now), 'yesterday');
  assert.equal(timeAgo(null, now), ''); assert.equal(timeAgo('garbage', now), '');
  assert.equal(deliveryText(null), 'Ask supplier'); assert.equal(deliveryText(0), 'Same day');
});

test('estimated total: collection has no delivery fee; unknown price gives null (never a fake number)', () => {
  assert.equal(estTotal(100, 5, 50, 'DELIVERY'), 550);
  assert.equal(estTotal(100, 5, 50, 'COLLECTION'), 500);
  assert.equal(estTotal(null, 5, 50), null);
  assert.equal(estTotal(100, 0, 50), null);
  assert.equal(estTotal(0.1, 3, 0), 0.3);
});

test('stock band: unknown (supplier hides stock) is null, not "in stock"', () => {
  assert.equal(stockBand(null), null); assert.equal(stockBand('LOW').tone, 'warn');
});

test('compare: several criteria, ties all marked, unknown never wins, no single overall winner', () => {
  const b = compareBest([{ est_total_at_min: 200, delivery_days: 3, min_order_qty: '5' }, { est_total_at_min: 150, delivery_days: 1, min_order_qty: '5' }, { est_total_at_min: null, delivery_days: null, min_order_qty: '10' }]);
  assert.deepEqual(b.total, [false, true, false]); assert.deepEqual(b.delivery, [false, true, false]); assert.deepEqual(b.moq, [true, true, false]);
  assert.deepEqual(compareBest([{ est_total_at_min: null, delivery_days: null, min_order_qty: '1' }]).total, [false]);
  assert.equal(Object.keys(b).includes('winner'), false);
});

test('references: unique, long enough for the server (8+), and a changed request gets a new signature', () => {
  const a = newClientRef(), b = newClientRef();
  assert.notEqual(a, b); assert.ok(a.length >= 8 && /^NETORD-[0-9A-Z]{20}$/.test(a));
  const base = { offerId: 'o1', qty: 5, method: 'COLLECTION', address: ' ', note: '' };
  assert.equal(orderSignature(base), orderSignature({ ...base, qty: '5', address: '' }), 'whitespace and number-vs-string do not change the request');
  assert.notEqual(orderSignature(base), orderSignature({ ...base, qty: 6 }));
});

test('errors become one plain sentence; raw database text is never shown', () => {
  assert.equal(mapNetworkError({ message: 'TypeError: Failed to fetch' }).kind, 'offline');
  assert.equal(mapNetworkError({ message: 'TypeError: Failed to fetch' }).unsure, true);
  const pc = mapNetworkError({ code: 'P0410', message: 'x', details: '240' }); assert.equal(pc.kind, 'price_changed'); assert.equal(pc.newTotal, 240);
  assert.equal(mapNetworkError({ code: 'P0412', message: 'Only 3 of "Sugar" available right now.' }).message, 'Only 3 of "Sugar" available right now.');
  assert.equal(mapNetworkError({ code: '42501', message: 'row-level security policy for table "network_orders"' }).message.includes('network_orders'), false);
  assert.equal(mapNetworkError({ code: 'XX000', message: 'relation "network_orders" does not exist' }).message, 'Something went wrong. Please try again.');
  assert.equal(mapNetworkError({ code: 'P0409', message: 'x' }).kind, 'conflict');
});
