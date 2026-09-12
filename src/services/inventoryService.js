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

export const inventoryService = {
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
};
