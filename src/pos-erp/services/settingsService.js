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
        // Phase 15: only written when actually provided -- callers that
        // don't touch the logo (most profile-field saves) must not
        // accidentally null it out.
        ...(updates.logo_url !== undefined ? { logo_url: updates.logo_url } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Phase 15 -- uploads a logo image to the `business-logos` Storage
   * bucket and saves its public URL onto lb_businesses.logo_url in one
   * call. Always uploads to `<businessId>/logo.<ext>` (upsert: true) --
   * one logo per business, so re-uploading replaces the old file rather
   * than leaving it orphaned in Storage forever.
   *
   * Client-side only validation here (type/size) -- the real
   * enforcement is Storage's own bucket policies (phase15_business_logo.sql),
   * which only let a business write into its OWN folder.
   */
  async uploadLogo(businessId, file) {
    if (!file) throw new Error('settingsService.uploadLogo: a file is required.');
    if (!file.type?.startsWith('image/')) throw new Error('Please choose an image file (PNG, JPG, etc).');
    if (file.size > 2 * 1024 * 1024) throw new Error('That image is too large — please use one under 2MB.');

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${businessId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('business-logos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('business-logos').getPublicUrl(path);
    // Cache-bust: overwriting the same path keeps the same URL, which
    // means a browser that already cached the OLD logo image would keep
    // showing it after a re-upload without this. Harmless query param —
    // Storage ignores it, browsers don't.
    const bustUrl = `${pub.publicUrl}?v=${Date.now()}`;

    return this.updateBusinessProfile(businessId, { logo_url: bustUrl });
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
