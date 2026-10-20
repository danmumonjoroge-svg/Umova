// src/pos-erp/offline/warmCache.js
//
// Fills the phone's offline copy while there IS internet, so the till still works when the signal goes.
// Runs: when the till opens online, whenever the connection comes back, and every 10 minutes while online.
// Everything here is READ-ONLY against the server and best-effort: a failure just means the copy stays as it was.
//
// What is kept for offline use: the item list (up to 2,000 items), the last known stock level of each item, the customer
// list (for credit sales), the business details (for receipts) and the till settings (payment methods).

import { useEffect, useRef } from 'react';
import { posSupabase } from '../services/posSupabaseClient';
import { productService } from '../services/productService';
import { customerService } from '../services/customerService';
import { settingsService } from '../services/settingsService';
import { cacheProducts, cacheServerStockLevels, cacheCustomers, cacheValue } from './offlineCache';
import { setMeta } from './db';
import { inventoryService } from '../services/inventoryService';
import { supplierService } from '../services/supplierService';
import { expensesService } from '../services/expensesService';
import { saveSnapshot, pullPages } from './readThrough';
import { getRetention, sinceDate } from './retention';

const PAGE = 500;
const MAX_PAGES = 4;          // 2,000 items is more than a shop till browses; bigger shops still search by name/barcode online
const EVERY_MS = 10 * 60 * 1000;

async function pullAll(fetchPage) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchPage(page);
    const rows = r?.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * @param {{tenant:object, allow?:{retail?:boolean, money?:boolean}}} a
 *   allow: which kinds of business data this signed-in person may see. Data they may not see is NOT copied to their phone
 *   (a cashier's phone does not need the spending list). Missing = allowed, so older callers keep working.
 */
export async function warmPosCache({ tenant, allow = {} }) {
  const result = { products: 0, customers: 0, ok: true, copies: {} };
  try {
    const products = await pullAll((page) => productService.getAll({ page, limit: PAGE }));
    await cacheProducts(products);
    result.products = products.length;
  } catch { result.ok = false; }

  try {
    // quantity per product (RLS already limits this to the signed-in business)
    // read in pages of 1,000 (the server hands back at most 1,000 rows per request)
    const levels = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await posSupabase.from('lb_inventory').select('product_id, quantity').order('product_id').range(from, from + 999);
      if (error) throw error;
      levels.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    await cacheServerStockLevels(levels.map(r => ({ productId: r.product_id, quantity: r.quantity })));
  } catch { /* stock numbers stay as last known */ }

  try {
    const customers = await pullAll((page) => customerService.getAll({ page, limit: PAGE }));
    await cacheCustomers(customers);
    result.customers = customers.length;
  } catch { result.ok = false; }

  if (tenant?.business_id) {
    try { await cacheValue(`business:${tenant.business_id}`, await settingsService.getBusinessProfile(tenant.business_id)); } catch { /* keep old */ }
    try { await cacheValue(`posSettings:${tenant.business_id}`, await settingsService.getPosSettings(tenant.business_id)); } catch { /* keep old */ }
  }
  // ---- saved copies for the look-only pages (Products, Stock, Suppliers, Spending). Each is best-effort and independent:
  // one failing (or one the person may not see) never stops the others, and never blocks selling.
  const tid = tenant?.id;
  const copy = async (name, run) => {
    try { const r = await run(); result.copies[name] = r ? { rows: r.rows.length, complete: r.complete } : 'skipped'; }
    catch { result.copies[name] = 'failed'; }
  };
  if (tid && allow.retail !== false) {
    await copy('products', async () => { const r = await pullPages((page, size) => productService.getAll({ page, limit: size })); await saveSnapshot('products', tid, r.rows, { complete: r.complete }); return r; });
    await copy('inventory', async () => { const r = await pullPages((page, size) => inventoryService.getAll({ page, limit: size })); await saveSnapshot('inventory', tid, r.rows, { complete: r.complete }); return r; });
    await copy('suppliers', async () => { const r = await pullPages((page, size) => supplierService.getAll({ page, limit: size })); await saveSnapshot('suppliers', tid, r.rows, { complete: r.complete }); return r; });
  }
  if (tid && allow.money !== false) {
    const { expensesDays } = await getRetention();
    const since = sinceDate(expensesDays);
    await copy('expenses', async () => { const r = await pullPages((page, size) => expensesService.getAll({ businessId: tenant.business_id, page, limit: size, sinceDate: since })); await saveSnapshot('expenses', tid, r.rows, { complete: r.complete }); return r; });
    await copy('expense_categories', async () => { const rows = await expensesService.getCategories(); await saveSnapshot('expense_categories', tid, rows); return { rows, complete: true }; });
  }
  if (result.ok) { try { await setMeta('lastWarmedAt', new Date().toISOString()); } catch { /* ignore */ } }
  return result;
}

/** Mount once (ConnectionStatus does). Warms on open, on reconnect, and every 10 minutes while online. */
export function useWarmPosCache({ isOnline, tenant, enabled = true, allow }) {
  const running = useRef(false);
  useEffect(() => {
    if (!enabled || !isOnline || !tenant?.id) return undefined;
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try { await warmPosCache({ tenant, allow }); } finally { running.current = false; }
    };
    run();
    const id = setInterval(run, EVERY_MS);
    return () => clearInterval(id);
  }, [isOnline, tenant?.id, tenant?.business_id, enabled, allow?.retail, allow?.money]); // eslint-disable-line react-hooks/exhaustive-deps
}
