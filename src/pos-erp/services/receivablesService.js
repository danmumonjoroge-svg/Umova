// src/pos-erp/services/receivablesService.js
//
// Receivables and customer statements — both read-only views over data
// that's already kept correct elsewhere:
//   - "Receivables" (§25) = lb_customers where outstanding_balance > 0.
//     That column is only ever written by record_customer_payment() and
//     the process_credit_sale_payment trigger (both already live in the
//     DB) — never recomputed here.
//   - "Statement" (§26) = the lb_customer_credit_transactions ledger for
//     one customer, which those same two DB routines already write a row
//     to on every sale and every payment, each carrying its own
//     balance_after. No client-side running-balance calculation needed —
//     the DB already produced it.
//
// NOTE: lb_customer_credit_transactions has no due_date column, so
// "aging"/"overdue" (§25) can't be computed from this table alone yet —
// it only has created_at. Leaving aging out of getReceivables() rather
// than approximating it from created_at, which would mislabel a very old
// but fully-paid balance as overdue.

import { posSupabase as supabase } from './posSupabaseClient';

export const receivablesService = {
  async getReceivables({ page = 1, limit = 50 } = {}) {
    let q = supabase
      .from('lb_customers')
      .select('*', { count: 'exact' })
      .gt('outstanding_balance', 0)
      .order('outstanding_balance', { ascending: false });

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0, page, limit };
  },

  async getStatement(customerId, { limit = 200 } = {}) {
    const { data, error } = await supabase
      .from('lb_customer_credit_transactions')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
};
