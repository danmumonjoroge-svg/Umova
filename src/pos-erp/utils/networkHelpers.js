// src/pos-erp/utils/networkHelpers.js
//
// Pure helpers for My Business Network (no React, no Supabase) so they can be unit-tested with `node --test`.
// Everything a shopkeeper reads on screen (status words, "KES 1,200", "2h ago", error sentences) is decided here.

import { isNetworkFailure } from '../offline/netErrors.js';

// ── status words (simple language, one list for both sides) ──────────────────────────────────────────────────────
export const STATUS = {
  AWAITING_CONFIRMATION: { tone: 'warn', buyer: 'Waiting for supplier', seller: 'Needs your answer', short: 'Awaiting confirmation' },
  CONFIRMED:             { tone: 'info', buyer: 'Confirmed', seller: 'Confirmed', short: 'Confirmed' },
  PREPARING:             { tone: 'info', buyer: 'Being prepared', seller: 'Preparing', short: 'Preparing' },
  DISPATCHED:            { tone: 'info', buyer: 'On the way', seller: 'Sent', short: 'Dispatched' },
  PARTIALLY_RECEIVED:    { tone: 'info', buyer: 'Partly received', seller: 'Partly received', short: 'Partly received' },
  RECEIVED:              { tone: 'good', buyer: 'Received', seller: 'Received', short: 'Received' },
  CANCELLED:             { tone: 'neutral', buyer: 'Cancelled', seller: 'Cancelled', short: 'Cancelled' },
  DISPUTED:              { tone: 'bad', buyer: 'Problem reported', seller: 'Problem reported', short: 'Disputed' },
};
export const statusLabel = (status, side) => (STATUS[status] ? STATUS[status][side === 'SALES' || side === 'SUPPLIER' ? 'seller' : 'buyer'] : String(status || ''));
export const statusTone = (status) => STATUS[status]?.tone || 'neutral';

/** The 5-stage progress bar. Returns { steps:[{label,state:'done'|'now'|'todo'}], note } ; cancelled/disputed get a note instead of a false "done". */
export const PROGRESS_STEPS = ['Sent', 'Confirmed', 'Preparing', 'On the way', 'Received'];
const STEP_AT = { AWAITING_CONFIRMATION: 0, CONFIRMED: 1, PREPARING: 2, DISPATCHED: 3, PARTIALLY_RECEIVED: 3, RECEIVED: 4 };
export function progressFor(status) {
  if (status === 'CANCELLED') return { steps: PROGRESS_STEPS.map((label) => ({ label, state: 'todo' })), note: 'This order was cancelled.' };
  const at = status === 'DISPUTED' ? 3 : STEP_AT[status] ?? 0;
  return {
    steps: PROGRESS_STEPS.map((label, i) => ({ label, state: status === 'RECEIVED' ? 'done' : i < at ? 'done' : i === at ? 'now' : 'todo' })),
    note: status === 'DISPUTED' ? 'A problem was reported with this delivery.' : null,
  };
}

// ── numbers and dates ────────────────────────────────────────────────────────────────────────────────────────────
export const money = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`);
export const qtyText = (n) => (n == null ? '—' : Number(n).toLocaleString('en-KE', { maximumFractionDigits: 3 }));

/** "just now", "5 min ago", "2h ago", "3 days ago". Empty string when unknown. */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const STOCK_BAND = {
  IN_STOCK:  { label: 'In stock', tone: 'good' },
  AVAILABLE: { label: 'Available', tone: 'good' },
  LOW:       { label: 'Low stock', tone: 'warn' },
  OUT:       { label: 'Out of stock', tone: 'bad' },
};
export const stockBand = (code) => STOCK_BAND[code] || null;   // null = supplier chose not to show stock

export const deliveryText = (days) => (days == null ? 'Ask supplier' : days === 0 ? 'Same day' : days === 1 ? '1 day' : `${days} days`);

/** What the buyer is expected to pay for this much of one offer. null when the supplier will quote the price. */
export function estTotal(price, qty, fee = 0, method = 'DELIVERY') {
  if (price == null || !(qty > 0)) return null;
  return Math.round((Number(price) * Number(qty) + (method === 'COLLECTION' ? 0 : Number(fee || 0))) * 100) / 100;
}

// ── comparing offers: several criteria, NEVER a single "winner" ─────────────────────────────────────────────────
/** For each row, which offers are best on that one criterion. Ties all get the mark. Unknown values never win. */
export function compareBest(offers) {
  const best = (vals, pick) => {
    const known = vals.filter((v) => v != null);
    if (!known.length) return vals.map(() => false);
    const target = pick(...known);
    return vals.map((v) => v != null && v === target);
  };
  return {
    total: best(offers.map((o) => o.est_total_at_min), Math.min),
    delivery: best(offers.map((o) => o.delivery_days), Math.min),
    moq: best(offers.map((o) => Number(o.min_order_qty)), Math.min),
  };
}

// ── references and retries ───────────────────────────────────────────────────────────────────────────────────────
export function newClientRef(prefix = 'NETORD') {
  const webCrypto = typeof crypto !== 'undefined' ? crypto : undefined;   // `globalThis` is not known to the app's lint rules
  const u = (webCrypto?.randomUUID?.() || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
  return `${prefix}-${u.slice(0, 20).toUpperCase()}`;   // the server requires at least 8 characters
}
/** The same request must reuse its reference (safe retry); a changed request must get a new one. */
export const orderSignature = (o) => JSON.stringify([o.offerId, Number(o.qty), o.method, (o.address || '').trim(), (o.note || '').trim()]);

// ── errors: one sentence a shopkeeper understands, never raw database text ──────────────────────────────────────
const SAFE_CODES = new Set(['22023', 'P0411', 'P0412', 'P0413']);   // the database writes these messages for people
export function mapNetworkError(err) {
  if (isNetworkFailure(err)) return { kind: 'offline', message: 'No internet. Nothing was changed.', unsure: true };
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === 'P0410') return { kind: 'price_changed', message: 'The price has changed. Please check the new total.', newTotal: Number(err?.details) || null };
  if (code === 'P0409') return { kind: 'conflict', message: 'This request was already used for a different order. Start again.' };
  if (code === '42501') return { kind: 'denied', message: 'You do not have permission for this, or it is no longer available to you.' };
  if (SAFE_CODES.has(code) && msg) return { kind: code === 'P0412' ? 'stock' : 'rule', message: msg };
  return { kind: 'unknown', message: 'Something went wrong. Please try again.' };
}
