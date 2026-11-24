// THE ADAPTOR SEAM. Every import from the host Umova / POS app lives in this one file; nothing else in elimu/ imports from outside
// elimu/ (except React and lucide-react). When Elimu is merged into the host, only these paths can need changing.
//
// Assumes the folder is placed at   src/pos-erp/elimu/   next to  services/, components/, navigation/, auth/  (as in the POS repo).
// Pure logic (utils/*.js, communication/*.js except the service) does NOT import this file, so it runs and is tested in plain Node.
import { posSupabase } from '../../services/posSupabaseClient';
import { usePermissions, RequirePermission } from '../../navigation/PermissionsContext';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { getRegisteredBusinessName } from '../../services/businessIdentity';
import { humanError } from '../utils/humanError.js';

export { staffService, generateTempPassword } from '../../services/staffService';
export { supplierService } from '../../services/supplierService.js';
export { purchaseOrderService, goodsReceivedService, supplierReturnService } from '../../services/purchaseService.js';
export const supabase = posSupabase;
export { usePermissions, RequirePermission, usePosErpAuth };

// Existing UI kit (cards, chips, sheets) so Elimu looks like the rest of Umova.
export * from '../../components/CardKit';
export { fieldClass } from '../../components/workspace/Sheet';
export { default as Sheet } from '../components/AppSheet.jsx';   // Elimu's own phone-friendly sheet (scrolls, keyboard- and notch-safe)
export { POSAuthProvider, usePOSAuth } from '../../context/POSAuthContext';
export { default as POSForcePasswordChange } from '../../auth/POSForcePasswordChange';
export { posPasskeys } from '../../auth/posPasskeys';
export { default as POSPasskeySettings } from '../../auth/POSPasskeySettings';
export { default as AppLock } from '../../../security/AppLock';
export { BRAND } from '../../theme/brand';

/** Current school context. The database stamps tenant_id/business_id itself; these are for display and cache keys only. */
export function useSchool() {
  const a = usePosErpAuth();
  return { tenantId: a.tenant?.id ?? null, businessId: a.tenant?.business_id ?? null, userId: a.posStaffId ?? null, staffName: a.staffName ?? null, schoolName: getRegisteredBusinessName() || a.tenant?.business_name || '' };
}

/** Throw a readable Error for a failed Supabase call. */
export function unwrap({ data, error }) {
  if (error) throw humanError(error);
  return data;
}
