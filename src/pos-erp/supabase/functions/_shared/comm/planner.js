// supabase/functions/_shared/comm/planner.js
//
// WHAT should be messaged, and WHEN, decided from today's data. Pure functions: the scheduler loads snapshots,
// passes them here with "now", and gets back the jobs it should make sure exist. Each job carries a deterministic
// dedupe_key, so running the scan every five minutes (or twice at once) can never create a duplicate message.

import { dateContext, nowInTz, addDays, diffDays } from './dateContext.js';
import { analyseReceivable, PO_CLOSED, OPEN_APPT } from './context.js';

const job = (automation, purpose, dedupe, extra) => ({ automation, purpose, dedupe_key: dedupe, ...extra });

/** Which repeat bucket an overdue item is in: 0 on day 1..N, 1 on the next N days, ... */
export function overdueBucket(daysOverdue, repeatEvery) {
  return Math.floor((daysOverdue - 1) / Math.max(1, repeatEvery));
}

/** customers: [{ id, outstanding, items }] */
export function planCustomerReminders(customers, prefs, now, tz) {
  const out = [];
  const t = prefs.timing;
  for (const c of customers || []) {
    const a = analyseReceivable({ outstanding: c.outstanding, items: c.items }, { now, tz });
    if (!a.focus || a.state === 'CLEARED' || a.state === 'NO_DATE') continue;
    const f = a.focus; const base = { recipient_kind: 'CUSTOMER', customer_id: c.id, reference_type: 'receivable', reference_id: c.id };
    if (a.state === 'UPCOMING' && f.daysRemaining <= t.payment_lead_days) out.push(job('PAYMENT_REMINDER', 'PAYMENT_UPCOMING', `PAYREM:UP:${c.id}:${f.date}`, base));
    else if (a.state === 'DUE_TODAY') out.push(job('PAYMENT_REMINDER', 'PAYMENT_DUE_TODAY', `PAYREM:TODAY:${c.id}:${f.date}`, base));
    else if (a.state === 'OVERDUE') {
      const b = overdueBucket(f.daysOverdue, t.overdue_repeat_days);
      if (b < t.overdue_max_reminders) out.push(job('PAYMENT_REMINDER', 'PAYMENT_OVERDUE', `PAYREM:LATE:${c.id}:${f.date}:${b}`, base));
    }
  }
  return out;
}

/** payments: customer payments recorded in the last few days [{ id, customer_id }] */
export function planPaymentReceived(payments) {
  return (payments || []).map((p) => job('PAYMENT_RECEIVED', 'PAYMENT_RECEIVED', `PAYREC:${p.id}`, { recipient_kind: 'CUSTOMER', customer_id: p.customer_id, reference_type: 'customer_payment', reference_id: p.id }));
}

/** appointments: rows of lb_appointments (+ rescheduled_at / cancelled_at) */
export function planAppointments(appts, prefs, now, tz) {
  const out = [];
  const nt = nowInTz(now, tz);
  for (const a of appts || []) {
    const base = { recipient_kind: 'CUSTOMER', customer_id: a.customer_id, reference_type: 'appointment', reference_id: a.id };
    const slot = `${a.appointment_date}T${String(a.appointment_time || '').slice(0, 5)}`;
    const status = String(a.status || '').toUpperCase();
    if (status === 'CANCELLED') {
      if (a.cancelled_at && withinDays(a.cancelled_at, nt, 3, tz)) out.push(job('APPOINTMENT_CANCELLED', 'APPOINTMENT_CANCELLED', `APPTCAN:${a.id}`, base));
      continue;
    }
    if (!OPEN_APPT.includes(status)) continue;
    const c = dateContext({ date: a.appointment_date, time: a.appointment_time, now, tz });
    if (!c.valid || !c.hasTime || c.minutesUntil == null || c.minutesUntil <= 0) continue;
    if (a.rescheduled_at && a.rescheduled_from_date && withinDays(a.rescheduled_at, nt, 3, tz)) out.push(job('APPOINTMENT_RESCHEDULED', 'APPOINTMENT_RESCHEDULED', `APPTRES:${a.id}:${slot}`, base));
    if (c.minutesUntil <= prefs.timing.appointment_lead_hours * 60) out.push(job('APPOINTMENT_REMINDER', 'APPOINTMENT_REMINDER', `APPTREM:${a.id}:${slot}`, base));
  }
  return out;
}

