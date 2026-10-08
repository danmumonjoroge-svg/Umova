// src/pos-erp/services/productionService.js
//
// Production (phase22_production.sql). ONE generic engine: materials go in, finished
// goods come out, for a bakery, butchery, kitchen or juice bar alike.
//   Recipe  = what one batch needs and should make.
//   Run     = how many you planned, then what was REALLY used and made.
// Posting a run moves stock through lb_inventory + lb_stock_movements (the same
// tables as the till and goods receiving) and records yield, wastage and cost.
//
// Writes go through SECURITY DEFINER functions; the tables are read-only to the client.
// OFFLINE: recipes are cached for reading only. Starting and posting a run change stock
// and cost, so they need a connection and say so.

import { posSupabase as supabase } from './posSupabaseClient';
import { db } from '../offline/db';

export const WASTAGE_REASONS = ['Spillage', 'Burnt', 'Damaged', 'Expired', 'Overproduction', 'Preparation Loss', 'Other'];

async function cacheRecipes(rows) {
  try {
    await db.recipes_cache.clear();
    await db.recipes_cache.bulkPut(rows.map((r) => ({ id: r.id, name: r.name, primary_product_name: r.primary_product_name, primary_quantity: r.primary_quantity, primary_unit: r.primary_unit, cost_per_batch: r.cost_per_batch })));
  } catch (err) { console.error('[productionService] cache write failed:', err); }
}

export const productionService = {
  // ---------- recipes ----------
  /** Recipes with the expected cost of one batch. Falls back to the device cache when offline. */
  async listRecipes({ includeInactive = false } = {}) {
    try {
      let q = supabase.from('lb_recipe_summary').select('*').order('name');
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      if (!includeInactive) cacheRecipes(data || []);
      return { rows: data || [], fromCache: false };
    } catch (err) {
      if (err?.name === 'TypeError') return { rows: await db.recipes_cache.toArray(), fromCache: true };
      throw err;
    }
  },

  async getRecipe(id) {
    const [{ data: head, error: hErr }, { data: inputs, error: iErr }, { data: outputs, error: oErr }] = await Promise.all([
      supabase.from('lb_production_recipes').select('*').eq('id', id).single(),
      supabase.from('lb_production_recipe_inputs').select('*, product:lb_products(id, name, track_inventory, cost_price)').eq('recipe_id', id),
      supabase.from('lb_production_recipe_outputs').select('*, product:lb_products(id, name, track_inventory)').eq('recipe_id', id),
    ]);
    if (hErr) throw hErr; if (iErr) throw iErr; if (oErr) throw oErr;
    return { ...head, inputs: inputs || [], outputs: [...(outputs || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)) };
  },

  /** inputs: [{ product_id, quantity, unit }]; outputs: [{ product_id, quantity, unit, cost_share_pct, is_primary }] */
  async saveRecipe({ id = null, businessId, name, notes = null, inputs, outputs, createdBy = null }) {
    const { data, error } = await supabase.rpc('save_production_recipe', {
      p_recipe_id: id, p_business_id: businessId, p_name: name, p_notes: notes || null,
      p_inputs: inputs.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity), unit: i.unit || null })),
      p_outputs: outputs.map((o) => ({ product_id: o.product_id, quantity: Number(o.quantity), unit: o.unit || null, cost_share_pct: Number(o.cost_share_pct ?? 100), is_primary: !!o.is_primary })),
      p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  async setRecipeActive(id, active) {
    const { error } = await supabase.rpc('set_production_recipe_active', { p_recipe_id: id, p_active: active });
    if (error) throw error;
  },

  // ---------- runs ----------
  async listRuns({ statuses = ['DRAFT'], limit = 60 } = {}) {
    const { data, error } = await supabase
      .from('lb_production_runs')
      .select('*, recipe:lb_production_recipes(id, name)')
      .in('status', statuses).order('run_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getRun(id) {
    const [{ data: run, error: rErr }, { data: inputs, error: iErr }, { data: outputs, error: oErr }] = await Promise.all([
      supabase.from('lb_production_runs').select('*, recipe:lb_production_recipes(id, name)').eq('id', id).single(),
      supabase.from('lb_production_run_inputs').select('*, product:lb_products(id, name)').eq('run_id', id),
      supabase.from('lb_production_run_outputs').select('*, product:lb_products(id, name, track_inventory)').eq('run_id', id),
    ]);
    if (rErr) throw rErr; if (iErr) throw iErr; if (oErr) throw oErr;
    return { ...run, inputs: inputs || [], outputs: [...(outputs || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)) };
  },

  /** plannedQuantity = how many of the MAIN output you mean to make. Returns the run id. */
  async startRun({ recipeId, plannedQuantity, runDate = null, notes = null, clientReference = null, createdBy = null }) {
    const { data, error } = await supabase.rpc('start_production_run', {
      p_recipe_id: recipeId, p_planned_quantity: Number(plannedQuantity), p_run_date: runDate, p_notes: notes || null,
      p_client_reference: clientReference, p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  /** outputs: [{ product_id, actual_quantity }] (every one); inputs: optional [{ product_id, actual_quantity }] where use differed from plan. */
  async postRun({ runId, outputs, inputs = null, wastageReason = null, notes = null, postedBy = null }) {
    const { data, error } = await supabase.rpc('post_production_run', {
      p_run_id: runId,
      p_outputs: outputs.map((o) => ({ product_id: o.product_id, actual_quantity: Number(o.actual_quantity) })),
      p_inputs: inputs ? inputs.map((i) => ({ product_id: i.product_id, actual_quantity: Number(i.actual_quantity) })) : null,
      p_wastage_reason: wastageReason || null, p_notes: notes || null, p_posted_by: postedBy,
    });
    if (error) throw error;
    return data;
  },

  async cancelRun(runId) {
    const { error } = await supabase.rpc('cancel_production_run', { p_run_id: runId });
    if (error) throw error;
  },
};
