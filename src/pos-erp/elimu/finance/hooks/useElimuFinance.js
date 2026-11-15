// Supplies tenant / school / staff identity and permission checks from the EXISTING POS auth. No second auth or staff system.
// can() only decides what to SHOW; the database re-checks every action (elimu_fin_can in E001), so these are conveniences, not security.
import { useEffect, useMemo, useState } from 'react';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { financeApi } from '../services/financeApi';
import { ACTION_PERMS, canWith } from '../utils/permissions';

export { ACTION_PERMS, canWith };
export function useElimuFinance() {
  const { staffId, posStaffId, tenant } = usePosErpAuth();
  // Elimu roles (one table for every Elimu module): the screen asks the database what this person holds.
  const [access, setAccess] = useState(null);
  useEffect(() => { let live = true; financeApi.myAccess().then(a => live && setAccess(a)).catch(() => live && setAccess({ ok: false })); return () => { live = false; }; }, [posStaffId, staffId]);
  const perms = useMemo(() => ({ isOwner: !!access?.is_owner, actions: access?.actions || [] }), [access]);
  return useMemo(() => {
    const has = (p) => perms.actions.includes(p);
    return {
      api: financeApi, tenantId: tenant?.id, businessId: tenant?.business_id, staffId: posStaffId || staffId, school: tenant,
      can: (action) => canWith(has, action, !!perms?.isOwner), ready: !!tenant?.business_id && !!access,
    };
  }, [staffId, posStaffId, tenant, perms]);
}
