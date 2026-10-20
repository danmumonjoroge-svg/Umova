// src/pos-erp/offline/offlineCache.js
//
// Read-through cache (brief section 22 -- "Stock: view stock, sell stock"
// while offline, and "Sales: search items" while offline). Filled while ONLINE (see warmCache.js and the till),
// read while offline. This file only reads/writes the phone's own database; it never talks to the server.
//
// Honesty note (brief section 43): a cached quantity is a LAST KNOWN
// value, not a live one. offlineSaleService decrements it optimistically
// on an offline sale so the till doesn't show stock that was just sold,
// but the real, authoritative check still happens server-side the
// moment the sale syncs. This cache is a UX convenience for continuity, not a second
// source of truth.
//
// CHANGED in the offline-mode pass:
//   * cacheProducts() used to overwrite every cached quantity with null each time the product list refreshed, wiping the
//     stock levels. It now KEEPS the last known quantity unless a new one is supplied.
//   * It also keeps selling_mode / unit / is_active, so weight and volume items still sell correctly offline.
//   * Customers (for credit sales) and the business/till settings (for receipts and payment methods) are cached too.
//   * Stock numbers refreshed from the server have the still-unsent offline sales taken off again, so the till never
//     "gives back" stock that was already sold on this phone.

import { db, getMeta, setMeta } from './db';

export async function cacheProducts(products) {
  if (!products?.length) return;
  const existing = await db.products_cache.bulkGet(products.map(p => p.id));
  const keep = new Map(existing.filter(Boolean).map(r => [r.id, r]));
  const rows = products.map(p => {
    const old = keep.get(p.id);
    return {
      id: p.id,
      sku: p.sku || null,
      barcode: p.barcode || null,
      name: p.name,
      selling_price: p.selling_price ?? p.unit_price ?? 0,
      cost_price: p.cost_price ?? 0,
      selling_mode: p.selling_mode || old?.selling_mode || 'PER_UNIT',
      is_active: p.is_active ?? old?.is_active ?? 'active',
      unit: p.unit ?? old?.unit ?? null,
      track_inventory: p.track_inventory !== false,
      allow_negative_stock: !!p.allow_negative_stock,
      // quantity comes from cacheStockLevels(); a plain product list does not carry it, so keep what we knew.
      quantity: p.quantity ?? old?.quantity ?? null,
      cachedAt: new Date().toISOString(),
    };
  });
  await db.products_cache.bulkPut(rows);
}

/** @param {Array<{productId: string, quantity: number}>} levels */
export async function cacheStockLevels(levels) {
  if (!levels?.length) return;
  await db.transaction('rw', db.products_cache, async () => {
    for (const { productId, quantity } of levels) {
      await db.products_cache.update(productId, { quantity });
    }
  });
}

/** How many of each product are in sales saved on this phone but not yet accepted by the server. */
export async function unsentQuantities() {
  const rows = await db.outbox.where('status').anyOf('PENDING', 'SYNCING').toArray();
  const out = new Map();
  for (const r of rows) {
    if (r.kind !== 'sale') continue;
    for (const it of r.payload?.items || []) out.set(it.product_id, (out.get(it.product_id) || 0) + Number(it.quantity || 0));
  }
  return out;
}

/** Server stock levels in, minus what this phone has sold but not yet sent. */
export async function cacheServerStockLevels(levels) {
  if (!levels?.length) return;
  const unsent = await unsentQuantities();
  await cacheStockLevels(levels.map(l => ({
    productId: l.productId,
    quantity: Math.max(0, Number(l.quantity || 0) - (unsent.get(l.productId) || 0)),
  })));
}

/**
 * Optimistic local decrement after an offline sale -- so the next
 * search on the same device (before syncing) doesn't show stock that
 * was just sold in this same offline session. Never goes below zero in
 * the CACHE even if the real row would (that's the server's decision to
 * make on sync, via allow_negative_stock) -- this is only display.
 */
export async function decrementCachedStock(productId, qty) {
  const row = await db.products_cache.get(productId);
  if (!row || row.quantity == null) return; // nothing cached to adjust -- fine, just means the search UI won't show a number for this item until back online
  await db.products_cache.update(productId, { quantity: Math.max(0, row.quantity - qty) });
}

export async function getCachedProducts() {
  return db.products_cache.toArray();
}

export async function searchCachedProducts(term) {
  const all = await db.products_cache.toArray();
  if (!term) return all;
  const t = term.toLowerCase();
  return all.filter(p =>
    p.name?.toLowerCase().includes(t) || p.sku?.toLowerCase().includes(t) || p.barcode === term
  );
}

/** Barcode lookup with no internet. Same shape the scanner expects (product + stock), or null if never cached. */
export async function findCachedByBarcode(barcode) {
  if (!barcode) return null;
  const p = await db.products_cache.where('barcode').equals(String(barcode)).first();
  if (!p) return null;
  return {
    product: { ...p, unit_price: p.selling_price },
    stock: p.track_inventory && p.quantity != null ? { quantity: p.quantity, averageCost: p.cost_price || 0 } : null,
  };
}

// ---- customers (credit sales need to pick one with no signal) ----
export async function cacheCustomers(customers) {
  if (!customers?.length) return;
  await db.customers_cache.bulkPut(customers.map(c => ({
    id: c.id, tenant_id: c.tenant_id ?? null, name: c.name, phone: c.phone ?? null, customer_type: c.customer_type ?? null,
    credit_limit: c.credit_limit ?? null, outstanding_balance: c.outstanding_balance ?? c.balance ?? null,
    is_active: c.is_active ?? true, cachedAt: new Date().toISOString(),
  })));
}
export async function getCachedCustomers() { return db.customers_cache.toArray(); }

// ---- small key/value caches (business details for receipts, till settings, capabilities, permissions) ----
export async function cacheValue(key, value) {
  try { await setMeta(`cache:${key}`, { value, at: new Date().toISOString() }); } catch { /* cache is best-effort */ }
}
export async function readCachedValue(key) {
  try { return (await getMeta(`cache:${key}`))?.value ?? null; } catch { return null; }
}

// ---- one business per saved copy ------------------------------------------------------------------------------------
// BUG FOUND IN FIELD TEST: the saved item/customer lists were not tied to a business, so a phone used for both a real shop
// and the demo account showed both businesses' customers in one list offline. The saved copy now belongs to ONE business:
// when a different business signs in the copy is emptied first, and signing out empties it too (a shared phone must not
// keep the last person's customers). Unsent sales/shifts are NOT touched -- they carry their own business id.
const COPY_TABLES = ['products_cache', 'customers_cache', 'folios_cache', 'rooms_cache', 'recipes_cache'];

export async function clearOfflineCaches() {
  try {
    for (const t of COPY_TABLES) await db[t].clear();
    await db.meta.where('key').startsWith('cache:').delete();
    await db.meta.delete('cacheOwner');
    await db.meta.delete('lastWarmedAt');
  } catch { /* best effort */ }
}

/** Call whenever a business signs in. Empties the saved copy if it belonged to a different business. */
export async function ensureCacheOwner(tenantId) {
  if (!tenantId) return;
  try {
    const owner = await getMeta('cacheOwner');
    // No recorded owner = a copy saved by the earlier version, which could hold two businesses mixed together: start clean.
    if (owner !== tenantId) { await clearOfflineCaches(); await setMeta('cacheOwner', tenantId); }
  } catch { /* best effort */ }
}
