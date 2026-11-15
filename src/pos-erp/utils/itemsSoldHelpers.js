// src/pos-erp/utils/itemsSoldHelpers.js
//
// Pure helper for the "What was sold" part of Daily Closing (no React, no Supabase, so `node --test` can check it).
// Turns one day's sales into three levels the owner can open one by one:
//   Category  ->  Item (units sold, money)  ->  each sale of that item (receipt number, time, how many, price)
// Categories come from the item's own category (flat in this schema: there is no parent/child category, and no brand or model
// field, so nothing is invented). An item with no category goes under "No category". Weighed items keep their decimals.

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * @param {Array} sales    [{ id, sale_number, created_at, items: [{ product_id, quantity, unit_price, total_price }] }]
 * @param {Object} products map of product_id -> { name, category: {id,name}|null, unit: {code}|null }
 */
export function groupItemsSold(sales, products = {}) {
  const cats = new Map();
  let units = 0; let value = 0; let lines = 0;

  for (const s of sales || []) {
    for (const it of s.items || []) {
      const p = products[it.product_id] || {};
      const catKey = p.category?.id || 'none';
      if (!cats.has(catKey)) cats.set(catKey, { id: catKey, name: p.category?.name || 'No category', units: 0, value: 0, items: new Map() });
      const cat = cats.get(catKey);
      if (!cat.items.has(it.product_id)) cat.items.set(it.product_id, { id: it.product_id, name: p.name || 'Item no longer in your list', unit: p.unit?.code || '', units: 0, value: 0, sales: [] });
      const item = cat.items.get(it.product_id);

      const q = num(it.quantity);
      const total = num(it.total_price);
      item.units += q; item.value += total; item.sales.push({ saleId: s.id, saleNumber: s.sale_number, at: s.created_at, quantity: q, unitPrice: num(it.unit_price), total });
      cat.units += q; cat.value += total; units += q; value += total; lines += 1;
    }
  }

  const byValue = (a, b) => b.value - a.value || a.name.localeCompare(b.name);
  const categories = [...cats.values()].map((c) => ({
    ...c, units: r3(c.units), value: r2(c.value),
    items: [...c.items.values()].map((i) => ({ ...i, units: r3(i.units), value: r2(i.value), sales: i.sales.sort((a, b) => String(a.at).localeCompare(String(b.at))) })).sort(byValue),
  })).sort((a, b) => (a.id === 'none') - (b.id === 'none') || byValue(a, b));   // "No category" always last

  return { categories, totals: { units: r3(units), value: r2(value), lines, itemCount: categories.reduce((s, c) => s + c.items.length, 0) } };
}

/** Keep only items whose name matches `q` (and drop empty categories). Totals shown on the cards stay the real day figures. */
export function filterItemsSold(grouped, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return grouped.categories;
  return grouped.categories
    .map((c) => ({ ...c, items: c.items.filter((i) => i.name.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)) }))
    .filter((c) => c.items.length);
}

export const qtyText = (n, unit) => `${r3(n).toLocaleString('en-KE', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
