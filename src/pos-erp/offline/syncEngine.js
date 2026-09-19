// src/pos-erp/offline/syncEngine.js
//
// Brief §25 -- the sync queue's processing logic:
//   Local Transaction -> Local Database -> Sync Queue ->
//     Internet Available? NO -> Wait | YES -> Upload -> Server ->
//     Confirmation -> Mark Synced
//
// This file is the "Upload -> Server -> Confirmation -> Mark Synced"
// half. Writing INTO the queue (the left side of that diagram) is each
// domain's own offline*Service.js -- offlineSaleService.js for sales.
// Kept separate deliberately: this file only knows how to drain a
// generic outbox row by dispatching on `kind`; it does not know what a
// sale or a payment IS. Adding a second offline-capable domain later
// means adding one more `case` here, not rewriting this file.
//
// RETRY POLICY, matching brief §25/§29:
//   - A NETWORK failure (fetch couldn't even reach the server) leaves
//     the row PENDING and retries automatically next sync pass. No data
//     loss, no cap on retries -- the brief is explicit that connectivity
//     problems must never lose a transaction.
//   - A SERVER-REJECTED failure (Supabase returned a real error -- bad
//     data, a constraint violation that ISN'T the idempotency one, an
//     RLS denial) is NOT retried forever. It's marked FAILED with the
//     error message attached, and surfaced to the owner as "needs
//     attention" (§29's own wording) rather than silently retried into
//     an infinite loop that could mask a real problem.
//   - A DUPLICATE (the idempotency check in saleService.create finds an
//     existing row for this client_reference) is treated as SUCCESS, not
//     an error -- that's the whole point of the idempotency key: a
//     retried upload becomes a safe no-op instead of a duplicate row.

import { db } from './db';
import { saleService } from '../services/saleService';

let syncing = false; // module-level lock -- prevents two overlapping sync passes (e.g. an 'online' event firing while a manual "Sync now" is already running)

function isNetworkError(err) {
  // fetch()/supabase-js throw a TypeError with no HTTP status when the
  // request never reached the server at all (DNS failure, no route,
  // CORS-blocked-by-being-offline). A real Supabase error has a
  // .code/.status from the server. This is a heuristic, not a perfect
  // classifier -- when genuinely unsure, treating it as a network error
  // (retry) is the safer default per §25 ("do not lose data").
  if (!err) return false;
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message || '')) return true;
  if (err.message === 'Failed to fetch') return true;
  return false;
}

async function processOne(row) {
  await db.outbox.update(row.id, { status: 'SYNCING' });

  try {
    if (row.kind === 'sale') {
      const result = await saleService.create(row.payload);
      await db.outbox.update(row.id, { status: 'SYNCED', syncedAt: new Date().toISOString(), serverId: result.id });
      return { ok: true, row, result };
    }
    // Unknown kind -- a future domain not wired into this engine yet.
    // Not a network problem, so don't spin on it forever.
    await db.outbox.update(row.id, { status: 'FAILED', error: `Unknown outbox kind: ${row.kind}` });
    return { ok: false, row, error: `Unknown outbox kind: ${row.kind}` };
  } catch (err) {
    if (isNetworkError(err)) {
      // Back to PENDING, not FAILED -- this will be retried automatically
      // next time the sync engine runs, with no owner action needed.
      await db.outbox.update(row.id, { status: 'PENDING' });
      return { ok: false, row, error: err.message, retryable: true };
    }
    await db.outbox.update(row.id, { status: 'FAILED', error: err.message || String(err) });
    return { ok: false, row, error: err.message, retryable: false };
  }
}

/**
 * Drains the outbox in creation order (oldest first -- a later sale
 * shouldn't sync before an earlier one, even though nothing here strictly
 * depends on ordering yet). Safe to call repeatedly; a second call while
 * one is already running is a no-op (returns immediately with `skipped:
 * true`) rather than racing the first.
 */
export async function runSync() {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    const pending = await db.outbox.where('status').anyOf('PENDING').sortBy('createdAt');
    const results = [];
    for (const row of pending) {
      results.push(await processOne(row));
      // Stop early on the FIRST network failure -- if the connection
      // just dropped, hammering through the rest of the queue with the
      // same failure is pointless and just delays the next real attempt.
      if (!results[results.length - 1].ok && results[results.length - 1].retryable) break;
    }
    return {
      skipped: false,
      synced: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok && !r.retryable).length,
      deferred: results.filter(r => !r.ok && r.retryable).length,
    };
  } finally {
    syncing = false;
  }
}

/** For the "N transactions waiting to sync" line (§26). FAILED rows count too -- they still need the owner's attention, they haven't vanished. */
export async function countPending() {
  return db.outbox.where('status').anyOf('PENDING', 'SYNCING', 'FAILED').count();
}

/** A FAILED row the owner wants to try again (e.g. after fixing whatever the error described). Moves it back to PENDING for the next sync pass. */
export async function retryFailed(outboxId) {
  await db.outbox.update(outboxId, { status: 'PENDING', error: null });
}
