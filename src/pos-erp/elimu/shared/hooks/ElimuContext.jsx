// elimu/shared/hooks/ElimuContext.jsx -- who am I in the school, and which school is it. Uses the POS auth (no second login).
// `can()` only decides what to SHOW. Every action is checked again by the database (elimu_can / RLS).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { cacheValue, readCachedValue } from '../../../offline/offlineCache';
import { accessService } from '../services/accessService';
import { actionsForRoles } from '../utils/access';
import { todayInTz } from '../utils/time';

const Ctx = createContext({ loaded: false, can: () => false, canAny: () => false, roles: [], isOwner: false, tenantId: null, businessId: null, schoolName: '', userId: null, tz: 'Africa/Nairobi', today: () => '', refresh: () => {} });

export function ElimuProvider({ children }) {
  const { tenant, posStaffId, isOwner: signedInOwner } = usePosErpAuth();
  const [state, setState] = useState({ loaded: false, roles: [], actions: new Set(), isOwner: false });
  const refresh = useCallback(async () => {
    if (!posStaffId) return;
    try {
      const r = await accessService.my();
      if (r?.ok) { setState({ loaded: true, roles: r.roles || [], actions: new Set(r.actions || []), isOwner: !!r.is_owner }); cacheValue(`elimu-access:${posStaffId}`, r); }
    } catch {
      const saved = await readCachedValue(`elimu-access:${posStaffId}`); // offline: show what this person could do last time
      if (saved?.ok) setState({ loaded: true, roles: saved.roles || [], actions: new Set(saved.actions || []), isOwner: !!saved.is_owner });
      else if (signedInOwner) setState({ loaded: true, roles: [], actions: actionsForRoles([], true), isOwner: true });
    }
  }, [posStaffId, signedInOwner]);
  useEffect(() => { refresh(); }, [refresh]);
  const value = useMemo(() => {
    const owner = !!signedInOwner || state.isOwner; const set = owner && !state.loaded ? actionsForRoles([], true) : state.actions;
    const tz = tenant?.time_zone || 'Africa/Nairobi';
    return {
      loaded: state.loaded, roles: state.roles, isOwner: owner, tenantId: tenant?.id || null, businessId: tenant?.business_id || null, schoolName: tenant?.business_name || '',
      userId: posStaffId, tz, today: () => todayInTz(tz), refresh,
      can: (a) => (!a ? true : set.has(a)), canAny: (list) => !list?.length || list.some((a) => set.has(a)),
    };
  }, [state, tenant, posStaffId, signedInOwner, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useElimu = () => useContext(Ctx);

/** Route guard: plain message instead of the page. The database still refuses the data. */
export function RequireElimu({ any, children }) {
  const { can, canAny, loaded } = useElimu();
  const ok = Array.isArray(any) ? canAny(any) : can(any);
  if (!loaded) return <div className="p-6 text-sm text-[#6F7461]">Loading…</div>;
  if (ok) return children;
  return (<div className="p-6 max-w-md mx-auto text-center"><p className="text-base font-semibold text-slate-800">You do not have access to this page</p><p className="text-sm text-slate-500 mt-1">Ask the school administrator if you need it.</p></div>);
}
