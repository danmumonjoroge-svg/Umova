// Exam timetable (staff): choose the sitting date, time and venue for each assessment, then publish so parents can see it.
// The database refuses clashes (same class at overlapping times, or the same venue), so the message shown is the database's own.
import React, { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Pill } from '../../../components/CardKit';
import Sheet, { fieldClass } from '../../../components/workspace/Sheet';
import { useLoad } from '../../../components/network/networkKit';
import { useScope } from '../../academic/hooks/useScope';
import ScopeBar from '../../academic/components/ScopeBar';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';
import { examScheduleService } from '../../academic/services/examScheduleService';

const today = () => new Date().toISOString().slice(0, 10);
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const dayText = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

function SittingSheet({ row, onClose, onSaved }) {
  const [f, setF] = useState({ date: row.exam_date || '', start: hm(row.start_time) || '08:00', end: hm(row.end_time) || '10:00', venue: row.venue || '', notes: row.notes || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.date) return setErr('Choose the date.'); if (f.end <= f.start) return setErr('The end time must be after the start time.');
    setBusy(true); try { await examScheduleService.set(row.assessment_id, f); onSaved(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={row.name} onClose={onClose}>
      {err && <Note tone="bad">{err}</Note>}
      <p className="text-xs text-[#6F7461] mb-2">{row.class_name}{row.stream_name ? ` ${row.stream_name}` : ''} · {row.subject}</p>
      <div className="space-y-3">
        <input type="date" min={today()} className={fieldClass} value={f.date} onChange={set('date')} aria-label="Date" />
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-[#6F7461]">Starts<input type="time" className={fieldClass} value={f.start} onChange={set('start')} /></label><label className="text-xs text-[#6F7461]">Ends<input type="time" className={fieldClass} value={f.end} onChange={set('end')} /></label></div>
        <input className={fieldClass} placeholder="Venue (hall or room)" value={f.venue} onChange={set('venue')} /><input className={fieldClass} placeholder="Note for parents (optional), e.g. bring a calculator" value={f.notes} onChange={set('notes')} />
        <button type="button" disabled={busy} onClick={save} className="w-full min-h-[48px] rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save sitting'}</button>
      </div>
    </Sheet>);
}

export default function ExamTimetablePage() {
  const s = useScope(); const { scope } = s; const [edit, setEdit] = useState(null); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const ready = scope.yearId && scope.termId;
  const list = useLoad(() => (ready ? examScheduleService.list({ yearId: scope.yearId, termId: scope.termId, classId: scope.classId }) : Promise.resolve([])), [scope.yearId, scope.termId, scope.classId]);
  const rows = list.data || []; const scheduled = rows.filter((r) => r.exam_date); const unpublished = scheduled.filter((r) => !r.published);
  const publish = async (ids, on) => { setBusy(true); setMsg(null); try { await examScheduleService.publish(ids, on); setMsg({ tone: 'good', text: on ? 'Published. Parents can now see it.' : 'Hidden from parents.' }); list.reload(); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } finally { setBusy(false); } };
  return (
    <FitPage title="Exam timetable" subtitle="When and where each paper is sat" icon={CalendarClock}>
      <AccessGate>{(a) => {
        const can = a.can('config.manage') || a.can('marks.manage_all');
        return (<div className="space-y-3">
          <ScopeBar s={s} show={['year', 'term', 'class']} />
          {!can && <Note tone="warn">You can see the timetable. Only the exams officer or head can change or publish it.</Note>}
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
          {can && unpublished.length > 0 && <button type="button" disabled={busy} onClick={() => publish(unpublished.map((r) => r.assessment_id), true)} className="w-full min-h-[44px] rounded-xl border border-[#1F6B45] text-[#1F6B45] font-semibold disabled:opacity-50">Publish {unpublished.length} scheduled paper(s) to parents</button>}
          {list.loading ? <LoadingBlock /> : list.error ? <Note tone="bad">{list.error.message}</Note> : rows.length === 0 ? <EmptyBlock>No assessments for this term{scope.classId ? ' and class' : ''}. Create them under Exams &amp; assessments first.</EmptyBlock> : (
            <ul className="space-y-2">{rows.map((r) => (
              <li key={r.assessment_id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-semibold">{r.name}</div><div className="text-xs text-[#6F7461]">{r.class_name}{r.stream_name ? ` ${r.stream_name}` : ''} · {r.subject}</div></div>
                  {r.exam_date ? <Pill tone={r.published ? 'good' : 'warn'}>{r.published ? 'Published' : 'Not published'}</Pill> : <Pill tone="neutral">Not scheduled</Pill>}</div>
                {r.exam_date && <div className="mt-1 text-sm">{dayText(r.exam_date)} · {hm(r.start_time)}–{hm(r.end_time)}{r.venue ? ` · ${r.venue}` : ''}</div>}
                {can && <div className="mt-2 flex gap-2"><button type="button" onClick={() => setEdit(r)} className="px-3 min-h-[38px] rounded-lg border border-[#1F6B45] text-[#1F6B45] text-sm">{r.exam_date ? 'Change' : 'Set date and venue'}</button>
                  {r.exam_date && <button type="button" disabled={busy} onClick={() => publish([r.assessment_id], !r.published)} className="px-3 min-h-[38px] rounded-lg border border-[#E3DBB8] text-sm disabled:opacity-50">{r.published ? 'Hide from parents' : 'Publish'}</button>}</div>}
              </li>))}</ul>)}
          {edit && <SittingSheet row={edit} onClose={() => setEdit(null)} onSaved={() => list.reload()} />}
        </div>);
      }}</AccessGate>
    </FitPage>);
}
