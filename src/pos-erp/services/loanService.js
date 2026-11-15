// src/pos-erp/services/loanService.js
//
// My Loans: the ONLY place the app talks to the loan tables and functions (schema/phase37_loans.sql).
// Every rule lives in the database: who may add a loan (owner only), who may mark an instalment paid (expenses.record), the
// schedule maths (loan_preview_schedule, one implementation), the posting to My Spending, and the retry/double-tap safety.
// Nothing here is trusted for security. Reading is plain table reads (RLS keeps each business to its own loans);
// every change is a function call. Errors are thrown raw; screens turn them into words with mapLoanError.

import { posSupabase as supabase } from './posSupabaseClient';
import { newUuid } from '../offline/idGenerator';
import { loanTotals } from '../utils/loanHelpers';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const loanService = {
  /** Every loan of the business with its instalments. */
  async getAll({ businessId } = {}) {
    await this.accrue(businessId);      // so interest for months that have ended is on screen (no-op for other loans)
    const run = async (select) => {
      let q = supabase.from('lb_loans').select(select).order('created_at', { ascending: false });
      if (businessId) q = q.eq('business_id', businessId);
      return q;
    };
    // Payments come with the loan. If this database has not had phase38 yet, fall back to loans without payment history rather than showing nothing.
    let { data, error } = await run('*, installments:lb_loan_installments(*), payments:lb_loan_payments(*)');
    if (error && /lb_loan_payments|relationship|schema cache/i.test(String(error.message || ''))) ({ data, error } = await run('*, installments:lb_loan_installments(*)'));
    if (error) throw error;
    return data || [];
  },

  /** The schedule exactly as it would be saved (same database function as the save). */
  preview: (f) => rpc('loan_preview_schedule', {
    p_principal: Number(f.principal), p_method: f.interest_method, p_rate: Number(f.rate) || 0, p_rate_period: f.rate_period || 'YEAR',
    p_count: parseInt(f.term_count, 10), p_frequency: f.frequency, p_first_due: f.first_due, p_fee_per: Number(f.fee_per_installment) || 0,
  }),

  /**
   * Owner only (the database refuses anyone else). `clientReference` is made when the form opens, so a double tap or a retry after a
   * dropped reply is recognised as the same loan and never saved twice.
   * A loan counts as "money received in the app" unless the owner says it came before using the app or some instalments are already paid.
   */
  create: (businessId, f, clientReference) => {
    const paidBefore = parseInt(f.paid_before_count || 0, 10) || 0;
    return rpc('loan_create', {
      p_client_reference: clientReference || `loan-${newUuid()}`,
      p_business_id: businessId,
      p_lender_name: f.lender_name, p_lender_type: f.lender_type, p_reference_no: f.reference_no || null,
      p_principal: Number(f.principal), p_interest_method: f.interest_method, p_rate: f.interest_method === 'NONE' ? 0 : Number(f.rate) || 0,
      p_rate_period: f.rate_period || 'YEAR', p_term_count: parseInt(f.term_count, 10), p_frequency: f.frequency,
      p_first_due: f.first_due, p_disbursed_on: f.disbursed_on || null,
      p_upfront_fees: Number(f.upfront_fees) || 0, p_fee_per_installment: Number(f.fee_per_installment) || 0,
      p_auto_pay: !!f.auto_pay, p_payment_method: f.payment_method || 'BANK',
      p_paid_before_count: paidBefore, p_record_disbursement: !(f.received_before_app || paidBefore > 0), p_notes: f.notes || null,
    });
  },
  newReference: () => `loan-${newUuid()}`,

  /** Pays the BALANCE of one instalment (what is left after any part payments). */
  markPaid: (installmentId, paidOn = null, method = null) => rpc('loan_mark_paid', { p_installment_id: installmentId, p_paid_on: paidOn, p_method: method }),
  /**
   * Record what was ACTUALLY paid: any amount (less than, equal to, or more than the instalment). The database splits it: interest
   * first, then the loan, oldest instalment first, and anything extra is paid ahead. `clientReference` is made when the form opens,
   * so a double tap or a retry after a dropped reply is recognised as the same payment and never recorded twice.
   */
  recordPayment: (loanId, { amount, paidOn = null, method = null, note = null }, clientReference) => rpc('loan_record_payment', {
    p_client_reference: clientReference || `loanpay-${newUuid()}`, p_loan_id: loanId, p_amount: Number(amount),
    p_paid_on: paidOn || null, p_method: method || null, p_note: note ? String(note).trim() || null : null,
  }),
  newPaymentReference: () => `loanpay-${newUuid()}`,
  /** Owner only. Only the most recent payment of a loan can be undone (the database says so if not). */
  voidPayment: (paymentId) => rpc('loan_void_payment', { p_payment_id: paymentId }),
  updateInstallment: (id, { dueDate, principal, interest, fees }) => rpc('loan_update_installment', {
    p_installment_id: id, p_due_date: dueDate, p_principal: Number(principal) || 0, p_interest: Number(interest) || 0, p_fees: Number(fees) || 0,
  }),
  setAutoPay: (loanId, auto, method = null) => rpc('loan_set_auto_pay', { p_loan_id: loanId, p_auto: !!auto, p_method: method }),
  close: (loanId, mode) => rpc('loan_close', { p_loan_id: loanId, p_mode: mode }),

  /** Charges the month's interest on reducing-balance loans up to today (phase 41). Silent if it is not installed yet or not allowed. */
  async accrue(businessId = null) {
    try { return await rpc('loan_accrue', { p_business_id: businessId }); } catch (e) { return null; }
  },

  /** Posts every auto-pay instalment whose date has come. Safe to call as often as you like; never posts twice. */
  postDue: (businessId = null) => rpc('loan_post_due', { p_business_id: businessId }),

  /** For the balance sheet. Zeros (not an error) if the loan tables are not on this database yet, so Financial Statements never break. */
  async getTotals({ businessId } = {}) {
    try {
      return loanTotals(await this.getAll({ businessId }));
    } catch (err) {
      console.warn('[loanService] totals unavailable (loans not installed yet?):', err?.message || err);
      return { outstandingPrincipal: 0, receivedInApp: 0, principalRepaid: 0 };
    }
  },
};
