// src/pos-erp/hooks/useMpesaPayment.js
//
// Drives the "Send M-Pesa Request" -> "Waiting..." -> "Paid"/"Failed" UI in POSPage.
//
// How the till hears about the result (three independent paths, any one is enough):
//   1. Supabase Realtime pushes the row the instant confirm_mpesa_payment() updates it
//      (needs schema/phase46_mpesa_realtime.sql -- the table must be in the realtime publication).
//   2. A fast poll (2s, then 4s) reads the row. Every read has a timeout, so a request that hung while the phone
//      was busy with the PIN prompt can never freeze the screen. Failures are counted and shown, not hidden.
//   3. The moment the tab/app comes back to the foreground (or the network returns) the row is re-read at once.
//      This is the case that used to leave the spinner stuck: the buyer types their PIN, the browser was
//      paused in the background, and nothing re-checked when the cashier came back.
//
// Nothing here ever decides a payment succeeded: the UI only mirrors the status the trusted callback wrote.
//
// Survives a page refresh: when a prompt is sent, the cart and the request id are saved on this device
// (see mpesaInflight below). On the next load the till picks the request up again -- still waiting, already paid
// (receipt shown, nothing to re-select) or failed (cart restored) -- instead of an empty screen.

import { useState, useCallback, useRef, useEffect } from 'react';
import { posSupabase as supabase } from '../services/posSupabaseClient';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

