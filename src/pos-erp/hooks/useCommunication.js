// src/pos-erp/hooks/useCommunication.js

import { useState, useEffect, useCallback } from 'react';
import { templateService, communicationLogService } from '../services/communicationService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useTemplates() {
  const { staffId, tenant } = usePosErpAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await templateService.ensureDefaults({ tenantId: tenant.id, businessId: tenant.business_id, createdBy: staffId });
      setTemplates(result);
    } catch (err) {
      console.error('[useTemplates] fetch failed:', err);
      setError(err.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, [tenant, staffId]);

  useEffect(() => { fetch(); }, [fetch]);

  const update = useCallback(async (id, updates) => {
    const result = await templateService.update(id, updates);
    setTemplates(prev => prev.map(t => t.id === id ? result : t));
    return result;
  }, []);

  return { templates, loading, error, fetch, update };
}

export function useCommunicationLog(customerId) {
  const { staffId, tenant } = usePosErpAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await communicationLogService.getHistory({ businessId: tenant?.business_id, customerId }));
    } catch (err) {
      console.error('[useCommunicationLog] fetch failed:', err);
      setError(err.message || 'Failed to load message history.');
    } finally {
      setLoading(false);
    }
  }, [tenant, customerId]);

  useEffect(() => { fetch(); }, [fetch]);

  const send = useCallback(async ({ customer, template, variables, referenceType, referenceId }) => {
    const result = await communicationLogService.send({
      tenantId: tenant?.id, businessId: tenant?.business_id, customer, template, variables,
      referenceType, referenceId, createdBy: staffId,
    });
    setHistory(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  return { history, loading, error, fetch, send };
}
