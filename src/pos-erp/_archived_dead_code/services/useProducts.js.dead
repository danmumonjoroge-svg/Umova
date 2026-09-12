// src/pos-erp/hooks/useProducts.js
//
// FIXED: fetch() had no try/catch — if productService.getAll() threw
// (missing table, RLS denial, bad join, network error), setLoading(false)
// was never reached and the UI spun forever with no visible error. Now
// every failure path always resolves loading, and the error is captured
// in state so the page can show it instead of an infinite spinner.

import { useState, useEffect, useCallback } from 'react';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useProducts() {
  const { staffId } = usePosErpAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await productService.getAll({ ...params });
      setProducts(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useProducts] fetch failed:', err);
      setError(err.message || 'Failed to load products.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await productService.create({ ...data, created_by: staffId });
    setProducts(prev => [result, ...prev]);
    return result;
  }, [staffId]);

  const update = useCallback(async (id, updates) => {
    const result = await productService.update(id, updates);
    setProducts(prev => prev.map(p => p.id === id ? result : p));
    return result;
  }, []);

  const remove = useCallback(async (id) => {
    await productService.delete(id);
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  return { products, loading, error, pagination, fetch, create, update, remove };
}
