// What the signed-in staff member may do. Loaded from pos_my_permissions() (database truth).
//
// IMPORTANT: this only decides what to SHOW. The database refuses the action regardless
// (the existing permission triggers plus phases 28-32). If the permissions RPC is unavailable (migration not yet deployed
// or a network blip) `can()` returns true so a working business is never locked out of its own
// screens; the database is still the enforcement, and `loaded` tells you which case you are in.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { permissionService } from '../services/permissionService';
import { cacheValue, readCachedValue } from '../offline/offlineCache';

const Ctx = createContext({ loaded: false, role: null, isOwner: false, template: null, can: () => true, canAny: () => true, refresh: () => {} });

export function PermissionsProvider({ children }) {
  const { posStaffId, isOwner: signedInAsOwner } = usePosErpAuth();
  const [state, setState] = useState({ loaded: false, role: null, isOwner: false, template: null, set: new Set() });

  const refresh = useCallback(async () => {
    if (!posStaffId) { setState({ loaded: false, role: null, isOwner: false, template: null, set: new Set() }); return; }
    try {
      const r = await permissionService.my();
      if (r?.ok) {
        setState({ loaded: true, role: r.role, isOwner: !!r.is_owner, template: r.template, set: new Set(r.permissions || []) });
        cacheValue(`permissions:${posStaffId}`, r); // so the same screens show with no internet
      }
    } catch (err) {
      console.warn('[Permissions] not available yet:', err.message);
      // No internet: use what this person was last allowed (display only -- the database still decides every save).
      const saved = await readCachedValue(`permissions:${posStaffId}`);
      if (saved?.ok) { setState({ loaded: true, role: saved.role, isOwner: !!saved.is_owner, template: saved.template, set: new Set(saved.permissions || []) }); return; }
      setState((s) => (s.loaded ? s : { loaded: false, role: null, isOwner: false, template: null, set: new Set() }));
    }
  }, [posStaffId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2 * 60 * 1000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(t); window.removeEventListener('focus', refresh); };
  }, [refresh]);

  // The business owner always has every right (the sign-in record says so even when the permission list could not be
  // loaded, e.g. offline). This only decides what is SHOWN -- the database still decides every save.
  const owner = !!signedInAsOwner || state.isOwner;
  const value = useMemo(() => ({
    loaded: state.loaded,
    role: state.role,
    template: state.template,
    isOwner: owner,
    // '@owner' means "business owner only" (staff management has no permission key of its own).
    can: (p) => (!p || owner || !state.loaded ? true : p === '@owner' ? false : state.set.has(p)),
    canAny: (list) => (!list || !list.length || owner || !state.loaded ? true : list.some((p) => (p === '@owner' ? false : state.set.has(p)))),
    refresh,
  }), [state, refresh, owner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePermissions = () => useContext(Ctx);

/** Route guard: shows a plain "no access" message instead of the page. The database still refuses data. */
export function RequirePermission({ perm, children }) {
  const { can, canAny } = usePermissions();
  const ok = Array.isArray(perm) ? canAny(perm) : can(perm);
  if (ok) return children;
  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <p className="text-base font-semibold text-slate-800">You do not have access to this page</p>
      <p className="text-sm text-slate-500 mt-1">Ask the business owner if you need it.</p>
    </div>
  );
}
