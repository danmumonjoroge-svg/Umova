// src/pos-erp/hooks/useProducts.js
//
// FIXED: create() only stamped created_by — never tenant_id/business_id,
// which lb_products.tenant_id (NOT NULL) requires. Mirrors
// useSuppliers.js's pattern now. remove() replaced with
// deactivate()/reactivate() to match productService.js's soft-delete fix.

import { useState, useEffect, useCallback } from 'react';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useProducts() {
  const { staffId, tenant } = usePosErpAuth();
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
    const result = await productService.create({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      created_by: staffId,
    });
    setProducts(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const update = useCallback(async (id, updates) => {
    const result = await productService.update(id, { ...updates, updated_by: staffId });
    setProducts(prev => prev.map(p => p.id === id ? result : p));
    return result;
  }, [staffId]);

  const deactivate = useCallback(async (id) => {
    const result = await productService.deactivate(id);
    setProducts(prev => prev.map(p => (p.id === id ? result : p)));
    return result;
  }, []);

  const reactivate = useCallback(async (id) => {
    const result = await productService.reactivate(id);
    setProducts(prev => prev.map(p => (p.id === id ? result : p)));
    return result;
  }, []);

  return { products, loading, error, pagination, fetch, create, update, deactivate, reactivate };
}
