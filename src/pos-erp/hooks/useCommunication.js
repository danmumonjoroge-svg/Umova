// src/pos-erp/hooks/useCommunication.js

import { useState, useEffect, useCallback } from 'react';
import { templateService, communicationLogService, whatsappService } from '../services/communicationService';
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

// Phase 10 — supplier-facing counterpart of useTemplates(). Same
// ensureDefaults() call (it seeds both customer and supplier defaults
// together), filtered down to the SUPPLIER_* ones so a supplier-facing
// screen doesn't have to filter the full list itself every render.
export function useSupplierTemplates() {
  const { templates, loading, error, fetch, update } = useTemplates();
  const supplierTemplates = templates.filter(t => String(t.message_type).startsWith('SUPPLIER_'));
  return { templates: supplierTemplates, loading, error, fetch, update };
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

  // Phase 8 (§16) — prepare a WhatsApp message and get back the wa.me
  // URL to open. Prepared only; the owner still has to press Send inside
  // WhatsApp, which is what markSent() below records.
  const prepareWhatsApp = useCallback(async ({ customer, template, variables, referenceType, referenceId }) => {
    const result = await whatsappService.prepare({
      tenantId: tenant?.id, businessId: tenant?.business_id, customer, template, variables,
      referenceType, referenceId, createdBy: staffId,
    });
    setHistory(prev => [result.log, ...prev]);
    return result;
  }, [staffId, tenant]);

  const replaceInHistory = useCallback((row) => {
    setHistory(prev => prev.map(h => (h.id === row.id ? row : h)));
    return row;
  }, []);

  const markOpened = useCallback(async (logId) => replaceInHistory(await whatsappService.markOpened(logId)), [replaceInHistory]);
  const markSent = useCallback(async (logId) => replaceInHistory(await whatsappService.markSentByOwner(logId)), [replaceInHistory]);
  const markNotSent = useCallback(async (logId) => replaceInHistory(await whatsappService.markNotSent(logId)), [replaceInHistory]);

  // Phase 10 — supplier equivalent of prepareWhatsApp(). Same open/opened
  // bookkeeping; reuses markOpened/markSent/markNotSent above since those
  // only ever operate on a log row id, not on which recipient table it
  // points at.
  const prepareWhatsAppForSupplier = useCallback(async ({ supplier, template, variables, referenceType, referenceId }) => {
    const result = await whatsappService.prepareForSupplier({
      tenantId: tenant?.id, businessId: tenant?.business_id, supplier, template, variables,
      referenceType, referenceId, createdBy: staffId,
    });
    setHistory(prev => [result.log, ...prev]);
    return result;
  }, [staffId, tenant]);

  return { history, loading, error, fetch, send, prepareWhatsApp, prepareWhatsAppForSupplier, markOpened, markSent, markNotSent };
}
