// src/pos-erp/hooks/useMpesaPayment.js
//
// Drives the "Send M-Pesa Request" -> "Waiting..." -> "Paid"/"Failed" UI
// in POSPage. Uses Supabase Realtime to hear about the status change the
// instant confirm_mpesa_payment() (called from the callback Edge
// Function) updates the row -- no client-side polling loop needed as the
// primary path, though mpesaService.pollStatus() exists as a fallback if
// realtime isn't reachable on a given network.

import { useState, useCallback, useRef, useEffect } from 'react';
import { posSupabase as supabase } from '../services/posSupabaseClient';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useMpesaPayment() {
  const { staffId, tenant, posStaffId } = usePosErpAuth();
  // 'idle' | 'sending' | 'pending' | 'paid' | 'failed'
  const [phase, setPhase] = useState('idle');
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState('');
  const channelRef = useRef(null);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle'); setTransaction(null); setError('');
  }, [cleanup]);

  const send = useCallback(async ({ phone, amount, cartSnapshot, customerId, shiftId }) => {
    setError('');
    setPhase('sending');
    try {
      const txn = await mpesaService.requestPayment({
        tenantId: tenant?.id, businessId: tenant?.business_id, phone, amount, cartSnapshot,
        customerId, shiftId, requestedBy: staffId,
      });
      setTransaction(txn);
      setPhase('pending');

      // Listen for the row this Edge Function will update once
      // Safaricom calls back. Section 37: only THIS event moves the UI
      // to Paid -- nothing here assumes success just because the
      // request was sent.
      const channel = supabase
        .channel(`mpesa-${txn.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lb_mpesa_transactions', filter: `id=eq.${txn.id}` }, (payload) => {
          const row = payload.new;
          setTransaction(row);
          if (row.status === 'PAID') setPhase('paid');
          else if (['FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_ATTENTION'].includes(row.status)) setPhase('failed');
        })
        .subscribe();
      channelRef.current = channel;

      return txn;
    } catch (err) {
      setError(err.message);
      setPhase('idle');
      throw err;
    }
  }, [tenant, staffId]);

  /** Manual re-check, for a cashier who doesn't trust the spinner (or realtime genuinely didn't fire). */
  const refresh = useCallback(async () => {
    if (!transaction?.id) return;
    const row = await mpesaService.pollStatus(transaction.id);
    setTransaction(row);
    if (row.status === 'PAID') setPhase('paid');
    else if (['FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_ATTENTION'].includes(row.status)) setPhase('failed');
  }, [transaction]);

  return { phase, transaction, error, send, refresh, reset };
}
