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
   * Uploads a PROCESSED logo (see utils/logoImage.js: already checked, resized and re-encoded)
   * to the public `business-logos` bucket and returns its public URL. Path is always
   * `<business_id>/logo.<ext>`; the storage policies (phase15) only let a business write inside
   * its own folder. The other extension is removed so a business never keeps two logos.
   * This does NOT touch lb_businesses: call setLogoUrl() with the returned URL.
   */
  async uploadLogo(businessId, blob, { ext, contentType }) {
    if (!businessId) throw new Error('settingsService.uploadLogo: businessId is required.');
    if (!blob || !['png', 'jpg'].includes(ext)) throw new Error('settingsService.uploadLogo: a processed logo is required.');
    const path = `${businessId}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from('business-logos').upload(path, blob, { contentType, upsert: true });
    if (uploadError) throw uploadError;
    const other = `${businessId}/logo.${ext === 'png' ? 'jpg' : 'png'}`;
    await supabase.storage.from('business-logos').remove([other]).catch(() => {}); // best effort: a leftover file is harmless
    const { data } = supabase.storage.from('business-logos').getPublicUrl(path);
    // Same path every time (upsert): add a version so a browser/CDN does not keep showing the old logo.
    return `${data.publicUrl}?v=${Date.now()}`;
  },

  /** Saves ONLY the logo address on the business (or null = no logo). Returns the updated business row. */
  async setLogoUrl(businessId, url) {
    if (!businessId) throw new Error('settingsService.setLogoUrl: businessId is required.');
    const { data, error } = await supabase.from('lb_businesses')
      .update({ logo_url: url || null, updated_at: new Date().toISOString() }).eq('id', businessId).select().single();
    if (error) throw error;
    return data;
  },

  /** Removes the logo files and clears the address: the business goes back to the default look. */
  async removeLogo(businessId) {
    if (!businessId) throw new Error('settingsService.removeLogo: businessId is required.');
    await supabase.storage.from('business-logos').remove([`${businessId}/logo.png`, `${businessId}/logo.jpg`, `${businessId}/logo.jpeg`, `${businessId}/logo.webp`, `${businessId}/logo.svg`]).catch(() => {});
    return this.setLogoUrl(businessId, null);
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
