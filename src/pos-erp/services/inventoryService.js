// src/pos-erp/services/inventoryService.js
//
// New — needed because POSDashboard.jsx's low-stock widget was reading
// p.stock_quantity and p.reorder_level directly off lb_products. Neither
// exists there: quantity only lives on lb_inventory (per warehouse), and
// while reorder_level IS a real lb_products column, the join has to
// happen in the query, not assumed on the product row.
//
// Reads lb_inventory.stock_status directly (LOW_STOCK/OUT_OF_STOCK/NORMAL)
// rather than recomputing it client-side — applyStockMovement (see
// purchaseService.js) is what keeps that column correct on every write,
// so this only needs to read it.

import { posSupabase as supabase } from './posSupabaseClient';
import { applyStockMovement, getDefaultWarehouseId } from './purchaseService';

// Manual adjustment types exposed on the Inventory page. Deliberately
// excludes SALE / PURCHASE_RECEIPT / SUPPLIER_RETURN / STOCK_TRANSFER_* —
// those already have their own dedicated flows (Till, Goods Receiving,
// Supplier Returns) and shouldn't be duplicated here.
export const MANUAL_ADJUSTMENT_TYPES = ['STOCK_ADJUSTMENT', 'STOCK_COUNT', 'DAMAGED', 'EXPIRED', 'OPENING_STOCK'];

export const inventoryService = {
  /**
   * Full inventory view — every active product, joined with its stock
   * row if one exists. Products with track_inventory = false or that
   * have simply never had a stock movement yet (no lb_inventory row —
   * applyStockMovement only creates one on first movement) still show
   * up, just with no quantity to report.
   */
  async getAll({ search, page = 1, limit = 50 } = {}) {
    let query = supabase
      .from('lb_products')
      .select(
        'id, name, sku, track_inventory, reorder_level, cost_price, selling_price, inventory:lb_inventory(quantity, average_cost, stock_status, last_movement_at)',
        { count: 'exact' }
      )
      .eq('is_active', 'active')
      .order('name', { ascending: true });

    if (search) query = query.ilike('name', `%${search}%`);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    // inventory comes back as an array (reverse FK relation) even though
    // there's at most one row per product in a single-warehouse tenant —
    // flatten it here so callers don't have to know that.
    const flattened = (data || []).map((p) => ({ ...p, inventory: p.inventory?.[0] || null }));
    return { data: flattened, count, page, limit };
  },

  async getLowStockItems({ warehouseId } = {}) {
    let query = supabase
      .from('lb_inventory')
      .select('id, product_id, warehouse_id, quantity, stock_status, product:lb_products(id, name, sku, reorder_level)')
      .in('stock_status', ['LOW_STOCK', 'OUT_OF_STOCK'])
      .order('quantity', { ascending: true });

    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async getStockLevel(productId, warehouseId) {
    const { data, error } = await supabase
      .from('lb_inventory')
      .select('quantity, stock_status, average_cost')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();
    if (error) throw error;
    return data; // null if the product has never had a stock movement yet
  },

  async getMovementHistory(productId, { limit = 30 } = {}) {
    const { data, error } = await supabase
      .from('lb_stock_movements')
      .select('id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  /**
   * @param {object} adjustment - { tenantId, businessId?, branchId?, productId,
   *   movementType (one of MANUAL_ADJUSTMENT_TYPES), quantity (signed —
   *   positive adds stock, negative removes it), reason, createdBy }
   */
  async adjustStock({ tenantId, businessId = null, branchId = null, productId, movementType, quantity, reason, createdBy }) {
    if (!MANUAL_ADJUSTMENT_TYPES.includes(movementType)) {
      throw new Error(`inventoryService.adjustStock: movementType must be one of ${MANUAL_ADJUSTMENT_TYPES.join(', ')}.`);
    }
    const warehouseId = await getDefaultWarehouseId(tenantId);
    return applyStockMovement({
      tenantId,
      businessId,
      branchId,
      warehouseId,
      productId,
      movementType,
      quantity,
      unitCost: 0, // manual adjustments don't carry a cost basis
      referenceType: 'MANUAL_ADJUSTMENT',
      notes: reason || null,
      createdBy,
    });
  },
};
