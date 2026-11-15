// src/pos-erp/services/mpesaService.js
//
// Client side of Stage 2 (brief section 33-41). This file NEVER touches
// Daraja directly and holds no secrets -- it calls the mpesa-stk-push
// Edge Function (which does) and otherwise only reads/writes
// lb_mpesa_transactions / lb_mpesa_config, both RLS-scoped the same as
// every other table in this project.

import { posSupabase as supabase } from './posSupabaseClient';
import { normalizePhoneForWhatsApp } from './communicationService';

/** supabase-js hides the function's own message behind "Edge Function returned a non-2xx status code". Read the real one out of the reply. */
async function functionErrorMessage(error) {
  try {
    const res = error?.context;
    if (res && typeof res.json === 'function') {
      const body = await res.clone().json();
      if (body?.error) return String(body.error);
    }
  } catch { /* fall through */ }
  return error?.message || 'The M-Pesa service did not answer. Please try again.';
}

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
  async saveConfig({ tenantId, businessId, shortcode, environment = 'sandbox', isActive, consumerKey, consumerSecret, passkey, accountType = 'paybill', tillNumber }) {
    if (!shortcode) throw new Error('mpesaService.saveConfig: a shortcode (till/paybill number) is required.');
    const { data, error } = await supabase.functions.invoke('mpesa-save-config', {
      body: { tenantId, businessId, shortcode, environment, isActive: !!isActive, consumerKey, consumerSecret, passkey, accountType, tillNumber },
    });
    if (error) throw new Error(await functionErrorMessage(error));
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
  async requestPayment({ tenantId, businessId, phone, amount, cartSnapshot, customerId, shiftId, requestedBy, rentInvoiceId, folioId }) {
    const normalizedPhone = normalizePhoneForWhatsApp(phone);
    if (!normalizedPhone) {
      throw new Error(`"${phone}" doesn't look like a Kenyan mobile number. Use a number like 0712345678.`);
    }

    const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
      body: { tenantId, businessId, phone: normalizedPhone, amount, cartSnapshot, customerId, shiftId, requestedBy, rentInvoiceId, folioId },
    });
    if (error) throw new Error(await functionErrorMessage(error));
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
    const start = new Date(`${date}T00:00:00`).toISOString();
    const end = new Date(`${date}T23:59:59.999`).toISOString();
    const { data, error } = await supabase
      .from('lb_mpesa_transactions')
      .select('*, sale:lb_sales(id, sale_number), customer:lb_customers(id, name)')
      .eq('business_id', businessId)
      .gte('requested_at', start).lte('requested_at', end)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Has this M-Pesa code already been used on a sale? Used when a cashier
   * records "customer already paid" by typing the code from the customer's
   * SMS -- stops the same SMS being used to "pay" for two sales. Checks
   * both places a code can live: a confirmed STK transaction, and a
   * payment a cashier recorded by hand. Online only (offline sales are
   * checked against the server only when they sync -- see the note in
   * POSPage's completeSale).
   * @returns {Promise<boolean>}
   */
  async isCodeUsed(businessId, code) {
    // Compared the way the database compares (letters/digits only, upper case), so "shk 7x9abcd" and "SHK7X9ABCD" are one code.
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!c) return false;
    const [stk, manual, rent] = await Promise.all([
      supabase.from('lb_mpesa_transactions').select('id').eq('business_id', businessId).eq('mpesa_receipt_number', c).limit(1),
      supabase.from('lb_payments').select('id').eq('business_id', businessId).eq('payment_method', 'MOBILE_MONEY').eq('reference_no', c).limit(1),
      // Rent-invoice payments live in their own table; a code used there must not pay a sale too. Best effort: a
      // business without Rent & Charges, or a read that fails, must not block a real sale.
      supabase.from('lb_rent_invoice_payments').select('id').eq('business_id', businessId).eq('payment_method', 'MOBILE_MONEY').eq('reference_no', c).limit(1),
    ]);
    if (stk.error) throw stk.error;
    if (manual.error) throw manual.error;
    // This is only the quick, friendly check; the database's unique index (phase39) is what actually guarantees it.
    return (stk.data?.length || 0) > 0 || (manual.data?.length || 0) > 0 || (!rent.error && (rent.data?.length || 0) > 0);
  },

  /**
   * M-Pesa payments a cashier RECORDED BY HAND (typed the code) on a given
   * day -- the counterpart to getForDate() above, which only knows about
   * STK prompts. Deliberately NOT joined to lb_sales: this only needs the
   * amount/code/time, and skipping the join avoids depending on a
   * relationship name that hasn't been confirmed for lb_payments.
   * STK-confirmed sales also write an lb_payments row (with the M-Pesa
   * receipt as its reference), so those are removed by matching codes
   * against `stkReceipts` -- the caller passes the day's STK receipt
   * numbers.
   */
  async getManualForDate({ businessId, date, stkReceipts = [], stkSaleIds = [] }) {
    const { data, error } = await supabase
      .from('lb_payments')
      .select('id, amount, reference_no, created_at, sale_id')
      .eq('business_id', businessId)
      .eq('payment_method', 'MOBILE_MONEY')
      .gte('created_at', new Date(`${date}T00:00:00`).toISOString()).lte('created_at', new Date(`${date}T23:59:59.999`).toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stk = new Set(stkReceipts.map(norm).filter(Boolean));
    const stkSales = new Set(stkSaleIds.filter(Boolean));
    // One M-Pesa code is one payment. If the same code sits on more than one row, count it once. Rows without a code are all kept.
    // A payment already shown as a confirmed prompt (same code, or the same sale) is not listed a second time.
    const seen = new Set();
    const rows = (data || []).filter((p) => {
      const k = norm(p.reference_no);
      if (k && stk.has(k)) return false;
      if (p.sale_id && stkSales.has(p.sale_id)) return false;
      if (k) { if (seen.has(k)) return false; seen.add(k); }
      return true;
    });
    // What is left is either a code a cashier typed, or a prompt payment whose request is not in this day's list (asked
    // yesterday, paid today). The database names a prompt's sale "MPESA-<checkout id>", so that tells them apart no matter
    // how the code was written. Best effort: if this lookup fails, everything stays "typed" as before.
    const saleIds = [...new Set(rows.map((p) => p.sale_id).filter(Boolean))];
    const viaPrompt = new Set();
    if (saleIds.length) {
      const { data: sales, error: salesErr } = await supabase.from('lb_sales').select('id, client_reference').in('id', saleIds);
      if (!salesErr) (sales || []).forEach((x) => { if (String(x.client_reference || '').startsWith('MPESA-')) viaPrompt.add(x.id); });
    }
    return rows.map((p) => ({ ...p, via_prompt: viaPrompt.has(p.sale_id) }));
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

  // ---------- Received payments (phase43): customers paying straight to the till / paybill ----------
  // Safaricom tells our c2b-hook function; the payment lands in lb_mpesa_c2b_payments. These helpers only read it and call the
  // database functions that clear bills. Nothing here decides a bill is paid: pos_apply_mpesa_c2b does, inside one transaction.

  /** Newest first. status: 'OPEN' (new + part used) | 'ALL' | one status. */
  async c2bList(businessId, { status = 'OPEN', limit = 100 } = {}) {
    let q = supabase.from('lb_mpesa_c2b_payments')
      .select('id,trans_id,trans_time,amount,amount_used,status,payer_name,bill_ref_number,note')
      .eq('business_id', businessId).order('trans_time', { ascending: false }).limit(limit);
    if (status === 'OPEN') q = q.in('status', ['NEW', 'PARTLY_USED']);
    else if (status !== 'ALL') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /** Bills this payment could belong to, best first (name, amount and bill number are compared by the database). */
  async c2bSuggest(c2bId) {
    const { data, error } = await supabase.rpc('pos_c2b_suggest', { p_c2b_id: c2bId });
    if (error) throw error;
    return data || [];
  },

  /** Clear a bill with a received payment. amount omitted = as much as the bill needs / the payment has left. */
  async c2bApply({ c2bId, targetType, targetId, amount = null, by = null }) {
    const { data, error } = await supabase.rpc('pos_apply_mpesa_c2b', {
      p_c2b_id: c2bId, p_target_type: targetType, p_target_id: targetId, p_amount: amount, p_by: by,
    });
    if (error) throw error;
    return data;
  },

  /** Set a payment aside (needs a reason) or bring it back. Manager/owner only; the database enforces it. */
  async c2bIgnore(c2bId, reason, ignore = true) {
    const { data, error } = await supabase.rpc('pos_ignore_mpesa_c2b', { p_c2b_id: c2bId, p_reason: reason || null, p_ignore: ignore });
    if (error) throw error;
    return data;
  },

  /** Owner turns "receive payments made to my till" on/off. Goes through the c2b-register Edge Function (it holds the secrets). */
  async c2bSetEnabled(businessId, enable) {
    const { data, error } = await supabase.functions.invoke('c2b-register', { body: { businessId, enable: !!enable } });
    if (error) throw new Error(await functionErrorMessage(error));
    if (data?.error) throw new Error(data.error);
    return data;
  },
};
