// src/pos-erp/services/mpesaService.js
//
// Client side of Stage 2 (brief section 33-41). This file NEVER touches
// Daraja directly and holds no secrets -- it calls the mpesa-stk-push
// Edge Function (which does) and otherwise only reads/writes
// lb_mpesa_transactions / lb_mpesa_config, both RLS-scoped the same as
// every other table in this project.

import { posSupabase as supabase } from './posSupabaseClient';
import { normalizePhoneForWhatsApp } from './communicationService';

export const MPESA_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_ATTENTION'];

export const mpesaService = {
  async getConfig(businessId) {
    const { data, error } = await supabase
      .from('lb_mpesa_config').select('*').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Phase 13 -- the ONLY way to set up M-Pesa for a business, including
   * the Daraja consumer key/secret/passkey. Goes through the
   * mpesa-save-config Edge Function, never a direct table write --
   * lb_mpesa_secrets has no RLS policy at all (see
   * schema/phase13_mpesa_client_credentials.sql), so a direct client
   * insert/update on it would simply fail; this is the real path.
   *
   * consumerKey/consumerSecret/passkey are all OPTIONAL per call -- pass
   * only the ones the owner actually typed. Leaving one blank does not
   * clear whatever's already on file (the Edge Function merges, never
   * overwrites with blank). Never returns the secrets themselves, only
   * confirmation flags -- see the return value.
   * @returns {Promise<{ok: true, has_consumer_key: boolean, has_consumer_secret: boolean, has_passkey: boolean}>}
   */
  async saveConfig({ tenantId, businessId, shortcode, environment = 'sandbox', isActive, consumerKey, consumerSecret, passkey }) {
    if (!shortcode) throw new Error('mpesaService.saveConfig: a shortcode (till/paybill number) is required.');
    const { data, error } = await supabase.functions.invoke('mpesa-save-config', {
      body: { tenantId, businessId, shortcode, environment, isActive: !!isActive, consumerKey, consumerSecret, passkey },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },

  /**
   * Sends the STK request. Returns the PENDING lb_mpesa_transactions row.
   * Never marks anything Paid here -- that only ever happens through the
   * callback (see confirm_mpesa_payment in phase12_mpesa.sql). If the
   * Edge Function call itself fails (no internet, function down), this
   * throws -- brief section 23: "M-Pesa STK Push cannot be initiated
   * while completely offline", so the caller (the UI) is expected to
   * check connectivity before offering this button at all, and this is
   * the backstop if that check was stale.
   */
  async requestPayment({ tenantId, businessId, phone, amount, cartSnapshot, customerId, shiftId, requestedBy }) {
    const normalizedPhone = normalizePhoneForWhatsApp(phone);
    if (!normalizedPhone) {
      throw new Error(`"${phone}" doesn't look like a Kenyan mobile number. Use a number like 0712345678.`);
    }

    const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
      body: { tenantId, businessId, phone: normalizedPhone, amount, cartSnapshot, customerId, shiftId, requestedBy },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data.transaction;
  },

  async getById(id) {
    const { data, error } = await supabase.from('lb_mpesa_transactions').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  /**
   * Polling fallback for the till UI while waiting on the callback.
   * Realtime (see useMpesaPayment.js) is the primary mechanism; this
   * exists because a cashier's own connection can be flaky even though
   * Safaricom's callback reaches Supabase fine, so a poll is a safety
   * net, not the main path.
   */
  async pollStatus(id) {
    return this.getById(id);
  },

  /** Reconciliation view (brief section 39). One day's transactions, bucketed by status client-side -- the page does the bucketing so this stays a plain fetch. */
  async getForDate({ businessId, date }) {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const { data, error } = await supabase
      .from('lb_mpesa_transactions')
      .select('*, sale:lb_sales(id, sale_number), customer:lb_customers(id, name)')
      .eq('business_id', businessId)
      .gte('requested_at', start).lte('requested_at', end)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /** A stuck PENDING row the owner has decided to give up on manually (e.g. they know the customer walked away). Doesn't touch Daraja -- purely a local bookkeeping decision, logged as such. */
  async markNeedsAttention(id, note) {
    const { data, error } = await supabase
      .from('lb_mpesa_transactions')
      .update({ status: 'NEEDS_ATTENTION', result_desc: note || 'Marked by owner', updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'PENDING') // guard: can't override an already-settled row this way
      .select().single();
    if (error) throw error;
    return data;
  },
};
