// Run: node --test tests/items_sold.test.mjs   (from src/pos-erp)
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupItemsSold, filterItemsSold, qtyText } from '../utils/itemsSoldHelpers.js';

const products = {
  a10: { name: 'Samsung Galaxy A10', category: { id: 'ph', name: 'Phones' }, unit: { code: 'pc' } },
  ix: { name: 'iPhone XX', category: { id: 'ph', name: 'Phones' }, unit: { code: 'pc' } },
  tx: { name: 'Tecno XX', category: { id: 'ph', name: 'Phones' }, unit: { code: 'pc' } },
  sugar: { name: 'Sugar', category: { id: 'gr', name: 'Groceries' }, unit: { code: 'kg' } },
  loose: { name: 'Loose item', category: null, unit: null },
};
const sale = (id, no, at, items) => ({ id, sale_number: no, created_at: at, items: items.map(([p, q, up]) => ({ product_id: p, quantity: q, unit_price: up, total_price: q * up })) });

test("the owner's example: 24 Samsung A10, 3 iPhone XX, 12 Tecno XX on one day", () => {
  const sales = [
    sale('s1', 'S-1', '2026-09-27T08:00:00Z', [['a10', 10, 5000], ['ix', 1, 40000]]),
    sale('s2', 'S-2', '2026-09-27T10:00:00Z', [['a10', 14, 5000], ['tx', 12, 7000]]),
    sale('s3', 'S-3', '2026-09-27T12:00:00Z', [['ix', 2, 40000]]),
  ];
  const g = groupItemsSold(sales, products);
  const phones = g.categories.find((c) => c.id === 'ph');
  const get = (id) => phones.items.find((i) => i.id === id);
  assert.equal(get('a10').units, 24);
  assert.equal(get('ix').units, 3);
  assert.equal(get('tx').units, 12);
  assert.equal(phones.units, 39);
  assert.equal(g.totals.units, 39);
  assert.equal(get('a10').sales.length, 2);                 // third level: each sale
  assert.deepEqual(get('a10').sales.map((x) => x.saleNumber), ['S-1', 'S-2']);
  assert.equal(get('ix').value, 120000);
});

test('items inside a category are biggest money first; "No category" and unknown items are kept, last', () => {
  const g = groupItemsSold([sale('s1', 'S-1', '2026-09-27T08:00:00Z', [['sugar', 2.5, 200], ['loose', 1, 10], ['tx', 1, 7000], ['gone', 1, 50]])], products);
  assert.deepEqual(g.categories.map((c) => c.name), ['Phones', 'Groceries', 'No category']);
  const none = g.categories[2];
  assert.deepEqual(none.items.map((i) => i.name).sort(), ['Item no longer in your list', 'Loose item']);
  assert.equal(g.totals.value, 500 + 10 + 7000 + 50);
});

test('weighed items keep decimals; the totals add up exactly; an empty day is empty', () => {
  const g = groupItemsSold([sale('s1', 'S-1', 'x', [['sugar', 0.1, 100]]), sale('s2', 'S-2', 'y', [['sugar', 0.2, 100]])], products);
  assert.equal(g.categories[0].items[0].units, 0.3);
  assert.equal(qtyText(2.5, 'kg'), '2.5 kg');
  assert.equal(qtyText(24, 'pc'), '24 pc');
  const e = groupItemsSold([], products);
  assert.equal(e.categories.length, 0); assert.equal(e.totals.units, 0);
});

test('search narrows items by item or category name and drops empty categories', () => {
  const g = groupItemsSold([sale('s1', 'S-1', 'x', [['a10', 1, 5], ['sugar', 1, 5]])], products);
  assert.equal(filterItemsSold(g, 'galaxy')[0].items.length, 1);
  assert.equal(filterItemsSold(g, 'galaxy').length, 1);
  assert.equal(filterItemsSold(g, 'groc')[0].name, 'Groceries');
  assert.equal(filterItemsSold(g, '').length, 2);
  assert.equal(filterItemsSold(g, 'zzz').length, 0);
});
