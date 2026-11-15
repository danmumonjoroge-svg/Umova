// supabase/functions/_shared/comm/dispatcher.js
//
// The server-side scheduler core. Runs from a database timer (see phase51), never from the browser.
//
// One run, for every active business that has at least one automation switched on:
//   1. SCAN      plan the messages that should exist today (planner.js) and create the missing ones as jobs.
//                A deterministic dedupe key + a unique index make a duplicate impossible, however often this runs.
//   2. RE-CHECK  every waiting job is re-evaluated against fresh data. Debt paid? Goods received? Appointment
//                cancelled or past? Then the job is SUPPRESSED instead of sent. (Payment completed / goods received
//                therefore cancel pending reminders without any trigger on a financial table.)
//   3. SEND      only jobs in AUTO mode, only outside quiet hours, only through a configured provider. Everything
//                else is left READY for a person to review in the app. Failures retry with back-off, then stop.
//
// Failure isolation: one business or one job failing never stops the others, and nothing here writes to a sale,
// payment, stock or accounting table; it only writes lb_comm_jobs, lb_communication_log and pos_audit_log.

import { nowInTz, inQuietHours, addDays, toYmd } from './dateContext.js';
import { compose } from './engine.js';
import { PURPOSE_BY_KEY } from './library.js';
import { AUTOMATION_BY_KEY } from './prefs.js';
import * as L from './loaders.js';
import { loadForPurpose } from './records.js';
import { planCustomerReminders, planPaymentReceived, planAppointments, planPurchaseOrders, planSupplierPayments, planGoodsReceived, planDigests } from './planner.js';
import { isConfigured } from './providers.js';
import { sendLogRow, nextRetryDelayMinutes, MAX_ATTEMPTS } from './sender.js';

// Reasons a message is simply no longer needed (as opposed to "needs a person to fix something").
export const SUPPRESS_CODES = ['CLEARED', 'ALL_RECEIVED', 'PO_CLOSED', 'PO_NOT_APPROVED', 'PO_CANCELLED', 'APPT_CANCELLED', 'APPT_PASSED', 'APPT_CLOSED', 'NOT_CANCELLED', 'NO_BALANCE', 'NO_LOW_STOCK', 'SALE_VOIDED', 'NOTHING_TO_APPROVE'];
const MAX_NEW_JOBS_PER_BUSINESS_PER_RUN = 40;
const MAX_REVALIDATE_PER_BUSINESS = 60;

export const parentPurpose = (p) => PURPOSE_BY_KEY[p]?.variantOf || p;

/** composeResult -> what to do with the job. Pure. */
export function evaluateJob(c) {
  if (c.ok) return { action: 'SEND', reason: '' };
  const codes = c.blocking.map((b) => b.code);
  if (codes.length && codes.every((x) => SUPPRESS_CODES.includes(x))) return { action: 'SUPPRESS', reason: c.blocking[0].message };
  return { action: 'REVIEW', reason: c.blocking[0]?.message || 'Needs a person to check it.' };
}

const log = (...a) => console.log('[comm-dispatch]', ...a);

async function activeBusinesses(svc) {
  const b = await svc.from('lb_businesses').select('id, tenant_id, status');
  if (b.error) throw b.error;
  const t = await svc.from('pos_tenants').select('id, status');
  if (t.error) throw t.error;
  const live = new Set((t.data || []).filter((x) => !['pending', 'rejected', 'suspended'].includes(String(x.status))).map((x) => x.id));
  return (b.data || []).filter((x) => live.has(x.tenant_id) && (!x.status || String(x.status).toUpperCase() === 'ACTIVE'));
}

function recipientRef(job) {
  if (job.customer_id) return { kind: 'CUSTOMER', id: job.customer_id };
  if (job.supplier_id) return { kind: 'SUPPLIER', id: job.supplier_id };
  return null;
}

async function ownerRef(svc, tenantId) { const o = await L.loadOwnerRecipient(svc, { tenantId }); return o ? { kind: 'OWNER', id: o.id } : null; }

