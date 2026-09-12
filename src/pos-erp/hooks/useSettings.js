// src/pos-erp/hooks/useSettings.js

import { useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/settingsService';
import { auditService } from '../services/auditService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useSettings() {
  const { tenant } = usePosErpAuth();
  const [profile, setProfile] = useState(null);
  const [posSettings, setPosSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        settingsService.getBusinessProfile(tenant.business_id),
        settingsService.getPosSettings(tenant.business_id),
      ]);
      setProfile(p);
      setPosSettings(s);
    } catch (err) {
      console.error('[useSettings] fetch failed:', err);
      setError(err.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  const updateProfile = useCallback(async (updates) => {
    const result = await settingsService.updateBusinessProfile(tenant.business_id, updates);
    setProfile(result);
    return result;
  }, [tenant]);

  const savePosSettings = useCallback(async ({ settings, receipt_header, receipt_footer }) => {
    const result = await settingsService.savePosSettings({ tenantId: tenant?.id, businessId: tenant?.business_id, settings, receipt_header, receipt_footer });
    setPosSettings({ ...result, settings: result.settings || {} });
    return result;
  }, [tenant]);

  return { profile, posSettings, loading, error, fetch, updateProfile, savePosSettings };
}

export function useAudit() {
  const { tenant } = usePosErpAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await auditService.getEntries({ tenantId: tenant?.id }));
    } catch (err) {
      console.error('[useAudit] fetch failed:', err);
      setError(err.message || 'Failed to load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  return { entries, loading, error, fetch };
}
