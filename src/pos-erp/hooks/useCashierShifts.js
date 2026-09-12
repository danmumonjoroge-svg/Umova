// src/pos-erp/hooks/useCashierShifts.js
//
// FIXED: openShift() never generated shift_number, which
// lb_cashier_shifts requires as NOT NULL with no database-side default
// or sequence (confirmed via information_schema — the column genuinely
// expects the application to supply it). Every openShift() call was
// failing with a 23502 not-null-violation before a shift could ever be
// created.
//
// Format: SH-<tenant business_code>-<YYYYMMDDHHmmss>. Timestamp-based
// rather than a counted sequence (SH-0001, SH-0002...) to avoid a
// race condition between two cashiers opening shifts at the same
// moment without a DB-side sequence to serialize on. If you want true
// sequential per-tenant numbering later, that needs a Postgres
// sequence or a SERIALIZABLE-safe RPC — not something to fake
// client-side.

import { useState, useEffect, useCallback } from 'react';
import { cashierService } from '../services/cashierService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

function generateShiftNumber(tenant) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const prefix = tenant?.business_code ? tenant.business_code.toUpperCase() : 'SH';
  return `${prefix}-${stamp}`;
}

export function useCashierShifts() {
  const { staffId, tenant } = usePosErpAuth();
  const [shifts, setShifts] = useState([]);
  const [activeShift, setActiveShift] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const data = await cashierService.getShifts();
    setShifts(data || []);
    setActiveShift(data?.find(s => s.status === 'OPEN' && s.cashier_id === staffId) || null);
    setLoading(false);
  }, [staffId]);

  useEffect(() => { fetch(); }, [fetch]);

  const openShift = useCallback(async (openingFloat) => {
    const result = await cashierService.openShift({
      cashier_id: staffId,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      shift_number: generateShiftNumber(tenant),
      opening_float: openingFloat,
      status: 'OPEN'
    });
    setActiveShift(result);
    setShifts(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const closeShift = useCallback(async (actualCash, closingFloat, notes) => {
    if (!activeShift) return;
    const result = await cashierService.closeShift(activeShift.id, { actualCash, closingFloat, notes });
    setActiveShift(null);
    setShifts(prev => prev.map(s => s.id === result.id ? result : s));
    return result;
  }, [activeShift]);

  // FIXED: was never stamping business_id — see the fuller explanation in
  // schema/phase4_daily_closing_cash_fix.sql, which fixes the matching
  // half of this on the RPC side (perform_daily_closing() was filtering
  // cash movements on branch_id, which is always NULL in this
  // no-branches design, so NULL = NULL never matched and daily-closing
  // cash totals were always zero regardless of what got logged here).
  const cashMovement = useCallback(async (type, amount, reason) => {
    if (!activeShift) return;
    await cashierService.addCashMovement({
      shift_id: activeShift.id, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null,
      movement_type: type, amount, reason, created_by: staffId
    });
  }, [activeShift, staffId, tenant]);

  return { shifts, activeShift, loading, fetch, openShift, closeShift, cashMovement };
}
