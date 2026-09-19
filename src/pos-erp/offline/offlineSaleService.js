// src/pos-erp/offline/offlineSaleService.js
//
// Brief section 27 ("Offline Stock" -- the owner must not have to wait
// for Supabase) and section 24 (local transaction IDs).
//
// This wraps saleService.create() -- it does not replace or duplicate
// its business logic (pricing, stock movement, receipt, audit all still
// happen exactly once, inside saleService.create, whether that call
// happens now (online) or later (sync)). What this file adds is only:
// decide whether to call it now or queue it, and give the till an
// immediate, honest result either way.
//
// THREE OUTCOMES, never blurred together (brief section 43):
//   'SYNCED'       -- created on the server just now. Real sale_number,
//                      real receipt, everything saleService.create()
//                      normally returns.
//   'LOCAL_PENDING' -- queued. Has a LOCAL-SALE-* id, NOT a real
//                      sale_number yet (one doesn't exist until the row
//                      is actually inserted server-side). The UI must
//                      show this differently from a synced sale -- see
//                      POSPage.jsx's confirmation message.
//   (throws)        -- a real validation error (e.g. insufficient stock
//                      against the CACHED quantity, or a CREDIT sale
//                      with no customer selected) -- surfaced to the
//                      cashier immediately, same as today, whether
//                      online or offline.

import { db } from './db';
import { nextLocalId } from './idGenerator';
import { saleService } from '../services/saleService';
import { decrementCachedStock, searchCachedProducts } from './offlineCache';

function computeTotals(items) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const discountTotal = items.reduce((s, i) => s + (i.discount_amount || 0), 0);
  const taxTotal = items.reduce((s, i) => s + (i.tax_amount || 0), 0);
  return { subtotal, discountTotal, taxTotal, total: subtotal - discountTotal + taxTotal };
}

/**
 * Best-effort stock check against the CACHE -- not authoritative (the
 * real check is server-side in saleService.create, which runs for real
 * the moment this syncs). This exists only so a cashier offline doesn't
 * oversell an item that's visibly at zero on their own screen; it is
 * not a substitute for the server-side check and must never be treated
 * as one.
 */
async function checkCachedStock(items) {
  for (const item of items) {
    const cached = await db.products_cache.get(item.product_id);
    if (!cached) continue; // never cached (e.g. product created after last online session) -- nothing to check against, let it through
    if (cached.track_inventory === false || cached.allow_negative_stock) continue;
    if (cached.quantity != null && item.quantity > cached.quantity) {
      throw new Error(`Insufficient stock for ${cached.name} (last known: ${cached.quantity}, requested: ${item.quantity}).`);
    }
  }
}

/**
 * @param {object} sale - same shape saleService.create() takes (tenant_id,
 *   business_id, cashier_id, shift_id, customer_id?, items[], payments[], notes?)
 *   already merged with tenant/staff ids, same as useSales.create() does.
 * @param {{isOnline: boolean}} status - from useNetStatus(); the caller's
 *   current read of connectivity. This function ALSO catches a network
 *   failure on the online path and falls back to queueing -- so a stale
 *   "online" reading doesn't lose the sale (section 26: "the connection
 *   becomes unstable").
 */
export async function createOfflineAwareSale(sale, { isOnline }) {
  if (isOnline) {
    try {
      return { ...(await saleService.create(sale)), _offlineStatus: 'SYNCED' };
    } catch (err) {
      const looksOffline = err?.name === 'TypeError' && /fetch|network/i.test(err.message || '');
      if (!looksOffline) throw err; // a REAL rejection (bad data, RLS, insufficient stock server-side) -- surface it, don't silently queue a sale that's actually invalid
      // else fall through to the offline path below
    }
  }

  // ---- Offline path ----
  await checkCachedStock(sale.items);
  if (sale.payments?.some(p => p.payment_method === 'CREDIT') && !sale.customer_id) {
    // Mirrors the server-side trigger's own rule (process_credit_sale_payment)
    // so the cashier gets this immediately instead of finding out on sync,
    // long after the customer has left.
    throw new Error('Select a customer before completing a credit sale.');
  }

  const clientReference = await nextLocalId('SALE');
  const totals = computeTotals(sale.items);
  const payload = { ...sale, client_reference: clientReference };

  await db.outbox.add({
    kind: 'sale',
    status: 'PENDING',
    clientReference,
    payload,
    createdAt: new Date().toISOString(),
  });

  for (const item of sale.items) {
    await decrementCachedStock(item.product_id, item.quantity);
  }

  // A synthetic sale object shaped enough like a real one that the
  // existing receipt/confirmation UI can render it -- but status is
  // 'LOCAL_PENDING', never 'COMPLETED', and sale_number IS the local id
  // (there is no real one yet) so nothing downstream can mistake this
  // for a synced, numbered sale.
  return {
    id: clientReference,
    client_reference: clientReference,
    sale_number: clientReference,
    status: 'LOCAL_PENDING',
    _offlineStatus: 'LOCAL_PENDING',
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    tax_total: totals.taxTotal,
    total_amount: totals.total,
    customer_id: sale.customer_id ?? null,
    items: sale.items,
    payments: sale.payments,
    completed_at: new Date().toISOString(),
  };
}

export { searchCachedProducts };
