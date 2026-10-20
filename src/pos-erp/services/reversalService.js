// Sale reversals (phase29_sale_reversals.sql). The database decides who may do what and performs the
// reversal atomically; this file only carries requests. Error text from the database starts with a code.
import { posSupabase as supabase } from './posSupabaseClient';

const REASONS = {
  NOT_ALLOWED: 'You do not have permission to do that.',
  ALREADY_REVERSED: 'This sale has already been reversed.',
  ALREADY_REQUESTED: 'This sale already has a reversal request.',
  ALREADY_DECIDED: 'This request has already been decided.',
  SALE_ON_FOLIO: 'This sale is on a customer folio. Remove the charge from the folio instead.',
  SALE_NOT_FOUND: 'Sale not found.',
  NOT_FOUND: 'Request not found.',
  NO_DEFAULT_WAREHOUSE: 'No default store was found, so stock could not be returned. Nothing was changed.',
};
export function friendlyReversalError(msg = '') {
  const hit = Object.keys(REASONS).find((k) => msg.includes(k));
  if (hit) return REASONS[hit];
  const m = msg.match(/^(?:REASON_REQUIRED|NOTE_REQUIRED|SALE_NOT_REVERSIBLE):\s*(.*)$/);
  return m ? m[1] : msg;
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyReversalError(error.message));
  return data;
}

export const reversalService = {
  recentSales: (search = '') => rpc('pos_recent_sales', { p_search: search || null, p_limit: 40 }),
  request: (saleId, reason) => rpc('pos_request_sale_reversal', { p_sale_id: saleId, p_reason: reason }),
  approve: (id, note) => rpc('pos_decide_sale_reversal', { p_request_id: id, p_approve: true, p_note: note || null }),
  refuse: (id, note) => rpc('pos_decide_sale_reversal', { p_request_id: id, p_approve: false, p_note: note }),
  cancel: (id) => rpc('pos_cancel_sale_reversal', { p_request_id: id }),
  list: (status = null) => rpc('pos_list_sale_reversals', { p_status: status }),
  /** Only for saleService.create when a just-made folio sale could not be posted to its folio. */
  rollbackNewSale: (saleId, reason) => rpc('pos_rollback_new_sale', { p_sale_id: saleId, p_reason: reason }),
};
