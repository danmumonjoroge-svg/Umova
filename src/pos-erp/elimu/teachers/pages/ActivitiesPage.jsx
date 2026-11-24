// elimu/teachers/pages/ActivitiesPage.jsx -- games, clubs, drama and other activities: who leads and takes part, and events/results.
import React, { useState } from 'react';
import { Trophy } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { friendlyError } from '../../utils/validation.js';
import { InfoCard, EmptyNote, V } from '../../ui/cards/index.js';
import { teacherService, KIND_LABEL, ROLE_LABEL, LEVEL_LABEL } from '../services/teacherService.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50';
const btnS = 'min-h-[38px] px-3 rounded-xl text-xs font-semibold border bg-white disabled:opacity-50';
const day = (v) => new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const Opts = ({ map }) => Object.entries(map).map(([k, l]) => <option key={k} value={k}>{l}</option>);

function FormSheet({ title, onClose, onSave, children, ok = true, label = 'Save' }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await onSave(); } catch (e) { setErr(friendlyError(e)); setBusy(false); } };
  return <Sheet title={title} onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}{children}<button type="button" className={btnP} style={{ background: V.primary }} disabled={busy || !ok} onClick={go}>{busy ? 'Saving...' : label}</button></div></Sheet>;
}

export default function ActivitiesPage() {
  const r = useAsync(() => teacherService.activities(), []); const d = r.data; const [sheet, setSheet] = useState(null); const [msg, setMsg] = useState('');
  const manage = !!d?.can_manage; const done = () => { setSheet(null); r.reload(); };
  const [f, setF] = useState({}); const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const open = (kind, init = {}) => { setF(init); setSheet({ kind, ...init }); };
  const end = async (p) => { setMsg(''); try { await teacherService.endRole(p.assignment_id); r.reload(); } catch (e) { setMsg(friendlyError(e)); } };
  return (
    <FitPage title="Games, clubs & activities" icon={Trophy} subtitle="Who leads each activity, and how it is going">
      {r.error && !d && <Notice tone="bad">{r.error}</Notice>}
      {msg && <Notice tone="bad">{msg}</Notice>}
      {r.loading && !d && <LoadingBlock />}
      {d && (<div className="space-y-3">
        {manage && <button type="button" className={btnP} style={{ background: V.primary }} onClick={() => open('new', { name: '', kind: 'GAMES', note: '' })}>Add an activity</button>}
        {d.activities.length === 0 ? <EmptyNote title="No activities yet">Add football, drama club, music, science club and so on. Then say which teachers lead them.</EmptyNote> : (
          <div className="grid gap-3 md:grid-cols-2">{d.activities.map((a) => (
            <InfoCard key={a.id} title={a.name} aside={<span className="text-xs" style={{ color: V.muted }}>{KIND_LABEL[a.kind]}{!a.is_active && ' - switched off'}</span>}>
              {a.note && <p className="text-xs mb-2" style={{ color: V.muted }}>{a.note}</p>}
              {a.people.length === 0 ? <p className="text-sm" style={{ color: V.muted }}>No teacher assigned this year.</p> : <ul className="space-y-1">{a.people.map((p) => <li key={p.assignment_id} className="text-sm flex items-center justify-between gap-2"><span><b>{p.name}</b> - <span style={{ color: p.role === 'LEADER' ? V.primary : V.muted }}>{ROLE_LABEL[p.role]}</span></span>{manage && <button type="button" className="text-xs underline" style={{ color: V.muted }} onClick={() => end(p)}>End</button>}</li>)}</ul>}
              {a.events.length > 0 && <div className="mt-3 pt-3 border-t" style={{ borderColor: V.border2 }}><div className="text-xs font-semibold mb-1">Recent events</div><ul className="space-y-1">{a.events.slice(0, 4).map((e) => <li key={e.id} className="text-xs">{day(e.date)} - {e.title} ({LEVEL_LABEL[e.level]}){e.result ? ` - ${e.result}` : ''}</li>)}</ul></div>}
              <div className="flex flex-wrap gap-2 mt-3">
                {manage && <button type="button" className={btnS} style={{ borderColor: V.border }} onClick={() => open('assign', { activity: a.id, staff: '', role: 'LEADER' })}>Add teacher</button>}
                <button type="button" className={btnS} style={{ borderColor: V.border }} onClick={() => open('event', { activity: a.id, date: '', title: '', level: 'SCHOOL', result: '' })}>Record an event</button>
                {manage && <button type="button" className={btnS} style={{ borderColor: V.border }} onClick={() => open('edit', { id: a.id, name: a.name, kind: a.kind, note: a.note || '', active: a.is_active })}>Edit</button>}
              </div>
            </InfoCard>))}</div>)}
        {sheet && ['new', 'edit'].includes(sheet.kind) && (
          <FormSheet title={sheet.kind === 'new' ? 'Add an activity' : 'Edit activity'} ok={f.name?.trim().length >= 2} onClose={() => setSheet(null)} onSave={async () => { await teacherService.saveActivity(f); done(); }}>
            <input className={fieldClass} placeholder="Name (for example: Football, Drama club)" value={f.name || ''} onChange={set('name')} />
            <select className={fieldClass} value={f.kind || 'GAMES'} onChange={set('kind')}><Opts map={KIND_LABEL} /></select>
            <input className={fieldClass} placeholder="A short note (optional)" value={f.note || ''} onChange={set('note')} />
            {sheet.kind === 'edit' && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />Still running this year</label>}
          </FormSheet>)}
        {sheet?.kind === 'assign' && (
          <FormSheet title="Add a teacher" ok={!!f.staff} onClose={() => setSheet(null)} onSave={async () => { await teacherService.assign(f.activity, f.staff, f.role); done(); }}>
            <select className={fieldClass} value={f.staff || ''} onChange={set('staff')}><option value="">Choose a teacher</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select className={fieldClass} value={f.role || 'LEADER'} onChange={set('role')}><Opts map={ROLE_LABEL} /></select>
          </FormSheet>)}
        {sheet?.kind === 'event' && (
          <FormSheet title="Record an event" ok={!!f.date && (f.title || '').trim().length >= 2} onClose={() => setSheet(null)} onSave={async () => { await teacherService.addEvent(f); done(); }}>
            <input className={fieldClass} placeholder="Title (for example: Zonal football final)" value={f.title || ''} onChange={set('title')} />
            <input type="date" aria-label="Date" className={fieldClass} value={f.date || ''} onChange={set('date')} />
            <select className={fieldClass} value={f.level || 'SCHOOL'} onChange={set('level')}><Opts map={LEVEL_LABEL} /></select>
            <input className={fieldClass} placeholder="Result (for example: Runners-up)" value={f.result || ''} onChange={set('result')} />
          </FormSheet>)}
      </div>)}
    </FitPage>);
}
