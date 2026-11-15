// Access + school context for Elimu screens. `can('students.manage')` is answered from the database (elimu_my_access) - Elimu roles only.
import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { supabase, useSchool } from '../services/platform.js';
import { canElimu } from '../utils/permissions.js';
import { setupService } from '../services/ElimuSetupService.js';
import { useAsync } from './useAsync.js';
import { readSettings } from '../utils/settings.js';

const AccessCtx = createContext(null);

/** Fetches the caller's Elimu access once for a whole subtree. `value` (tests / hosts) skips the fetch. */
export function ElimuAccessProvider({ value, children }) {
  const own = useAccessFetch(!value);
  return <AccessCtx.Provider value={value || own}>{children}</AccessCtx.Provider>;
}

function useAccessFetch(enabled) {
  const school = useSchool();
  const { data, loading } = useAsync(async () => {
    if (!enabled) return null;
    const { data: d, error } = await supabase.rpc('elimu_my_access');
    if (error) throw new Error(error.message);
    return d;
  }, [enabled, school.tenantId, school.userId]);
  const actions = useMemo(() => new Set(data?.actions || []), [data]);
  const isOwner = !!data?.is_owner;
  const can = useCallback((action) => isOwner || canElimu((a) => actions.has(a), action), [actions, isOwner]);
  return useMemo(() => ({ can, loaded: !!data && !loading, isOwner, roles: data?.roles || [] }), [can, loading, data, isOwner]);
}

/** Elimu access of the signed-in person (from elimu_my_access: Elimu roles only). Uses the nearest provider, else fetches itself. */
export function useElimuAccess() {
  const ctx = useContext(AccessCtx);
  const own = useAccessFetch(!ctx);
  return ctx || own;
}

/** Runs the idempotent school setup once and returns settings + current period. */
export function useElimuSetup() {
  const school = useSchool();
  const res = useAsync(async () => {
    await setupService.ensureSetup();
    const [settings, period] = await Promise.all([setupService.getSettings(), setupService.currentPeriod()]);
    return { settings, period };
  }, [school.tenantId]);
  return { ...res, school, settingsRow: res.data?.settings || null, settings: readSettings(res.data?.settings), period: res.data?.period || null };
}
