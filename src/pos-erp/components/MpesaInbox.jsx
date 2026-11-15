// src/pos-erp/components/MpesaInbox.jsx
//
// "Received payments": money customers sent straight to the till / paybill (phase43). Joy sends KES 3,000; it appears here with
// her name and the M-Pesa code. The cashier taps the bill it belongs to (the system suggests them), presses "Clear bill",
// and the bill turns Paid. One code can only ever be used once: the database refuses a second use.
//   See the list / clear a bill : payments.record (cashier and up)
//   Set a payment aside / bring it back : payments.approve (manager, owner)
// Mounted on the M-Pesa page (My Money -> M-Pesa).

import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2, CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { usePermissions } from '../navigation/PermissionsContext';
import { singleFlight } from '../utils/singleFlight';

const kes = (n) => `KES ${(Number(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (t) => new Date(t).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATE = {
  NEW: ['Waiting for a bill', 'bg-[#FBF0CC] text-[#7A5A0E]'],
  PARTLY_USED: ['Part used', 'bg-[#FBF0CC] text-[#7A5A0E]'],
  USED: ['Used', 'bg-[#E3F1E7] text-[#1B5138]'],
  IGNORED: ['Set aside', 'bg-[#EEEBDD] text-[#6B6A55]'],
};

function Payment({ p, canApply, canIgnore, staffId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const left = Number(p.amount) - Number(p.amount_used);
  const usable = canApply && (p.status === 'NEW' || p.status === 'PARTLY_USED');
  const [label, cls] = STATE[p.status] || STATE.NEW;

  const toggle = async () => {
    const next = !open; setOpen(next); setErr('');
    if (next && sugg === null) {
      try { setSugg(await mpesaService.c2bSuggest(p.id)); } catch (e) { setSugg([]); setErr(e?.message || 'Could not look for bills.'); }
    }
  };

  const clear = singleFlight(`c2b.apply.${p.id}`, async (s) => {
    setBusy(`${s.target_type}:${s.target_id}`); setErr('');
    try {
      const r = await mpesaService.c2bApply({ c2bId: p.id, targetType: s.target_type, targetId: s.target_id, by: staffId });
      setDone(r); onChanged();
    } catch (e) { setErr(e?.message || 'Could not clear the bill.'); }
    finally { setBusy(''); }
  });

  const aside = singleFlight(`c2b.ignore.${p.id}`, async (ignore) => {
    let reason = null;
    if (ignore) { reason = window.prompt('Why is this payment being set aside? (for example: wrong number, refund due)'); if (!reason) return; }
    setBusy('ignore'); setErr('');
    try { await mpesaService.c2bIgnore(p.id, reason, ignore); onChanged(); }
    catch (e) { setErr(e?.message || 'Could not change this payment.'); }
    finally { setBusy(''); }
  });

  return (
    <div className="border-b border-[#EEEBDD] last:border-0">
      <button type="button" onClick={usable ? toggle : undefined} className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-[#23382B] truncate">{kes(p.amount)} · {p.payer_name || 'Name not shown'}</div>
          <div className="text-[11.5px] text-[#6F7461]"><span className="font-mono tracking-wide">{p.trans_id}</span> · {when(p.trans_time)}{p.bill_ref_number ? ` · Ref ${p.bill_ref_number}` : ''}{p.status === 'PARTLY_USED' ? ` · ${kes(left)} left` : ''}</div>
          {p.status === 'IGNORED' && p.note && <div className="text-[11px] text-[#6F7461]">{p.note}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${cls}`}>{label}</span>
          {usable && <ChevronDown size={15} className={`text-[#8B8766] transition-transform ${open ? 'rotate-180' : ''}`} />}
        </div>
      </button>

      {done && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-[#E3F1E7] text-[12.5px] text-[#1B5138] flex gap-2"><CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          <span>{kes(done.applied)} applied. {done.paid_in_full ? 'Bill is now PAID.' : `Part payment taken. ${kes(done.balance_after)} still to pay.`}{done.invoice_number ? ` Invoice ${done.invoice_number}.` : ''}{done.receipt_number ? ` Receipt ${done.receipt_number}.` : ''}</span></div>
      )}
      {err && <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-[#FBE4E0] text-[12.5px] text-[#8F2E24]">{err}</div>}

      {open && usable && (
        <div className="px-3 pb-3">
          {sugg === null && <div className="text-xs text-[#8B8766]"><Loader2 size={13} className="animate-spin inline mr-1" />Looking for the bill…</div>}
          {sugg && sugg.length === 0 && <p className="text-[12px] text-[#6F7461]">No bill looks like this one. Check the name, or record it on the bill yourself using the code <b className="font-mono">{p.trans_id}</b>.</p>}
          {sugg && sugg.map((s) => {
            const key = `${s.target_type}:${s.target_id}`;
            const takes = Math.min(left, Number(s.balance));
            return (
              <div key={key} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#23382B] truncate">{s.label}</div>
                  <div className="text-[11.5px] text-[#6F7461] truncate">{s.customer_name} · owes {kes(s.balance)}{s.reasons ? ` · ${s.reasons}` : ''}</div>
                </div>
                <button type="button" disabled={!!busy} onClick={() => clear(s)}
                  className="shrink-0 min-h-[40px] px-3 rounded-lg bg-[#1F6B45] hover:bg-[#17553A] text-white text-[12.5px] font-semibold border-b-2 border-[#C9A227] disabled:opacity-60">
                  {busy === key ? 'Clearing…' : Number(s.balance) <= left + 0.004 ? 'Clear bill' : `Take ${kes(takes)}`}
                </button>
              </div>
            );
          })}
          {canIgnore && p.status === 'NEW' && (
            <button type="button" disabled={!!busy} onClick={() => aside(true)} className="mt-1 text-[12px] font-semibold text-[#8A6A12] underline">Not for any bill: set aside</button>
          )}
        </div>
      )}
      {!usable && canIgnore && p.status === 'IGNORED' && (
        <div className="px-3 pb-2"><button type="button" disabled={!!busy} onClick={() => aside(false)} className="text-[12px] font-semibold text-[#1F6B45] underline">Bring back</button></div>
      )}
    </div>
  );
}

