// src/pos-erp/offline/offlineShift.js
//
// A till shift is what every sale hangs on (lb_sales.shift_id). Before this, a shift could only be found or opened
// WITH internet, so a cashier who started the day offline could not sell at all.
//
// What works offline now:
//   * The shift that was open when the phone last had internet is remembered, and selling continues on it.
//   * Opening a shift offline is allowed: it gets its own id made on the phone and is queued as "shift_open". The queue
//     sends it BEFORE the sales that use it (creation order), and a retry is recognised as "already saved".
// What deliberately still needs internet:
//   * Closing a shift. The expected-cash figure is worked out by the server from the sales it has received, so closing
//     before every sale has been sent would give a wrong, falsely-reassuring number. (See POSPage / useCashierShifts.)

import { db, getMeta, setMeta } from './db';
import { nextLocalId, newUuid } from './idGenerator';

const key = (staffId) => `active_shift:${staffId}`;

export async function getCachedActiveShift(staffId) {
  if (!staffId) return null;
  try { return (await getMeta(key(staffId))) || null; } catch { return null; }
}

export async function cacheActiveShift(staffId, shift) {
  if (!staffId) return;
  try { await setMeta(key(staffId), shift || null); } catch { /* best effort */ }
}

/**
 * Open a shift with no internet. Returns the shift row the till should use (flagged `_local: true` until the server has it).
 */
export async function queueShiftOpen({ tenant, staffId, openingFloat, shiftNumber }) {
  const openedAt = new Date().toISOString();
  const shift = {
    id: newUuid(),
    tenant_id: tenant?.id,
    business_id: tenant?.business_id ?? null,
    cashier_id: staffId,
    shift_number: shiftNumber,
    opening_float: Number(openingFloat) || 0,
    status: 'OPEN',
    opened_at: openedAt,
  };
  await db.outbox.add({
    kind: 'shift_open',
    status: 'PENDING',
    clientReference: await nextLocalId('SHIFT'),
    tenantId: tenant?.id ?? null,
    payload: { shift },
    createdAt: openedAt,
  });
  const local = { ...shift, _local: true };
  await cacheActiveShift(staffId, local);
  try { window.dispatchEvent(new Event('pos-outbox-changed')); } catch { /* non-browser */ }
  return local;
}

/** The server now has this shift: drop the "local" flag so the till shows it as a normal shift. */
export async function markShiftSynced(shiftId) {
  try {
    const rows = await db.meta.where('key').startsWith('active_shift:').toArray();
    for (const r of rows) {
      if (r.value?.id === shiftId && r.value._local) await setMeta(r.key, { ...r.value, _local: false });
    }
  } catch { /* best effort */ }
}

/** How many saved items (the shift itself and its sales) the server has not accepted yet for this shift. */
export async function unsentForShift(shiftId) {
  if (!shiftId) return 0;
  const rows = await db.outbox.where('status').anyOf('PENDING', 'SYNCING', 'FAILED').toArray();
  return rows.filter(r =>
    (r.kind === 'sale' && r.payload?.shift_id === shiftId) ||
    (r.kind === 'shift_open' && r.payload?.shift?.id === shiftId)
  ).length;
}
