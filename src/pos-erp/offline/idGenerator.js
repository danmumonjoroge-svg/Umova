// src/pos-erp/offline/idGenerator.js
//
// Brief §24: every offline transaction gets a unique local identifier,
// e.g. LOCAL-SALE-20260919-A1B2C3D4-000001, and that identifier stays attached to
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
 * A short random id for THIS phone, made once and kept in the same durable store as the queue. It is part of every local
 * id so two phones can never make the same one (audit D-01: two phones in one business both made
 * LOCAL-SALE-<today>-000001, and the server then treated the second sale as "already saved").
 */
export async function getDeviceId() {
  const key = 'device_id';
  const existing = await getMeta(key);
  if (existing) return existing;
  // transaction so two racing callers agree on one value
  return db.transaction('rw', db.meta, async () => {
    const again = await getMeta(key);
    if (again) return again;
    const id = newUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    await setMeta(key, id);
    return id;
  });
}

/**
 * @param {string} kind - short uppercase tag, e.g. 'SALE', 'PAYMENT', 'STOCK'
 * @returns {Promise<string>} e.g. "LOCAL-SALE-20260919-A1B2C3D4-000001"
 */
export async function nextLocalId(kind) {
  const stamp = todayStamp();
  const counterKey = `local_id_counter_${kind}_${stamp}`;
  // Dexie transaction so two rapid taps (or two tabs on the same device)
  // can't both read the same counter value and collide -- exactly the
  // "same sale submitted twice" case §29 calls out.
  const deviceId = await getDeviceId();
  const next = await db.transaction('rw', db.meta, async () => {
    const current = (await getMeta(counterKey)) || 0;
    const updated = current + 1;
    await setMeta(counterKey, updated);
    return updated;
  });
  return `LOCAL-${kind}-${stamp}-${deviceId}-${String(next).padStart(6, '0')}`;
}

/**
 * A random unique id (UUID v4) made on the phone. Used where the phone creates a row that other rows will point at
 * (an offline-opened shift): the server accepts the id as given, so a retry after a dropped reply is recognised as the
 * same row ("already saved") instead of creating a second one.
 */
export function newUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    // very old browser: still unique enough for one phone's shifts
    const r = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    return `${r()}-${r().slice(0, 4)}-4${r().slice(0, 3)}-a${r().slice(0, 3)}-${r()}${r().slice(0, 4)}`;
  }
}