export default function MpesaInbox({ config, onConfigChanged }) {
  const { tenant, staffId } = usePosErpAuth();
  const { can } = usePermissions();
  const businessId = tenant?.business_id;
  const canApply = can('payments.record');
  const canIgnore = can('payments.approve');
  const canSetup = can('settings.manage');
  const [filter, setFilter] = useState('OPEN');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError('');
    try { setRows(await mpesaService.c2bList(businessId, { status: filter })); }
    catch (e) { setRows([]); setError(e?.code === '42501' || e?.code === '42P01' ? 'Received payments are not switched on for this business yet.' : (e?.message || 'Could not load received payments.')); }
    finally { setLoading(false); }
  }, [businessId, filter]);
  useEffect(() => { load(); }, [load]);

  // Light refresh so a payment that has just arrived shows without a manual reload. Only while the page is visible.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = singleFlight('MpesaInbox.toggle', async () => {
    setToggling(true); setError('');
    try { await mpesaService.c2bSetEnabled(businessId, !config?.c2b_enabled); onConfigChanged?.(); }
    catch (e) { setError(e?.message || 'Could not change this setting.'); }
    finally { setToggling(false); }
  });

  const openTotal = rows.filter((r) => r.status === 'NEW' || r.status === 'PARTLY_USED').reduce((a, r) => a + Number(r.amount) - Number(r.amount_used), 0);

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-bold text-[#23382B] text-sm uppercase tracking-wide flex items-center gap-1.5"><Inbox size={15} /> Received payments</h2>
        <button type="button" onClick={load} aria-label="Refresh" className="w-8 h-8 rounded-lg border border-[#E3DBB8] bg-white flex items-center justify-center"><RefreshCw size={14} /></button>
      </div>

      {config && !config.c2b_enabled && (
        <div className="mb-2 bg-[#FBF3D5] border border-[#EBD98A] rounded-xl px-3 py-2.5 text-[12.5px] text-[#6B4F0B]">
          <p>Payments sent to your till or paybill are not coming into the system yet.</p>
          {canSetup ? (
            <button type="button" disabled={toggling} onClick={toggle} className="mt-2 min-h-[38px] px-3 rounded-lg bg-[#1F6B45] text-white text-sm font-semibold disabled:opacity-60">{toggling ? 'Turning on…' : 'Turn on received payments'}</button>
          ) : <p className="mt-1">Ask the owner or a manager to turn this on in M-Pesa setup.</p>}
        </div>
      )}
      {config?.c2b_enabled && canSetup && (
        <p className="text-[11px] text-[#8B8766] mb-2">Receiving payments is ON. <button type="button" onClick={toggle} disabled={toggling} className="underline font-semibold">Turn off</button></p>
      )}

      <div className="flex gap-1.5 mb-2">
        {[['OPEN', 'To clear'], ['USED', 'Cleared'], ['IGNORED', 'Set aside'], ['ALL', 'All']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`px-3 min-h-[34px] rounded-full text-[12.5px] font-semibold border ${filter === k ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>{l}</button>
        ))}
      </div>
      {filter === 'OPEN' && rows.length > 0 && <p className="text-[12px] text-[#6F7461] mb-1">{rows.length} payment{rows.length === 1 ? '' : 's'} waiting · {kes(openTotal)} not yet matched to a bill</p>}

      {error && <div className="mb-2 px-3 py-2 rounded-xl bg-[#FBE4E0] text-[12.5px] text-[#8F2E24]">{error}</div>}
      <div className="bg-white border border-[#E3DBB8] rounded-xl">
        {loading && rows.length === 0 ? <div className="py-8 text-center text-sm text-[#8B8766]"><Loader2 size={15} className="animate-spin inline mr-2" />Loading…</div>
          : rows.length === 0 ? <div className="py-8 text-center text-sm text-[#8B8766]">{filter === 'OPEN' ? 'No payments waiting. New ones appear here by themselves.' : 'Nothing to show.'}</div>
          : rows.map((p) => <Payment key={p.id} p={p} canApply={canApply} canIgnore={canIgnore} staffId={staffId} onChanged={load} />)}
      </div>
    </div>
  );
}
