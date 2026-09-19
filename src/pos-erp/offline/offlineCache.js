// src/pos-erp/offline/offlineCache.js
//
// Read-through cache (brief section 22 -- "Stock: view stock, sell stock"
// while offline, and "Sales: search items" while offline). Populated on
// every successful ONLINE fetch (see the useEffect in POSPage.jsx that
// calls cacheProducts() whenever useProducts()'s list changes) -- never
// fetched by this module itself. This file only reads/writes Dexie.
//
// Honesty note (brief section 43): a cached quantity is a LAST KNOWN
// value, not a live one. offlineSaleService decrements it optimistically
// on an offline sale so the till doesn't show stock that was just sold,
// but the real, authoritative check still happens server-side the
// moment the sale syncs (saleService.create's existing pre-flight
// check). This cache is a UX convenience for continuity, not a second
// source of truth.

import { db } from './db';

export async function cacheProducts(products) {
  if (!products?.length) return;
  const rows = products.map(p => ({
    id: p.id,
    sku: p.sku || null,
    barcode: p.barcode || null,
    name: p.name,
    selling_price: p.selling_price ?? p.unit_price ?? 0,
    cost_price: p.cost_price ?? 0,
    track_inventory: p.track_inventory !== false,
    allow_negative_stock: !!p.allow_negative_stock,
    // quantity is filled in separately by cacheStockLevels() below, once
    // it's known -- productService.getAll() doesn't join inventory, so
    // this stays null until something that DOES know quantity calls it.
    quantity: p.quantity ?? null,
    cachedAt: new Date().toISOString(),
  }));
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
