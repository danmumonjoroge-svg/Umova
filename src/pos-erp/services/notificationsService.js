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

  async getAll() {
    const [lowStock, supplierBalances, customerCredit, shifts] = await Promise.all([
      this.getLowStockNotifications(),
      this.getSupplierBalanceNotifications(),
      this.getCustomerCreditNotifications(),
      this.getShiftNotifications(),
    ]);
    return [...shifts, ...lowStock, ...supplierBalances, ...customerCredit];
  },
};
