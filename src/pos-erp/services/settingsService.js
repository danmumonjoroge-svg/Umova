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
        // logo_url is written here but never *chosen* here — it only
        // ever holds a URL that uploadLogo() below just got back from
        // Supabase Storage, never anything a form field could set
        // directly, so there's no way to point a business at an
        // arbitrary external image URL through this path.
        logo_url: updates.logo_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Uploads a new business logo to the public `business-logos` bucket
   * (phase14) and returns its public URL — does NOT save it onto
   * lb_businesses itself; call updateBusinessProfile with the returned
   * url (or let useSettings.uploadLogo below do both in one step).
   *
   * Fixed filename (logo.<ext>) with upsert:true — one logo per
   * business, replaced in place rather than accumulating timestamped
   * files. Bucket name and this path shape (businessId/logo.<ext>,
   * one folder level) match the phase14 v2 migration and what was
   * actually observed live in the browser network trace, not this
   * function's first version.
   */
  async uploadLogo(businessId, file) {
    if (!businessId) throw new Error('settingsService.uploadLogo: businessId is required.');
    if (!file) throw new Error('settingsService.uploadLogo: file is required.');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${businessId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('business-logos')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('business-logos').getPublicUrl(path);
    // Cache-bust: same path every time (upsert), so append a version
    // query param or a stale browser/CDN cache would keep showing the
    // old logo after a change.
    return `${data.publicUrl}?v=${Date.now()}`;
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
