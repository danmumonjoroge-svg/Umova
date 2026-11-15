// elimu/timetable/pages/TimetablePage.jsx -- view the timetable by class, teacher or room; staff with timetable.manage can add/edit lessons.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { FitPage, SelectField, LoadingBlock, ErrorLine, NotConnected, classOptions, btn, btnPrimary, Notice } from '../../shared/components/kit';
import TimetableGrid from '../components/TimetableGrid';
import EntryEditor from '../components/EntryEditor';
import { timetableService } from '../services/timetableService';
import { attendanceService } from '../../attendance/services/attendanceService';
import { viewFilters } from '../utils/grid';
import { hhmm } from '../../shared/utils/time';

export default function TimetablePage() {
  const { can } = useElimu(); const f = useFoundation({ subjects: true, teachers: true, terms: true });
  const [termId, setTermId] = useState(''); const [view, setView] = useState('class'); const [who, setWho] = useState('');
  const [data, setData] = useState({ entries: [], periods: [], rooms: [], availability: [] }); const [hours, setHours] = useState(null);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(null); const [edit, setEdit] = useState(null);
  const manage = can('timetable.manage');
  useEffect(() => { if (!termId && f.terms.length) setTermId((f.terms.find((t) => t.is_current) || f.terms[0]).term_id); }, [f.terms, termId]);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [entries, periods, rooms, availability, s] = await Promise.all([timetableService.entries({ termId: termId || null }), timetableService.periods({ termId: termId || null }), timetableService.rooms(), timetableService.availability().catch(() => []), attendanceService.settings().catch(() => null)]);
      setData({ entries, periods, rooms, availability }); setHours(s ? { opening: s.opening_time, closing: s.closing_time } : null);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [termId]);
  useEffect(() => { load(); }, [load]);
  const options = useMemo(() => ({
    classes: classOptions(f.classStreams), subjects: f.subjects.map((s) => ({ value: s.subject_id, label: s.subject_name })), teachers: f.teachers.map((t) => ({ value: t.teacher_id, label: t.teacher_name })), rooms: data.rooms.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name })),
  }), [f, data.rooms]);
  const whoOptions = view === 'class' ? options.classes : view === 'teacher' ? options.teachers : options.rooms;
  const shown = useMemo(() => {
    if (!who) return [];
    if (view === 'class') { const [c, s] = who.split('|'); return data.entries.filter(viewFilters.class(c, s || null)); }
    return data.entries.filter(view === 'teacher' ? viewFilters.teacher(who) : viewFilters.room(who));
  }, [view, who, data.entries]);
  const ctx = useMemo(() => ({ entries: data.entries.map((e) => ({ ...e, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time) })), rooms: data.rooms, periods: data.periods, availability: data.availability, hours, teacherNames: Object.fromEntries(f.teachers.map((t) => [t.teacher_id, t.teacher_name])) }), [data, hours, f.teachers]);
  const label = (e) => ({ title: e.entry_kind === 'ACTIVITY' ? e.activity_label : f.names.subject(e.subject_id), sub: view === 'class' ? [f.names.teacher(e.teacher_id), data.rooms.find((r) => r.id === e.room_id)?.name].filter(Boolean).join(' · ') : f.classLabel(e.class_id, e.stream_id) });
  const seedFor = ({ day, row }) => ({ day_of_week: day, start_time: row.start, end_time: row.end, term_id: termId || null, ...(view === 'class' && who ? { class_id: who.split('|')[0], stream_id: who.split('|')[1] || null } : {}), ...(view === 'teacher' ? { teacher_id: who } : {}), ...(view === 'room' ? { room_id: who } : {}) });
  return (
    <FitPage title="Timetable" subtitle="Lessons by class, teacher or room">
      {!f.loading && !f.connected && <NotConnected />}
      <div className="grid grid-cols-2 gap-x-3">
        <SelectField label="Term" value={termId} onChange={(v) => setTermId(v || '')} options={f.terms.map((t) => ({ value: t.term_id, label: t.term_name || t.name }))} placeholder="No term" />
        <SelectField label="View" value={view} onChange={(v) => { setView(v || 'class'); setWho(''); }} options={[{ value: 'class', label: 'Class' }, { value: 'teacher', label: 'Teacher' }, { value: 'room', label: 'Room' }]} placeholder="Class" />
      </div>
      <SelectField label={view === 'class' ? 'Class' : view === 'teacher' ? 'Teacher' : 'Room'} value={who} onChange={(v) => setWho(v || '')} options={whoOptions} />
      <ErrorLine error={err} />
      {loading ? <LoadingBlock /> : !who ? <Notice tone="good">Choose who to show.</Notice> : (
        <TimetableGrid entries={shown} periods={data.periods} days={[1, 2, 3, 4, 5, ...(shown.some((e) => e.day_of_week === 6) ? [6] : [])]} label={label} onEntry={manage ? (e) => setEdit({ entry: e }) : undefined} onCell={manage ? (c) => setEdit({ seed: seedFor(c) }) : undefined} />)}
      {manage && who && <button className={`${btnPrimary} w-full mt-3`} onClick={() => setEdit({ seed: seedFor({ day: 1, row: { start: '', end: '' } }) })}>Add lesson</button>}
      {edit && <EntryEditor entry={edit.entry} seed={edit.seed} ctx={ctx} options={options} canOverride={can('timetable.override')} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </FitPage>
  );
}
