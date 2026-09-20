// src/pos-erp/services/productService.js
//
// FIXED: create() inserted whatever object it was given verbatim, with
// no tenant_id/business_id stamped anywhere in the chain — same bug
// already fixed on suppliers, purchase orders, and sales.
// lb_products.tenant_id is NOT NULL with no default, so every product
// creation in the app was failing at the DB level, including the
// Till's quick-create-from-scan flow (which calls productService
// directly — see useProducts.js/POSPage.jsx updates alongside this).
//
// FIXED: delete() was a hard DELETE. lb_products is referenced by FK
// from lb_sale_items, lb_grn_items, lb_purchase_order_items,
// lb_inventory, and lb_stock_movements — deleting any product with
// transaction history fails (or cascades) at the DB level. Replaced
// with deactivate()/reactivate() against the real is_active enum
// ('active'/'inactive'), same pattern as supplierService.js.

import { posSupabase as supabase } from './posSupabaseClient';

const PRODUCT_FIELDS =
  '*, category:lb_product_categories(id,name), unit:lb_product_units(id,name,code)';

export const productService = {
  async getAll({ categoryId, search, activeOnly = false, page = 1, limit = 50 } = {}) {
    let q = supabase
      .from('lb_products')
      .select(PRODUCT_FIELDS, { count: 'exact' })
      .order('name');
    if (categoryId) q = q.eq('category_id', categoryId);
    if (activeOnly) q = q.eq('is_active', 'active');
    if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`);
    const from = (page - 1) * limit; const to = from + limit - 1; q = q.range(from, to);
    const { data, error, count } = await q; if (error) throw error; return { data, count, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('lb_products')
      .select(PRODUCT_FIELDS)
      .eq('id', id)
      .single();
    if (error) throw error; return data;
  },

  /**
   * @param {object} product - must include tenant_id (NOT NULL, no DB
   *   default). business_id is nullable.
   */
  async create(product) {
    if (!product.tenant_id) {
      throw new Error('productService.create: tenant_id is required (lb_products.tenant_id is NOT NULL).');
    }
    const { data, error } = await supabase
      .from('lb_products')
      .insert(product)
      .select(PRODUCT_FIELDS)
      .single();
    if (error) throw error; return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('lb_products')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(PRODUCT_FIELDS)
      .single();
    if (error) throw error; return data;
  },

  /**
   * Soft delete only — see header note on why a hard delete isn't safe
   * here. Past sales/GRNs/POs should still resolve to a real product
   * row even after it's discontinued.
   */
  async deactivate(id) {
    return this.update(id, { is_active: 'inactive' });
  },

  async reactivate(id) {
    return this.update(id, { is_active: 'active' });
  },

  /**
   * Uploads a product/service photo to the public `product-images`
   * bucket (phase15) and returns its public URL. Same pattern as
   * settingsService.uploadLogo(): fixed filename per product
   * (upsert:true, one photo per product, replaced in place) and a
   * cache-busting ?v= query param on the returned URL so a browser/CDN
   * cache doesn't keep showing the old photo after a change. Does NOT
   * save it onto the product itself — the caller (ProductsPage.jsx)
   * stages it into the edit form like any other field and saves it via
   * the normal update() call, so it can still be cancelled before Save.
   */
  async uploadImage(businessId, productId, file) {
    if (!businessId) throw new Error('productService.uploadImage: businessId is required.');
    if (!productId) throw new Error('productService.uploadImage: productId is required — save the product once before adding a photo.');
    if (!file) throw new Error('productService.uploadImage: file is required.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${businessId}/${productId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  },
};
