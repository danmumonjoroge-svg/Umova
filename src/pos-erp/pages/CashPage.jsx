// src/pos-erp/pages/CashPage.jsx
//
// Phase 4 — cash management (brief §38), the piece of it that doesn't
// live inside the till itself: logging a cash-in/cash-out against the
// active shift (useCashierShifts.cashMovement() already existed but
// wasn't called from anywhere — same "service exists, no UI" pattern as
// Payables in Phase 3), shift history, and daily closing
// (perform_daily_closing() — already existed, never surfaced).

import React, { useState, useEffect, useCallback } from 'react';
import { Wallet, Loader2, ArrowDownCircle, ArrowUpCircle, CheckCircle2 } from 'lucide-react';
import { useCashierShifts } from '../hooks/useCashierShifts';
import { cashierService } from '../services/cashierService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CashPage() {
  const { tenant, staffId } = usePosErpAuth();
  const { activeShift, shifts, loading, cashMovement } = useCashierShifts();

  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movType, setMovType] = useState('CASH_OUT');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [movError, setMovError] = useState('');
  const [movSaving, setMovSaving] = useState(false);

  const [closings, setClosings] = useState([]);
  const [closingBusy, setClosingBusy] = useState(false);
  const [closingError, setClosingError] = useState('');
  const [closingDate, setClosingDate] = useState(new Date().toISOString().slice(0, 10));

  const loadMovements = useCallback(async () => {
    if (!activeShift) { setMovements([]); return; }
    setMovementsLoading(true);
    try {
      setMovements(await cashierService.getCashMovements(activeShift.id));
    } catch (err) {
      console.error('[CashPage] movements fetch failed:', err);
    } finally {
      setMovementsLoading(false);
    }
  }, [activeShift]);

  const loadClosings = useCallback(async () => {
    if (!tenant?.business_id) return;
    try {
      setClosings(await cashierService.getDailyClosings({ businessId: tenant.business_id }));
    } catch (err) {
      console.error('[CashPage] closings fetch failed:', err);
    }
  }, [tenant]);

  useEffect(() => { loadMovements(); }, [loadMovements]);
  useEffect(() => { loadClosings(); }, [loadClosings]);

  const submitMovement = async (e) => {
    e.preventDefault();
    setMovError('');
    if (!movAmount || Number(movAmount) <= 0) {
      setMovError('Enter a valid amount.');
      return;
    }
    setMovSaving(true);
    try {
      await cashMovement(movType, Number(movAmount), movReason || null);
      setMovAmount(''); setMovReason('');
      loadMovements();
    } catch (err) {
      setMovError(err.message || 'Failed to log movement.');
    } finally {
      setMovSaving(false);
    }
  };

  const runDailyClosing = async () => {
    if (!tenant?.business_id) return;
    setClosingBusy(true);
    setClosingError('');
    try {
      await cashierService.performDailyClosing({
        businessId: tenant.business_id,
        closingDate,
        closedBy: staffId,
      });
      loadClosings();
    } catch (err) {
      setClosingError(err.message || 'Failed to perform daily closing.');
    } finally {
      setClosingBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Wallet size={22} className="text-amber-600" /> My Money
        </h1>
        <p className="text-slate-500 text-sm">Cash in/out against the active shift, and end-of-day closing.</p>
      </div>

      {/* Active shift + cash movements */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-bold text-slate-800 mb-3">Active Shift</h2>
        {!activeShift ? (
          <p className="text-sm text-slate-500">No shift is currently open — open one from the Till to log cash movements.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Shift</div>
                <div className="font-semibold text-slate-800">{activeShift.shift_number}</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Opening float</div>
                <div className="font-semibold text-slate-800">{fmt(activeShift.opening_float)}</div>
              </div>
            </div>

            <form onSubmit={submitMovement} className="flex flex-wrap gap-2 items-end mb-4">
              {movError && <div className="w-full bg-red-50 text-red-700 text-sm rounded px-3 py-2">{movError}</div>}
              <select value={movType} onChange={e => setMovType(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm">
                <option value="CASH_IN">Cash In</option>
                <option value="CASH_OUT">Cash Out</option>
                <option value="PETTY_CASH">Petty Cash</option>
              </select>
              <input
                required type="number" step="0.01" min="0.01" placeholder="Amount"
                value={movAmount} onChange={e => setMovAmount(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm w-32"
              />
              <input
                placeholder="Reason" value={movReason} onChange={e => setMovReason(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-[140px]"
              />
              <button type="submit" disabled={movSaving} className="bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-60">
                {movSaving ? 'Saving…' : 'Log'}
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {movementsLoading && <div className="text-sm text-slate-400 py-3"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading…</div>}
              {!movementsLoading && movements.length === 0 && <div className="text-sm text-slate-400 py-3">No cash movements logged this shift.</div>}
              {movements.map(m => (
                <div key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    {m.movement_type === 'CASH_IN'
                      ? <ArrowUpCircle size={15} className="text-emerald-600" />
                      : <ArrowDownCircle size={15} className="text-red-500" />}
                    <span className="text-slate-700">{m.movement_type.replace('_', ' ')}</span>
                    {m.reason && <span className="text-slate-400">— {m.reason}</span>}
                  </div>
                  <span className="font-semibold text-slate-800">{fmt(m.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Daily closing */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-bold text-slate-800 mb-1">Daily Closing</h2>
        <p className="text-sm text-slate-500 mb-4">
          Rolls up sales, payments, expenses, refunds and cash movements for one day. Can only be run once per day — running it again for an already-closed date will fail.
        </p>
        {closingError && <div className="mb-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{closingError}</div>}
        <div className="flex items-end gap-2 mb-5">
          <input type="date" value={closingDate} onChange={e => setClosingDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          <button
            onClick={runDailyClosing}
            disabled={closingBusy || !tenant?.business_id}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-60"
          >
            <CheckCircle2 size={15} /> {closingBusy ? 'Closing…' : 'Close Day'}
          </button>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Sales</th>
              <th className="text-right px-3 py-2">Cash</th><th className="text-right px-3 py-2">Expenses</th>
              <th className="text-right px-3 py-2">Refunds</th><th className="text-center px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {closings.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-slate-400">No closings yet.</td></tr>
            )}
            {closings.map(c => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.closing_date}</td>
                <td className="px-3 py-2 text-right">{fmt(c.total_sales)}</td>
                <td className="px-3 py-2 text-right">{fmt(c.total_cash_payments)}</td>
                <td className="px-3 py-2 text-right">{fmt(c.total_expenses)}</td>
                <td className="px-3 py-2 text-right">{fmt(c.total_refunds)}</td>
                <td className="px-3 py-2 text-center">
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
