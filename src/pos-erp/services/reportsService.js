// src/pos-erp/services/reportsService.js
//
// getDailySummary(date) — if a CLOSED lb_daily_closings row exists for
// that date, return it as-is (source: 'closed'). Otherwise compute the
// same shape live from lb_sales/lb_payments/lb_expenses/lb_cash_movements
// (source: 'live') so "today, before anyone closes the day" still shows
// something real instead of nothing. This live-preview path has no RPC
// equivalent (there's nothing to close yet), so it stays a client-side
// read — that's a different situation from closeDay() below.
//
// FIXED: closeDay() used to reimplement the exact same computation
// perform_daily_closing() (the RPC) already does, and wrote directly to
// lb_daily_closings — a second "close the day" code path alongside
// cashierService.performDailyClosing() (used by pages/CashPage.jsx),
// with no guarantee the two ever agreed. Concretely they didn't: this
// file hardcoded total_refunds to 0 (never queried lb_refunds at all),
// while the RPC actually populates it from lb_refunds. Now delegates to
// the RPC via cashierService.performDailyClosing() instead of
// recomputing — one authority for "close the day", matching the fix
// already made to cashierService.closeShift()/supplierService.recordPayment().
//
// ADDED: getItemsSold() and getExpenseBreakdown() - the "what exactly" behind the day's totals
// (which items, how many units, which spending). Both are read-only, work for live AND closed days
// (nothing is stored in lb_daily_closings for them), and use the SAME day boundaries and the SAME
// sale statuses as computeSummary(), so the item revenue lines up with Total Sales.
//
// Payment-method -> daily_closings column mapping (per the confirmed
// lb_payment_method enum: BANK, CARD, CASH, CREDIT, MOBILE_MONEY,
// OTHER, VOUCHER) — still used by the live-preview path above:
//   CASH          -> total_cash_payments
//   MOBILE_MONEY  -> total_mobile_payments
//   CARD          -> total_card_payments
//   CREDIT        -> total_credit_sales
//   BANK/VOUCHER/OTHER -> total_other_payments

import { posSupabase as supabase } from './posSupabaseClient';
import { cashierService } from './cashierService';

function mapMethodToColumn(method) {
  switch (method) {
    case 'CASH': return 'total_cash_payments';
    case 'MOBILE_MONEY': return 'total_mobile_payments';
    case 'CARD': return 'total_card_payments';
    case 'CREDIT': return 'total_credit_sales';
    default: return 'total_other_payments'; // BANK, VOUCHER, OTHER
  }
}

async function computeSummary({ tenantId, date }) {
  const { data: sales, error: salesError } = await supabase
    .from('lb_sales')
    .select('id, total_amount, shift_id')
    .eq('tenant_id', tenantId)
    .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED'])
    .gte('created_at', `${date}T00:00:00`)
    .lt('created_at', `${date}T23:59:59.999`);
  if (salesError) throw salesError;

  const totalSales = (sales || []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  const saleIds = (sales || []).map((s) => s.id);

  const paymentTotals = {
    total_cash_payments: 0,
    total_mobile_payments: 0,
    total_card_payments: 0,
    total_credit_sales: 0,
    total_other_payments: 0,
  };

  if (saleIds.length) {
    const { data: payments, error: paymentsError } = await supabase
      .from('lb_payments')
      .select('payment_method, amount, change_amount')
      .in('sale_id', saleIds)
      .eq('status', 'COMPLETED');
    if (paymentsError) throw paymentsError;

    for (const p of payments || []) {
      const col = mapMethodToColumn(p.payment_method);
      paymentTotals[col] += Number(p.amount) - Number(p.change_amount || 0);
    }
  }

  const { data: expenses, error: expensesError } = await supabase
    .from('lb_expenses')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('expense_date', date)
    .eq('status', 'PAID');
  if (expensesError) throw expensesError;
  const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);

  const { data: movements, error: movementsError } = await supabase
    .from('lb_cash_movements')
    .select('movement_type, amount, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', `${date}T00:00:00`)
    .lt('created_at', `${date}T23:59:59.999`);
  if (movementsError) throw movementsError;

  let totalCashIn = 0, totalCashOut = 0;
  for (const m of movements || []) {
    if (m.movement_type === 'CASH_IN') totalCashIn += Number(m.amount);
    else totalCashOut += Number(m.amount); // CASH_OUT + PETTY_CASH
  }

  const { count: stockMovementCount, error: smError } = await supabase
    .from('lb_stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', `${date}T00:00:00`)
    .lt('created_at', `${date}T23:59:59.999`);
  if (smError) throw smError;

  return {
    closing_date: date,
    total_sales: totalSales,
    ...paymentTotals,
    total_expenses: totalExpenses,
    total_refunds: 0, // live-preview only — closeDay() now gets the real figure from the RPC (see header note)
    total_cash_in: totalCashIn,
    total_cash_out: totalCashOut,
    stock_movement_count: stockMovementCount || 0,
  };
}


const DAY_START = (date) => `${date}T00:00:00`;
const DAY_END = (date) => `${date}T23:59:59.999`;
const CHUNK = 100; // sale ids per request - keeps the URL short on busy days