/** Fresh compose for a job: re-reads everything. */
export async function composeForJob({ svc, job, biz, prefs, templates, now }) {
  const rec = recipientRef(job) || (job.recipient_kind === 'OWNER' ? await ownerRef(svc, job.tenant_id) : null);
  if (!rec) return { ok: false, blocking: [{ code: 'NO_RECIPIENT', message: 'There is nobody to send this to.' }], warnings: [], details: [] };
  const purpose = parentPurpose(job.purpose);
  const dateFromKey = /(\d{4}-\d{2}-\d{2})$/.exec(job.dedupe_key || '')?.[1] || toYmd(now, biz.time_zone);
  const reference = job.reference_type === 'customer_payment' || job.reference_type === 'appointment' || job.reference_type === 'purchase_order' || job.reference_type === 'grn' || job.reference_type === 'supplier_payment' || job.reference_type === 'sale'
    ? { type: job.reference_type, id: job.reference_id } : null;
  const { recipient, records } = await loadForPurpose({ db: svc, tenantId: job.tenant_id, purpose, recipient: rec, reference, tz: biz.time_zone, prefs, date: dateFromKey });
  if (!recipient) return { ok: false, blocking: [{ code: 'NO_RECIPIENT', message: 'The contact no longer exists.' }], warnings: [], details: [] };
  return compose({ purpose, channel: job.channel, business: biz, prefs, templates, recipient, records, inputs: {}, now });
}

// ------------------------------------------------------------------------------------------------ scan
async function scanBusiness({ svc, b, biz, prefs, now, stats }) {
  const tz = biz.time_zone; const tenantId = b.tenant_id; const nt = nowInTz(now, tz);
  const autos = prefs.automations; const on = (k) => autos[k] && autos[k].mode !== 'OFF';
  const since = new Date(now.getTime() - 3 * 86400000).toISOString();
  const planned = [];
  const safe = async (name, fn) => { try { planned.push(...await fn()); } catch (e) { stats.errors.push(`${b.id}/${name}: ${e.message || e}`); } };

  if (on('PAYMENT_REMINDER')) await safe('receivables', async () => planCustomerReminders(await L.loadAllReceivables(svc, { tenantId, tz, prefs }), prefs, now, tz));
  if (on('PAYMENT_RECEIVED')) await safe('payments', async () => { const r = await svc.from('lb_customer_payments').select('id, customer_id').eq('tenant_id', tenantId).gte('created_at', since).limit(200); if (r.error) throw r.error; return planPaymentReceived(r.data); });
  if (on('APPOINTMENT_REMINDER') || on('APPOINTMENT_RESCHEDULED') || on('APPOINTMENT_CANCELLED')) await safe('appointments', async () => {
    const r = await svc.from('lb_appointments').select('id, customer_id, status, appointment_date, appointment_time, rescheduled_at, rescheduled_from_date, rescheduled_from_time, cancelled_at').eq('tenant_id', tenantId).gte('appointment_date', addDays(nt.today, -3)).lte('appointment_date', addDays(nt.today, 3)).limit(500);
    if (r.error) throw r.error; return planAppointments(r.data, prefs, now, tz);
  });
  if (on('SUPPLIER_DELIVERY_REMINDER') || on('SUPPLIER_PURCHASE_CONFIRMATION')) await safe('purchase_orders', async () => {
    const sel = 'id, supplier_id, status, expected_date, revised_delivery_date, created_at, items:lb_purchase_order_items(quantity, received_quantity)';
    const [open, recent] = await Promise.all([
      svc.from('lb_purchase_orders').select(sel).eq('tenant_id', tenantId).in('status', ['APPROVED', 'PARTIALLY_RECEIVED']).limit(500),
      svc.from('lb_purchase_orders').select(sel).eq('tenant_id', tenantId).gte('created_at', since).limit(200),
    ]);
    if (open.error) throw open.error; if (recent.error) throw recent.error;
    const seen = new Map(); for (const p of [...(open.data || []), ...(recent.data || [])]) seen.set(p.id, p);
    return planPurchaseOrders([...seen.values()], prefs, now, tz);
  });
  if (on('SUPPLIER_PAYMENT_CONFIRMATION')) await safe('supplier_payments', async () => { const r = await svc.from('lb_supplier_payments').select('id, supplier_id').eq('tenant_id', tenantId).gte('created_at', since).limit(200); if (r.error) throw r.error; return planSupplierPayments(r.data); });
  if (on('SUPPLIER_GOODS_RECEIVED')) await safe('grns', async () => { const r = await svc.from('lb_goods_received_notes').select('id, supplier_id').eq('tenant_id', tenantId).gte('created_at', since).limit(200); if (r.error) throw r.error; return planGoodsReceived(r.data); });
  await safe('digests', async () => planDigests(prefs, now, tz).filter((j) => on(j.automation)));

  const rows = [];
  for (const j of planned) {
    const a = autos[j.automation]; if (!a || a.mode === 'OFF') continue;
    if (j.recipient_kind === 'SUPPLIER' && !j.supplier_id) continue;
    if (j.recipient_kind === 'CUSTOMER' && !j.customer_id) continue;
    const { delayed, date, automation, ...rest } = j;
    rows.push({ ...rest, automation, tenant_id: tenantId, business_id: b.id, channel: a.channel, mode: a.mode, status: a.mode === 'AUTO' ? 'PENDING' : 'READY', run_at: now.toISOString() });
  }
  if (!rows.length) return;
  // only the keys we do not already have, capped per run so enabling a rule on a big backlog cannot flood anyone
  const keys = rows.map((r) => r.dedupe_key);
  const have = await svc.from('lb_comm_jobs').select('dedupe_key').eq('tenant_id', tenantId).in('dedupe_key', keys);
  if (have.error) throw have.error;
  const known = new Set((have.data || []).map((x) => x.dedupe_key));
  const fresh = rows.filter((r) => !known.has(r.dedupe_key)).slice(0, MAX_NEW_JOBS_PER_BUSINESS_PER_RUN);
  if (!fresh.length) return;
  const ins = await svc.from('lb_comm_jobs').upsert(fresh, { onConflict: 'tenant_id,dedupe_key', ignoreDuplicates: true });
  if (ins.error) throw ins.error;
  stats.created += fresh.length;
}

