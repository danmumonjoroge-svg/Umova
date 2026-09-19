// src/pos-erp/offline/idGenerator.js
//
// Brief §24: every offline transaction gets a unique local identifier,
// e.g. LOCAL-SALE-20260919-000001, and that identifier stays attached to
// the transaction after it syncs (it becomes lb_sales.client_reference --
// see schema/phase11_offline_sync.sql).
//
// The counter resets per calendar day and is stored in Dexie's `meta`
// table (not a JS module-level variable), because a module-level counter
// is lost on page refresh/tab close -- and §32's Test 6 explicitly
// requires surviving a close-and-reopen while offline. Reading the
// counter from the same durable store the queue itself lives in means a
// refresh mid-sale still produces a unique id, never a repeat.

import { db, getMeta, setMeta } from './db';

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {string} kind - short uppercase tag, e.g. 'SALE', 'PAYMENT', 'STOCK'
 * @returns {Promise<string>} e.g. "LOCAL-SALE-20260919-000001"
 */
export async function nextLocalId(kind) {
  const stamp = todayStamp();
  const counterKey = `local_id_counter_${kind}_${stamp}`;
  // Dexie transaction so two rapid taps (or two tabs on the same device)
  // can't both read the same counter value and collide -- exactly the
  // "same sale submitted twice" case §29 calls out.
  const next = await db.transaction('rw', db.meta, async () => {
    const current = (await getMeta(counterKey)) || 0;
    const updated = current + 1;
    await setMeta(counterKey, updated);
    return updated;
  });
  return `LOCAL-${kind}-${stamp}-${String(next).padStart(6, '0')}`;
}
