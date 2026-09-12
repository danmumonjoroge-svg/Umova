// src/pos-erp/services/expensesService.js
//
// Phase 4 — expenses (brief §37). record_expense() already exists in the
// DB (generates expense_number via generate_expense_number(), inserts the
// row) — this wraps it rather than inserting directly, same pattern as
// paymentService.js/the fixed supplierService.recordPayment().
//
// lb_expense_status: PENDING | APPROVED | PAID | REJECTED (confirmed
// against the live enum). record_expense() defaults to PAID if no status
// is passed — matches how a small business actually pays most expenses
// (cash out the till immediately), so the create() helper below doesn't
// force a status choice; PENDING is available for anyone who wants an
// approval step later, without making it mandatory now.
//
// Categories are real seeded lookup rows (lb_expense_categories,
// is_system = true — Rent, Electricity, Water, Transport, Wages, Airtime,
// Repairs, Packaging, Cleaning, Licences, Marketing, Miscellaneous),
// not something to hardcode a label list for. getCategories() reads them
// live so a tenant's own added categories (RLS also allows
// tenant_id = their own tenant) show up automatically too.

import { posSupabase as supabase } from './posSupabaseClient';

export const expensesService = {
  async getCategories() {
    const { data, error } = await supabase
      .from('lb_expense_categories')
      .select('id, name, is_system')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getAll({ businessId, page = 1, limit = 50 } = {}) {
    let q = supabase
      .from('lb_expenses')
      .select('*, category:lb_expense_categories(id, name)', { count: 'exact' })
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0, page, limit };
  },

  /**
   * @param {object} p - { businessId, branchId?, categoryId, expenseDate?,
   *   amount, paymentMethod, description?, attachmentUrl?, status?, createdBy }
   * @returns {Promise<string>} the new lb_expenses.id
   */
  async create({ businessId, branchId, categoryId, expenseDate, amount, paymentMethod, description, attachmentUrl, status, createdBy }) {
    if (!businessId) throw new Error('expensesService.create: businessId is required.');
    if (!amount || Number(amount) <= 0) throw new Error('expensesService.create: amount must be greater than zero.');
    if (!paymentMethod) throw new Error('expensesService.create: paymentMethod is required.');

    const { data, error } = await supabase.rpc('record_expense', {
      p_business_id: businessId,
      p_branch_id: branchId ?? null,
      p_category_id: categoryId ?? null,
      p_expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      p_amount: Number(amount),
      p_payment_method: paymentMethod,
      p_description: description || null,
      p_attachment_url: attachmentUrl || null,
      p_status: status || 'PAID',
      p_created_by: createdBy ?? null,
    });
    if (error) throw error;
    return data;
  },
};
