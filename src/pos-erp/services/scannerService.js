// Universal Scanning Engine — Scanner Service
//
// Sits between the raw scan (camera/hardware/manual) and the business
// transaction. Responsible for:
//   - resolving the barcode to a product (via productResolverService)
//   - attaching current stock info for display (read-only)
//   - classifying the outcome (RESOLVED / NOT_FOUND / INACTIVE / ERROR)
//   - tenant-scoped scan-event audit logging
//
// It NEVER writes to lb_inventory or lb_stock_movements. That responsibility
// belongs to the existing sale/GRN/inventory services — see saleService.js,
// purchaseService.js and inventoryService.js.
//
// Every database call here goes through posSupabase (storage key
// sb-pos-auth-token) so the scanner shares the POS staff session with the
// rest of the POS services. Never import the main app's supabaseClient.

import { posSupabase as supabase } from './posSupabaseClient';
import { resolveBarcode } from './productResolverService';
import { SCAN_RESULTS } from '../constants/scannerModes';

// Error reasons surfaced to callers (never raw Supabase/PostgREST text).
export const SCAN_ERROR_REASONS = {
  INVALID_BARCODE: 'INVALID_BARCODE',
  AUTH_ERROR: 'AUTH_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
};

function isAuthError(err) {
  const status = err?.status;
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 401 ||
    code === 'PGRST301' || // JWT required / invalid
    code === 'PGRST303' || // JWT claims invalid
    msg.includes('jwt') ||
    msg.includes('not authenticated')
  );
}

/** Logs enough to identify the failing service — never keys, tokens or URLs. */
function logScanFailure(stage, err) {
  console.error(`[SCANNER] ${stage} failed:`, {
    client: 'posSupabase',
    status: err?.status ?? null,
    code: err?.code ?? null,
    message: err?.message ?? String(err),
    details: err?.details ?? null, // for FK/unique errors this names the constraint
    hint: err?.hint ?? null,
  });
}

/**
 * Full scan handling pipeline used by every module (POS, GRN, stocktake,
 * transfer, returns). Returns a consistent shape regardless of outcome.
 *
 * tenantId / businessId come from usePosErpAuth().tenant (tenant.id and
 * tenant.business_id) — the same values every other POS service stamps.
 */
export async function handleScan({
  barcode,
  scannerType,
  contextType,
  contextId,
  userId,
  tenantId,
  businessId,
}) {
  let outcome;
  try {
    const resolution = await resolveBarcode({ barcode });
    if (resolution.reason === 'INVALID_BARCODE') {
      outcome = {
        result: SCAN_RESULTS.ERROR,
        reason: SCAN_ERROR_REASONS.INVALID_BARCODE,
        barcode: resolution.barcode,
      };
    } else if (!resolution.found) {
      outcome = { result: SCAN_RESULTS.NOT_FOUND, barcode: resolution.barcode };
    } else if (resolution.reason === 'INACTIVE') {
      outcome = { result: SCAN_RESULTS.INACTIVE, barcode: resolution.barcode, product: resolution.product };
    } else {
      let stock = null;
      if (resolution.product.track_inventory) {
        stock = await getAvailableStock({ productId: resolution.product.id });
      }
      outcome = {
        result: SCAN_RESULTS.RESOLVED,
        barcode: resolution.barcode,
        product: resolution.product,
        packQuantity: resolution.packQuantity || 1,
        stock,
      };
    }
  } catch (err) {
    logScanFailure('barcode resolution', err);
    outcome = {
      result: SCAN_RESULTS.ERROR,
      reason: isAuthError(err) ? SCAN_ERROR_REASONS.AUTH_ERROR : SCAN_ERROR_REASONS.DATABASE_ERROR,
      barcode,
    };
  }

  // Fire-and-forget audit log; never let logging failures block the scan.
  logScanEvent({ userId, tenantId, businessId, barcode, scannerType, contextType, contextId, outcome }).catch(() => {});
  return outcome;
}

/** Read-only stock lookup for scan-time display. Never used for final posting. */
async function getAvailableStock({ productId }) {
  const { data, error } = await supabase
    .from('lb_inventory')
    .select('quantity, average_cost')
    .eq('product_id', productId)
    .maybeSingle();
  if (error) {
    // Stock is display-only: don't fail the scan, but don't hide the cause.
    logScanFailure('stock lookup', error);
    return null;
  }
  return data ? { quantity: data.quantity, averageCost: data.average_cost } : { quantity: 0, averageCost: 0 };
}

/**
 * Lightweight audit trail of scan events (barcode metadata only — never
 * camera frames). lb_scanner_events requires tenant_id and business_id
 * (NOT NULL, tenant-scoped RLS), so an event is only written when the POS
 * tenant context is present. Without it the event is skipped rather than
 * written untenanted. Failures are logged, never thrown.
 */
async function logScanEvent({ userId, tenantId, businessId, barcode, scannerType, contextType, contextId, outcome }) {
  if (!tenantId || !businessId) {
    console.warn('[SCANNER] scan event not logged: missing tenant/business context.');
    return;
  }
  const { error } = await supabase.from('lb_scanner_events').insert({
    tenant_id: tenantId,
    business_id: businessId,
    user_id: userId || null,
    barcode,
    format: outcome?.format || null,
    scanner_type: scannerType || 'MANUAL',
    context_type: contextType || null,
    context_id: contextId || null,
    result: outcome?.result || 'ERROR',
  });
  if (error) logScanFailure('scan event log', error);
}
