// src/pos-erp/services/cashierService.js
//
// FIXED: closeShift() only wrote status/actual_cash/closed_at.
// expected_cash and variance are real columns on lb_cashier_shifts but
// nothing populated them anywhere in the codebase — which meant "till
// balanced?" could never actually be answered. Now computed as:
//
//   expected_cash = opening_float
//                  + cash sales during the shift (lb_payments, net of
//                    change given back to the customer)
//                  + CASH_IN movements
//                  − CASH_OUT movements
//                  − PETTY_CASH movements
//   variance = actual_cash − expected_cash
//
// KNOWN GAP: cash refunds paid out mid-shift are NOT netted in yet —
// lb_refunds' schema hasn't been confirmed, so a shift with cash refunds
// will show expected_cash slightly too high (and a false "cashier is
// short" variance). Flagging clearly rather than silently ignoring it;
// fix is to subtract cash lb_refunds rows for this shift's sales once
// that schema is confirmed.
//
// Sale statuses counted as contributing revenue: COMPLETED and
// PARTIALLY_REFUNDED (the unrefunded portion still happened) — DRAFT
// and VOIDED excluded. REFUNDED sales are excluded entirely on the
// assumption a fully refunded sale nets to zero cash impact; that holds
// only if the original payment was also cash, which is usually true but
// not guaranteed — same caveat as the refunds gap above.
//
// Both tables have a tenant_isolation RLS policy requiring
// tenant_id = get_current_tenant_id() on insert — callers (see
// useCashierShifts.js) must include tenant_id in every insert payload.

import { posSupabase as supabase } from './posSupabaseClient';

const SHIFTS_TABLE = 'lb_cashier_shifts';
const MOVEMENTS_TABLE = 'lb_cash_movements';

export const cashierService = {
  async getShifts({ limit = 50 } = {}) {
    const { data, error } = await supabase
      .from(SHIFTS_TABLE)
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async openShift(shift) {
    const { data, error } = await supabase
      .from(SHIFTS_TABLE)
      .insert({ ...shift, opened_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async closeShift(id, { actualCash, notes }) {
    // NOTE: lb_cashier_shifts has no `notes` column (only lb_cash_movements
    // does) — accepting `notes` here for callers, but it's intentionally
    // NOT written to this table. If you want a closing note recorded,
    // log it via addCashMovement() against this shift instead.
    const { data: shift, error: shiftError } = await supabase
      .from(SHIFTS_TABLE)
      .select('opening_float')
      .eq('id', id)
      .single();
    if (shiftError) throw shiftError;

    const expectedCash = await computeExpectedCash(id, shift.opening_float || 0);
    const variance = Number(actualCash) - expectedCash;

    const { data, error } = await supabase
      .from(SHIFTS_TABLE)
      .update({
        status: 'CLOSED',
        actual_cash: actualCash,
        expected_cash: expectedCash,
        variance,
        closed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async addCashMovement(movement) {
    const { data, error } = await supabase
      .from(MOVEMENTS_TABLE)
      .insert(movement)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

async function computeExpectedCash(shiftId, openingFloat) {
  // 1. Cash sales during this shift, net of change given back.
  const { data: sales, error: salesError } = await supabase
    .from('lb_sales')
    .select('id')
    .eq('shift_id', shiftId)
    .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED']);
  if (salesError) throw salesError;

  let cashSalesNet = 0;
  const saleIds = (sales || []).map((s) => s.id);
  if (saleIds.length) {
    const { data: payments, error: paymentsError } = await supabase
      .from('lb_payments')
      .select('amount, change_amount')
      .in('sale_id', saleIds)
      .eq('payment_method', 'CASH')
      .eq('status', 'COMPLETED');
    if (paymentsError) throw paymentsError;
    cashSalesNet = (payments || []).reduce(
      (sum, p) => sum + (Number(p.amount) - Number(p.change_amount || 0)),
      0
    );
  }

  // 2. Manual cash movements logged against this shift.
  const { data: movements, error: movementsError } = await supabase
    .from(MOVEMENTS_TABLE)
    .select('movement_type, amount')
    .eq('shift_id', shiftId);
  if (movementsError) throw movementsError;

  let cashIn = 0, cashOut = 0;
  for (const m of movements || []) {
    if (m.movement_type === 'CASH_IN') cashIn += Number(m.amount);
    else if (m.movement_type === 'CASH_OUT' || m.movement_type === 'PETTY_CASH') cashOut += Number(m.amount);
  }

  return Number(openingFloat) + cashSalesNet + cashIn - cashOut;
}
