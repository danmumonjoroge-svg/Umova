// src/pos-erp/offline/syncEngine.js
//
// Brief §25 -- the sync queue's processing logic:
//   Local Transaction -> Local Database -> Sync Queue ->
//     Internet Available? NO -> Wait | YES -> Upload -> Server ->
//     Confirmation -> Mark Synced
//
// This file is the "Upload -> Server -> Confirmation -> Mark Synced" half. Writing INTO the queue is each
// domain's own offline*Service.js (offlineSaleService.js for sales, offlineShift.js for shifts). This file only drains
// generic outbox rows by `kind`. Adding a Chama/Finance kind later = one more entry in HANDLERS.
//
// RETRY POLICY (brief §25/§29):
//   - A NETWORK failure leaves the row PENDING and retries by itself. No data loss, no retry cap.
//   - A SIGN-IN failure (token expired) leaves the row PENDING too and tells the owner to sign in again; it is never
//     "needs attention", because nothing is wrong with the sale.
//   - A SERVER-REFUSED failure (bad data, a constraint, a permission) is marked FAILED with the reason, shown as
//     "needs attention", and never retried blindly. The owner can retry it or set it aside (offlineQueue UI).
//   - A DUPLICATE (the server already has this client_reference / this shift id) is SUCCESS: that is the point of the key.
//
// CHANGED in the offline-mode pass (all found in the audit):
//   * Network detection used `err.name === 'TypeError'`, which never matches what supabase-js really throws, so a
//     connection that dropped mid-sync marked the sale FAILED. Now uses netErrors.isNetworkFailure.
//   * A row left as SYNCING (page closed mid-send) was never picked up again. Now reset to PENDING at the start of a pass
//     -- safe because every send is idempotent.
//   * Two tabs could send at once. Now one sender at a time (Web Locks where the browser has them).
//   * Rows now carry the business they belong to; a different business signed in on the same phone never sends them.
//   * Sales that depend on a shift the server has not accepted wait for it instead of failing on a missing shift.
//   * Old SYNCED rows are tidied away after 14 days; DISCARDED rows are kept as a record.

import { db, getMeta, setMeta } from './db';
import { saleService } from '../services/saleService';
import { cashierService } from '../services/cashierService';
import { isNetworkFailure, isAuthFailure, isDuplicateKey } from './netErrors';
import { markShiftSynced } from './offlineShift';

let syncing = false; // same-tab guard

const KEEP_SYNCED_DAYS = 14;
const UNSENT = ['PENDING', 'SYNCING', 'FAILED'];

const HANDLERS = {
  // The shift is created with the id the phone made, so a retry hits the primary key = "already saved".
  async shift_open(row) {
    const shift = row.payload.shift;
    try {
      const saved = await cashierService.openShift(shift);
      await markShiftSynced(shift.id);
      return { serverId: saved?.id || shift.id };
    } catch (err) {
      if (isDuplicateKey(err)) { await markShiftSynced(shift.id); return { serverId: shift.id }; }
      throw err;
    }
  },
  // `fromOfflineQueue` tells saleService the goods have ALREADY left the shop: record the sale instead of refusing it
  // because the server's stock count (which did not know about this sale) looks short. See saleService.create.
  async sale(row) {
    const result = await saleService.create({ ...row.payload, fromOfflineQueue: true });
    return { serverId: result.id, serverNumber: result.sale_number };
  },
};

function rowTenant(row) {
  return row.tenantId ?? row.payload?.tenant_id ?? row.payload?.shift?.tenant_id ?? null;
}
function rowShiftId(row) {
  return row.kind === 'sale' ? row.payload?.shift_id : row.kind === 'shift_open' ? row.payload?.shift?.id : null;
}

async function processOne(row) {
  const handler = HANDLERS[row.kind];
  if (!handler) {
    await db.outbox.update(row.id, { status: 'FAILED', error: `Unknown outbox kind: ${row.kind}` });
    return { ok: false, row, error: `Unknown outbox kind: ${row.kind}` };
  }
  await db.outbox.update(row.id, { status: 'SYNCING', lastTriedAt: new Date().toISOString() });
  try {
    const r = await handler(row);
    await db.outbox.update(row.id, {
      status: 'SYNCED', syncedAt: new Date().toISOString(), error: null, serverId: r.serverId, serverNumber: r.serverNumber ?? null,
    });
    return { ok: true, row };
  } catch (err) {
    const message = err?.message || String(err);
    if (isNetworkFailure(err)) {
      await db.outbox.update(row.id, { status: 'PENDING' }); // retried automatically, no owner action
      return { ok: false, row, error: message, retryable: true };
    }
    if (isAuthFailure(err)) {
      await db.outbox.update(row.id, { status: 'PENDING' });
      return { ok: false, row, error: message, retryable: true, authRequired: true };
    }
    await db.outbox.update(row.id, { status: 'FAILED', error: message, attempts: (row.attempts || 0) + 1 });
    return { ok: false, row, error: message, retryable: false };
  }
}

