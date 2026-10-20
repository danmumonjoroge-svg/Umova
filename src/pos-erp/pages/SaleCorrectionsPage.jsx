// Sale corrections: ask to reverse a sale, and approve or refuse requests.
// Nothing here changes a sale by itself: every action is a database function that checks who you are,
// and a reversal (stock, customer balance, payments, audit) runs as one all-or-nothing step.
import React, { useCallback, useEffect, useState } from 'react';
import { reversalService } from '../services/reversalService';
import { usePermissions } from '../navigation/PermissionsContext';
import { singleFlight } from '../utils/singleFlight';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (t) => (t ? new Date(t).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const BADGE = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-red-100 text-red-800', CANCELLED: 'bg-slate-100 text-slate-600' };
const WORD = { PENDING: 'Waiting', APPROVED: 'Reversed', REJECTED: 'Refused', CANCELLED: 'Cancelled' };

export default function SaleCorrectionsPage() {
  const { can } = usePermissions();
  const [tab, setTab] = useState('requests');
  const [requests, setRequests] = useState(null);
  const [sales, setSales] = useState(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // result of the last approval, shown until dismissed

  const loadRequests = useCallback(async () => {
    try { setRequests(await reversalService.list()); } catch (e) { setError(e.message); setRequests([]); }
  }, []);
  const loadSales = useCallback(async () => {
    try { setSales(await reversalService.recentSales(search)); } catch (e) { setError(e.message); setSales([]); }
  }, [search]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { if (tab === 'new') loadSales(); }, [tab, loadSales]);

  const act = singleFlight('SaleCorrectionsPage.act', async (fn, after) => {
    setBusy(true); setError('');
    try { const r = await fn(); await loadRequests(); if (after) after(r); } catch (e) { setError(e.message); } finally { setBusy(false); }
  });

  const submitRequest = () => act(() => reversalService.request(picked.id, reason), () => { setPicked(null); setReason(''); setTab('requests'); });
  const isApprover = can('refunds.approve');

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Sale corrections</h1>
        <p className="text-xs text-slate-500">A sale is never edited or deleted. A correction is asked for, approved by a manager or the owner, and kept on record.</p>
      </div>
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      {done && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1">
          <p className="font-semibold text-emerald-900">Sale reversed. Stock and records are updated.</p>
          {(done.warnings || []).length > 0 && <p className="font-semibold text-amber-800">Still to do by hand:</p>}
          <ul className="list-disc pl-5 text-amber-900">{(done.warnings || []).map((w, i) => <li key={i}>{String(w).replace(/^[A-Z_]+:\s*/, '')}</li>)}</ul>
          <button type="button" onClick={() => setDone(null)} className="text-xs font-semibold underline text-emerald-900">Dismiss</button>
        </div>
      )}
      <div className="flex gap-2">
        {[['requests', 'Requests'], ['new', 'Ask to reverse a sale']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 min-h-[40px] rounded-xl text-sm font-semibold border ${tab === k ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white border-slate-300 text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab === 'new' && (
        <div className="space-y-2">
          {picked ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
              <p className="text-sm font-semibold">{picked.sale_number} · {money(picked.total_amount)}</p>
              <label className="block text-sm text-slate-700" htmlFor="rev-reason">Why does this sale need to be reversed?</label>
              <textarea id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-xl p-2 text-sm" placeholder="e.g. Customer returned the goods" />
              <div className="flex gap-2">
                <button type="button" disabled={busy || reason.trim().length < 5} onClick={submitRequest} className="bg-emerald-800 text-white text-sm font-semibold px-4 min-h-[44px] rounded-xl disabled:opacity-50">Send request</button>
                <button type="button" onClick={() => { setPicked(null); setReason(''); }} className="text-sm font-semibold px-4 min-h-[44px] rounded-xl border border-slate-300">Back</button>
              </div>
            </div>
          ) : (
            <>
              <input aria-label="Search by sale number" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by sale number, e.g. S-000123" className="w-full border border-slate-300 rounded-xl px-3 min-h-[44px] text-sm" />
              {sales === null && <p className="text-sm text-slate-500">Loading…</p>}
              {sales && sales.length === 0 && <p className="text-sm text-slate-500">No sales found. {isApprover ? '' : 'You can only ask about your own sales from the last 24 hours.'}</p>}
              {(sales || []).map((s) => (
                <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold text-sm">{s.sale_number}</p><p className="text-xs text-slate-500">{when(s.completed_at)} · {money(s.total_amount)}</p></div>
                  {s.on_folio ? <span className="text-xs text-slate-500">On a folio: change it there</span>
                    : s.live_request ? <span className="text-xs text-amber-700">Request already made</span>
                    : <button type="button" onClick={() => setPicked(s)} className="text-sm font-semibold px-3 min-h-[40px] rounded-lg border border-slate-300 hover:bg-slate-50">Reverse…</button>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-2">
          {requests === null && <p className="text-sm text-slate-500">Loading…</p>}
          {requests && requests.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}
          {(requests || []).map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-sm">{r.sale_number} · {money(r.sale_total)}</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BADGE[r.status]}`}>{WORD[r.status] || r.status}</span>
              </div>
              <p className="text-sm text-slate-700">“{r.reason}”</p>
              <p className="text-xs text-slate-500">Asked by {r.requested_by_name || 'staff'} · {when(r.requested_at)}
                {r.decided_at && ` · ${WORD[r.status]} by ${r.decided_by_name || 'staff'}${r.self_approved ? ' (their own request)' : ''}`}</p>
              {r.decision_note && <p className="text-xs text-slate-600">Note: {r.decision_note}</p>}
              {r.status === 'APPROVED' && (r.warnings || []).length > 0 && (
                <ul className="list-disc pl-5 text-xs text-amber-800">{r.warnings.map((w, i) => <li key={i}>{String(w).replace(/^[A-Z_]+:\s*/, '')}</li>)}</ul>
              )}
              {r.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2 items-center pt-1">
                  {isApprover && (
                    <>
                      <input aria-label="Note" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="Note (needed to refuse)" className="flex-1 min-w-[140px] border border-slate-300 rounded-lg px-2 min-h-[40px] text-sm" />
                      <button type="button" disabled={busy} onClick={() => act(() => reversalService.approve(r.id, note[r.id]), setDone)} className="bg-emerald-800 text-white text-sm font-semibold px-3 min-h-[40px] rounded-lg disabled:opacity-50">Approve</button>
                      <button type="button" disabled={busy || (note[r.id] || '').trim().length < 3} onClick={() => act(() => reversalService.refuse(r.id, note[r.id]))} className="text-sm font-semibold px-3 min-h-[40px] rounded-lg border border-red-300 text-red-800 disabled:opacity-50">Refuse</button>
                    </>
                  )}
                  {r.mine && <button type="button" disabled={busy} onClick={() => act(() => reversalService.cancel(r.id))} className="text-sm font-semibold px-3 min-h-[40px] rounded-lg border border-slate-300">Cancel request</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
