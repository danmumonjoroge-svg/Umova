// src/pos-erp/hooks/useSuppliers.js
//
// Mirrors useProducts.js's shape so SuppliersPage.jsx feels consistent
// with ProductsPage.jsx. Pulls tenant_id/business_id from usePosErpAuth
// so every create() has what lb_suppliers.tenant_id (NOT NULL) requires.
//
// ASSUMPTION TO VERIFY: this assumes usePosErpAuth()'s `tenant` object
// exposes `tenant.id` as the tenant_id FK (POSLayout.jsx already reads
// tenant?.business_name and tenant?.business_code off the same object,
// so the shape exists — id just isn't confirmed yet). If create() starts
// failing with a null tenant_id error, that's the field name to check
// first.

import { useState, useEffect, useCallback } from 'react';
import { supplierService } from '../services/supplierService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { readThrough } from '../offline/readThrough';

export function useSuppliers() {
  const { staffId, tenant } = usePosErpAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });
  const [copyInfo, setCopyInfo] = useState({ fromCache: false, savedAt: null, complete: true }); // saved copy from this phone?

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const rt = await readThrough('suppliers', () => supplierService.getAll(params), { tenantId: tenant?.id, params, searchFields: ['name'], where: (r, p) => !p.activeOnly || r.is_active === true });
      const result = rt.result;
      setCopyInfo({ fromCache: rt.fromCache, savedAt: rt.savedAt, complete: rt.complete });
      setSuppliers(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useSuppliers] fetch failed:', err);
      setError(err.message || 'Failed to load suppliers.');
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await supplierService.create({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      created_by: staffId,
    });
    setSuppliers(prev => [...prev, result].sort((a, b) => a.name.localeCompare(b.name)));
    return result;
  }, [staffId, tenant]);

  const update = useCallback(async (id, updates) => {
    const result = await supplierService.update(id, { ...updates, updated_by: staffId });
    setSuppliers(prev => prev.map(s => (s.id === id ? result : s)));
    return result;
  }, [staffId]);

  const deactivate = useCallback(async (id) => {
    const result = await supplierService.deactivate(id);
    setSuppliers(prev => prev.map(s => (s.id === id ? result : s)));
    return result;
  }, []);

  const reactivate = useCallback(async (id) => {
    const result = await supplierService.reactivate(id);
    setSuppliers(prev => prev.map(s => (s.id === id ? result : s)));
    return result;
  }, []);

  return { suppliers, loading, error, pagination, copyInfo, fetch, create, update, deactivate, reactivate };
}

/**
 * Detail hook for one supplier's linked records — used by the supplier
 * detail drawer to show POs / GRNs / payments / returns without pulling
 * all of it into the list hook above.
 */
export function useSupplierDetail(supplierId) {
  const [data, setData] = useState({ purchaseOrders: [], grns: [], payments: [], returns: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const [purchaseOrders, grns, payments, returns] = await Promise.all([
        supplierService.getPurchaseOrders(supplierId),
        supplierService.getGoodsReceivedNotes(supplierId),
        supplierService.getPayments(supplierId),
        supplierService.getReturns(supplierId),
      ]);
      setData({ purchaseOrders, grns, payments, returns });
    } catch (err) {
      console.error('[useSupplierDetail] fetch failed:', err);
      setError(err.message || 'Failed to load supplier detail.');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...data, loading, error, refetch: fetch };
}
