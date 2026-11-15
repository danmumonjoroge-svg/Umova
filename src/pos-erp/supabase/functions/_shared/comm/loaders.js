// supabase/functions/_shared/comm/loaders.js
//
// Reads the real records a message is built from. `db` is any supabase-js client:
//   * in the app it is the signed-in user's client (so row-level security limits every read to their business)
//   * in the scheduler it is the service-role client, so EVERY query here is also filtered by tenant_id explicitly.
// The same code therefore gives the same answer in both places.
//
// Reads only. Nothing here writes to any business table.

import { normalizePrefs } from './prefs.js';
import { toYmd, nowInTz, addDays } from './dateContext.js';

const one = (r) => { if (r.error) throw r.error; return r.data; };
const rows = (r) => { if (r.error) throw r.error; return r.data || []; };

/** Registered business name (the name given at registration) + contact details + zone. */
export async function loadBusiness(db, { tenantId, businessId }) {
  const [t, b] = await Promise.all([
    db.from('pos_tenants').select('business_name, phone, email').eq('id', tenantId).maybeSingle(),
    businessId ? db.from('lb_businesses').select('name, phone, email, address, currency, time_zone').eq('id', businessId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const tenant = t.error ? null : t.data;
  const biz = b.error ? null : b.data;
  return {
    name: (tenant?.business_name || biz?.name || '').trim(),
    phone: biz?.phone || tenant?.phone || '',
    email: biz?.email || tenant?.email || '',
    address: biz?.address || '',
    currency: biz?.currency || 'KES',
    time_zone: biz?.time_zone || 'Africa/Nairobi',
  };
}

export async function loadPrefs(db, { tenantId, businessId }) {
  if (!businessId) return normalizePrefs(null);
  const r = await db.from('lb_comm_preferences').select('settings').eq('tenant_id', tenantId).eq('business_id', businessId).maybeSingle();
  return normalizePrefs(r.error ? null : r.data);
}

export async function loadTemplates(db, { tenantId, businessId }) {
  let q = db.from('lb_communication_templates').select('id, business_id, purpose, message_type, channel, subject, body, is_active, is_customised').eq('tenant_id', tenantId);
  if (businessId) q = q.eq('business_id', businessId);
  const r = await q;
  return r.error ? [] : (r.data || []);
}

export async function loadRecipient(db, { tenantId, kind, id }) {
  if (kind === 'CUSTOMER') {
    const c = one(await db.from('lb_customers').select('id, name, phone, email, outstanding_balance').eq('tenant_id', tenantId).eq('id', id).maybeSingle());
    return c ? { kind, ...c } : null;
  }
  if (kind === 'SUPPLIER') {
    const s = one(await db.from('lb_suppliers').select('id, name, phone, email, contact_person, outstanding_balance').eq('tenant_id', tenantId).eq('id', id).maybeSingle());
    return s ? { kind, ...s } : null;
  }
  return null;
}

/** Owner / staff recipient for business messages. */
export async function loadStaffRecipient(db, { tenantId, staffId }) {
  const r = await db.from('pos_staff').select('id, name, phone, email, role').eq('pos_tenant_id', tenantId).eq('id', staffId).maybeSingle();
  const s = r.error ? null : r.data;
  return s ? { kind: s.role === 'owner' ? 'OWNER' : 'STAFF', id: s.id, name: s.name, phone: s.phone, email: s.email } : null;
}

export async function loadOwnerRecipient(db, { tenantId }) {
  const r = await db.from('pos_staff').select('id, name, phone, email, role').eq('pos_tenant_id', tenantId).eq('role', 'owner').eq('status', 'active').order('created_at').limit(1).maybeSingle();
  const s = r.error ? null : r.data;
  return s ? { kind: 'OWNER', id: s.id, name: s.name, phone: s.phone, email: s.email } : null;
}

// ---- receivables ----------------------------------------------------------------------------------------
export async function loadReceivable(db, { tenantId, customerId, tz, prefs, withLedger = false }) {
  const days = prefs?.default_credit_days > 0 ? prefs.default_credit_days : null;
  const snap = rows(await db.rpc('comm_receivable_snapshot', { p_tenant: tenantId, p_tz: tz, p_default_days: days, p_customer: customerId }));
  const cust = one(await db.from('lb_customers').select('outstanding_balance').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle());
  const out = {
    outstanding: Number(cust?.outstanding_balance || 0),
    items: snap.filter((r) => r.due_date).map((r) => ({ due_date: r.due_date, amount: Number(r.open_amount), reference: r.reference || '' })),
  };
  if (withLedger) {
    const led = rows(await db.from('lb_customer_credit_transactions').select('created_at, transaction_type, amount, balance_after').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10));
    out.ledger = led.reverse();
  }
  return out;
}

/** Every customer who owes money, with their open items (scheduler). */
export async function loadAllReceivables(db, { tenantId, tz, prefs }) {
  const days = prefs?.default_credit_days > 0 ? prefs.default_credit_days : null;
  const snap = rows(await db.rpc('comm_receivable_snapshot', { p_tenant: tenantId, p_tz: tz, p_default_days: days, p_customer: null }));
  const by = new Map();
  for (const r of snap) {
    if (!by.has(r.customer_id)) by.set(r.customer_id, { id: r.customer_id, outstanding: Number(r.outstanding), items: [] });
    if (r.due_date) by.get(r.customer_id).items.push({ due_date: r.due_date, amount: Number(r.open_amount), reference: r.reference || '' });
  }
  return [...by.values()];
}

// ---- transactions -----------------------------------------------------------------------------------------
export async function loadSale(db, { tenantId, saleId }) {
  const s = one(await db.from('lb_sales').select('*, items:lb_sale_items(quantity, total_price, product:lb_products(name)), payments:lb_payments(amount, change_amount, status), receipt:lb_receipts(receipt_number)').eq('tenant_id', tenantId).eq('id', saleId).maybeSingle());
  if (!s) return null;
  const pays = (s.payments || []).filter((p) => !p.status || !['FAILED', 'CANCELLED', 'REVERSED'].includes(String(p.status).toUpperCase()));
  const receipt = Array.isArray(s.receipt) ? s.receipt[0] : s.receipt;
  return { ...s, receipt_number: receipt?.receipt_number, paid_amount: pays.length ? pays.reduce((a, p) => a + Number(p.amount || 0) - Number(p.change_amount || 0), 0) : null };
}

export async function loadPayment(db, { tenantId, paymentId }) {
  return one(await db.from('lb_customer_payments').select('id, customer_id, amount, payment_method, reference_no, created_at').eq('tenant_id', tenantId).eq('id', paymentId).maybeSingle());
}

export async function loadAppointment(db, { tenantId, appointmentId }) {
  return one(await db.from('lb_appointments').select('*, service:lb_products(name), staff:pos_staff(name)').eq('tenant_id', tenantId).eq('id', appointmentId).maybeSingle());
}

export async function loadPo(db, { tenantId, poId }) {
  return one(await db.from('lb_purchase_orders').select('*, supplier:lb_suppliers(id, name), items:lb_purchase_order_items(quantity, received_quantity, product:lb_products(name))').eq('tenant_id', tenantId).eq('id', poId).maybeSingle());
}

export async function loadGrn(db, { tenantId, grnId }) {
  const g = one(await db.from('lb_goods_received_notes').select('*, items:lb_grn_items(quantity, product:lb_products(name)), po:lb_purchase_orders(po_number, items:lb_purchase_order_items(quantity, received_quantity, product:lb_products(name)))').eq('tenant_id', tenantId).eq('id', grnId).maybeSingle());
  return g;
}

export async function loadSupplierPayment(db, { tenantId, paymentId }) {
  return one(await db.from('lb_supplier_payments').select('id, supplier_id, amount, payment_method, reference_no, payment_date, created_at').eq('tenant_id', tenantId).eq('id', paymentId).maybeSingle());
}

export async function loadSupplierActivity(db, { tenantId, supplierId }) {
  const [pos, pays] = await Promise.all([
    db.from('lb_purchase_orders').select('po_number, order_date, total_amount').eq('tenant_id', tenantId).eq('supplier_id', supplierId).order('order_date', { ascending: false }).limit(5),
    db.from('lb_supplier_payments').select('amount, payment_date, created_at').eq('tenant_id', tenantId).eq('supplier_id', supplierId).order('payment_date', { ascending: false }).limit(5),
  ]);
  return { recentPos: pos.error ? [] : pos.data || [], recentSupplierPayments: pays.error ? [] : pays.data || [] };
}

export async function loadLowStock(db, { tenantId }) {
  const r = await db.from('lb_inventory').select('quantity, stock_status, product:lb_products(name, reorder_level)').eq('tenant_id', tenantId).in('stock_status', ['LOW_STOCK', 'OUT_OF_STOCK']).order('quantity', { ascending: true }).limit(40);
  if (r.error) return [];
  return (r.data || []).map((i) => ({ name: i.product?.name || 'Product', quantity: i.quantity, stock_status: i.stock_status, reorder_level: i.product?.reorder_level }));
}

export async function loadDailySales(db, { tenantId, date, tz }) {
  const from = zonedDayStartIso(date, tz); const to = zonedDayStartIso(addDays(date, 1), tz);
  const s = await db.from('lb_sales').select('id, total_amount, status, payments:lb_payments(payment_method, amount)').eq('tenant_id', tenantId).gte('completed_at', from).lt('completed_at', to);
  if (s.error) throw s.error;
  const ok = (s.data || []).filter((x) => !['CANCELLED', 'VOIDED', 'REVERSED'].includes(String(x.status || '').toUpperCase()));
  const byMethod = {};
  for (const x of ok) for (const p of x.payments || []) byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount || 0);
  return { date, total: ok.reduce((a, x) => a + Number(x.total_amount || 0), 0), count: ok.length, byMethod };
}

function zonedDayStartIso(ymd, tz) {
  // midnight at the start of `ymd` in the business zone, as a UTC instant
  const n = nowInTz(new Date(`${ymd}T12:00:00Z`), tz);
  const offsetMin = Math.round((new Date(`${n.today}T${n.time}:00Z`).getTime() - n.instant.getTime()) / 60000);
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offsetMin * 60000).toISOString();
}

export { toYmd };
