// End-of-day cash and M-Pesa reconciliation (phase30_reconciliation.sql). The expected figures come from the
// database (sales, folio payments, cash movements, spending and reversals for the Nairobi calendar day).
import { posSupabase as supabase } from './posSupabaseClient';

export function friendlyReconcileError(msg = '') {
  if (msg.includes('NOT_ALLOWED')) return 'You do not have permission to reconcile.';
  if (msg.includes('SIGNED_OFF') || msg.includes('LOCKED')) return 'This day has been signed off and cannot be changed.';
  if (msg.includes('SECOND_PERSON')) return 'Someone else (or the owner) must sign off a count you prepared.';
  const m = msg.match(/^[A-Z_]+:\s*(.*)$/);
  return m ? m[1] : msg;
}
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyReconcileError(error.message));
  return data;
}
export const reconcileService = {
  preview: (business, date) => rpc('pos_reconcile_preview', { p_business: business, p_date: date }),
  save: (business, date, openingFloat, countedCash, countedMpesa, notes) =>
    rpc('pos_reconcile_save', { p_business: business, p_date: date, p_opening_float: openingFloat, p_counted_cash: countedCash, p_counted_mpesa: countedMpesa, p_notes: notes || null }),
  signoff: (id) => rpc('pos_reconcile_signoff', { p_id: id }),
  list: (business, from, to) => rpc('pos_reconcile_list', { p_business: business, p_from: from, p_to: to }),
};
