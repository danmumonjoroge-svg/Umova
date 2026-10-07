// src/pos-erp/navigation/CapabilitiesContext.jsx
//
// Which business capabilities are switched on (Retail / Rentals /
// Salon). Stored in the existing lb_pos_settings JSONB `settings` blob
// under `enabled_capabilities` -- NO migration needed, that table is
// already a generic settings store (see settingsService.js's header).
//
// null / missing means "the owner hasn't chosen yet" -> every capability
// is shown (except opt-in capabilities such as folios). That is deliberate: this system has no reliable signal for a
// business's type (pos_tenants.business_type is a free-text, optional
// signup field), and hiding "Rentals" from a property business that
// simply hasn't visited Settings would lock them out of their own
// navigation. Once the owner saves a choice in Settings -> "What does
// your business do?", navigation narrows to just those.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { settingsService } from '../services/settingsService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { ALL_CAPABILITY_KEYS, DEFAULT_CAPABILITY_KEYS } from './navConfig';

const CapabilitiesContext = createContext({
  enabled: DEFAULT_CAPABILITY_KEYS,
  chosen: false,
  loading: false,
  refresh: () => {},
});

export function CapabilitiesProvider({ children }) {
  const { tenant } = usePosErpAuth();
  const [stored, setStored] = useState(null); // null = not chosen
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true);
    try {
      const s = await settingsService.getPosSettings(tenant.business_id);
      const list = s?.settings?.enabled_capabilities;
      setStored(Array.isArray(list) ? list.filter((k) => ALL_CAPABILITY_KEYS.includes(k)) : null);
    } catch (err) {
      // A failed settings read must never hide navigation -- fall back to "everything on".
      console.error('[Capabilities] could not read settings:', err);
    } finally {
      setLoading(false);
    }
  }, [tenant?.business_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({
    enabled: stored ?? DEFAULT_CAPABILITY_KEYS,
    chosen: stored !== null,
    loading,
    refresh,
  }), [stored, loading, refresh]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities() {
  return useContext(CapabilitiesContext);
}
