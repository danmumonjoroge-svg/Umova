// src/pos-erp/hooks/useLowStock.js
//
// Shared by POSDashboard.jsx (the low-stock card) and the new
// notification center — one query, read in both places, instead of
// duplicating the lb_inventory join.

import { useState, useEffect, useCallback } from 'react';
import { inventoryService } from '../services/inventoryService';

export function useLowStock(warehouseId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getLowStockItems({ warehouseId });
      setItems(data || []);
    } catch (err) {
      console.error('[useLowStock] fetch failed:', err);
      setError(err.message || 'Failed to load stock levels.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { fetch(); }, [fetch]);

  const outOfStock = items.filter((i) => i.stock_status === 'OUT_OF_STOCK');
  const lowStock = items.filter((i) => i.stock_status === 'LOW_STOCK');

  return { items, outOfStock, lowStock, loading, error, refetch: fetch };
}
