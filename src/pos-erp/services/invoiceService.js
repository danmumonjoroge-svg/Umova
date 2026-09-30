// src/pos-erp/services/invoiceService.js
// My Invoices — a thin layer over the EXISTING Rent & Charges tables. Invoice lines are
// lb_recurring_charge_invoices rows; totals/status come from the lb_rent_invoice_summary view
// (calculated from recorded payments, never stored, never set by picking a payment option).
import { posSupabase as supabase } from './posSupabaseClient';

export const INVOICE_STATUS_LABEL = {
  DRAFT: 'Draft', ISSUED: 'Issued', PARTIALLY_PAID: 'Partially Paid', PAID: 'Paid', OVERDUE: 'Overdue', CANCELLED: 'Cancelled',
};

export const invoiceService = {
  async getAll({ businessId, period } = {}) {
    let q = supabase.from('lb_rent_invoice_summary').select('*').order('period', { ascending: false }).order('invoice_number', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    if (period) q = q.eq('period', period);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    // views carry no FKs for PostgREST embedding, so names are joined here
    const cIds = [...new Set(rows.map((r) => r.customer_id))], uIds = [...new Set(rows.map((r) => r.unit_id).filter(Boolean))];
    const [{ data: cs }, { data: us }] = await Promise.all([
      cIds.length ? supabase.from('lb_customers').select('id, name, phone, email').in('id', cIds) : { data: [] },
      uIds.length ? supabase.from('lb_units').select('id, unit_number').in('id', uIds) : { data: [] },
    ]);
    const cm = Object.fromEntries((cs || []).map((c) => [c.id, c])), um = Object.fromEntries((us || []).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, customer: cm[r.customer_id] || null, unit: um[r.unit_id] || null }));
  },

  /** Everything the screen and the PDF need, all from the database. */
  async getDetail(id) {
    const { data: inv, error } = await supabase.from('lb_rent_invoice_summary').select('*').eq('id', id).single();
    if (error) throw error;
    const [lines, pays, cust, unit, biz, mp] = await Promise.all([
      supabase.from('lb_recurring_charge_invoices').select('id, amount, paid_amount, status, due_date, charge:lb_recurring_charges(charge_name)')
        .eq('rent_invoice_id', id).order('created_at'),
      supabase.from('lb_rent_invoice_payments').select('*').eq('rent_invoice_id', id).order('created_at'),
      supabase.from('lb_customers').select('id, name, phone, email').eq('id', inv.customer_id).single(),
      inv.unit_id ? supabase.from('lb_units').select('id, unit_number').eq('id', inv.unit_id).single() : { data: null },
      supabase.from('lb_businesses').select('*').eq('id', inv.business_id).single(),
      supabase.from('lb_mpesa_config').select('shortcode, is_active, environment, has_consumer_key, has_consumer_secret, has_passkey').eq('business_id', inv.business_id).maybeSingle(),
    ]);
    return {
      invoice: inv,
      lines: (lines.data || []).filter((l) => !['WAIVED', 'CANCELLED'].includes(l.status)),
      payments: pays.data || [], customer: cust.data, unit: unit.data, business: biz.data, mpesa: mp.data || null,
    };
  },

  async generateMonthly({ businessId, period, createdBy }) {
    const { data, error } = await supabase.rpc('generate_monthly_rent_invoices', { p_business_id: businessId, p_period: period, p_created_by: createdBy ?? null });
    if (error) throw error;
    return data;
  },
  async issue(id) { const { error } = await supabase.rpc('issue_rent_invoice', { p_invoice_id: id }); if (error) throw error; },
  async cancel(id) { const { error } = await supabase.rpc('cancel_rent_invoice', { p_invoice_id: id }); if (error) throw error; },
  async setNotes(id, notes) { const { error } = await supabase.from('lb_rent_invoices').update({ notes: notes || null }).eq('id', id); if (error) throw error; },

  /** Cash / bank / other, or M-Pesa entered BY HAND (source MPESA_MANUAL — never shown as Safaricom-verified). */
  async recordPayment({ invoiceId, amount, paymentMethod, referenceNo, notes, source, createdBy }) {
    const { data, error } = await supabase.rpc('record_rent_invoice_payment', {
      p_invoice_id: invoiceId, p_amount: Number(amount), p_payment_method: paymentMethod,
      p_reference_no: referenceNo || null, p_notes: notes || null, p_created_by: createdBy ?? null, p_source: source || 'MANUAL',
    });
    if (error) throw error;
    return data;
  },
};
