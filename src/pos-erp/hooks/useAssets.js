// src/pos-erp/hooks/useAssets.js
//
// Phase 9 — mirrors the shape of useCustomers.js / useProducts.js:
// tenant/business scoping comes from usePosErpAuth(), the service does
// the queries, this holds the list and keeps it in step after writes.

import { useState, useEffect, useCallback } from 'react';
import { assetService } from '../services/assetService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useAssets() {
  const { staffId, tenant } = usePosErpAuth();
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, totals] = await Promise.all([
        assetService.getAll({ businessId: tenant.business_id }),
        assetService.getSummary({ businessId: tenant.business_id }),
      ]);
      setAssets(rows);
      setSummary(totals);
    } catch (err) {
      console.error('[useAssets] fetch failed:', err);
      setError(err.message || 'Failed to load equipment.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (fields) => {
    const row = await assetService.create({ tenantId: tenant?.id, businessId: tenant?.business_id, createdBy: staffId, ...fields });
    await fetch(); // summary has to move too, so refetch rather than splice
    return row;
  }, [tenant, staffId, fetch]);

  const update = useCallback(async (id, fields) => {
    const row = await assetService.update(id, fields);
    await fetch();
    return row;
  }, [fetch]);

  const setMaintenance = useCallback(async (id, on) => {
    const row = await assetService.setMaintenance(id, on);
    await fetch();
    return row;
  }, [fetch]);

  const dispose = useCallback(async (id, opts) => {
    const row = await assetService.dispose(id, opts);
    await fetch();
    return row;
  }, [fetch]);

  const postDepreciation = useCallback(async (args) => {
    const id = await assetService.postDepreciation({ ...args, createdBy: staffId });
    await fetch();
    return id;
  }, [staffId, fetch]);

  return { assets, summary, loading, error, fetch, create, update, setMaintenance, dispose, postDepreciation };
}
