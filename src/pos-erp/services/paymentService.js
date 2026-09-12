// src/pos-erp/services/paymentService.js
//
// Standalone customer payments — money received against an EXISTING
// outstanding_balance (e.g. "customer walks in and pays down what they
// owe"), separate from paying for a brand-new sale at the till (that path
// already works: saleService.create()'s `payments` array inserts
// lb_payments rows directly, and the process_credit_sale_payment trigger
// already handles the balance bump for CREDIT sales — see saleService.js).
//
// This is a thin wrapper around record_customer_payment(), an RPC that
// already exists in the database and already does, atomically:
//   1. generates the payment number (generate_customer_payment_number)
//   2. inserts the lb_customer_payments row
//   3. decrements lb_customers.outstanding_balance (floored at 0)
//   4. writes the lb_customer_credit_transactions ledger entry
// Deliberately NOT reimplementing any of that client-side — doing the
// balance math here too would create two sources of truth that could
// drift apart from network retries, partial failures, etc. The RPC is
// the single source of truth for "what does this customer owe."

import { posSupabase as supabase } from './posSupabaseClient';

export const paymentService = {
  /**
   * @param {object} p
   * @param {string} p.businessId  - tenant.business_id (lb_businesses.id)
   * @param {string} [p.branchId]  - optional; this app doesn't use branches yet
   * @param {string} p.customerId
   * @param {number} p.amount
   * @param {'CASH'|'MOBILE_MONEY'|'CARD'|'BANK'|'VOUCHER'|'OTHER'} p.paymentMethod
   *   - matches lb_payment_method exactly (confirmed against the live enum).
   *     CREDIT is intentionally excluded here — it's a sale payment method,
   *     not something you'd ever record as how a payment-against-balance
   *     was paid.
   * @param {string} [p.referenceNo]
   * @param {string} [p.notes]
   * @param {string} p.createdBy - staffId (auth.users.id), same value every
   *   other lb_* created_by column uses.
   * @returns {Promise<string>} the new lb_customer_payments.id
   */
  async recordCustomerPayment({ businessId, branchId, customerId, amount, paymentMethod, referenceNo, notes, createdBy }) {
    if (!businessId) throw new Error('paymentService.recordCustomerPayment: businessId is required.');
    if (!customerId) throw new Error('paymentService.recordCustomerPayment: customerId is required.');
    if (!amount || Number(amount) <= 0) throw new Error('paymentService.recordCustomerPayment: amount must be greater than zero.');
    if (!paymentMethod) throw new Error('paymentService.recordCustomerPayment: paymentMethod is required.');

    const { data, error } = await supabase.rpc('record_customer_payment', {
      p_business_id: businessId,
      p_branch_id: branchId ?? null,
      p_customer_id: customerId,
      p_amount: Number(amount),
      p_payment_method: paymentMethod,
      p_reference_no: referenceNo || null,
      p_notes: notes || null,
      p_created_by: createdBy ?? null,
    });
    if (error) throw error;
    return data;
  },
};
