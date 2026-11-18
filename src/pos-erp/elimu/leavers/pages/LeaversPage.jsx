// elimu/leavers/pages/LeaversPage.jsx -- record a student leaving (transfer, withdrawal, graduation) and see the leavers list.
// Tabs: Record a leaver / Leavers. A student who owes fees stops for confirmation first; leaving never writes the debt off.
import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, fieldClass } from '../../services/platform.js';
import { ConfirmSheet } from '../../shared/components/kit.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { leaversService, KINDS, KIND_LABEL, leaveProblems } from '../services/leaversService.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const today = () => new Date().toISOString().slice(0, 10);
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Record({ onDone }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [pick, setPick] = useState(null);
  const [kind, setKind] = useState('TRANSFER'); const [date, setDate] = useState(today()); const [reason, setReason] = useState(''); const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ask, setAsk] = useState(null); const [ok, setOk] = useState(null);
  useEffect(() => { if (pick || q.trim().length < 2) { setHits([]); return undefined; } let live = true; const h = setTimeout(async () => { try { const r = await leaversService.search(q.trim()); if (live) setHits(r); } catch (x) { if (live) setErr(friendlyError(x)); } }, 300); return () => { live = false; clearTimeout(h); }; }, [q, pick]);
  const problems = leaveProblems({ studentId: pick?.student_id, kind, date, reason });
  const send = async (confirmBalance) => {
    setBusy(true); setErr('');
    try {
      const r = await leaversService.leave({ studentId: pick.student_id, kind, date, reason, destination: kind === 'TRANSFER' ? dest : '', confirmBalance });
      if (r.needs_confirmation) { setAsk(r); } else { setAsk(null); setOk({ name: pick.name, kind, ...r }); setPick(null); setQ(''); setReason(''); setDest(''); onDone && onDone(); }
    } catch (x) { setErr(friendlyError(x)); setAsk(null); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      {err && <Notice tone="bad">{err}</Notice>}
      {ok && <Notice tone="good">{ok.name} is recorded as {KIND_LABEL[ok.kind].toLowerCase()}. {ok.enrolments_closed} enrolment{ok.enrolments_closed === 1 ? '' : 's'} closed{ok.passes_cancelled ? `, ${ok.passes_cancelled} open gate pass cancelled` : ''}.{ok.balance > 0 ? ` The ${kes(ok.balance)} balance stays on the student's account.` : ''}</Notice>}
      <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 space-y-3">
        <div className="text-sm font-semibold">Student</div>
        {pick ? (<div className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F4E8] p-2 text-sm"><span><b>{pick.name}</b> · {pick.admission_no}{pick.class_name ? ` · ${pick.class_name}` : ''}{pick.balance > 0 ? ` · owes ${kes(pick.balance)}` : ''}</span><button type="button" className={btnS} onClick={() => { setPick(null); setAsk(null); }}>Change</button></div>) : (<>
          <input className={fieldClass} placeholder="Search by name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && <ul className="divide-y divide-[#EFE9CF] rounded-xl border border-[#E3DBB8]">{hits.map((h) => <li key={h.student_id}><button type="button" className="w-full text-left p-2.5 text-sm min-h-[44px]" onClick={() => { setPick(h); setOk(null); }}><b>{h.name}</b> <span className="text-xs text-[#6F7461]">{h.admission_no}{h.class_name ? ` · ${h.class_name}` : ''}</span></button></li>)}</ul>}
          {q.trim().length >= 2 && hits.length === 0 && <p className="text-xs text-[#6F7461]">No active student matches. Students who have already left do not appear here.</p>}</>)}
        <div className="flex gap-1.5 flex-wrap">{KINDS.map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={`h-10 px-3 rounded-full text-xs font-semibold border ${kind === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block text-xs text-[#6F7461]">Leaving date<input type="date" max={today()} className={`${fieldClass} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {kind === 'TRANSFER' && <label className="block text-xs text-[#6F7461]">Going to (school)<input className={`${fieldClass} mt-1`} value={dest} onChange={(e) => setDest(e.target.value)} /></label>}
        </div>
        <label className="block text-xs text-[#6F7461]">Reason{kind === 'WITHDRAWAL' ? ' *' : ' (optional)'}<textarea rows={2} className={`${fieldClass} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {problems.length > 0 && pick && problems.map((p) => <Notice key={p} tone="gold">{p}</Notice>)}
        <button type="button" className={`${btnP} w-full`} disabled={busy || problems.length > 0} onClick={() => send(false)}>{busy ? 'Saving…' : `Record ${kind === 'GRADUATION' ? 'graduation' : kind === 'TRANSFER' ? 'transfer' : 'withdrawal'}`}</button>
        <p className="text-xs text-[#6F7461]">The student's record is closed with this status and every open enrolment ends on the leaving date. History is kept. Any open gate pass is cancelled. If the student comes back, reinstate them from the Leavers tab.</p>
      </div>
      {ask && <ConfirmSheet title="This student still owes fees" confirmLabel="Record leaving anyway" busy={busy} onConfirm={() => send(true)} onCancel={() => setAsk(null)}><p>{ask.message}</p></ConfirmSheet>}
    </div>);
}

function List({ refreshKey }) {
  const [kind, setKind] = useState(''); const [bump, setBump] = useState(0);
  const data = useAsync(() => leaversService.list(kind || null, null), [kind, refreshKey, bump]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const back = async (row) => { setBusy(row.exit_id); setErr(''); setMsg(''); try { const r = await leaversService.reinstate(row.student_id, ''); setMsg(`${row.name}: ${r.message}`); setBump((b) => b + 1); } catch (x) { setErr(friendlyError(x)); } setBusy(''); };
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">{[['', 'All'], ...KINDS.map(([k]) => [k, KIND_LABEL[k]])].map(([k, l]) => <button key={k || 'all'} type="button" onClick={() => setKind(k)} className={`h-9 px-3 rounded-full text-xs font-semibold border ${kind === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
      {err && <Notice tone="bad">{err}</Notice>}{msg && <Notice tone="good">{msg}</Notice>}
      {data.loading && !data.data ? <LoadingBlock /> : (data.data || []).length === 0 ? <EmptyBlock>No leavers recorded.</EmptyBlock> : (
        <ul className="space-y-2">{data.data.map((r) => (
          <li key={r.exit_id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-semibold truncate">{r.name} <span className="text-xs font-normal text-[#6F7461]">{r.admission_no}{r.last_class ? ` · ${r.last_class}` : ''}</span></div>
              <div className="text-xs text-[#6F7461]">{KIND_LABEL[r.kind]} on {r.exit_date}{r.destination_school ? ` → ${r.destination_school}` : ''}{r.recorded_by_name ? ` · by ${r.recorded_by_name}` : ''}</div></div>
              {r.reinstated_at ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-900">Reinstated</span> : <button type="button" className={btnS} disabled={busy === r.exit_id} onClick={() => back(r)}>Reinstate</button>}</div>
            {r.reason && <div className="text-xs mt-1">{r.reason}</div>}
            {Number(r.balance_at_exit) > 0 && <div className="text-xs mt-1 text-amber-800">Owed {kes(r.balance_at_exit)} when they left</div>}
          </li>))}</ul>)}
    </div>);
}

export default function LeaversPage() {
  const [tab, setTab] = useState('record'); const [key, setKey] = useState(0);
  return (
    <FitPage title="Transfers & leavers" subtitle="Record a student leaving, and see who has left" icon={LogOut}>
      <div className="space-y-3">
        <div className="flex gap-1.5">{[['record', 'Record a leaver'], ['list', 'Leavers']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-10 px-4 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
        {tab === 'record' ? <Record onDone={() => setKey((k) => k + 1)} /> : <List refreshKey={key} />}
      </div>
    </FitPage>);
}
