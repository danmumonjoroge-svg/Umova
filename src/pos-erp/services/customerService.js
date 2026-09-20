// src/pos-erp/services/customerService.js
//
// lb_customers columns (confirmed against the live schema, not assumed):
// id, tenant_id, business_id, name, phone, email, address, customer_type
// (lb_customer_type: WALK_IN | REGISTERED | BUSINESS | CREDIT),
// credit_limit, outstanding_balance, is_active (real boolean — NOT the
// text-status pattern lb_products.is_active uses), created_by, updated_by,
// created_at, updated_at.
//
// NOTE: there is no customer_number column here, unlike the brief's ideal
// schema (§21). Not inventing a client-only numbering scheme for it — it
// wouldn't persist anywhere and would drift/collide across sessions with
// no source of truth. Customers are identified by name/phone here; add a
// real column + sequence later if a human-readable customer number turns
// out to be genuinely needed.
//
// outstanding_balance is never written directly by this service — it's
// only ever moved by record_customer_payment() and the
// process_credit_sale_payment trigger, both already live in the DB. This
// keeps that column always in sync with lb_customer_credit_transactions
// (see receivablesService.js for reading that ledger), instead of having
// two separate places that could disagree.

import { posSupabase as supabase } from './posSupabaseClient';

export const customerService = {
  async getAll({ search, activeOnly = true, page = 1, limit = 50 } = {}) {
    let q = supabase
      .from('lb_customers')
      .select('*', { count: 'exact' })
      .order('name', { ascending: true });

    if (activeOnly) q = q.eq('is_active', true);
    if (search) {
      q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    }
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase.from('lb_customers').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async create(customer) {
    if (!customer.tenant_id) throw new Error('customerService.create: tenant_id is required.');
    if (!customer.name?.trim()) throw new Error('customerService.create: name is required.');

    const { data, error } = await supabase
      .from('lb_customers')
      .insert({
        tenant_id: customer.tenant_id,
        business_id: customer.business_id ?? null,
        name: customer.name.trim(),
        phone: customer.phone || null,
        email: customer.email || null,
        address: customer.address || null,
        customer_type: customer.customer_type || 'WALK_IN',
        credit_limit: customer.credit_limit || 0,
        created_by: customer.created_by ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('lb_customers')
      .update({
        name: updates.name?.trim(),
        phone: updates.phone || null,
        email: updates.email || null,
        address: updates.address || null,
        customer_type: updates.customer_type,
        credit_limit: updates.credit_limit,
        updated_by: updates.updated_by ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Soft delete only — a customer with sale/payment history can't be hard
  // deleted anyway (FK from lb_sales/lb_customer_payments/
  // lb_customer_credit_transactions), and outstanding_balance/history must
  // survive regardless. Mirrors productService.js's deactivate/reactivate
  // pattern, but this toggles a real boolean, not a status string.
  async deactivate(id) {
    const { data, error } = await supabase
      .from('lb_customers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async reactivate(id) {
    const { data, error } = await supabase
      .from('lb_customers')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Mirrors supplierService.getWithOutstandingBalances() exactly — same
   * shape, same reasoning: a lightweight list of "who currently owes
   * money", reused by the Home dashboard for a genuine COUNT of how
   * many customers a receivables total is spread across, which the
   * balance sheet's single sum (financialReportsService) can't answer
   * on its own.
   */
  async getWithOutstandingBalances() {
    const { data, error } = await supabase
      .from('lb_customers')
      .select('id, name, phone, outstanding_balance, credit_limit')
      .gt('outstanding_balance', 0)
      .order('outstanding_balance', { ascending: false });
    if (error) throw error;
    return data || [];
  },
};
