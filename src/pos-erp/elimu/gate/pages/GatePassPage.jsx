// elimu/gate/pages/GatePassPage.jsx -- gate passes for staff.
//   My passes   : a teacher writes a pass (for example a sick student) and sees whether the parent has answered.
//   At the gate : the gate officer sees ONLY passes the parent accepted that are still valid, and records the exit.
//   All         : management sees the week's passes with their state.
// The database enforces every rule (who may write, answer and release); this page only offers the buttons.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync, useDebounced } from '../../hooks/useAsync.js';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { studentService } from '../../services/ElimuStudentService.js';
import { gatePassService } from '../services/gatePassService.js';
import { friendlyError } from '../../utils/validation.js';

export const STATE = { REQUESTED: ['Waiting for parent', 'bg-amber-50 text-amber-900'], PARENT_ACCEPTED: ['Parent accepted', 'bg-emerald-50 text-emerald-900'], PARENT_REFUSED: ['Parent refused', 'bg-red-50 text-red-800'],
  CANCELLED: ['Cancelled', 'bg-slate-100 text-slate-600'], EXITED: ['Left school', 'bg-sky-50 text-sky-900'], EXPIRED: ['Expired', 'bg-slate-100 text-slate-600'] };
const when = (t) => (t ? new Date(t).toLocaleString('en-KE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const Chip = ({ s }) => { const [l, c] = STATE[s] || [s, 'bg-slate-100']; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{l}</span>; };

function NewPassSheet({ onClose, onSaved }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [stu, setStu] = useState(null);
  const found = useAsync(() => (dq.trim().length >= 2 && !stu ? studentService.list({ search: dq }) : Promise.resolve({ rows: [] })), [dq, stu]);
  const [f, setF] = useState({ reason: '', collector: '', phone: '', hours: '6' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!stu) return setErr('Choose the student.'); if (f.reason.trim().length < 3) return setErr('Write the reason (for example: sick, taken to clinic).');
    setBusy(true); try { await gatePassService.create({ studentId: stu.id, reason: f.reason.trim(), collectorName: f.collector.trim(), collectorPhone: f.phone.trim(), hours: parseInt(f.hours, 10) }); onSaved(); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Write a gate pass" onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        {stu ? <div className="flex items-center justify-between rounded-xl border border-[#E3DBB8] bg-white p-3"><div><b>{stu.full_name}</b><div className="text-xs text-[#6F7461]">{stu.admission_no}{stu.class_name ? ` · ${stu.class_name}` : ''}</div></div><button type="button" className="underline text-sm" onClick={() => setStu(null)}>Change</button></div> : (<>
          <input className={fieldClass} placeholder="Search the student by name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
          {(found.data?.rows || []).slice(0, 6).map((r) => (<button key={r.id} type="button" onClick={() => setStu(r)} className="w-full text-left rounded-xl border border-[#E3DBB8] bg-white p-2 min-h-[48px]"><b className="text-sm">{r.full_name}</b><div className="text-xs text-[#6F7461]">{r.admission_no}{r.class_name ? ` · ${r.class_name}` : ''}</div></button>))}</>)}
        <input className={fieldClass} placeholder="Reason (for example: sick, taken to clinic)" value={f.reason} onChange={set('reason')} />
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} placeholder="Who will collect (optional)" value={f.collector} onChange={set('collector')} /><input className={fieldClass} inputMode="tel" placeholder="Their phone (optional)" value={f.phone} onChange={set('phone')} /></div>
        <label className="text-xs text-[#6F7461]">Valid for<select className={`${fieldClass} mt-1`} value={f.hours} onChange={set('hours')}>{[1, 2, 4, 6, 12, 24].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}</select></label>
        <p className="text-xs text-[#6F7461]">The parent is asked in the parent portal. The gate officer can only release the student after the parent accepts.</p>
        <button type="button" disabled={busy} onClick={save} className="w-full min-h-[48px] rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Send to parent'}</button>
      </div>
    </Sheet>);
}

function PassCard({ p, children }) {
  return (
    <li className="rounded-2xl border border-[#E3DBB8] bg-white p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-semibold">{p.student_name}</div><div className="text-xs text-[#6F7461]">{p.class_name} · {p.reason}</div></div><Chip s={p.state} /></div>
      <div className="mt-1 text-xs text-[#6F7461]">Written {when(p.requested_at)}{p.requested_by_name ? ` by ${p.requested_by_name}` : ''} · valid until {when(p.valid_until)}</div>
      {p.collector_name && <div className="text-xs mt-0.5">Collector: <b>{p.collector_name}</b>{p.collector_phone ? ` · ${p.collector_phone}` : ''}</div>}
      {p.parent_note && <div className="text-xs mt-0.5 italic">Parent: “{p.parent_note}”</div>}
      {p.register_result && <div className="text-xs text-[#6F7461] mt-0.5">Register: {p.register_result}</div>}
      {children}
    </li>);
}

export default function GatePassPage() {
  const { can } = useElimuAccess(); const [sp, setSp] = useSearchParams();
  const canWrite = can('attendance.take_own') || can('attendance.take_any'); const canGate = can('attendance.take_any'); const canAll = can('attendance.view_all') || can('attendance.take_any');
  const tabs = [canWrite && ['mine', 'My passes'], canGate && ['gate', 'At the gate'], canAll && ['all', 'All']].filter(Boolean);
  const want = sp.get('tab'); const tab = tabs.find((t) => t[0] === want) ? want : tabs[0]?.[0];
  const view = tab === 'gate' ? 'cleared' : tab === 'all' ? 'all' : 'mine';
  const list = useAsync(() => (tab ? gatePassService.list(view) : Promise.resolve([])), [view, tab]);
  const [sheet, setSheet] = useState(false); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false); const [filter, setFilter] = useState('');
  const run = async (fn, ok) => { setBusy(true); setMsg(null); try { const r = await fn(); setMsg({ tone: 'good', text: typeof ok === 'function' ? ok(r) : ok }); list.reload(); } catch (e) { setMsg({ tone: 'bad', text: friendlyError(e) }); } finally { setBusy(false); } };
  const rows = (list.data || []).filter((p) => !filter || p.state === filter);
  return (
    <FitPage title="Gate passes" subtitle="Permission for a student to leave school" icon={DoorOpen}>
      {tabs.length === 0 ? <Notice tone="gold">You do not have access to gate passes.</Notice> : (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setSp({ tab: k })} className={`h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}
            <span className="flex-1" />{canWrite && tab === 'mine' && <button type="button" onClick={() => setSheet(true)} className="px-3 min-h-[38px] rounded-lg bg-[#1F6B45] text-white text-sm font-semibold">+ New pass</button>}</div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {tab === 'all' && <div className="flex gap-1.5 flex-wrap">{[['', 'All'], ['REQUESTED', 'Waiting for parent'], ['PARENT_ACCEPTED', 'Accepted'], ['PARENT_REFUSED', 'Refused'], ['EXITED', 'Left']].map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`h-8 px-2.5 rounded-full text-xs border ${filter === k ? 'bg-[#E4F0E8] border-[#1F6B45]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>}
          {tab === 'gate' && <Notice tone="gold">Only passes the parent has accepted appear here. Check who is collecting before you let the student go.</Notice>}
          {list.error && <Notice tone="bad">{list.error}</Notice>}
          {list.loading && !list.data ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock>{tab === 'gate' ? 'No student is cleared to leave right now.' : tab === 'mine' ? 'You have not written any passes in the last 30 days.' : 'No passes.'}</EmptyBlock> : (
            <ul className="space-y-2">{rows.map((p) => (
              <PassCard key={p.id} p={p}>
                {tab === 'gate' && p.state === 'PARENT_ACCEPTED' && <button type="button" disabled={busy} onClick={() => run(() => gatePassService.exit(p.id), (r) => `${p.student_name} released.${r?.register ? ` ${r.register}` : ''}`)} className="mt-2 w-full min-h-[48px] rounded-xl bg-[#1F6B45] text-white font-bold disabled:opacity-50">Let {p.student_name.split(' ')[0]} go</button>}
                {tab !== 'gate' && ['REQUESTED', 'PARENT_ACCEPTED'].includes(p.state) && <button type="button" disabled={busy} onClick={() => { const why = window.prompt('Why is this pass cancelled?'); if (why && why.trim().length >= 3) run(() => gatePassService.cancel(p.id, why.trim()), 'Pass cancelled.'); }} className="mt-2 px-3 min-h-[38px] rounded-lg border border-[#E3DBB8] text-sm disabled:opacity-50">Cancel pass</button>}
              </PassCard>))}</ul>)}
          {sheet && <NewPassSheet onClose={() => setSheet(false)} onSaved={() => { setMsg({ tone: 'good', text: 'Sent to the parent.' }); list.reload(); }} />}
        </div>)}
    </FitPage>);
}
