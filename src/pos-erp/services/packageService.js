// src/pos-erp/services/packageService.js
//
// Packages (phase23_packages.sql): ONE price for a bundle of things you already sell.
// Charging a package to a folio writes one ordinary folio line per component (the
// price split in proportion to normal prices, adding up to exactly the package price)
// and takes stocked components out of stock. Writes go through SECURITY DEFINER
// functions; the tables are read-only to the client. Selling or removing a package
// changes stock and a bill, so it needs a connection and says so.

import { posSupabase as supabase } from './posSupabaseClient';

export const packageService = {
  /** Packages with the normal total, the guest's saving and the estimated cost. */
  async list({ includeInactive = false } = {}) {
    let q = supabase.from('lb_package_summary').select('*').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async get(id) {
    const [{ data: head, error: hErr }, { data: items, error: iErr }] = await Promise.all([
      supabase.from('lb_packages').select('*').eq('id', id).single(),
      supabase.from('lb_package_items').select('*').eq('package_id', id).order('position'),
    ]);
    if (hErr) throw hErr; if (iErr) throw iErr;
    return { ...head, items: items || [] };
  },

  /** items: [{ product_id|null, description, quantity, list_price, category }] */
  async save({ id = null, businessId, name, description = null, price, items, createdBy = null }) {
    const { data, error } = await supabase.rpc('save_package', {
      p_package_id: id, p_business_id: businessId, p_name: name, p_description: description || null, p_price: Number(price),
      p_items: items.map((i) => ({ product_id: i.product_id || null, description: i.description || null, quantity: Number(i.quantity), list_price: i.list_price === '' || i.list_price == null ? null : Number(i.list_price), category: i.category || null })),
      p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  async setActive(id, active) {
    const { error } = await supabase.rpc('set_package_active', { p_package_id: id, p_active: active });
    if (error) throw error;
  },

  /** Charge package(s) to an open folio. Returns { charge_id, lines, total, duplicate }. */
  async addToFolio({ folioId, packageId, quantity = 1, clientReference = null, createdBy = null }) {
    const { data, error } = await supabase.rpc('add_package_to_folio', {
      p_folio_id: folioId, p_package_id: packageId, p_quantity: quantity, p_client_reference: clientReference, p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  /** Take a whole package sale off the bill; stock comes back. */
  async removeFromFolio({ folioId, chargeId, reason, by = null }) {
    const { error } = await supabase.rpc('void_package_charge', { p_folio_id: folioId, p_charge_id: chargeId, p_reason: reason, p_by: by });
    if (error) throw error;
  },
};
