// src/pos-erp/services/etimsService.js
//
// KRA eTIMS (Phase 2): thin wrappers over the database functions in schema/phase48_etims_foundation.sql. Same style as
// reversalService.js. The database decides who may do what; this file only carries requests.
//
// SECURITY: nothing here knows a KRA address, key or header, and nothing ever will. Talking to KRA happens only in Edge
// Functions (Phase 3 onward). The browser reads status flags and masked values.
import { posSupabase as supabase } from './posSupabaseClient';

const REASONS = {
  PIN_INVALID: 'Enter the business KRA PIN with no spaces.',
  ENVIRONMENT_INVALID: 'Choose Test or Live.',
  ETIMS_NOT_SET_UP: 'Set up tax invoices first.',
  ITEM_NOT_FOUND: 'Item not found.',
  UNKNOWN_FIELD: 'That setting is not recognised.',
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
  /** Masked status for the setup card: no key, PIN shown as dots + last 4. */
  myStatus: (businessId) => rpc('pos_etims_my_status', { p_business_id: businessId }),
  saveProfile: ({ businessId, kraPin, environment, branchId, deviceSerial, vatRegistered }) => rpc('pos_etims_save_profile', {
    p_business_id: businessId, p_kra_pin: kraPin, p_environment: environment || 'sandbox',
    p_branch_id: branchId || null, p_device_serial: deviceSerial || null, p_vat_registered: !!vatRegistered,
  }),
  /** codes: any of { tax_code, item_class_code, unit_code, packaging_code, origin_country_code }, each picked from KRA's synced list. */
  setItemCodes: (businessId, productId, codes) => rpc('pos_etims_set_item_codes', { p_business_id: businessId, p_product_id: productId, p_codes: codes }),
  /** Status of the tax invoice for sales (a cashier may read this; it has no PIN, key or invoice body). */
  async statusForSales(saleIds) {
    if (!saleIds?.length) return {};
    const { data, error } = await supabase.from('lb_sale_etims_status').select('sale_id, doc_type, invoice_no, status, kra_data').in('sale_id', saleIds);
    if (error) throw error;
    return Object.fromEntries((data || []).filter((r) => r.doc_type === 'SALE').map((r) => [r.sale_id, r]));
  },
};
