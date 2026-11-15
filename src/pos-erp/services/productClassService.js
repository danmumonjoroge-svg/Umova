// src/pos-erp/services/productClassService.js
// Product / service classes (phase42): Restaurant, Lounge & Bar, Accommodation, Outdoor Activities, or your own.
// Reads and saves classes; the database does the seeding, the guessing and the "move a whole category" work.
import { posSupabase as supabase } from './posSupabaseClient';

export const CLASS_KINDS = [
  ['RESTAURANT', 'Restaurant / food'], ['BAR', 'Lounge / bar'], ['ACCOMMODATION', 'Accommodation'], ['OUTDOOR', 'Outdoor activities'],
  ['RETAIL', 'Retail'], ['SERVICES', 'Services'], ['OTHER', 'Other'],
];
export const CLASS_PRESETS = [
  ['hospitality', 'Hotel / lodge', 'Restaurant, Lounge & Bar, Accommodation, Outdoor Activities'],
  ['restaurant', 'Restaurant & bar', 'Restaurant and Lounge & Bar'],
  ['retail', 'Shop', 'Retail classes'],
  ['services', 'Services', 'Service classes'],
];

export const productClassService = {
  async list(businessId) {
    const { data, error } = await supabase.from('lb_product_classes').select('id,name,kind,sort_order,is_active').eq('business_id', businessId).order('sort_order').order('name');
    if (error) throw error;
    return data || [];
  },
  async seed(businessId, preset) {
    const { data, error } = await supabase.rpc('seed_default_product_classes', { p_business_id: businessId, p_preset: preset });
    if (error) throw error;
    return data; // how many were created
  },
  async add({ tenantId, businessId, name, kind = 'OTHER', sortOrder = 99 }) {
    const { data, error } = await supabase.from('lb_product_classes').insert({ tenant_id: tenantId, business_id: businessId, name: String(name).trim(), kind, sort_order: sortOrder }).select().single();
    if (error) throw error.code === '23505' ? new Error('You already have a class with that name.') : error;
    return data;
  },
  async rename(id, name, kind) {
    const { error } = await supabase.from('lb_product_classes').update({ name: String(name).trim(), ...(kind ? { kind } : {}), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error.code === '23505' ? new Error('You already have a class with that name.') : error;
  },
  async setActive(id, active) {
    const { error } = await supabase.from('lb_product_classes').update({ is_active: !!active, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
  /** Preview (apply=false) or apply (true) the database's guess for items with no class. Never overwrites a class someone chose. */
  async autoAssign(businessId, apply = false) {
    const { data, error } = await supabase.rpc('pos_auto_assign_product_classes', { p_business_id: businessId, p_apply: !!apply });
    if (error) throw error;
    return data || [];
  },
  /** Put every item of a category into a class (null class = clear). Returns how many items moved. */
  async assignCategory(businessId, categoryId, classId) {
    const { data, error } = await supabase.rpc('pos_assign_class_to_category', { p_business_id: businessId, p_category_id: categoryId, p_class_id: classId || null });
    if (error) throw error;
    return data;
  },
  async categories() {
    const { data, error } = await supabase.from('lb_product_categories').select('id,name').order('name');
    if (error) throw error;
    return data || [];
  },
};
