// src/pos-erp/services/reportsService.js
//
// lb_daily_closings has real columns for every payment-method breakdown
// (total_cash_payments, total_mobile_payments, total_card_payments,
// total_credit_sales, total_other_payments) plus totals for expenses,
// refunds, and cash in/out — but nothing in this codebase writes to it
// yet (confirmed in conversation). So this file does two things:
//
//   getDailySummary(date) — if a CLOSED lb_daily_closings row exists for
//   that date, return it as-is (source: 'closed'). Otherwise compute the
//   same shape live from lb_sales/lb_payments/lb_expenses/lb_cash_movements
//   (source: 'live') so "today, before anyone closes the day" still shows
//   something real instead of nothing.
//
//   closeDay(date) — computes the same numbers and actually writes the
//   lb_daily_closings row for the first time, moving it from "empty
//   table" to "populated the way the schema clearly intends".
//
// KNOWN GAP: total_refunds is left at 0 — lb_refunds' schema hasn't
// been confirmed yet (same gap flagged in cashierService.js). Once
// that's in, both this and computeExpectedCash should subtract cash
// refunds properly instead of ignoring them.
//
// Payment-method -> daily_closings column mapping (per the confirmed
// lb_payment_method enum: BANK, CARD, CASH, CREDIT, MOBILE_MONEY,
// OTHER, VOUCHER):
//   CASH          -> total_cash_payments
//   MOBILE_MONEY  -> total_mobile_payments
//   CARD          -> total_card_payments
//   CREDIT        -> total_credit_sales
//   BANK/VOUCHER/OTHER -> total_other_payments

import { posSupabase as supabase } from './posSupabaseClient';

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
    total_refunds: 0, // KNOWN GAP — see header note
    total_cash_in: totalCashIn,
    total_cash_out: totalCashOut,
    stock_movement_count: stockMovementCount || 0,
  };
}

export const reportsService = {
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
   * Actually closes the day — computes the summary and writes it to
   * lb_daily_closings for the first time (or updates an existing
   * non-CLOSED row for that date, if one was left OPEN).
   */
  async closeDay({ tenantId, businessId = null, branchId = null, date, closedBy }) {
    const summary = await computeSummary({ tenantId, date });

    const { data: existing, error: existingError } = await supabase
      .from('lb_daily_closings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('closing_date', date)
      .maybeSingle();
    if (existingError) throw existingError;

    const payload = {
      tenant_id: tenantId,
      business_id: businessId,
      branch_id: branchId,
      ...summary,
      status: 'CLOSED',
      closed_by: closedBy,
      closed_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await supabase
        .from('lb_daily_closings')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('lb_daily_closings')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
