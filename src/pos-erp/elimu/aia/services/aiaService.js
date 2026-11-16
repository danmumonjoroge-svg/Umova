import { posSupabase } from '../../../services/posSupabaseClient.js';

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
  async accountingEvents(businessId, limit = 200) {
    const { data, error } = await posSupabase.from('elimu_aia_accounting_events').select('id, source_type, source_id, event_date, description, amount, currency, journal_lines, status, external_journal_ref, adapter_note, created_at').eq('business_id', businessId).order('event_date', { ascending: false }).limit(limit);
    fail(error); return rows(data);
  },
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
  async createBatch(row) {
    const { data, error } = await posSupabase.from('elimu_aia_batches').insert(row).select().single(); fail(error); return data;
  },
  async recordProduction(row) {
    const { data, error } = await posSupabase.from('elimu_aia_production_records').insert(row).select().single(); fail(error); return data;
  },
  async createInventoryItem(row) {
    const { data, error } = await posSupabase.from('elimu_aia_inventory_items').insert(row).select().single(); fail(error); return data;
  },
  async recordInventoryMovement(row) {
    const { data, error } = await posSupabase.from('elimu_aia_inventory_movements').insert(row).select().single(); fail(error); return data;
  },
  async saveActivity(row) {
    const { data, error } = await posSupabase.from('elimu_aia_activities').insert(row).select().single(); fail(error); return data;
  },
  async recordTransaction(row) {
    const { data, error } = await posSupabase.from('elimu_aia_transactions').insert(row).select().single(); fail(error); return data;
  },
  async recordRemittance(row) {
    const { data, error } = await posSupabase.from('elimu_aia_remittances').insert(row).select().single(); fail(error); return data;
  },
  async updateRemittance(id, businessId, status, note = null, staffId = null) {
    const { data, error } = await posSupabase.from('elimu_aia_remittances').update({ status, decision_note: note, decided_by: staffId }).eq('id', id).eq('business_id', businessId).select().single(); fail(error); return data;
  },
};