async function drain({ tenantId }) {
  // A row still marked SYNCING here was cut off (page closed mid-send): it is safe to send again.
  await db.outbox.where('status').equals('SYNCING').modify({ status: 'PENDING' });

  const all = await db.outbox.where('status').anyOf('PENDING', 'FAILED').sortBy('id');
  const blockedShifts = new Set(all.filter(r => r.kind === 'shift_open' && r.status === 'FAILED').map(r => r.payload?.shift?.id));
  const pending = all.filter(r => r.status === 'PENDING' && (!tenantId || !rowTenant(r) || rowTenant(r) === tenantId));

  const results = [];
  let blocked = 0;
  for (const row of pending) {
    if (row.kind === 'sale' && blockedShifts.has(rowShiftId(row))) { blocked++; continue; }
    const r = await processOne(row);
    results.push(r);
    if (!r.ok && !r.retryable && row.kind === 'shift_open') blockedShifts.add(rowShiftId(row)); // its sales wait for it
    if (!r.ok && r.retryable) break; // the connection (or sign-in) is the problem: stop, try next pass
  }

  // tidy: sent items older than two weeks are no longer needed on the phone
  try {
    const cutoff = new Date(Date.now() - KEEP_SYNCED_DAYS * 86400000).toISOString();
    await db.outbox.where('status').equals('SYNCED').filter(r => (r.syncedAt || '') < cutoff).delete();
  } catch { /* tidy is optional */ }

  const authRequired = results.some(r => r.authRequired);
  try { await setMeta('needsSignIn', authRequired); } catch { /* ignore */ }
  return {
    skipped: false,
    synced: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok && !r.retryable).length,
    deferred: results.filter(r => !r.ok && r.retryable).length,
    blocked,
    authRequired,
  };
}

/**
 * Sends waiting items oldest-first (a shift always goes before its sales). Safe to call repeatedly or from two tabs:
 * only one pass runs at a time, the other returns { skipped: true }.
 * @param {{tenantId?: string}} [opts] only send items belonging to this business
 */
export async function runSync(opts = {}) {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    if (locks?.request) {
      return await locks.request('umova-pos-sync', { ifAvailable: true }, async (lock) => (lock ? drain(opts) : { skipped: true }));
    }
    return await drain(opts);
  } finally {
    syncing = false;
  }
}

/** Items the server has not accepted yet (waiting, sending, or refused). */
export async function countUnsent() {
  return db.outbox.where('status').anyOf(...UNSENT).count();
}
/** Kept under the old name for existing callers. */
export const countPending = countUnsent;

export async function needsSignIn() {
  try { return !!(await getMeta('needsSignIn')); } catch { return false; }
}

/** Everything on the phone's list, newest first, for the "Saved on this phone" screen. */
export async function listQueue({ tenantId } = {}) {
  const rows = await db.outbox.orderBy('id').reverse().toArray();
  return rows.filter(r => !tenantId || !rowTenant(r) || rowTenant(r) === tenantId);
}

/** A refused item the owner wants to try again (e.g. after fixing whatever the reason said). */
export async function retryFailed(outboxId) {
  await db.outbox.update(outboxId, { status: 'PENDING', error: null });
  try { window.dispatchEvent(new Event('pos-outbox-changed')); } catch { /* non-browser */ }
}

/**
 * Set a refused item aside. It is NOT deleted: it stays on the list as "Set aside" with who/when/why, because it was a real
 * sale that happened. Only refused (FAILED) items can be set aside -- never one still waiting to be sent.
 */
export async function setAsideFailed(outboxId, { by = null, note = null } = {}) {
  const row = await db.outbox.get(outboxId);
  if (!row || row.status !== 'FAILED') throw new Error('Only an item that needs attention can be set aside.');
  await db.outbox.update(outboxId, { status: 'DISCARDED', discardedAt: new Date().toISOString(), discardedBy: by, discardNote: note });
  try { window.dispatchEvent(new Event('pos-outbox-changed')); } catch { /* non-browser */ }
}
