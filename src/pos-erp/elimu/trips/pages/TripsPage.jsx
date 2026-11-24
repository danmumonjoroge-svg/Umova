// elimu/trips/pages/TripsPage.jsx -- school trips and activities: plan one, see which parents agreed, mark who went, cancel.
import React, { useState } from 'react';
import { Bus } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { setupService } from '../../services/ElimuSetupService.js';
import { tripService, tripProblems, tripMoney, CONSENT_LABEL } from '../services/tripService.js';
import { friendlyError } from '../../utils/validation.js';
import { TripCard } from '../../ui/cards/index.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const day = (v) => new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

function NewSheet({ classes, onClose, onDone }) {
  const [f, setF] = useState({ title: '', description: '', destination: '', date: '', returnDate: '', classId: '', cost: '', deadline: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value })); const probs = tripProblems(f);
  const send = async () => { setBusy(true); setErr(''); try { await tripService.create(f); onDone(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Plan a trip" onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      <input className={fieldClass} placeholder="Title (for example: Nairobi National Park)" value={f.title} onChange={set('title')} />
      <input className={fieldClass} placeholder="Destination" value={f.destination} onChange={set('destination')} />
      <textarea className={fieldClass} rows={3} placeholder="What parents should know (time, what to bring)" value={f.description} onChange={set('description')} />
      <label className="text-xs block">For<select className={fieldClass} value={f.classId} onChange={set('classId')}><option value="">Whole school</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs block">Trip date<input type="date" className={fieldClass} value={f.date} onChange={set('date')} /></label><label className="text-xs block">Return date (optional)<input type="date" className={fieldClass} value={f.returnDate} onChange={set('returnDate')} /></label></div>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs block">Cost per student (KES)<input type="number" className={fieldClass} value={f.cost} onChange={set('cost')} /></label><label className="text-xs block">Reply by (optional)<input type="date" className={fieldClass} value={f.deadline} onChange={set('deadline')} /></label></div>
      <button type="button" className={btnP} disabled={busy || probs.length > 0} onClick={send}>{busy ? 'Saving...' : 'Create trip'}</button>{f.title && probs[0] && <p className="text-xs text-[#6F7461]">{probs[0]}</p>}
      <p className="text-xs text-[#6F7461]">Parents are asked for consent in their portal. The cost is shown to them but is not added to the fee account.</p></div></Sheet>
  );
}

function Roster({ trip, canManage, onClose, onChanged }) {
  const [tick, setTick] = useState(0); const r = useAsync(() => tripService.roster(trip.id), [trip.id, tick]); const [err, setErr] = useState(''); const [filter, setFilter] = useState('');
  const rows = (r.data?.rows || []).filter((x) => !filter || x.consent === filter); const started = new Date(trip.trip_date) <= new Date(new Date().toDateString());
  const mark = async (x, v) => { try { await tripService.attended(trip.id, x.student_id, v); setTick((n) => n + 1); onChanged(); } catch (e) { setErr(friendlyError(e)); } };
  const csv = () => { const lines = [['Student', 'Admission no', 'Class', 'Consent', 'Went']].concat((r.data?.rows || []).map((x) => [x.student_name, x.admission_no, x.class_name, CONSENT_LABEL[x.consent], x.attended === true ? 'Yes' : x.attended === false ? 'No' : '']));
    const blob = new Blob([lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `trip-${trip.id.slice(0, 8)}.csv`; a.click(); };
  return (
    <Sheet title={trip.title} onClose={onClose}><div className="space-y-2">{err && <Notice tone="bad">{err}</Notice>}
      <div className="flex gap-1.5 flex-wrap">{[['', 'All'], ['YES', 'Agreed'], ['NO', 'Declined'], ['WAITING', 'No answer']].map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`h-9 px-3 rounded-full text-xs font-semibold border ${filter === k ? 'bg-[#12261F] text-white' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}<button type="button" className={btnS} onClick={csv}>Download CSV</button></div>
      {r.loading ? <LoadingBlock /> : rows.map((x) => (
        <div key={x.student_id} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><div className="flex justify-between gap-2"><b>{x.student_name}</b><span className={`text-xs ${x.consent === 'YES' ? 'text-[#1F6B45]' : x.consent === 'NO' ? 'text-red-700' : 'text-[#6F7461]'}`}>{CONSENT_LABEL[x.consent]}</span></div>
          <div className="text-xs text-[#6F7461]">{x.admission_no} · {x.class_name}</div>{x.note && <div className="text-xs italic">Parent note: {x.note}</div>}
          {canManage && started && x.consent === 'YES' && trip.status === 'OPEN' && <div className="flex gap-2 mt-1.5"><button type="button" className={`${btnS} ${x.attended === true ? 'bg-[#E4F0E8]' : ''}`} onClick={() => mark(x, true)}>Went</button><button type="button" className={`${btnS} ${x.attended === false ? 'bg-[#FBE9E7]' : ''}`} onClick={() => mark(x, false)}>Did not go</button></div>}
        </div>))}</div></Sheet>
  );
}

export default function TripsPage() {
  const { can } = useElimuAccess(); const canManage = can('calendar.manage');
  const [tick, setTick] = useState(0); const [past, setPast] = useState(false); const [open, setOpen] = useState(false); const [roster, setRoster] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const list = useAsync(() => tripService.list(past), [tick, past]); const classes = useAsync(() => (canManage ? setupService.classes() : Promise.resolve([])), [canManage]);
  const cancel = async (t) => { const why = window.prompt(`Why is "${t.title}" cancelled? Parents will see this.`); if (!why) return; try { await tripService.cancel(t.id, why); setMsg('Trip cancelled.'); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  const rows = list.data || [];
  return (
    <FitPage title="Trips & activities" icon={Bus} subtitle="Plan trips and collect parent consent">
      <div className="space-y-3">{msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        <div className="flex items-center justify-between gap-2"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} /> Include past trips</label>{canManage && <button type="button" className={btnP} onClick={() => setOpen(true)}>Plan a trip</button>}</div>
        {list.loading ? <LoadingBlock /> : list.error ? <Notice tone="bad">{friendlyError(list.error)}</Notice> : rows.length === 0 ? <EmptyBlock title="No trips planned" /> : (
          <div className="space-y-3">{rows.map((t) => { const d = new Date(t.trip_date); const cancelled = t.status === 'CANCELLED';
            return <TripCard key={t.id} title={t.title} day={d.getDate()} month={d.toLocaleDateString('en-KE', { month: 'short' })}
              place={`${t.destination || 'School'} · ${t.class_name || 'Whole school'}`} time={`${tripMoney(t.cost)}${t.consent_deadline ? ` · reply by ${day(t.consent_deadline)}` : ''}`}
              status={cancelled ? { label: 'Cancelled', tone: 'bad' } : t.waiting > 0 ? { label: `${t.waiting} waiting`, tone: 'warn' } : { label: 'All answered', tone: 'ok' }}
              footer={<>{cancelled ? <div>Reason: {t.cancel_reason}</div> : <div>{t.yes} agreed · {t.no} declined · {t.waiting} not answered (of {t.eligible})</div>}
                <div className="flex gap-2 mt-2"><button type="button" className={btnP} onClick={() => setRoster(t)}>Consent list</button>{canManage && t.status === 'OPEN' && <button type="button" className={btnS} onClick={() => cancel(t)}>Cancel trip</button>}</div></>} />; })}</div>)}
      </div>
      {open && <NewSheet classes={classes.data || []} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setMsg('Trip created. Parents can answer in their portal.'); setTick((x) => x + 1); }} />}
      {roster && <Roster trip={roster} canManage={canManage} onClose={() => setRoster(null)} onChanged={() => setTick((x) => x + 1)} />}
    </FitPage>
  );
}
