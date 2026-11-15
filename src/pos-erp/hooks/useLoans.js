// src/pos-erp/hooks/useLoans.js
//
// Loads the business's loans. Before loading, it brings automatic (standing order / deduction) instalments up to date, but only
// for someone who may record expenses (the database would skip it for anyone else anyway), and only when online.

import { useState, useEffect, useCallback } from 'react';
import { loanService } from '../services/loanService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { usePermissions } from '../navigation/PermissionsContext';
import { mapLoanError, loanTotals } from '../utils/loanHelpers';
import { isOfflineNow } from '../offline/netErrors';

export function useLoans() {
  const { tenant } = usePosErpAuth();
  const { can } = usePermissions();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const canRecord = can('expenses.record');

  const fetch = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true);
    setError(null);
    try {
      if (canRecord && !isOfflineNow()) {
        try { await loanService.postDue(tenant.business_id); } catch (e) { console.warn('[useLoans] auto-post skipped:', e?.message || e); }
      }
      setLoans(await loanService.getAll({ businessId: tenant.business_id }));
    } catch (err) {
      console.error('[useLoans] fetch failed:', err);
      setError(mapLoanError(err));
    } finally {
      setLoading(false);
    }
  }, [tenant?.business_id, canRecord]);

  useEffect(() => { fetch(); }, [fetch]);

  return { loans, totals: loanTotals(loans), loading, error, refetch: fetch };
}
