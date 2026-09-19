// src/pos-erp/offline/db.js
//
// Stage 1B (brief §21) -- technology choice: Dexie over raw IndexedDB.
// Reasoning, since the brief requires this be a deliberate choice, not a
// default install: this project has no existing offline storage of any
// kind (grepped the whole tree -- confirmed), so there is nothing to
// reuse or conflict with. Dexie is chosen over raw IndexedDB because
// this project's writers (POSPage, CustomersPage, etc.) are plain React
// function components with no existing low-level IndexedDB code to
// preserve -- raw IndexedDB's callback/event API would mean writing a
// promise wrapper from scratch anyway, which is exactly what Dexie is.
// It also gives real transactions and indexable queries, both of which
// §21 explicitly asks for ("must support: transactions... local
// queries").
//
// One IndexedDB database, "umova_offline", opened once per tab.
//
// Tables:
//   outbox           -- queued mutations not yet confirmed by the server.
//                        This is THE sync queue (§25). One row per
//                        offline transaction, in creation order.
//   products_cache    -- read-through cache of lb_products + lb_inventory,
//                        refreshed on every successful online fetch, so
//                        "search my stock" still works with no signal.
//   customers_cache   -- same idea, for the credit-sale customer picker.
//   meta              -- small key/value table: lastSyncedAt, etc.
//
// What this file does NOT do: it doesn't talk to Supabase at all. That's
// syncEngine.js's job. This file only owns the local database.

import Dexie from 'dexie';

export const db = new Dexie('umova_offline');

db.version(1).stores({
  // ++id = auto-increment local key. kind identifies which service the
  // entry belongs to ('sale', 'customer_payment', ...) so syncEngine can
  // dispatch each queued item to the right handler without guessing from
  // shape. status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'.
  // clientReference is the LOCAL-* id (see idGenerator.js) -- indexed so
  // the UI can look up "did this specific sale sync yet?" without a scan.
  outbox: '++id, kind, status, clientReference, createdAt',

  // Keyed by the real lb_products.id so a cached row can be
  // read/updated directly once the server confirms a stock change.
  products_cache: 'id, sku, barcode, name',
  customers_cache: 'id, name, phone, customer_type',

  meta: 'key',
});

/** Small helper -- get/set a single meta value without exposing the whole table shape everywhere. */
export async function getMeta(key) {
  const row = await db.meta.get(key);
  return row?.value;
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}
