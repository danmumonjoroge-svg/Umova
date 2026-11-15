// src/pos-erp/services/notificationsService.js
//
// Aggregates the four categories confirmed in the conversation: low
// stock, overdue supplier balances, overdue customer credit, and
// shift issues (open too long / closed unbalanced). Each category
// reads data that already exists and is already kept correct
// elsewhere (applyStockMovement for stock_status, closeShift for
// variance) — this file doesn't compute anything new, it just surfaces
// what's already there as a flat notification list.
//
// THRESHOLDS BELOW ARE GUESSES, clearly marked — there's no business
// rule in the schema for "how long is too long to leave a shift open"
// or "how much variance counts as unbalanced". Exported as constants
// so they're one-line changes once you have real numbers.

import { posSupabase as supabase } from './posSupabaseClient';
import { inventoryService } from './inventoryService';
import { supplierService } from './supplierService';
import { loanService } from './loanService';
import { buildLoanNotifications } from '../utils/loanHelpers';
import * as C from '../utils/comm';
import { buildCommNotifications } from '../supabase/functions/_shared/comm/notifications.js';

// ASSUMPTIONS — adjust freely, these are not derived from anything in the schema.
export const OPEN_SHIFT_HOURS_THRESHOLD = 12; // a shift open longer than this is flagged
export const VARIANCE_TOLERANCE = 500; // absolute cash variance beyond this is flagged

