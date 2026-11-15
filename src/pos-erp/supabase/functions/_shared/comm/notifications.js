// supabase/functions/_shared/comm/notifications.js
//
// Pure builder for the INTERNAL notification centre (what needs the owner's attention). Separate from external messages.
// Same date engine as everything else, so "2 days overdue" here and in a reminder always agree. Takes data + `now`; no I/O.
import { dateContext, daysLabel } from './dateContext.js';
import { analyseReceivable } from './context.js';
import { formatMoney } from './phrases.js';

const PRIORITY = { high: 3, medium: 2, low: 1 };
export const byPriority = (a, b) => (PRIORITY[b.severity] - PRIORITY[a.severity]) || String(a.sortKey || '').localeCompare(String(b.sortKey || ''));

/**
 * @param {object} d { receivables:[{id,name,outstanding,items}], pos:[purchase orders with supplier], appointments, readyJobs, failedMessages,
 *                     recentPayments:[{id,customer_name,amount}], now, tz, currency, leadDays }
 */
export function buildCommNotifications(d) {
  const { now, tz, currency = 'KES' } = d; const lead = d.leadDays ?? 3; const out = [];
  const money = (n) => formatMoney(n, currency);

  for (const c of d.receivables || []) {
    const a = analyseReceivable({ outstanding: c.outstanding, items: c.items }, { now, tz });
    if (!a.focus || a.state === 'CLEARED' || a.state === 'NO_DATE') continue;
    const f = a.focus;
    if (a.state === 'OVERDUE') out.push({ id: `cust-overdue:${c.id}:${f.date}`, category: 'CUSTOMER', severity: f.daysOverdue >= 7 ? 'high' : 'medium', sortKey: f.date, message: `${c.name} owes ${money(a.amount)}, ${daysLabel(f.daysOverdue)} overdue (was due ${f.dateLong})`, link: '/pos/customers', contact: { kind: 'CUSTOMER', id: c.id, purpose: 'PAYMENT_REMINDER' } });
    else if (a.state === 'DUE_TODAY') out.push({ id: `cust-today:${c.id}:${f.date}`, category: 'CUSTOMER', severity: 'medium', sortKey: f.date, message: `${c.name}'s payment of ${money(a.amount)} is due today`, link: '/pos/customers', contact: { kind: 'CUSTOMER', id: c.id, purpose: 'PAYMENT_REMINDER' } });
    else if (f.daysRemaining <= lead) out.push({ id: `cust-soon:${c.id}:${f.date}`, category: 'CUSTOMER', severity: 'low', sortKey: f.date, message: `${c.name}'s payment of ${money(a.amount)} is due ${f.state === 'TOMORROW' ? 'tomorrow' : `in ${daysLabel(f.daysRemaining)}`} (${f.dateLong})`, link: '/pos/customers', contact: { kind: 'CUSTOMER', id: c.id, purpose: 'PAYMENT_REMINDER' } });
  }

  const closed = ['RECEIVED', 'CANCELLED', 'REJECTED', 'CLOSED', 'DRAFT', 'PENDING_APPROVAL'];
  for (const po of d.pos || []) {
    if (closed.includes(String(po.status).toUpperCase())) continue;
    const date = po.revised_delivery_date || po.expected_date; if (!date) continue;
    const c = dateContext({ date, now, tz }); if (!c.valid) continue;
    const who = po.supplier?.name || 'A supplier';
    if (c.state === 'PAST') out.push({ id: `po-late:${po.id}:${c.date}`, category: 'SUPPLIER', severity: c.daysOverdue >= 3 ? 'high' : 'medium', sortKey: c.date, message: `${who}'s delivery for ${po.po_number || 'an order'} is ${daysLabel(c.daysOverdue)} overdue (expected ${c.dateLong})`, link: '/pos/purchase-orders', contact: { kind: 'SUPPLIER', id: po.supplier_id || po.supplier?.id, purpose: 'SUPPLIER_DELIVERY_DELAYED', reference: { type: 'PURCHASE_ORDER', id: po.id } } });
    else if (c.state === 'TODAY' || c.daysRemaining <= 1) out.push({ id: `po-soon:${po.id}:${c.date}`, category: 'SUPPLIER', severity: 'low', sortKey: c.date, message: `${who}'s delivery for ${po.po_number || 'an order'} is expected ${c.state === 'TODAY' ? 'today' : 'tomorrow'}`, link: '/pos/goods-receiving' });
  }

  for (const a of d.appointments || []) {
    if (!['SCHEDULED', 'CONFIRMED'].includes(String(a.status).toUpperCase())) continue;
    const c = dateContext({ date: a.appointment_date, time: a.appointment_time, now, tz });
    if (!c.valid || c.state === 'PAST' || c.timePassed || c.daysRemaining > 1) continue;
    out.push({ id: `appt:${a.id}:${c.date}T${c.timeLabel || ''}`, category: 'APPOINTMENT', severity: c.state === 'TODAY' ? 'medium' : 'low', sortKey: `${c.date}${a.appointment_time || ''}`, message: `${a.customer?.name || 'A customer'} — ${a.service?.name || 'appointment'} ${c.state === 'TODAY' ? 'today' : 'tomorrow'}${c.timeLabel ? ` at ${c.timeLabel}` : ''}`, link: '/pos/appointments', contact: { kind: 'CUSTOMER', id: a.customer_id || a.customer?.id, purpose: 'APPOINTMENT_REMINDER', reference: { type: 'APPOINTMENT', id: a.id } } });
  }

  for (const p of d.recentPayments || []) out.push({ id: `paid:${p.id}`, category: 'CUSTOMER', severity: 'low', sortKey: 'z', message: `${p.customer_name || 'A customer'} paid ${money(p.amount)}`, link: '/pos/customers' });

  if (d.readyJobs > 0) out.push({ id: `ready:${d.readyJobs}`, category: 'MESSAGES', severity: 'medium', sortKey: 'a', message: `${d.readyJobs} message${d.readyJobs === 1 ? ' is' : 's are'} ready for you to review and send`, link: '/pos/messages' });
  if (d.failedMessages > 0) out.push({ id: `failed:${d.failedMessages}`, category: 'MESSAGES', severity: 'high', sortKey: 'a', message: `${d.failedMessages} message${d.failedMessages === 1 ? '' : 's'} could not be sent. Open Messages to retry.`, link: '/pos/messages' });
  return out.sort(byPriority);
}