// ------------------------------------------------------------------------------------------------ re-check waiting jobs
async function recheckBusiness({ svc, b, biz, prefs, templates, now, stats }) {
  const r = await svc.from('lb_comm_jobs').select('*').eq('tenant_id', b.tenant_id).eq('business_id', b.id).in('status', ['READY', 'PENDING']).order('updated_at', { ascending: true }).limit(MAX_REVALIDATE_PER_BUSINESS);
  if (r.error) throw r.error;
  for (const job of r.data || []) {
    try {
      const a = prefs.automations[job.automation];
      if (!a || a.mode === 'OFF') { await closeJob(svc, job, 'CANCELLED', 'This automation was switched off.'); stats.suppressed += 1; continue; }
      const c = await composeForJob({ svc, job, biz, prefs, templates, now });
      const ev = evaluateJob(c);
      if (ev.action === 'SUPPRESS') { await closeJob(svc, job, 'SUPPRESSED', ev.reason); await audit(svc, job, 'COMM_JOB_SUPPRESSED', { reason: ev.reason }); stats.suppressed += 1; }
      else if (ev.action === 'REVIEW' && job.status === 'PENDING') await svc.from('lb_comm_jobs').update({ status: 'READY', status_reason: ev.reason }).eq('id', job.id).eq('status', 'PENDING');
      else await svc.from('lb_comm_jobs').update({ updated_at: now.toISOString() }).eq('id', job.id);
    } catch (e) { stats.errors.push(`recheck ${job.id}: ${e.message || e}`); }
  }
}

async function closeJob(svc, job, status, reason) {
  await svc.from('lb_comm_jobs').update({ status, status_reason: reason }).eq('id', job.id);
}

async function audit(svc, job, action, metadata) {
  try {
    await svc.from('pos_audit_log').insert({ pos_tenant_id: job.tenant_id, actor_type: 'system', actor_id: null, action, entity_type: 'lb_comm_jobs', entity_id: job.id, metadata: { purpose: job.purpose, channel: job.channel, dedupe_key: job.dedupe_key, ...metadata } });
  } catch { /* an audit hiccup must not stop messaging; the job row itself is the primary record */ }
}