function chunked(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const num = (v) => Number(v || 0);

/**
 * Everything sold on one day, grouped Category -> Product -> Price.
 * "Sold" = lines of COMPLETED / PARTIALLY_REFUNDED sales (same rule as Total Sales). Reversed or voided
 * sales are left out. Partly-refunded sales still show their original lines (refunds are not kept per item).
 *
 * @returns {{salesCount:number, totalUnits:number, totalRevenue:number, categories:Array}}
 *   category: { id, name, units, revenue, products: [ { id, name, sku, unitLabel, units, revenue, prices: [ { unit_price, units, revenue } ] } ] }
 */
async function getItemsSold({ tenantId, businessId, date }) {
  let salesQuery = supabase
    .from('lb_sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED'])
    .gte('created_at', DAY_START(date))
    .lt('created_at', DAY_END(date));
  if (businessId) salesQuery = salesQuery.eq('business_id', businessId);
  const { data: sales, error: salesError } = await salesQuery;
  if (salesError) throw salesError;

  const saleIds = (sales || []).map((s) => s.id);
  const rows = [];
  for (const ids of chunked(saleIds, CHUNK)) {
    const { data, error } = await supabase
      .from('lb_sale_items')
      .select('quantity, unit_price, total_price, selling_mode, product:lb_products(id, name, sku, category:lb_product_categories(id, name), unit:lb_product_units(code))')
      .in('sale_id', ids);
    if (error) throw error;
    rows.push(...(data || []));
  }

  const cats = new Map();
  let totalUnits = 0;
  let totalRevenue = 0;

  for (const r of rows) {
    const qty = num(r.quantity);
    const revenue = num(r.total_price);
    const price = num(r.unit_price);
    const prod = r.product || null;
    const cat = prod?.category || null;

    const catKey = cat?.id || 'none';
    if (!cats.has(catKey)) cats.set(catKey, { id: catKey, name: cat?.name || 'Other items', units: 0, revenue: 0, products: new Map() });
    const c = cats.get(catKey);

    const prodKey = prod?.id || 'custom';
    if (!c.products.has(prodKey)) {
      c.products.set(prodKey, {
        id: prodKey,
        name: prod?.name || 'Custom / open item',
        sku: prod?.sku || null,
        unitLabel: r.selling_mode && r.selling_mode !== 'PER_UNIT' ? (prod?.unit?.code || null) : null,
        units: 0, revenue: 0, prices: new Map(),
      });
    }
    const p = c.products.get(prodKey);

    if (!p.prices.has(price)) p.prices.set(price, { unit_price: price, units: 0, revenue: 0 });
    const pl = p.prices.get(price);

    pl.units += qty; pl.revenue += revenue;
    p.units += qty;  p.revenue += revenue;
    c.units += qty;  c.revenue += revenue;
    totalUnits += qty; totalRevenue += revenue;
  }

  const categories = [...cats.values()]
    .map((c) => ({
      ...c,
      products: [...c.products.values()]
        .map((p) => ({ ...p, prices: [...p.prices.values()].sort((a, b) => b.units - a.units) }))
        .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  return { salesCount: saleIds.length, totalUnits, totalRevenue, categories };
}

/**
 * The day's PAID spending, grouped Category -> individual entries.
 * @returns {{total:number, categories:Array<{name,total,entries:Array<{id,description,amount}>}>}}
 */
async function getExpenseBreakdown({ tenantId, businessId, date }) {
  let q = supabase
    .from('lb_expenses')
    .select('id, amount, description, category:lb_expense_categories(name)')
    .eq('tenant_id', tenantId)
    .eq('expense_date', date)
    .eq('status', 'PAID');
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw error;

  const cats = new Map();
  let total = 0;
  for (const e of data || []) {
    const name = e.category?.name || 'Uncategorised';
    if (!cats.has(name)) cats.set(name, { name, total: 0, entries: [] });
    const c = cats.get(name);
    const amount = num(e.amount);
    c.total += amount; total += amount;
    c.entries.push({ id: e.id, description: e.description || name, amount });
  }
  const categories = [...cats.values()]
    .map((c) => ({ ...c, entries: c.entries.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.total - a.total);
  return { total, categories };
}

export const reportsService = {
  getItemsSold,
  getExpenseBreakdown,

  /**
   * @param {string} date - 'YYYY-MM-DD'
   */
  async getDailySummary({ tenantId, date }) {
    const { data: closed, error } = await supabase
      .from('lb_daily_closings')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('closing_date', date)
      .eq('status', 'CLOSED')
      .maybeSingle();
    if (error) throw error;

    if (closed) return { ...closed, source: 'closed' };

    const computed = await computeSummary({ tenantId, date });
    return { ...computed, source: 'live' };
  },

  /**
   * Closes the day via perform_daily_closing() — see header note on why
   * this no longer recomputes client-side. tenantId is accepted for call-
   * site compatibility (ReportsPage.jsx already passes it) but isn't
   * needed by the RPC itself, which derives tenant_id from businessId.
   */
  async closeDay({ tenantId, businessId, date, closedBy }) {
    if (!businessId) throw new Error('reportsService.closeDay: businessId is required.');
    await cashierService.performDailyClosing({ businessId, closingDate: date, closedBy });

    const { data, error } = await supabase
      .from('lb_daily_closings')
      .select('*')
      .eq('business_id', businessId)
      .eq('closing_date', date)
      .single();
    if (error) throw error;
    return data;
  },
};