/** pos: lb_purchase_orders with items + created_at */
export function planPurchaseOrders(pos, prefs, now, tz) {
  const out = [];
  const nt = nowInTz(now, tz);
  const t = prefs.timing;
  for (const p of pos || []) {
    const status = String(p.status || '').toUpperCase();
    const base = { recipient_kind: 'SUPPLIER', supplier_id: p.supplier_id, reference_type: 'purchase_order', reference_id: p.id };
    if (['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(status) && withinDays(p.created_at, nt, 3, tz)) out.push(job('SUPPLIER_PURCHASE_CONFIRMATION', 'SUPPLIER_PURCHASE_CONFIRMATION', `POCONF:${p.id}`, base));
    if (PO_CLOSED.includes(status) || !['APPROVED', 'PARTIALLY_RECEIVED'].includes(status)) continue;
    const outstanding = (p.items || []).reduce((s, i) => s + Math.max(0, Number(i.quantity || 0) - Number(i.received_quantity || 0)), 0);
    if ((p.items || []).length && outstanding <= 0) continue;
    const eff = dateContext({ date: p.revised_delivery_date || p.expected_date, now, tz });
    if (!eff.valid) continue;
    if (eff.state === 'PAST') {
      const b = overdueBucket(eff.daysOverdue, t.delivery_overdue_repeat_days);
      if (b < t.delivery_overdue_max_reminders) out.push(job('SUPPLIER_DELIVERY_REMINDER', 'SUPPLIER_DELIVERY_DELAYED', `DELREM:LATE:${p.id}:${eff.date}:${b}`, { ...base, delayed: true }));
    } else if (eff.daysRemaining <= t.delivery_lead_days) {
      out.push(job('SUPPLIER_DELIVERY_REMINDER', 'SUPPLIER_DELIVERY_REMINDER', `DELREM:UP:${p.id}:${eff.date}`, base));
    }
  }
  return out;
}

export function planSupplierPayments(rows) {
  return (rows || []).map((p) => job('SUPPLIER_PAYMENT_CONFIRMATION', 'SUPPLIER_PAYMENT_CONFIRMATION', `SUPPAY:${p.id}`, { recipient_kind: 'SUPPLIER', supplier_id: p.supplier_id, reference_type: 'supplier_payment', reference_id: p.id }));
}
export function planGoodsReceived(grns) {
  return (grns || []).map((g) => job('SUPPLIER_GOODS_RECEIVED', 'SUPPLIER_GOODS_RECEIVED', `GRN:${g.id}`, { recipient_kind: 'SUPPLIER', supplier_id: g.supplier_id, reference_type: 'grn', reference_id: g.id }));
}

/** Owner digests: once per day, at/after the chosen hour in the business zone. */
export function planDigests(prefs, now, tz) {
  const nt = nowInTz(now, tz); const out = [];
  if (nt.hour >= prefs.timing.daily_summary_hour) out.push(job('DAILY_SALES_SUMMARY', 'DAILY_SALES_SUMMARY', `DAILY:${nt.today}`, { recipient_kind: 'OWNER', reference_type: 'day', date: nt.today }));
  if (nt.hour >= prefs.timing.low_stock_hour) out.push(job('LOW_STOCK_NOTIFICATION', 'LOW_STOCK_NOTIFICATION', `LOWSTOCK:${nt.today}`, { recipient_kind: 'OWNER', reference_type: 'day', date: nt.today }));
  return out;
}

function withinDays(ts, nt, n, tz) {
  const d = dateContext({ date: ts, now: nt.instant, tz });
  return d.valid && d.days <= 0 && d.daysOverdue <= n;
}

export { addDays, diffDays };