// ------------------------------------------------------------------------------------------------ send claimed jobs
async function processJob({ svc, job, ctxFor, env, fetchFn, now, stats }) {
  const { biz, prefs, templates } = await ctxFor(job);
  const c = await composeForJob({ svc, job, biz, prefs, templates, now });
  const ev = evaluateJob(c);
  if (ev.action === 'SUPPRESS') { await closeJob(svc, job, 'SUPPRESSED', ev.reason); await audit(svc, job, 'COMM_JOB_SUPPRESSED', { reason: ev.reason }); stats.suppressed += 1; return; }
  if (ev.action === 'REVIEW') { await svc.from('lb_comm_jobs').update({ status: 'READY', status_reason: ev.reason }).eq('id', job.id); stats.review += 1; return; }
  if (!isConfigured(job.channel, env)) {
    await svc.from('lb_comm_jobs').update({ status: 'READY', status_reason: 'Automatic sending is not set up for this channel, so it was left for you to review and send.' }).eq('id', job.id);
    stats.review += 1; return;
  }
  if (inQuietHours(now, biz.time_zone, prefs.quiet_hours)) {
    await svc.from('lb_comm_jobs').update({ status: 'PENDING', next_attempt_at: new Date(now.getTime() + 20 * 60000).toISOString(), attempts: Math.max(0, job.attempts - 1) }).eq('id', job.id);
    stats.deferred += 1; return;
  }
  const ins = await svc.from('lb_communication_log').insert({
    tenant_id: job.tenant_id, business_id: job.business_id, customer_id: job.customer_id, supplier_id: job.supplier_id,
    recipient_kind: job.recipient_kind, recipient_name: c.recipientName || null, channel: job.channel, message_type: 'OTHER', purpose: c.purpose,
    recipient: c.to, subject: c.subject || null, generated_message: c.body, rendered_message: c.body, template_source: c.source,
    reference_type: job.reference_type, reference_id: job.reference_id, status: 'QUEUED', initiated_by: 'AUTOMATION', job_id: job.id,
  }).select('id, channel, recipient, rendered_message, subject, attempts').single();
  if (ins.error) throw ins.error;
  const out = await sendLogRow({ svc, row: ins.data, env, fetchFn, businessName: biz.name, senderId: prefs.sms_sender_id });
  if (out.state === 'SUBMITTED') {
    await svc.from('lb_comm_jobs').update({ status: 'DONE', log_id: ins.data.id, last_error: null, status_reason: null }).eq('id', job.id);
    await audit(svc, job, 'COMM_AUTO_SENT', { log_id: ins.data.id }); stats.sent += 1; return;
  }
  const msg = out.message || 'The message could not be sent.';
  if (out.state === 'NOT_CONFIGURED') { await svc.from('lb_comm_jobs').update({ status: 'READY', status_reason: msg, log_id: ins.data.id }).eq('id', job.id); stats.review += 1; return; }
  if (out.transient && job.attempts < MAX_ATTEMPTS) {
    await svc.from('lb_comm_jobs').update({ status: 'PENDING', last_error: msg, next_attempt_at: new Date(now.getTime() + nextRetryDelayMinutes(job.attempts) * 60000).toISOString() }).eq('id', job.id);
    stats.retry += 1; return;
  }
  await svc.from('lb_comm_jobs').update({ status: 'FAILED', last_error: msg, log_id: ins.data.id }).eq('id', job.id);
  await audit(svc, job, 'COMM_AUTO_FAILED', { error: msg, code: out.code }); stats.failed += 1;
}

// ------------------------------------------------------------------------------------------------ entry
export async function runDispatch({ svc, env, fetchFn = fetch, now = new Date() }) {
  const stats = { businesses: 0, created: 0, suppressed: 0, sent: 0, review: 0, deferred: 0, retry: 0, failed: 0, errors: [] };
  const businesses = await activeBusinesses(svc);
  const cache = new Map();
  const ctxOf = async (b) => {
    if (cache.has(b.id)) return cache.get(b.id);
    const [biz, prefs, templates] = await Promise.all([L.loadBusiness(svc, { tenantId: b.tenant_id, businessId: b.id }), L.loadPrefs(svc, { tenantId: b.tenant_id, businessId: b.id }), L.loadTemplates(svc, { tenantId: b.tenant_id, businessId: b.id })]);
    const v = { b, biz, prefs, templates }; cache.set(b.id, v); return v;
  };
  const byId = new Map(businesses.map((b) => [b.id, b]));

  for (const b of businesses) {
    try {
      const { biz, prefs, templates } = await ctxOf(b);
      if (!Object.values(prefs.automations).some((a) => a.mode !== 'OFF')) continue;
      if (!biz.name) { stats.errors.push(`${b.id}: no business name, skipped`); continue; }
      stats.businesses += 1;
      await scanBusiness({ svc, b, biz, prefs, now, stats });
      await recheckBusiness({ svc, b, biz, prefs, templates, now, stats });
    } catch (e) { stats.errors.push(`${b.id}: ${e.message || e}`); log('business failed', b.id, e.message || e); }
  }

  // send what is due (AUTO only)
  const claimed = await svc.rpc('comm_claim_jobs', { p_limit: 25 });
  if (claimed.error) { stats.errors.push(`claim: ${claimed.error.message}`); return stats; }
  for (const job of claimed.data || []) {
    try {
      const b = byId.get(job.business_id);
      if (!b) { await closeJob(svc, job, 'CANCELLED', 'The business is no longer active.'); continue; }
      await processJob({ svc, job, ctxFor: async () => ctxOf(b), env, fetchFn, now, stats });
    } catch (e) {
      stats.errors.push(`job ${job.id}: ${e.message || e}`);
      // never leave it PROCESSING without a trace, and never auto-retry something that might have reached the provider
      await svc.from('lb_comm_jobs').update({ status: 'FAILED', last_error: `Unexpected error: ${e.message || e}` }).eq('id', job.id);
    }
  }
  log(JSON.stringify(stats));
  return stats;
}

export { AUTOMATION_BY_KEY };