const GIVE_UP_AFTER_MS = 75000;        // no answer from the buyer (Safaricom's own prompt lasts about a minute): set aside as NEEDS_ATTENTION (late success still applies)
const READ_TIMEOUT_MS = 8000;          // one status read may never hang the till
const FAILED_STATUSES = ['FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_ATTENTION'];
const WATCH_AFTER_FAIL_MS = 10 * 60 * 1000; // keep a slow eye on an "uncertain" request: a late confirmation flips it to Paid
const INFLIGHT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// ---------- the in-flight request, remembered on this device ----------
const inflightKey = (tenantId) => `pos_mpesa_inflight_v1:${tenantId || 'none'}`;
export const mpesaInflight = {
  save(tenantId, data) { try { localStorage.setItem(inflightKey(tenantId), JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* storage full/blocked: the till still works, it just cannot resume after a refresh */ } },
  read(tenantId) {
    try {
      const v = JSON.parse(localStorage.getItem(inflightKey(tenantId)) || 'null');
      if (!v?.txnId) return null;
      if (Date.now() - (v.savedAt || 0) > INFLIGHT_MAX_AGE_MS) { this.clear(tenantId); return null; }
      return v;
    } catch { return null; }
  },
  clear(tenantId) { try { localStorage.removeItem(inflightKey(tenantId)); } catch { /* ignore */ } },
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export function useMpesaPayment() {
  const { staffId, tenant } = usePosErpAuth();
  // 'idle' | 'sending' | 'pending' | 'paid' | 'failed'
  const [phase, setPhase] = useState('idle');
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState('');
  const [connectionIssue, setConnectionIssue] = useState(false); // several status reads in a row failed
  const channelRef = useRef(null);
  const failsRef = useRef(0);
  const startedAtRef = useRef(0);
  const phaseRef = useRef('idle');
  phaseRef.current = phase;
  const txnRef = useRef(null);
  txnRef.current = transaction;

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);
  useEffect(() => () => cleanup(), [cleanup]);

  /** Apply a row (from realtime, a poll or a resume) to the screen. Idempotent; a settled "paid" never goes backwards. */
  const apply = useCallback((row) => {
    if (!row) return;
    if (phaseRef.current === 'paid') return;
    setTransaction(row);
    if (row.status === 'PAID') setPhase('paid');
    else if (FAILED_STATUSES.includes(row.status)) setPhase('failed');
    else setPhase('pending');
  }, []);

  const reset = useCallback(() => {
    cleanup();
    const saved = mpesaInflight.read(tenant?.id);
    if (saved && (!txnRef.current?.id || saved.txnId === txnRef.current.id)) mpesaInflight.clear(tenant?.id);
    failsRef.current = 0;
    phaseRef.current = 'idle'; txnRef.current = null;
    setPhase('idle'); setTransaction(null); setError(''); setConnectionIssue(false);
  }, [cleanup, tenant?.id]);

  /** Start (or restart) the realtime listener for one request. */
  const listen = useCallback((txnId) => {
    cleanup();
    channelRef.current = supabase
      .channel(`mpesa-${txnId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lb_mpesa_transactions', filter: `id=eq.${txnId}` }, (payload) => apply(payload.new))
      .subscribe();
  }, [cleanup, apply]);

  const send = useCallback(async ({ phone, amount, cartSnapshot, customerId, shiftId, rentInvoiceId, folioId, resumeState }) => {
    // One live request at a time: a double tap, or a second prompt while the first is unresolved, must never
    // reach Safaricom twice for the same sale.
    if (phaseRef.current === 'sending' || phaseRef.current === 'pending') return txnRef.current;
    setError(''); setConnectionIssue(false); failsRef.current = 0;
    setPhase('sending');
    try {
      const txn = await mpesaService.requestPayment({
        tenantId: tenant?.id, businessId: tenant?.business_id, phone, amount, cartSnapshot,
        customerId, shiftId, rentInvoiceId, folioId, requestedBy: staffId,
      });
      startedAtRef.current = Date.now();
      // Remember the request AND the cart on this device, so a refresh does not throw the sale away.
      // Only the till passes resumeState; the invoices page (rent) must not leave a note for the till to pick up.
      if (resumeState) mpesaInflight.save(tenant?.id, { txnId: txn.id, ...resumeState });
      setTransaction(txn);
      setPhase('pending');
      listen(txn.id);
      return txn;
    } catch (err) {
      setError(err.message);
      setPhase('idle');
      throw err;
    }
  }, [tenant, staffId, listen]);

  /** One status read. Never throws; returns the row or null. Counts consecutive failures so the screen can say so. */
  const readOnce = useCallback(async () => {
    const id = txnRef.current?.id;
    if (!id) return null;
    try {
      const row = await withTimeout(mpesaService.pollStatus(id), READ_TIMEOUT_MS);
      failsRef.current = 0; setConnectionIssue(false);
      apply(row);
      return row;
    } catch (err) {
      failsRef.current += 1;
      if (failsRef.current >= 3) setConnectionIssue(true);
      console.warn('[M-Pesa] status read failed:', err?.message || err);
      return null;
    }
  }, [apply]);

  /** Manual re-check (the "Check now" link). */
  const refresh = readOnce;

  /**
   * Pick a request up after a refresh / re-open. Returns { state, row, saved } so the page can restore the cart:
   *   state 'none'    nothing was in flight
   *   state 'pending' still waiting (keep watching)
   *   state 'paid'    the sale was recorded while the page was away
   *   state 'failed'  declined / cancelled / no answer
   */
  const resume = useCallback(async () => {
    const saved = mpesaInflight.read(tenant?.id);
    if (!saved) return { state: 'none' };
    try {
      const row = await withTimeout(mpesaService.getById(saved.txnId), 10000);
      startedAtRef.current = new Date(row.requested_at || saved.savedAt).getTime();
      setTransaction(row);
      if (row.status === 'PAID') { setPhase('paid'); return { state: 'paid', row, saved }; }
      if (FAILED_STATUSES.includes(row.status)) { setPhase('failed'); listen(row.id); return { state: 'failed', row, saved }; }
      setPhase('pending'); listen(row.id);
      return { state: 'pending', row, saved };
    } catch {
      // Could not reach the server right now: keep the memory, try again on the next load.
      return { state: 'none' };
    }
  }, [tenant?.id, listen]);

  // ---- Watch loop while a request is unresolved ----
  const txnId = transaction?.id;
  const status = transaction?.status;
  const watching = !!txnId && (phase === 'pending'
    || (phase === 'failed' && ['NEEDS_ATTENTION', 'TIMED_OUT'].includes(status)));
  useEffect(() => {
    if (!watching) return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (stopped) return;
      const age = Date.now() - (startedAtRef.current || Date.now());
      // No answer in time: set it aside (NOT "did not pay" -- a late success is still applied by the server).
      if (phaseRef.current === 'pending' && age > GIVE_UP_AFTER_MS) {
        try { await mpesaService.markNeedsAttention(txnId, 'No response from the buyer within 75 seconds. If they paid, a late confirmation is still recorded.'); } catch { /* already settled by the callback: the read below picks it up */ }
      }
      await readOnce();
      if (stopped) return;
      if (phaseRef.current === 'failed' && age > WATCH_AFTER_FAIL_MS) return; // stop watching an abandoned request
      const wait = phaseRef.current === 'failed' ? 6000 : age < 30000 ? 2000 : 4000;
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 1500);

    // Back in the foreground / network back: look straight away, do not wait for the next tick.
    const wake = () => { if (document.visibilityState !== 'hidden') { readOnce(); if (!channelRef.current) listen(txnId); } };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      stopped = true; clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, [watching, txnId, readOnce, listen]);

  /** The confirmed M-Pesa receipt code -- only ever set from the trusted callback result, never invented. */
  const confirmedCode = phase === 'paid' ? (transaction?.mpesa_receipt_number || '') : '';

  return { phase, transaction, error, connectionIssue, send, refresh, reset, resume, confirmedCode };
}
