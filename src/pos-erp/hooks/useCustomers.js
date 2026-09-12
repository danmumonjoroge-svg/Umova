// src/pos-erp/hooks/useCustomers.js
//
// Mirrors hooks/useProducts.js's shape exactly (same tenant_id/business_id
// stamping on create, same fetch/create/update/deactivate/reactivate
// surface) so CustomersPage.jsx can follow the same pattern ProductsPage.jsx
// already uses.

import { useState, useEffect, useCallback } from 'react';
import { customerService } from '../services/customerService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useCustomers() {
  const { staffId, tenant } = usePosErpAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await customerService.getAll(params);
      setCustomers(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useCustomers] fetch failed:', err);
      setError(err.message || 'Failed to load customers.');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await customerService.create({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      created_by: staffId,
    });
    setCustomers(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const update = useCallback(async (id, updates) => {
    const result = await customerService.update(id, { ...updates, updated_by: staffId });
    setCustomers(prev => prev.map(c => (c.id === id ? result : c)));
    return result;
  }, [staffId]);

  const deactivate = useCallback(async (id) => {
    const result = await customerService.deactivate(id);
    setCustomers(prev => prev.map(c => (c.id === id ? result : c)));
    return result;
  }, []);

  const reactivate = useCallback(async (id) => {
    const result = await customerService.reactivate(id);
    setCustomers(prev => prev.map(c => (c.id === id ? result : c)));
    return result;
  }, []);

  return { customers, loading, error, pagination, fetch, create, update, deactivate, reactivate };
}
