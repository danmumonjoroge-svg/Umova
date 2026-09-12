// src/pos-erp/services/cashierService.js
//
// FIXED (this pass): closeShift() used to reimplement expected_cash
// client-side (computeExpectedCash() below, now removed) — three extra
// round-trip queries, AND it disagreed with the DB's own logic: the
// client version netted lb_payments.change_amount out of cash sales, the
// close_cashier_shift() RPC does not net it out at all. Two different
// numbers for the same "expected cash" depending on which code path ran.
// Same class of bug as supplierService.recordPayment() in Phase 3 —
// client-side reimplementation of something a server RPC already does
// atomically. Switched to calling close_cashier_shift() directly; it's
// the authoritative calculation now, not a second one to keep in sync.
//
// close_cashier_shift(p_shift_id, p_actual_cash, p_closing_float, p_notes)
// returns a boolean, not the updated row — so closeShift() re-reads the
// shift afterward to get the real expected_cash/variance the RPC wrote,
// rather than trying to recompute them client-side a second time.
//
// KNOWN GAP carried over from the previous version (not something this
// fix changes): close_cashier_shift() doesn't net out cash refunds either
// — same caveat as before, now living in the DB function instead of here.

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

  /**
   * @param {string} id - the shift to close
   * @param {object} p - { actualCash, closingFloat, notes }
   *   closingFloat: the till float being left for the next shift (may
   *   differ from actualCash — the count includes takings that get
   *   banked, the float is what's deliberately left behind).
   *   notes: accepted for the caller's convenience, but
   *   close_cashier_shift() doesn't currently persist it anywhere
   *   (lb_cashier_shifts has no notes column, and the RPC's own body
   *   doesn't reference p_notes despite accepting it) — log a real note
   *   via addCashMovement() against this shift if one needs to survive.
   */
  async closeShift(id, { actualCash, closingFloat, notes }) {
    const { error: rpcError } = await supabase.rpc('close_cashier_shift', {
      p_shift_id: id,
      p_actual_cash: Number(actualCash),
      p_closing_float: closingFloat != null ? Number(closingFloat) : 0,
      p_notes: notes || null,
    });
    if (rpcError) throw rpcError;

    // The RPC returns only a boolean — re-read the row to get the
    // expected_cash/variance it just computed and wrote.
    const { data, error } = await supabase.from(SHIFTS_TABLE).select('*').eq('id', id).single();
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

  async getCashMovements(shiftId) {
    const { data, error } = await supabase
      .from(MOVEMENTS_TABLE)
      .select('*')
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Wraps perform_daily_closing() — rolls up sales/payments/expenses/
   * refunds/cash movements for one business+branch+date into
   * lb_daily_closings. Idempotent from the RPC's side (ON CONFLICT ...
   * DO UPDATE) as long as status isn't already 'CLOSED' for that date,
   * in which case it raises.
   */
  async performDailyClosing({ businessId, branchId, closingDate, closedBy, notes }) {
    if (!businessId) throw new Error('cashierService.performDailyClosing: businessId is required.');
    const { data, error } = await supabase.rpc('perform_daily_closing', {
      p_business_id: businessId,
      p_branch_id: branchId ?? null,
      p_closing_date: closingDate,
      p_closed_by: closedBy ?? null,
      p_notes: notes || null,
    });
    if (error) throw error;
    return data; // new/updated lb_daily_closings.id
  },

  async getDailyClosings({ businessId, limit = 30 } = {}) {
    let q = supabase.from('lb_daily_closings').select('*').order('closing_date', { ascending: false }).limit(limit);
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
};
