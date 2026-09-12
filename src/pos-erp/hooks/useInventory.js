// src/pos-erp/hooks/useInventory.js

import { useState, useEffect, useCallback } from 'react';
import { inventoryService } from '../services/inventoryService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useInventory() {
  const { staffId, tenant } = usePosErpAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await inventoryService.getAll(params);
      setItems(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useInventory] fetch failed:', err);
      setError(err.message || 'Failed to load inventory.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const adjustStock = useCallback(async ({ productId, movementType, quantity, reason }) => {
    await inventoryService.adjustStock({
      tenantId: tenant?.id,
      businessId: tenant?.business_id ?? null,
      productId,
      movementType,
      quantity,
      reason,
      createdBy: staffId,
    });
    await fetch(); // re-read rather than patch in place — quantity/stock_status/average_cost all depend on server-side logic in applyStockMovement
  }, [staffId, tenant, fetch]);

  return { items, loading, error, pagination, fetch, adjustStock };
}

export function useStockHistory(productId) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getMovementHistory(productId);
      setMovements(data || []);
    } catch (err) {
      console.error('[useStockHistory] fetch failed:', err);
      setError(err.message || 'Failed to load stock history.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { movements, loading, error, refetch: fetch };
}
