// src/pos-erp/services/supplierService.js
//
// REBUILT against the real lb_suppliers schema (confirmed via
// information_schema.columns query) instead of the earlier guess.
// Two things were wrong in the previous version:
//
// 1. WRONG CLIENT — was importing the main app's `supabase` client
//    ('../../supabaseClient'). Per the POS-independent-session decision,
//    every POS service must use posSupabase — same class of bug already
//    fixed once in productResolverService.js. Fixed here too.
//
// 2. WRONG COLUMN — filtered/updated a `status` column that does not
//    exist on lb_suppliers. The real schema uses a boolean `is_active`
//    instead. Also, `lb_supplier_aging` (used by the old getAging())
//    is not a real table/view in this database at all. Replaced with a
//    plain read of lb_suppliers.outstanding_balance, which the schema
//    already maintains directly on the row.
//
// NOTE — tenant_id is NOT NULL on lb_suppliers with no default,
// contradicting this file's original header comment ("tenant_id/
// business_id stripped throughout — this app is single-org"). That
// assumption does not hold for this table: every insert MUST supply
// tenant_id or it fails at the DB level. create() below requires it
// explicitly — pass it from usePosErpAuth()'s tenant context (see
// useSuppliers.js).

import { posSupabase as supabase } from './posSupabaseClient';

const TABLE = 'lb_suppliers';

const SUPPLIER_FIELDS =
  'id, tenant_id, business_id, name, registration_no, phone, email, address, contact_person, payment_terms, credit_limit, outstanding_balance, is_active, created_by, updated_by, created_at, updated_at';

export const supplierService = {
  async getAll({ activeOnly = false, search, page = 1, limit = 50 } = {}) {
    let query = supabase
      .from(TABLE)
      .select(SUPPLIER_FIELDS, { count: 'exact' })
      .order('name', { ascending: true });

    if (activeOnly) query = query.eq('is_active', true);
    if (search) query = query.ilike('name', `%${search}%`);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(SUPPLIER_FIELDS)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * @param {object} supplier - must include tenant_id (NOT NULL, no DB
   *   default). business_id is nullable and can be omitted.
   */
  async create(supplier) {
    if (!supplier.tenant_id) {
      throw new Error('supplierService.create: tenant_id is required (lb_suppliers.tenant_id is NOT NULL).');
    }
    const { data, error } = await supabase
      .from(TABLE)
      .insert(supplier)
      .select(SUPPLIER_FIELDS)
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SUPPLIER_FIELDS)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Soft delete only. lb_suppliers is referenced by FK from
   * lb_purchase_orders, lb_goods_received_notes, lb_supplier_payments and
   * lb_supplier_returns — hard-deleting a supplier with any history will
   * fail (or cascade) at the DB level. Deactivating is also what you
   * actually want operationally: past GRNs/POs/payments should stay
   * attributable to a real supplier even after you stop ordering from
   * them.
   */
  async deactivate(id) {
    return this.update(id, { is_active: false });
  },

  async reactivate(id) {
    return this.update(id, { is_active: true });
  },

  /**
   * Replaces the old getAging(), which queried a lb_supplier_aging table
   * that does not exist in this schema. outstanding_balance is maintained
   * directly on lb_suppliers, so this is just a sorted read of that
   * column. If GRN/payment triggers aren't yet keeping
   * outstanding_balance in sync automatically on the backend, that's a
   * separate question — this can't fix it client-side.
   */
  async getWithOutstandingBalances() {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, name, phone, contact_person, outstanding_balance, credit_limit')
      .gt('outstanding_balance', 0)
      .order('outstanding_balance', { ascending: false });
    if (error) throw error;
    return data;
  },

  // ---- Linked records ("link to GRN") ----

  async getPurchaseOrders(supplierId) {
    const { data, error } = await supabase
      .from('lb_purchase_orders')
      .select('id, po_number, purchase_type, status, order_date, expected_date, total_amount')
      .eq('supplier_id', supplierId)
      .order('order_date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getGoodsReceivedNotes(supplierId) {
    const { data, error } = await supabase
      .from('lb_goods_received_notes')
      .select('id, grn_number, status, invoice_no, received_date, total_amount, purchase_order_id')
      .eq('supplier_id', supplierId)
      .order('received_date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getPayments(supplierId) {
    const { data, error } = await supabase
      .from('lb_supplier_payments')
      .select('id, payment_number, amount, payment_method, reference_no, payment_date, grn_id, notes')
      .eq('supplier_id', supplierId)
      .order('payment_date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getReturns(supplierId) {
    const { data, error } = await supabase
      .from('lb_supplier_returns')
      .select('id, return_number, status, reason, total_amount, grn_id, created_at')
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  /**
   * Records a payment against a supplier (optionally tied to one GRN).
   *
   * FIXED: this used to be a raw INSERT into lb_supplier_payments, which
   * matched the shape but never touched lb_suppliers.outstanding_balance
   * — the exact risk this file's own earlier comment flagged ("if there's
   * no trigger... that's a separate question"). There is no such trigger;
   * confirmed the DB already has a purpose-built RPC,
   * record_supplier_payment(), that inserts the payment AND decrements
   * outstanding_balance atomically (mirrors record_customer_payment() on
   * the customer side, from Phase 2). Switched to calling that instead of
   * inserting directly — also means payment_number no longer needs to be
   * supplied by the caller; generate_supplier_payment_number() handles it
   * server-side now, replacing the `PMT-${Date.now()}` placeholder that
   * was in SuppliersPage.jsx.
   *
   * @param {object} p - { businessId, supplierId, grnId?, amount,
   *   paymentMethod, referenceNo?, notes?, createdBy }
   * @returns {Promise<string>} the new lb_supplier_payments.id
   */
  async recordPayment({ businessId, supplierId, grnId, amount, paymentMethod, referenceNo, notes, createdBy }) {
    if (!businessId) throw new Error('supplierService.recordPayment: businessId is required.');
    if (!supplierId) throw new Error('supplierService.recordPayment: supplierId is required.');
    if (!amount || Number(amount) <= 0) throw new Error('supplierService.recordPayment: amount must be greater than zero.');
    const { data, error } = await supabase.rpc('record_supplier_payment', {
      p_business_id: businessId,
      p_supplier_id: supplierId,
      p_grn_id: grnId ?? null,
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
