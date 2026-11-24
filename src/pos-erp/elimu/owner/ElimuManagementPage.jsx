// Elimu management: the OWNER's console (licences, payments, support messages). Self-contained so it can be mounted in the Finance ERP:
//   import ElimuManagementPage from '<path>/elimu/owner/ElimuManagementPage.jsx';   <Route path="elimu-management" element={<ElimuManagementPage />} />
// It only works for sign-ins listed in elimu_platform_owners (the database refuses everyone else).
import React, { useCallback, useEffect, useState } from 'react';
import { ownerService } from '../services/ElimuLicenceService.js';
import { humanMessage } from '../utils/humanError.js';

const money = (n, c = 'KES') => `${c} ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const STATE = { none: ['Not set up', 'bg-slate-100 text-slate-700'], active: ['Active', 'bg-emerald-100 text-emerald-800'], grace: ['Overdue (grace)', 'bg-amber-100 text-amber-900'], ended: ['Stopped', 'bg-red-100 text-red-800'], suspended: ['Suspended', 'bg-red-100 text-red-800'] };
const inp = 'h-11 rounded-xl border border-[#DDD6B6] px-3 bg-white w-full';
const btn = 'min-h-[44px] px-4 rounded-xl text-sm font-medium border border-[#DDD6B6] bg-white';
const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-medium bg-[#1F6B45] text-white disabled:opacity-60';

function SchoolCard({ s, onChanged }) {
  const [open, setOpen] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [hist, setHist] = useState(null);
  const [pay, setPay] = useState({ amount: String(s.monthly_amount || ''), months: '1', reference: '', method: 'M-Pesa' });
  const [lic, setLic] = useState({ paid_until: s.licence?.paid_until || '', grace_days: String(s.grace_days), price: String(s.price_per_student) });
  const [reason, setReason] = useState('');
  const [label, tone] = STATE[s.licence?.state] || STATE.none;
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await onChanged(); } catch (e) { setErr(humanMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="rounded-2xl border border-[#E3DBB8] bg-white p-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div><div className="font-semibold text-[#12261F]">{s.name}</div><div className="text-xs text-slate-500">Code {s.school_code} · {s.students} active students</div></div>
          <div className="text-right"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>{s.new_messages > 0 && <div className="text-xs text-[#1F6B45] mt-1">{s.new_messages} new message{s.new_messages === 1 ? '' : 's'}</div>}</div>
        </div>
        <div className="mt-2 text-sm text-slate-700">Monthly bill {money(s.monthly_amount, s.currency)} ({s.students} × {s.price_per_student}){s.licence?.paid_until ? ` · paid until ${s.licence.paid_until}` : ''}</div>
      </button>
      {open && (
        <div className="mt-3 space-y-4 border-t border-[#EFE8C8] pt-3">
          {err && <p role="alert" className="rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
          <section><h3 className="text-sm font-semibold mb-2">Record a payment received</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Amount<input className={inp} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
              <label className="text-xs">Months covered<input className={inp} inputMode="numeric" value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value })} /></label>
              <label className="text-xs">Reference<input className={inp} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
              <label className="text-xs">Method<input className={inp} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></label>
            </div>
            <button type="button" disabled={busy} className={`${btnP} mt-2`} onClick={() => run(() => ownerService.pay(s.tenant_id, pay).then(() => setHist(null)))}>Save payment</button>
          </section>
          <section><h3 className="text-sm font-semibold mb-2">Licence terms</h3>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs col-span-3 sm:col-span-1">Paid until<input type="date" className={inp} value={lic.paid_until} onChange={(e) => setLic({ ...lic, paid_until: e.target.value })} /></label>
              <label className="text-xs">Grace days<input className={inp} inputMode="numeric" value={lic.grace_days} onChange={(e) => setLic({ ...lic, grace_days: e.target.value })} /></label>
              <label className="text-xs">Price per student<input className={inp} inputMode="decimal" value={lic.price} onChange={(e) => setLic({ ...lic, price: e.target.value })} /></label>
            </div>
            <button type="button" disabled={busy} className={`${btn} mt-2`} onClick={() => run(() => ownerService.setLicence(s.tenant_id, { paid_until: lic.paid_until || null, grace_days: lic.grace_days === '' ? null : Number(lic.grace_days), price: lic.price === '' ? null : Number(lic.price) }))}>Save terms</button>
          </section>
          <section><h3 className="text-sm font-semibold mb-2">{s.suspended ? 'This school is suspended' : 'Suspend this school now'}</h3>
            {!s.suspended && <input className={`${inp} mb-2`} placeholder="Reason (kept for you)" value={reason} onChange={(e) => setReason(e.target.value)} />}
            <button type="button" disabled={busy} className={btn} onClick={() => run(() => ownerService.setLicence(s.tenant_id, { suspended: !s.suspended, reason }))}>{s.suspended ? 'Lift the suspension' : 'Suspend'}</button>
          </section>
          <section><button type="button" className={btn} onClick={() => ownerService.payments(s.tenant_id).then(setHist).catch((e) => setErr(humanMessage(e)))}>Show payment history</button>
            {hist && <ul className="mt-2 text-sm space-y-1">{hist.length === 0 && <li className="text-slate-500">No payments recorded yet.</li>}{hist.map((h) => <li key={h.id}>{h.paid_on} · {money(h.amount)} · {h.months} month{h.months === 1 ? '' : 's'}{h.reference ? ` · ${h.reference}` : ''}{h.method ? ` (${h.method})` : ''}</li>)}</ul>}</section>
        </div>
      )}
    </div>
  );
}

function Inbox({ onChanged }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [f, setF] = useState('NEW');
  const load = useCallback(() => ownerService.inbox(f === 'ALL' ? null : f).then(setRows).catch((e) => setErr(humanMessage(e))), [f]);
  useEffect(() => { load(); }, [load]);
  const mark = async (id, st) => { try { await ownerService.setInbox(id, st); await load(); onChanged?.(); } catch (e) { setErr(humanMessage(e)); } };
  const CH = { message: 'Message', whatsapp: 'Opened WhatsApp', call: 'Tapped Call', email: 'Opened Email' };
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">{['NEW', 'SEEN', 'DONE', 'ALL'].map((k) => <button key={k} type="button" onClick={() => setF(k)} aria-pressed={f === k} className={`${btn} ${f === k ? '!bg-[#E4F0E8] !border-[#1F6B45]' : ''}`}>{k === 'ALL' ? 'All' : k[0] + k.slice(1).toLowerCase()}</button>)}</div>
      <p className="text-xs text-slate-500">A tap on WhatsApp, Call or Email tells you that the person reached out; what they then say stays in that app. Typed messages are shown in full.</p>
      {err && <p role="alert" className="rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
      {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-slate-500">Nothing here.</p> : rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-[#E3DBB8] bg-white p-3 text-sm">
          <div className="flex justify-between gap-2"><b>{r.school || r.school_code || 'Unknown school'}</b><span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span></div>
          <div className="text-xs text-slate-500">{r.from_name || 'Someone'} ({r.from_kind}) · {CH[r.channel]}</div>
          {r.message && <p className="mt-1 whitespace-pre-wrap">{r.message}</p>}
          <div className="mt-2 flex gap-2">{r.status !== 'SEEN' && <button type="button" className={btn} onClick={() => mark(r.id, 'SEEN')}>Mark seen</button>}{r.status !== 'DONE' && <button type="button" className={btnP} onClick={() => mark(r.id, 'DONE')}>Done</button>}</div>
        </div>))}
    </div>
  );
}

export default function ElimuManagementPage() {
  const [ok, setOk] = useState(null); const [tab, setTab] = useState('schools'); const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [unread, setUnread] = useState(0);
  const load = useCallback(async () => { try { setRows(await ownerService.schools()); setUnread(await ownerService.unread()); setErr(''); } catch (e) { setErr(humanMessage(e)); } }, []);
  useEffect(() => { ownerService.isOwner().then((v) => { setOk(v); if (v) load(); }); }, [load]);
  if (ok === null) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (!ok) return <div className="max-w-md mx-auto p-6 text-center"><h1 className="text-lg font-bold text-[#12261F]">This page is for the Elimu owner</h1><p className="text-sm text-slate-600 mt-2">Your sign-in is not set up as an Elimu owner. If this is a mistake, add your user to the owners list in the database.</p></div>;
  const total = (rows || []).reduce((a, s) => a + Number(s.monthly_amount || 0), 0);
  const stopped = (rows || []).filter((s) => s.licence?.blocked).length;
  return (
    <div className="max-w-3xl mx-auto p-3 space-y-4">
      <div><h1 className="text-xl font-bold text-[#12261F]">Elimu management</h1><p className="text-sm text-slate-600">Schools, licences and support messages.</p></div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white border border-[#E3DBB8] p-3"><div className="text-lg font-bold">{rows ? rows.length : '–'}</div><div className="text-xs text-slate-500">Schools</div></div>
        <div className="rounded-xl bg-white border border-[#E3DBB8] p-3"><div className="text-lg font-bold">{money(total)}</div><div className="text-xs text-slate-500">Billed per month</div></div>
        <div className="rounded-xl bg-white border border-[#E3DBB8] p-3"><div className="text-lg font-bold">{stopped}</div><div className="text-xs text-slate-500">Stopped</div></div>
      </div>
      <div className="flex gap-2"><button type="button" onClick={() => setTab('schools')} aria-pressed={tab === 'schools'} className={`${btn} ${tab === 'schools' ? '!bg-[#E4F0E8]' : ''}`}>Schools</button>
        <button type="button" onClick={() => setTab('inbox')} aria-pressed={tab === 'inbox'} className={`${btn} ${tab === 'inbox' ? '!bg-[#E4F0E8]' : ''}`}>Messages{unread > 0 ? ` (${unread})` : ''}</button></div>
      {err && <p role="alert" className="rounded-xl bg-red-50 text-red-800 text-sm p-3">{err}</p>}
      {tab === 'schools' ? (rows === null ? <p className="text-sm text-slate-500">Loading…</p> : <div className="space-y-3">{rows.map((s) => <SchoolCard key={s.tenant_id} s={s} onChanged={load} />)}{rows.length === 0 && <p className="text-sm text-slate-500">No schools yet.</p>}</div>) : <Inbox onChanged={load} />}
    </div>
  );
}
