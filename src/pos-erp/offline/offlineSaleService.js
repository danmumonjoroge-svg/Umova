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
import { isNetworkFailure } from './netErrors';

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
  // ONE idempotency key for this sale, used by the online attempt AND the offline fallback. If the online
  // call actually reached the server but the reply was lost, the queued copy carries the same key, so
  // when it syncs the server recognises it and does not create a second sale (saleService.create checks
  // client_reference first). Before this, the online path sent no key at all.
  const clientReference = sale.client_reference || await nextLocalId('SALE');
  sale = { ...sale, client_reference: clientReference };
  if (isOnline) {
    try {
      return { ...(await saleService.create(sale)), _offlineStatus: 'SYNCED' };
    } catch (err) {
      // supabase-js reports a dropped connection as a plain error whose MESSAGE says "Failed to fetch" (its name is not
      // "TypeError"), so the check is on the message -- see netErrors.js.
      const looksOffline = isNetworkFailure(err);
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

  // A sale charged to a folio is billed later, so it needs the customer and carries no payment.
  // It stays "Saved locally" until the server has put it on the folio -- never shown as billed before that.
  if (sale.folio_id && (!sale.customer_id || sale.payments?.length)) {
    throw new Error('A sale charged to a folio needs the customer and takes no payment now.');
  }

  const totals = computeTotals(sale.items);
  // completed_at is the moment of the SALE, not of the upload: a sale made yesterday and sent today must still
  // land on yesterday's takings and daily closing.
  const soldAt = new Date().toISOString();
  const payload = { ...sale, client_reference: clientReference, completed_at: soldAt };

  await db.outbox.add({
    kind: 'sale',
    status: 'PENDING',
    clientReference,
    tenantId: sale.tenant_id ?? null,
    payload,
    createdAt: soldAt,
  });

  for (const item of sale.items) {
    await decrementCachedStock(item.product_id, item.quantity);
  }

  // Tell the connection pill immediately ("Offline · 3 sales saved")
  // instead of waiting for its next poll. Purely a UI nudge -- nothing
  // about the queued sale depends on anyone listening.
  try { window.dispatchEvent(new Event('pos-outbox-changed')); } catch { /* non-browser env */ }

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
    completed_at: soldAt,
  };
}

/**
 * Is this M-Pesa code already on a sale saved on THIS phone that the server has not accepted yet? (Offline the server cannot
 * be asked, so this is the only guard against typing one SMS code on two sales.) Sent sales are covered by the server check.
 */
export async function findQueuedMpesaCode(code, tenantId) {
  const want = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!want) return false;
  const rows = await db.outbox.where('status').anyOf('PENDING', 'SYNCING', 'FAILED').toArray();
  return rows.some((r) => r.kind === 'sale'
    && (!tenantId || !r.tenantId || r.tenantId === tenantId)
    && (r.payload?.payments || []).some((p) => p.payment_method === 'MOBILE_MONEY'
      && String(p.reference_no || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === want));
}

export { searchCachedProducts };
