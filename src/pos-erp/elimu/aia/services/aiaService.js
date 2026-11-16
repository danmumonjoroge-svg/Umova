import { supabase as posSupabase } from '../../services/platform.js';

const fail = (error) => { if (error) throw new Error(error.message || 'AIA request failed'); };
const rows = (data) => data || [];

/** School AIA records. All reads/writes are scoped by the active business and protected by database RLS. */
export const aiaService = {
  async activities(businessId) {
    const { data, error } = await posSupabase.from('elimu_aia_activities').select('*').eq('business_id', businessId).order('name');
    fail(error); return rows(data);
  },
  async transactions(businessId, { activityId = null, limit = 300 } = {}) {
    let q = posSupabase.from('elimu_aia_transactions').select('*, activity:elimu_aia_activities(name, activity_type)').eq('business_id', businessId).order('transaction_date', { ascending: false }).limit(limit);
    if (activityId) q = q.eq('activity_id', activityId);
    const { data, error } = await q; fail(error); return rows(data);
  },
  async remittances(businessId, limit = 200) {
    const { data, error } = await posSupabase.from('elimu_aia_remittances').select('*, activity:elimu_aia_activities(name)').eq('business_id', businessId).order('remittance_date', { ascending: false }).limit(limit);
    fail(error); return rows(data);
  },
  async summary(businessId) { const { data, error } = await posSupabase.rpc('elimu_aia_summary', { p_business: businessId }); fail(error); return data; },
  async batches(businessId, limit = 300) {
    const { data, error } = await posSupabase.from('elimu_aia_batch_balances').select('*').eq('business_id', businessId).order('started_on', { ascending: false }).limit(limit);
    fail(error); return rows(data);
  },
  async productionRecords(businessId, limit = 300) {
    const { data, error } = await posSupabase.from('elimu_aia_production_records').select('*, activity:elimu_aia_activities(name), batch:elimu_aia_batches(batch_code, subject)').eq('business_id', businessId).order('record_date', { ascending: false }).limit(limit);
    fail(error); return rows(data);
  },
  async inventoryBalances(businessId, limit = 300) {
    const { data, error } = await posSupabase.from('elimu_aia_inventory_balances').select('*').eq('business_id', businessId).order('item_name').limit(limit);
    fail(error); return rows(data);
  },
  async inventoryMovements(businessId, limit = 300) {
    const { data, error } = await posSupabase.from('elimu_aia_inventory_movements').select('*, item:elimu_aia_inventory_items(item_name, unit), activity:elimu_aia_activities(name)').eq('business_id', businessId).order('movement_date', { ascending: false }).limit(limit);
    fail(error); return rows(data);
  },
  // All writes go through database functions: they check the Elimu role, post the journal and keep the counters honest.
  async _rpc(fn, args) { const { data, error } = await posSupabase.rpc(fn, args); fail(error); return data; },
  createBatch(row) { return this._rpc('elimu_aia_save_batch', { p_business: row.business_id, p_batch: row }); },
  recordProduction(row) { return this._rpc('elimu_aia_record_production', { p_business: row.business_id, p_rec: row }); },
  createInventoryItem(row) { return this._rpc('elimu_aia_save_item', { p_business: row.business_id, p_item: row }); },
  recordInventoryMovement(row) { return this._rpc('elimu_aia_record_stock', { p_business: row.business_id, p_mv: row }); },
  saveActivity(row) { return this._rpc('elimu_aia_save_activity', { p_business: row.business_id, p_activity: row }); },
  recordTransaction(row) { return this._rpc('elimu_aia_record_transaction', { p_business: row.business_id, p_tx: row }); },
  voidTransaction(id, reason) { return this._rpc('elimu_aia_void_transaction', { p_tx: id, p_reason: reason }); },
  recordRemittance(row) { return this._rpc('elimu_aia_save_remittance', { p_business: row.business_id, p_r: row }); },
  decideRemittance(id, status, note = null) { return this._rpc('elimu_aia_decide_remittance', { p_id: id, p_status: status, p_note: note }); },
};
