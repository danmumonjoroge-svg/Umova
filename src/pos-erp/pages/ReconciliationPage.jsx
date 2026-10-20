// End-of-day reconciliation: what the system says should be in the till and on M-Pesa, against what was
// actually counted. The expected figures come from the database; this page only collects the count.
// A difference needs a written reason, and a count is signed off by a second person (or the owner).
import React, { useCallback, useEffect, useState } from 'react';
import { reconcileService } from '../services/reconcileService';
import { usePermissions } from '../navigation/PermissionsContext';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayNairobi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const num = (v) => (v === '' || v == null ? null : Number(v));

function Row({ label, value, strong, minus }) {
  return (
    <div className={`flex justify-between text-sm ${strong ? 'font-bold border-t border-slate-200 pt-1 mt-1' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{minus ? '− ' : ''}{money(value)}</span>
    </div>
  );
}

export default function ReconciliationPage() {
  const { tenant } = usePosErpAuth();
  const { can } = usePermissions();
  const business = tenant?.business_id;
  const [date, setDate] = useState(todayNairobi());
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ opening: '', cash: '', mpesa: '', notes: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    setError('');
    try {
      const d = await reconcileService.preview(business, date);
      setData(d);
      const s = d.saved;
      setForm(s ? { opening: String(s.opening_float ?? ''), cash: String(s.counted_cash ?? ''), mpesa: String(s.counted_mpesa ?? ''), notes: s.notes || '' } : { opening: '', cash: '', mpesa: '', notes: '' });
      const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      setHistory(await reconcileService.list(business, from, todayNairobi()));
    } catch (e) { setError(e.message); setData(null); }
  }, [business, date]);
  useEffect(() => { load(); }, [load]);

  const e = data?.expected;
  const saved = data?.saved;
  const locked = saved?.status === 'SIGNED_OFF';
  const float = num(form.opening) || 0;
  const expCash = e ? float + Number(e.expected_cash) : 0;
  const varCash = form.cash === '' || !e ? null : Number(form.cash) - expCash;
  const varMp = form.mpesa === '' || !e ? null : Number(form.mpesa) - Number(e.expected_mpesa);

  const save = singleFlight('reconcile-save', async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      await reconcileService.save(business, date, num(form.opening) || 0, num(form.cash), num(form.mpesa), form.notes);
      setMsg('Saved. Someone else (or the owner) can now sign it off.'); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  });
  const signoff = singleFlight('reconcile-signoff', async () => {
    setBusy(true); setError(''); setMsg('');
    try { await reconcileService.signoff(saved.id); setMsg('Signed off. This day is now locked.'); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  });

  if (!can('finance.view')) return <div className="p-6 text-center text-sm text-slate-600">You do not have permission to reconcile cash and M-Pesa.</div>;
  if (!business) return <div className="p-6 text-center text-sm text-slate-600">No business is linked to this account yet.</div>;

  const bad = (v) => v != null && Math.abs(v) >= 0.5;
  return (
    <div className="p-4 max-w-3xl mx-auto space-y-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Close the day: cash and M-Pesa</h1>
        <p className="text-xs text-slate-500">Count what is in the till and on M-Pesa, and compare with what the system expects. Days run on Nairobi time.</p>
      </div>
      <label className="block text-sm">Day
        <input type="date" value={date} max={todayNairobi()} onChange={(ev) => setDate(ev.target.value)} className="ml-2 border border-slate-300 rounded-lg px-2 py-1" />
      </label>
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      {msg && <div role="status" className="text-sm bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl p-3">{msg}</div>}
      {e && (
        <>
          {(e.warnings || []).map((w, i) => <div key={i} className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-xl p-3">{w}</div>)}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-1">
              <p className="font-semibold text-slate-900">Cash the system expects</p>
              <Row label="Opening float (you enter)" value={float} />
              <Row label="Cash sales" value={e.cash_sales} />
              <Row label="Cash paid on folios" value={e.folio_cash} />
              <Row label="Cash put in" value={e.cash_in} />
              <Row label="Cash taken out" value={e.cash_out} minus />
              <Row label="Cash spending" value={e.cash_spending} minus />
              <Row label="Cash given back on reversals" value={e.reversal_cash_given_back} minus />
              <Row label="Expected in the till" value={expCash} strong />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-1">
              <p className="font-semibold text-slate-900">M-Pesa the system expects</p>
              <Row label="M-Pesa sales" value={e.mpesa_sales} />
              <Row label="M-Pesa paid on folios" value={e.folio_mpesa} />
              <Row label="To send back on reversals" value={e.reversal_mpesa_to_send} minus />
              <Row label="Expected on M-Pesa" value={e.expected_mpesa} strong />
              <p className="text-xs text-slate-500 pt-2">Card sales {money(e.card_sales)} · On credit {money(e.credit_sales)} (not counted above)</p>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
            <p className="font-semibold text-slate-900">What you counted</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[['opening', 'Opening float'], ['cash', 'Cash counted'], ['mpesa', 'M-Pesa balance counted']].map(([k, l]) => (
                <label key={k} className="text-sm">{l}
                  <input type="number" inputMode="decimal" min="0" step="0.01" disabled={locked} value={form[k]} onChange={(ev) => setForm({ ...form, [k]: ev.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2" />
                </label>
              ))}
            </div>
            {varCash != null && <p className={`text-sm font-semibold ${bad(varCash) ? 'text-red-700' : 'text-emerald-700'}`}>Cash: {bad(varCash) ? (varCash > 0 ? `${money(varCash)} over` : `${money(-varCash)} short`) : 'matches'}</p>}
            {varMp != null && <p className={`text-sm font-semibold ${bad(varMp) ? 'text-red-700' : 'text-emerald-700'}`}>M-Pesa: {bad(varMp) ? (varMp > 0 ? `${money(varMp)} over` : `${money(-varMp)} short`) : 'matches'}</p>}
            <label className="block text-sm">Notes {(bad(varCash) || bad(varMp)) && <span className="text-red-700">(required: explain the difference)</span>}
              <textarea rows={2} disabled={locked} value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2" />
            </label>
            <div className="flex gap-2 flex-wrap">
              {!locked && <button type="button" disabled={busy || form.cash === '' || form.mpesa === ''} onClick={save} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50">Save count</button>}
              {saved && !locked && <button type="button" disabled={busy} onClick={signoff} className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm disabled:opacity-50">Sign off</button>}
            </div>
            {saved && <p className="text-xs text-slate-500">Status: {locked ? 'Signed off (locked)' : 'Saved, waiting for sign-off'}</p>}
          </div>
        </>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl p-3">
        <p className="font-semibold text-slate-900 mb-2">Last 30 days</p>
        {history.length === 0 && <p className="text-sm text-slate-500">Nothing saved yet.</p>}
        {history.map((h) => (
          <button key={h.id} type="button" onClick={() => setDate(h.rec_date)} className="w-full text-left flex justify-between gap-2 text-sm py-1 border-b border-slate-100">
            <span>{h.rec_date} · {h.status === 'SIGNED_OFF' ? 'Signed off' : 'Waiting'}{h.self_signed ? ' (owner, own count)' : ''}</span>
            <span className={Math.abs(h.variance_cash) >= 0.5 || Math.abs(h.variance_mpesa) >= 0.5 ? 'text-red-700' : 'text-emerald-700'}>cash {money(h.variance_cash)} · M-Pesa {money(h.variance_mpesa)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