export const notificationsService = {
  async getLowStockNotifications() {
    const items = await inventoryService.getLowStockItems();
    return items.map((i) => ({
      id: `low-stock-${i.id}`,
      category: 'INVENTORY',
      severity: i.stock_status === 'OUT_OF_STOCK' ? 'high' : 'medium',
      message: i.stock_status === 'OUT_OF_STOCK'
        ? `${i.product?.name || 'A product'} is out of stock`
        : `${i.product?.name || 'A product'} is low on stock (${i.quantity} left)`,
      link: '/pos/products',
      createdAt: null,
    }));
  },

  async getSupplierBalanceNotifications() {
    const suppliers = await supplierService.getWithOutstandingBalances();
    return suppliers.map((s) => ({
      id: `supplier-balance-${s.id}`,
      category: 'SUPPLIER',
      severity: s.credit_limit > 0 && s.outstanding_balance > s.credit_limit ? 'high' : 'medium',
      message: `${s.name} has an outstanding balance of ${Number(s.outstanding_balance).toLocaleString()}`,
      link: '/pos/suppliers',
      createdAt: null,
    }));
  },

  async getCustomerCreditNotifications() {
    const { data, error } = await supabase
      .from('lb_customers')
      .select('id, name, outstanding_balance, credit_limit')
      .gt('outstanding_balance', 0)
      .order('outstanding_balance', { ascending: false });
    if (error) throw error;
    return (data || []).map((c) => ({
      id: `customer-credit-${c.id}`,
      category: 'CUSTOMER',
      severity: c.credit_limit > 0 && c.outstanding_balance > c.credit_limit ? 'high' : 'medium',
      message: `${c.name} owes ${Number(c.outstanding_balance).toLocaleString()} on credit`,
      link: '/pos/customers', // FIXED: CustomersPage.jsx exists now (built in Phase 2) — was null with a "no Customers page exists yet" comment
      createdAt: null,
    }));
  },

  async getShiftNotifications() {
    const { data, error } = await supabase
      .from('lb_cashier_shifts')
      .select('id, shift_number, status, opened_at, variance')
      .order('opened_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const now = Date.now();
    const notifications = [];

    for (const s of data || []) {
      if (s.status === 'OPEN') {
        const hoursOpen = (now - new Date(s.opened_at).getTime()) / 36e5;
        if (hoursOpen >= OPEN_SHIFT_HOURS_THRESHOLD) {
          notifications.push({
            id: `shift-open-${s.id}`,
            category: 'SHIFT',
            severity: 'medium',
            message: `Shift ${s.shift_number} has been open for ${Math.floor(hoursOpen)}h`,
            link: '/pos/dashboard',
            createdAt: s.opened_at,
          });
        }
      } else if (Math.abs(s.variance || 0) > VARIANCE_TOLERANCE) {
        notifications.push({
          id: `shift-variance-${s.id}`,
          category: 'SHIFT',
          severity: 'high',
          message: `Shift ${s.shift_number} closed with a variance of ${Number(s.variance).toLocaleString()}`,
          link: '/pos/dashboard',
          createdAt: s.opened_at,
        });
      }
    }
    return notifications;
  },

  // Loan reminders: from 7 days before an instalment is due, on the day, and every day after until it is paid.
  // Worked out live from the instalments each time (same as the other alerts), so there is nothing to schedule or send.
  // Never lets a problem here (loan tables not installed yet, no internet) take the other alerts down with it.
  async getLoanNotifications() {
    try {
      return buildLoanNotifications(await loanService.getAll());
    } catch (err) {
      console.warn('[notifications] loan reminders unavailable:', err?.message || err);
      return [];
    }
  },

  // Phase 50 — date-aware alerts (overdue / due soon balances, late deliveries, today's appointments, messages waiting).
  // Uses the same date engine as the messages themselves. A failure here never takes the other alerts down.
  async getCommunicationNotifications({ tenantId, businessId, now = new Date() } = {}) {
    if (!tenantId) return [];
    try {
      const [business, prefs] = await Promise.all([
        C.loaders.loadBusiness(supabase, { tenantId, businessId }),
        C.loaders.loadPrefs(supabase, { tenantId, businessId }),
      ]);
      const tz = business.time_zone || C.DEFAULT_TZ;
      const today = C.nowInTz(now, tz).today;
      const [recv, pos, appts, ready, failed, paid] = await Promise.all([
        C.loaders.loadAllReceivables(supabase, { tenantId, tz, prefs }),
        supabase.from('lb_purchase_orders').select('id, po_number, status, supplier_id, expected_date, revised_delivery_date, supplier:lb_suppliers(id, name)').eq('tenant_id', tenantId).in('status', ['APPROVED', 'PARTIALLY_RECEIVED']).limit(200),
        supabase.from('lb_appointments').select('id, status, customer_id, appointment_date, appointment_time, customer:lb_customers(id, name), service:lb_products(name)').eq('tenant_id', tenantId).gte('appointment_date', today).limit(100),
        supabase.from('lb_comm_jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'READY'),
        supabase.from('lb_communication_log').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'FAILED').gte('created_at', new Date(now.getTime() - 7 * 864e5).toISOString()),
        supabase.from('lb_customer_payments').select('id, amount, created_at, customer:lb_customers(name)').eq('tenant_id', tenantId).gte('created_at', new Date(now.getTime() - 864e5).toISOString()).order('created_at', { ascending: false }).limit(5),
      ]);
      const ids = recv.map((r) => r.id);
      const names = ids.length ? (await supabase.from('lb_customers').select('id, name').eq('tenant_id', tenantId).in('id', ids)).data || [] : [];
      const nameOf = Object.fromEntries(names.map((n) => [n.id, n.name]));
      return buildCommNotifications({
        receivables: recv.map((r) => ({ ...r, name: nameOf[r.id] || 'A customer' })),
        pos: pos.data || [], appointments: appts.data || [],
        readyJobs: ready.count || 0, failedMessages: failed.count || 0,
        recentPayments: (paid.data || []).map((p) => ({ id: p.id, amount: p.amount, customer_name: p.customer?.name })),
        now, tz, currency: business.currency, leadDays: prefs.timing?.payment_lead_days,
      });
    } catch (err) {
      console.warn('[notifications] date-aware alerts unavailable:', err?.message || err);
      return [];
    }
  },

  async getReadKeys({ tenantId, staffId }) {
    if (!tenantId || !staffId) return new Set();
    const { data } = await supabase.from('lb_notification_reads').select('notif_key').eq('tenant_id', tenantId).eq('staff_id', staffId).limit(1000);
    return new Set((data || []).map((r) => r.notif_key));
  },
  async markRead({ tenantId, staffId, keys }) {
    if (!tenantId || !staffId || !keys?.length) return;
    await supabase.from('lb_notification_reads').upsert(keys.map((k) => ({ tenant_id: tenantId, staff_id: staffId, notif_key: k })), { onConflict: 'staff_id,notif_key' });
  },

  async getAll(ctx = {}) {
    const [lowStock, supplierBalances, customerCredit, shifts, loans, dated] = await Promise.all([
      this.getLowStockNotifications(),
      this.getSupplierBalanceNotifications(),
      this.getCustomerCreditNotifications(),
      this.getShiftNotifications(),
      this.getLoanNotifications(),
      this.getCommunicationNotifications(ctx),
    ]);
    // A dated alert for a customer replaces the plain "owes X" line, so nobody is listed twice.
    const datedCustomers = new Set(dated.filter((n) => n.contact?.kind === 'CUSTOMER' && n.id.startsWith('cust-')).map((n) => n.contact.id));
    const credit = customerCredit.filter((n) => !datedCustomers.has(n.id.replace('customer-credit-', '')));
    return [...dated, ...loans, ...shifts, ...lowStock, ...supplierBalances, ...credit];
  },
};
