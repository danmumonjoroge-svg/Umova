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
// Offline mode: the till can find, open and keep selling on a shift with no internet. See offline/offlineShift.js.
import { isNetworkFailure } from '../offline/netErrors';
import { cacheActiveShift, getCachedActiveShift, queueShiftOpen, unsentForShift } from '../offline/offlineShift';

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
    try {
      const data = await cashierService.getShifts();
      let active = data?.find(s => s.status === 'OPEN' && s.cashier_id === staffId) || null;
      // A shift opened offline that the server does not have yet is still the active one.
      if (!active) {
        const cached = await getCachedActiveShift(staffId);
        if (cached?._local && cached.status === 'OPEN' && !data?.some(s => s.id === cached.id)) active = cached;
      }
      setShifts(data || []);
      setActiveShift(active);
      await cacheActiveShift(staffId, active); // remembered for the next time the phone has no internet
    } catch (err) {
      if (!isNetworkFailure(err)) { console.error('[useCashierShifts] fetch failed:', err); }
      // No internet: carry on with the shift this phone last knew about, so selling is not blocked.
      const cached = await getCachedActiveShift(staffId);
      if (cached?.status === 'OPEN') { setActiveShift(cached); setShifts((prev) => (prev.length ? prev : [cached])); }
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => { fetch(); }, [fetch]);

  const openShift = useCallback(async (openingFloat) => {
    const shift_number = generateShiftNumber(tenant);
    let result;
    try {
      if (isNetworkFailure(null)) throw new Error('Failed to fetch'); // phone says it has no connection: do not wait for a timeout
      result = await cashierService.openShift({
        cashier_id: staffId,
        tenant_id: tenant?.id,
        business_id: tenant?.business_id ?? null,
        shift_number,
        opening_float: openingFloat,
        status: 'OPEN'
      });
      await cacheActiveShift(staffId, result);
    } catch (err) {
      if (!isNetworkFailure(err)) throw err; // a real refusal is shown to the cashier as before
      // No internet: open the shift on this phone. It is sent to the server first, before the sales that use it.
      result = await queueShiftOpen({ tenant, staffId, openingFloat, shiftNumber: shift_number });
    }
    setActiveShift(result);
    setShifts(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const closeShift = useCallback(async (actualCash, closingFloat, notes) => {
    if (!activeShift) return;
    // The server works out the expected cash from the sales IT has received, so every sale (and the shift itself) must
    // be sent first -- otherwise the figure would look fine while real sales were missing from it.
    const waiting = await unsentForShift(activeShift.id);
    if (waiting > 0) {
      throw new Error(`${waiting} saved item${waiting === 1 ? ' is' : 's are'} still waiting to be sent. Connect to the internet and wait for "Online · Up to date", then close the shift.`);
    }
    const result = await cashierService.closeShift(activeShift.id, { actualCash, closingFloat, notes });
    setActiveShift(null);
    await cacheActiveShift(staffId, null);
    setShifts(prev => prev.map(s => s.id === result.id ? result : s));
    return result;
  }, [activeShift, staffId]);

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
