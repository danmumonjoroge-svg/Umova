// src/pos-erp/hooks/useEtims.js
// KRA eTIMS (Phase 3): loads the masked status for this business. No key, no KRA address, nothing sensitive.
import { useState, useEffect, useCallback } from 'react';
import { etimsService } from '../services/etimsService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useEtims() {
  const { tenant } = usePosErpAuth();
  const businessId = tenant?.business_id;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try { setStatus(await etimsService.myStatus(businessId)); }
    catch (e) { setError(e?.message || 'Could not load tax invoice status.'); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveProfile = useCallback(async (form) => {
    await etimsService.saveProfile({ businessId, ...form });
    await refresh();
  }, [businessId, refresh]);

  return { businessId, status, loading, error, refresh, saveProfile };
}
