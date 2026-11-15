// src/pos-erp/services/etimsService.js
//
// KRA eTIMS (Phase 2): thin wrappers over the database functions in schema/phase48_etims_foundation.sql. Same style as
// reversalService.js. The database decides who may do what; this file only carries requests.
//
// SECURITY: nothing here knows a KRA address, key or header, and nothing ever will. Talking to KRA happens only in Edge
// Functions (Phase 3 onward). The browser reads status flags and masked values.
import { posSupabase as supabase } from './posSupabaseClient';

// Edge Function call. These functions answer with { ok:false, code, message } and a 4xx/5xx; show the message when there is one.
async function fn(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let m = null;
    try { const j = await error.context?.json?.(); m = j?.message || j?.code; } catch { /* not JSON */ }
    throw new Error(friendlyEtimsError(m || 'Could not reach the server. Check your connection and try again.'));
  }
  if (data && data.ok === false) throw new Error(data.message || data.code || 'Something went wrong.');
  return data;
}

const REASONS = {
  PIN_INVALID: 'Enter the business KRA PIN with no spaces.',
  ENVIRONMENT_INVALID: 'Choose Test or Live.',
  ETIMS_NOT_SET_UP: 'Set up tax invoices first.',
  ITEM_NOT_FOUND: 'Item not found.',
  UNKNOWN_FIELD: 'That setting is not recognised.',
  ETIMS_NOT_CONNECTED: 'Connect to KRA first.',
  ETIMS_NOT_RESENDABLE: 'Only a rejected or unconfirmed invoice can be sent again.',
  CODES_MISSING: 'Pick the tax type, item class, unit, packaging and country for this item first.',
  CODE_NOT_IN_KRA_LIST: 'That code is not in the list KRA gave us. Connect to KRA first, then pick from the list.',
};
export function friendlyEtimsError(msg = '') {
  if (/42501|permission|not yours/i.test(msg)) return 'You do not have permission to do that.';
  const hit = Object.keys(REASONS).find((k) => msg.includes(k));
  return hit ? REASONS[hit] : msg;
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyEtimsError(`${error.code || ''} ${error.message}`));
  return data;
}

// Status labels in the till's own vocabulary (Local / Pending / Confirmed / Needs attention). Owner-facing wording only.
export const ETIMS_STATUS_LABEL = {
  PENDING: 'Tax invoice waiting to send',
  SENDING: 'Sending to KRA…',
  SENT_UNCONFIRMED: 'Checking with KRA',
  ACCEPTED: 'Sent to KRA ✓',
  REJECTED: 'Needs attention',
  CANCELLED_BEFORE_SEND: '',
};

export const etimsService = {
  /** Connect this business to KRA (the server uses the saved PIN, branch and device). */
  connect: () => fn('etims-initialize'),
  /** Download KRA's code lists (tax types, units, item classes...). */
  syncCodes: (force = false) => fn('etims-sync-codes', { force }),
  /** Tell KRA about one item, after its codes are picked. */
  registerItem: (productId) => fn('etims-register-item', { productId }),
  /** Masked status for the setup card: no key, PIN shown as dots + last 4. */
  myStatus: (businessId) => rpc('pos_etims_my_status', { p_business_id: businessId }),
  saveProfile: ({ businessId, kraPin, environment, branchId, deviceSerial, vatRegistered }) => rpc('pos_etims_save_profile', {
    p_business_id: businessId, p_kra_pin: kraPin, p_environment: environment || 'sandbox',
    p_branch_id: branchId || null, p_device_serial: deviceSerial || null, p_vat_registered: !!vatRegistered,
  }),
  /** codes: any of { tax_code, item_class_code, unit_code, packaging_code, origin_country_code }, each picked from KRA's synced list. */
  setItemCodes: (businessId, productId, codes) => rpc('pos_etims_set_item_codes', { p_business_id: businessId, p_product_id: productId, p_codes: codes }),
  setEnabled: (businessId, enabled) => rpc('pos_etims_set_enabled', { p_business_id: businessId, p_enabled: !!enabled }),
  /** Everything that needs a person: { invoices (rejected / unconfirmed), held_back (sales that could not be turned into an invoice), oldest_waiting_at } */
  attention: (businessId) => rpc('pos_etims_attention', { p_business_id: businessId }),
  requeue: (invoiceId) => rpc('pos_etims_requeue', { p_invoice_id: invoiceId }),
  retryHeld: (businessId) => rpc('pos_etims_retry_held', { p_business_id: businessId }),
  /** Owner presses "Send now": runs the worker for this business only. */
  sendNow: () => fn('etims-submit'),
  /** Products with their KRA codes and registration state. */
  async listItems(businessId) {
    const [{ data: prods, error: e1 }, { data: maps, error: e2 }] = await Promise.all([
      supabase.from('lb_products').select('id, name, sku, barcode').eq('is_active', 'active').order('name').limit(500),
      supabase.from('lb_etims_item_map').select('*').eq('business_id', businessId),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const byProduct = Object.fromEntries((maps || []).map((m) => [m.product_id, m]));
    return (prods || []).map((p) => ({ ...p, map: byProduct[p.id] || null }));
  },
  /** Search ONE of KRA's own lists (tax_type, item_class, unit, packaging, country). Server-side, 30 at a time: item_class has thousands. */
  async searchCodes(environment, list, q = '') {
    const term = String(q).replace(/[,()%]/g, ' ').trim();
    let query = supabase.from('lb_etims_code_lists').select('code, name').eq('environment', environment).eq('list_name', list).order('code').limit(30);
    if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },
  /** Status of the tax invoice for sales (a cashier may read this; it has no PIN, key or invoice body). */
  async statusForSales(saleIds) {
    if (!saleIds?.length) return {};
    const { data, error } = await supabase.from('lb_sale_etims_status').select('sale_id, doc_type, invoice_no, status, kra_data').in('sale_id', saleIds);
    if (error) throw error;
    return Object.fromEntries((data || []).filter((r) => r.doc_type === 'SALE').map((r) => [r.sale_id, r]));
  },
};
