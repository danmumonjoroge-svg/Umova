// src/pos-erp/offline/queueLabels.js
//
// Plain-words description of one saved item, for the "Saved on this phone" screen. Pure (no React, no database) so it is
// unit-tested. Brief §43: never blur the states -- each one has its own honest wording.
//
//   PENDING   Saved on this phone   (not sent; the server does not know about it yet)
//   SYNCING   Sending...
//   SYNCED    Sent                  (the server accepted it)
//   FAILED    Needs attention       (the server refused it; the reason is shown)
//   DISCARDED Set aside             (kept as a record; will not be sent)

export const STATUS_LABEL = {
  PENDING: 'Saved on this phone',
  SYNCING: 'Sending…',
  SYNCED: 'Sent',
  FAILED: 'Needs attention',
  DISCARDED: 'Set aside',
};

export const STATUS_TONE = {
  PENDING: 'amber', SYNCING: 'amber', SYNCED: 'green', FAILED: 'red', DISCARDED: 'grey',
};

const kes = (n) => `KES ${Number(n || 0).toLocaleString()}`;
const METHOD = { CASH: 'Cash', MOBILE_MONEY: 'M-Pesa', CARD: 'Card', CREDIT: 'Credit' };

export function saleTotal(payload) {
  const items = payload?.items || [];
  return items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0) - Number(i.discount_amount || 0) + Number(i.tax_amount || 0), 0);
}

export function describeRow(row) {
  const status = row.status;
  const base = { id: row.id, status, statusLabel: STATUS_LABEL[status] || status, tone: STATUS_TONE[status] || 'grey', error: row.error || null, at: row.createdAt };
  if (row.kind === 'sale') {
    const p = row.payload || {};
    const items = p.items || [];
    const first = items.slice(0, 2).map(i => `${i.quantity} × ${i.name || 'item'}`).join(', ');
    const more = items.length > 2 ? ` +${items.length - 2} more` : '';
    const how = p.folio_id ? 'Charged to folio' : (p.payments || []).map(x => METHOD[x.payment_method] || x.payment_method).join(' + ');
    return { ...base, kind: 'sale', title: `Sale · ${kes(saleTotal(p))}`, detail: [first + more, how].filter(Boolean).join(' · '), ref: row.serverNumber || row.clientReference, canRetry: status === 'FAILED', canSetAside: status === 'FAILED' };
  }
  if (row.kind === 'shift_open') {
    const sh = row.payload?.shift || {};
    return { ...base, kind: 'shift_open', title: 'Shift opened', detail: `Starting cash ${kes(sh.opening_float)}`, ref: sh.shift_number || row.clientReference, canRetry: status === 'FAILED', canSetAside: false };
  }
  return { ...base, kind: row.kind, title: row.kind, detail: '', ref: row.clientReference, canRetry: status === 'FAILED', canSetAside: false };
}

/** "3 sales" / "1 sale" / "2 items" when there is a mix. */
export function countWords(rows) {
  const n = rows.length;
  const onlySales = rows.every(r => r.kind === 'sale');
  const word = onlySales ? 'sale' : 'item';
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
