// src/pos-erp/services/settingsService.js
//
// Phase 8 — settings (brief §59). Two real tables, not one invented
// structure:
//   - lb_businesses — Business Profile fields (name, phone, email,
//     address, currency, time_zone, logo_url) that already exist and
//     that other phases already read (tenant.business_id everywhere).
//   - lb_pos_settings — a dedicated settings table (confirmed against
//     the live schema): a JSONB `settings` blob plus explicit
//     receipt_header/receipt_footer columns. Payment Methods/Tax/
//     Communication/Inventory settings (§59) live as well-known keys
//     inside that JSONB blob — there's no dedicated column for each,
//     and the table's shape makes clear that's intentional (it's a
//     generic settings store, not a fixed-column form).
//
// No onConflict upsert on lb_pos_settings — its business_id/branch_id
// aren't confirmed to have a unique constraint, so this does an explicit
// select-then-update-or-insert instead of assuming one.

import { posSupabase as supabase } from './posSupabaseClient';

const DEFAULT_SETTINGS = {
  payment_methods_enabled: ['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'],
  tax_rate: 0,
  tax_inclusive: true,
  communication_enabled: false, // no SMS/email/WhatsApp provider connected yet (Phase 7) — stays off until one is
  low_stock_threshold_override: null, // null = use each product's own reorder_level
};

export const settingsService = {
  async getBusinessProfile(businessId) {
    if (!businessId) return null;
    const { data, error } = await supabase.from('lb_businesses').select('*').eq('id', businessId).single();
    if (error) throw error;
    return data;
  },

  async updateBusinessProfile(businessId, updates) {
    const { data, error } = await supabase
      .from('lb_businesses')
      .update({
        name: updates.name,
        phone: updates.phone || null,
        email: updates.email || null,
        address: updates.address || null,
        currency: updates.currency,
        time_zone: updates.time_zone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getPosSettings(businessId) {
    if (!businessId) return { settings: DEFAULT_SETTINGS, receipt_header: '', receipt_footer: '' };
    const { data, error } = await supabase.from('lb_pos_settings').select('*').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    if (!data) return { settings: DEFAULT_SETTINGS, receipt_header: '', receipt_footer: '' };
    return { ...data, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
  },

  async savePosSettings({ tenantId, businessId, settings, receipt_header, receipt_footer }) {
    if (!tenantId || !businessId) throw new Error('settingsService.savePosSettings: tenantId and businessId are required.');
    const { data: existing, error: existingError } = await supabase
      .from('lb_pos_settings')
      .select('id')
      .eq('business_id', businessId)
      .maybeSingle();
    if (existingError) throw existingError;

    const payload = { settings, receipt_header: receipt_header || null, receipt_footer: receipt_footer || null, updated_at: new Date().toISOString() };

    if (existing) {
      const { data, error } = await supabase.from('lb_pos_settings').update(payload).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase
      .from('lb_pos_settings')
      .insert({ tenant_id: tenantId, business_id: businessId, ...payload })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
