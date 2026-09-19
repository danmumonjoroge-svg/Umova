// src/pos-erp/services/assetService.js
//
// Phase 9 — My Equipment / fixed assets (brief §10).
//
// The owner-facing promise of §10 is "normal users should not need to
// understand depreciation". So the depreciation MATHS lives here, the
// owner only ever presses "Record this month's wear and tear", and the
// POSTING is done by post_asset_depreciation() in the database — one
// atomic call that writes the expense, the entry, and the running total
// together. Same pattern as record_customer_payment() /
// record_supplier_payment(): no balance arithmetic client-side.
//
// What this does NOT do, deliberately (see phase9_assets.sql's header):
// buying an asset does not reduce cash or raise a payable. This schema
// has no general ledger, so there is nowhere correct to post the other
// side, and posting it as an expense would be actively wrong — an asset
// is not an expense. The page states this rather than hiding it.

import { posSupabase as supabase } from './posSupabaseClient';

export const DEPRECIATION_METHODS = ['STRAIGHT_LINE', 'REDUCING_BALANCE', 'NONE'];
export const ASSET_STATUSES = ['ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED', 'WRITTEN_OFF'];

/** Cost less everything written off so far — what the asset is "worth" on the books. */
export function bookValue(asset) {
  return Number(asset.purchase_cost || 0) - Number(asset.accumulated_depreciation || 0);
}

/**
 * One month's depreciation for an asset, or null when there isn't a
 * defensible figure to compute.
 *
 * Returns null — rather than 0 or a guess — when the method is NONE, when
 * STRAIGHT_LINE has no useful life set, or when REDUCING_BALANCE has no
 * rate set. §13's rule: do not silently invent values when the
 * information needed isn't there. The UI turns a null into "tell me the
 * useful life first", not into a zero the owner would never question.
 */
export function monthlyDepreciation(asset) {
  const cost = Number(asset.purchase_cost || 0);
  const salvage = Number(asset.salvage_value || 0);
  const accumulated = Number(asset.accumulated_depreciation || 0);
  const remaining = cost - salvage - accumulated;
  if (remaining <= 0) return 0; // fully written down — a real answer, not a missing one

  if (asset.depreciation_method === 'NONE') return null;

  let annual;
  if (asset.depreciation_method === 'STRAIGHT_LINE') {
    const years = Number(asset.useful_life_years || 0);
    if (!years) return null;
    annual = (cost - salvage) / years;
  } else if (asset.depreciation_method === 'REDUCING_BALANCE') {
    const rate = Number(asset.depreciation_rate || 0);
    if (!rate) return null;
    // Reducing balance charges against what's left, not original cost.
    annual = (cost - accumulated) * (rate / 100);
  } else {
    return null;
  }

  // Never let a rounding step push the asset below salvage value — the
  // database function rejects that anyway, but failing there would give
  // the owner a raw SQL error instead of a sensible final part-month.
  return Math.min(Math.round((annual / 12) * 100) / 100, remaining);
}

/** First and last day of the month containing `date` (default: last month end → today's month). */
export function monthBounds(date = new Date()) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { periodStart: iso(start), periodEnd: iso(end) };
}

