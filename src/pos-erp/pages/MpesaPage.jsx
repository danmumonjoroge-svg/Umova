// src/pos-erp/pages/MpesaPage.jsx
//
// Brief section 39/41 -- "M-Pesa" reconciliation view, under My Money.
// Bucketing (Received/Confirmed/Pending/Needs attention, then
// Matched/Unmatched/Pending/Failed lists) matches the brief's own
// example layout. Every figure here comes straight from
// lb_mpesa_transactions -- nothing is estimated or inferred, because
// this is exactly the screen section 39 warns not to guess on
// ("never assume STK request = payment", "never match transactions
// solely because amounts are identical").
//
// "Matched" here means genuinely matched: the row's own sale_id, set
// only by confirm_mpesa_payment() when Safaricom actually confirmed
// that specific request. Nothing on this page does its own amount-based
// matching -- there is no unmatched-PAID case in this design, because a
// sale is never created until the match already exists (see
// phase12_mpesa.sql). "Unmatched" is kept as a labelled section anyway,
// always empty under this design, so if a future change ever creates a
// PAID row with no sale_id, it becomes visible here rather than silently
// disappearing from view.

import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Loader2, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

const STATUS_META = {
  PENDING: { label: 'Pending', bg: 'bg-amber-50 text-amber-700', Icon: Clock },
  PAID: { label: 'Confirmed', bg: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', bg: 'bg-red-50 text-red-700', Icon: XCircle },
  CANCELLED: { label: 'Cancelled', bg: 'bg-red-50 text-red-700', Icon: XCircle },
  TIMED_OUT: { label: 'Timed out', bg: 'bg-slate-100 text-slate-500', Icon: Clock },
  NEEDS_ATTENTION: { label: 'Needs attention', bg: 'bg-amber-100 text-amber-800', Icon: AlertTriangle },
};

export default function MpesaPage() {
  const { tenant } = usePosErpAuth();
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true); setError('');
    try {
      setRows(await mpesaService.getForDate({ businessId: tenant.business_id, date }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant, date]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((acc, r) => {
    acc.received += Number(r.amount || 0);
    if (r.status === 'PAID') acc.confirmed += Number(r.amount || 0);
    if (r.status === 'PENDING') acc.pending += Number(r.amount || 0);
    if (r.status === 'NEEDS_ATTENTION') acc.needsAttention += Number(r.amount || 0);
    return acc;
  }, { received: 0, confirmed: 0, pending: 0, needsAttention: 0 });

  const matched = rows.filter(r => r.status === 'PAID' && r.sale_id);
  const unmatched = rows.filter(r => r.status === 'PAID' && !r.sale_id); // see header note -- expected to always be empty under this design
  const pending = rows.filter(r => r.status === 'PENDING');
  const failed = rows.filter(r => ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(r.status));
  const needsAttention = rows.filter(r => r.status === 'NEEDS_ATTENTION');

  const handleGiveUp = async (row) => {
    setBusyId(row.id);
    try {
      await mpesaService.markNeedsAttention(row.id, 'Marked by owner from the M-Pesa screen');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Smartphone size={22} className="text-emerald-700" /> M-Pesa
        </h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Received</div>
          <div className="text-xl font-black text-slate-800">{fmt(totals.received)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Confirmed</div>
          <div className="text-xl font-black text-emerald-700">{fmt(totals.confirmed)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Pending</div>
          <div className="text-xl font-black text-amber-700">{fmt(totals.pending)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Needs attention</div>
          <div className="text-xl font-black text-red-600">{fmt(totals.needsAttention)}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-500"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
      ) : (
        <div className="space-y-6">
          <Section title={`Matched (${matched.length})`} empty="No confirmed payments yet today.">
            {matched.map(r => (
              <Row key={r.id} r={r} extra={r.sale ? `Sale #${r.sale.sale_number}` : null} />
            ))}
          </Section>

          {unmatched.length > 0 && (
            <Section title={`Unmatched (${unmatched.length})`} tone="amber" empty="">
              {unmatched.map(r => <Row key={r.id} r={r} extra="No matching sale — check this manually" />)}
            </Section>
          )}

          <Section title={`Pending (${pending.length})`} empty="Nothing waiting on a customer right now.">
            {pending.map(r => (
              <Row key={r.id} r={r} extra="Waiting for confirmation"
                action={<button disabled={busyId === r.id} onClick={() => handleGiveUp(r)} className="text-xs font-bold text-slate-500 hover:text-red-600">
                  {busyId === r.id ? 'Saving…' : "Give up on this"}
                </button>} />
            ))}
          </Section>

          {needsAttention.length > 0 && (
            <Section title={`Needs attention (${needsAttention.length})`} tone="amber" empty="">
              {needsAttention.map(r => <Row key={r.id} r={r} extra={r.result_desc} />)}
            </Section>
          )}

          <Section title={`Failed / Cancelled (${failed.length})`} empty="No failed payments today.">
            {failed.map(r => <Row key={r.id} r={r} extra={r.result_desc} />)}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, empty }) {
  const items = React.Children.toArray(children);
  return (
    <div>
      <h2 className="font-bold text-slate-700 mb-2 text-sm uppercase tracking-wide">{title}</h2>
      <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-100">
        {items.length === 0 ? <div className="px-4 py-6 text-center text-slate-400 text-sm">{empty}</div> : items}
      </div>
    </div>
  );
}

function Row({ r, extra, action }) {
  const meta = STATUS_META[r.status] || STATUS_META.PENDING;
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-800">
          KES {(Number(r.amount) || 0).toLocaleString()} — {r.customer?.name || r.phone}
        </div>
        <div className="text-xs text-slate-400">
          {new Date(r.requested_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          {r.mpesa_receipt_number ? ` · ${r.mpesa_receipt_number}` : ''}
          {extra ? ` · ${extra}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${meta.bg}`}>
          <meta.Icon size={11} /> {meta.label}
        </span>
      </div>
    </div>
  );
}
