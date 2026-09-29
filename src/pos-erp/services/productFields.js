// Shared lb_products select strings — single source of truth so
// productService and the scanner's productResolverService cannot drift.
//
// lb_product_units exposes `code` (not `abbreviation`). Requesting a
// nonexistent column makes PostgREST answer HTTP 400.

export const PRODUCT_UNIT_EMBED = 'unit:lb_product_units(id,name,code)';

export const PRODUCT_SCAN_FIELDS =
  'id,name,sku,barcode,description,category_id,unit_id,cost_price,selling_price,wholesale_price,' +
  'selling_mode,track_inventory,allow_negative_stock,reorder_level,is_active,' +
  PRODUCT_UNIT_EMBED;