export const assetService = {
  async getAll({ businessId, includeDisposed = true } = {}) {
    let q = supabase
      .from('lb_fixed_assets')
      .select('*, supplier:lb_suppliers(id, name)')
      .order('purchase_date', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    if (!includeDisposed) q = q.not('status', 'in', '("DISPOSED","WRITTEN_OFF")');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create({ tenantId, businessId, createdBy, ...fields }) {
    if (!tenantId) throw new Error('assetService.create: tenantId is required.');
    if (!fields.name) throw new Error('assetService.create: a name is required.');
    if (!fields.purchase_date) throw new Error('assetService.create: a purchase date is required.');
    if (fields.purchase_cost == null || Number(fields.purchase_cost) < 0) {
      throw new Error('assetService.create: purchase cost must be zero or more.');
    }

    const { data, error } = await supabase
      .from('lb_fixed_assets')
      .insert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        name: fields.name,
        category: fields.category || null,
        purchase_date: fields.purchase_date,
        purchase_cost: Number(fields.purchase_cost),
        supplier_id: fields.supplier_id || null,
        serial_number: fields.serial_number || null,
        location: fields.location || null,
        useful_life_years: fields.useful_life_years ? Number(fields.useful_life_years) : null,
        depreciation_method: fields.depreciation_method || 'STRAIGHT_LINE',
        depreciation_rate: fields.depreciation_rate ? Number(fields.depreciation_rate) : null,
        salvage_value: Number(fields.salvage_value || 0),
        notes: fields.notes || null,
        created_by: createdBy ?? null,
      })
      .select('*, supplier:lb_suppliers(id, name)')
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, fields) {
    // accumulated_depreciation and status are deliberately NOT updatable
    // here — the first is owned by post_asset_depreciation(), the second
    // by dispose(). Letting a form write either would create a second
    // authority over the same number (§2).
    const allowed = [
      'name', 'category', 'purchase_date', 'purchase_cost', 'supplier_id', 'serial_number',
      'location', 'useful_life_years', 'depreciation_method', 'depreciation_rate',
      'salvage_value', 'notes',
    ];
    const patch = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in fields) patch[k] = fields[k] === '' ? null : fields[k];

    const { data, error } = await supabase
      .from('lb_fixed_assets').update(patch).eq('id', id)
      .select('*, supplier:lb_suppliers(id, name)').single();
    if (error) throw error;
    return data;
  },

  async setMaintenance(id, underMaintenance) {
    const { data, error } = await supabase
      .from('lb_fixed_assets')
      .update({ status: underMaintenance ? 'UNDER_MAINTENANCE' : 'ACTIVE', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, supplier:lb_suppliers(id, name)').single();
    if (error) throw error;
    return data;
  },

  /**
   * Sell or scrap an asset. Records proceeds and the date; the
   * gain/loss is DERIVED (proceeds − book value), not stored, so it can
   * never disagree with the figures it comes from.
   *
   * No cash posting here either, for the same reason purchases don't
   * post: no general ledger. If money actually came in for a sold
   * fridge, the owner records that separately in My Money.
   */
  async dispose(id, { disposalDate, proceeds = 0, writtenOff = false, notes } = {}) {
    if (!disposalDate) throw new Error('assetService.dispose: a disposal date is required.');
    const patch = {
      status: writtenOff ? 'WRITTEN_OFF' : 'DISPOSED',
      disposal_date: disposalDate,
      disposal_proceeds: Number(proceeds || 0),
      updated_at: new Date().toISOString(),
    };
    if (notes != null) patch.notes = notes;
    const { data, error } = await supabase
      .from('lb_fixed_assets').update(patch).eq('id', id)
      .select('*, supplier:lb_suppliers(id, name)').single();
    if (error) throw error;
    return data;
  },

  /** proceeds − book value at disposal. Positive = gain, negative = loss. */
  disposalResult(asset) {
    if (!asset.disposal_date) return null;
    return Number(asset.disposal_proceeds || 0) - bookValue(asset);
  },

  async getDepreciationHistory(assetId) {
    const { data, error } = await supabase
      .from('lb_asset_depreciation_entries')
      .select('*')
      .eq('asset_id', assetId)
      .order('period_end', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Posts one period of depreciation. The RPC does the expense + entry +
   * running-total write atomically and rejects a period already posted
   * (UNIQUE on asset_id + period_end) — so pressing the button twice is
   * safe, and gets a clear "already recorded" rather than a double charge.
   */
  async postDepreciation({ assetId, periodStart, periodEnd, amount, createdBy }) {
    const { data, error } = await supabase.rpc('post_asset_depreciation', {
      p_asset_id: assetId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_amount: Number(amount),
      p_created_by: createdBy ?? null,
    });
    if (error) {
      if (String(error.message || '').includes('lb_asset_depreciation_unique_period')) {
        throw new Error('Wear and tear for this period has already been recorded for this item.');
      }
      throw error;
    }
    return data;
  },

  /** Totals for the register header and for the balance sheet's fixed-asset line. */
  async getSummary({ businessId } = {}) {
    let q = supabase
      .from('lb_fixed_assets')
      .select('purchase_cost, accumulated_depreciation, status');
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;

    // Disposed and written-off items leave the balance sheet — they're
    // still in the register for history, but they aren't owned any more.
    const live = (data || []).filter(a => a.status !== 'DISPOSED' && a.status !== 'WRITTEN_OFF');
    const cost = live.reduce((s, a) => s + Number(a.purchase_cost || 0), 0);
    const accumulated = live.reduce((s, a) => s + Number(a.accumulated_depreciation || 0), 0);
    return { cost, accumulated, netBookValue: cost - accumulated, count: live.length };
  },
};
