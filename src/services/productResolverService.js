// Universal Scanning Engine — Product Resolver
//
// FIXED (this pass): PRODUCT_FIELDS selected a `status` column that does
// not exist on lb_products — the real column is `is_active`, an enum
// (lb_product_status: 'active' | 'inactive'), not a boolean and not the
// 'ACTIVE'/'INACTIVE' strings this file was checking against. Selecting
// a nonexistent column errors at the PostgREST level, so barcode
// scanning was almost certainly failing on every single scan, not just
// mishandling inactive products as previously assumed.
//
// (Earlier fix, still in effect: uses posSupabase, not the main app's
// client — same class of bug as productService.js/supplierService.js.)

import { posSupabase as supabase } from '../services/posSupabaseClient';
import { normalizeBarcode, isValidBarcode } from '../utils/barcodeUtils';

const PRODUCT_FIELDS =
  'id, name, sku, barcode, description, category_id, unit_id, cost_price, selling_price, wholesale_price, selling_mode, track_inventory, allow_negative_stock, reorder_level, is_active, unit:lb_product_units(id, name, abbreviation)';

/**
 * Resolve a scanned barcode to a product.
 *
 * @returns {Promise<{found: boolean, product?: object, barcode: string, reason?: string}>}
 */
export async function resolveBarcode({ barcode }) {
  const normalized = normalizeBarcode(barcode);

  if (!isValidBarcode(normalized)) {
    return { found: false, barcode: normalized, reason: 'INVALID_BARCODE' };
  }

  // 1. Try the primary product barcode field (lb_products.barcode).
  let { data, error } = await supabase
    .from('lb_products')
    .select(PRODUCT_FIELDS)
    .eq('barcode', normalized)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  // 2. Fall back to the optional multi-barcode mapping table, if present,
  //    for packaging/carton/supplier barcodes (see lb_product_barcodes).
  if (!data) {
    const mapped = await resolveViaBarcodeMap({ barcode: normalized });
    if (mapped) {
      return {
        found: true,
        product: mapped.product,
        barcode: normalized,
        packQuantity: mapped.packQuantity,
        barcodeType: mapped.barcodeType,
      };
    }
  }

  if (!data) {
    return { found: false, barcode: normalized };
  }

  if (data.is_active && data.is_active !== 'active') {
    return { found: true, product: data, barcode: normalized, reason: 'INACTIVE' };
  }

  return { found: true, product: data, barcode: normalized, packQuantity: 1, barcodeType: 'UNIT' };
}

/**
 * Looks up lb_product_barcodes for carton/pack/alternative barcodes.
 * Fails soft (returns null) if the table doesn't exist yet in this
 * environment's schema — multi-barcode support is optional/Phase 2.
 */
async function resolveViaBarcodeMap({ barcode }) {
  try {
    const { data, error } = await supabase
      .from('lb_product_barcodes')
      .select(
        `barcode, barcode_type, pack_quantity, is_primary, status, product:lb_products(${PRODUCT_FIELDS})`
      )
      .eq('barcode', barcode)
      .eq('status', 'ACTIVE')
      .limit(1)
      .maybeSingle();

    if (error || !data || !data.product) return null;
    return {
      product: data.product,
      packQuantity: data.pack_quantity || 1,
      barcodeType: data.barcode_type || 'UNIT',
    };
  } catch (e) {
    return null;
  }
}

/**
 * Duplicate barcode guard used by the Products form before create/update.
 * NULL/blank barcodes are always allowed (many MSME products have none).
 */
export async function checkBarcodeAvailable({ barcode, excludeProductId }) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return { available: true };

  let query = supabase
    .from('lb_products')
    .select('id, name')
    .eq('barcode', normalized)
    .neq('is_active', 'inactive');

  if (excludeProductId) query = query.neq('id', excludeProductId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;

  if (data) {
    return { available: false, conflictingProduct: data };
  }
  return { available: true };
}
