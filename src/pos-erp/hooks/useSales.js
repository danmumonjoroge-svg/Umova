// src/pos-erp/hooks/useSales.js
//
// UPDATED alongside saleService.js's rebuild — now also stamps tenant_id
// (create() previously only added cashier_id, and the service didn't
// require or use tenant_id at all, which was part of why the insert
// would have failed).

import { useState, useEffect, useCallback } from 'react';
import { saleService } from '../services/saleService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useSales() {
  const { staffId, tenant } = usePosErpAuth();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await saleService.getAll({ ...params });
      setSales(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useSales] fetch failed:', err);
      setError(err.message || 'Failed to load sales.');
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const payload = { ...data, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, cashier_id: staffId };
    const result = await saleService.create(payload);
    setSales(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const voidSale = useCallback(async (id, reason) => {
    const result = await saleService.voidSale(id, reason, { voidedBy: staffId });
    setSales(prev => prev.map(s => (s.id === id ? result : s)));
    return result;
  }, [staffId]);

  return { sales, loading, error, pagination, fetch, create, voidSale };
}
