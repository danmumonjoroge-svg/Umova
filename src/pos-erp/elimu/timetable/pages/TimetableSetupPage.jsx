// elimu/timetable/pages/TimetableSetupPage.jsx -- rooms, daily periods (breaks and lunch included) and teacher availability.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { FitPage, LoadingBlock, Field, TimeField, SelectField, fieldClass, btn, btnPrimary, ErrorLine, Pill } from '../../shared/components/kit';
import { timetableService } from '../services/timetableService';
import { timeRange, DAY_NAMES } from '../../shared/utils/time';

const PERIOD_TYPES = ['LESSON', 'BREAK', 'LUNCH', 'ASSEMBLY', 'ACTIVITY', 'OTHER'];
const ROOM_TYPES = ['CLASSROOM', 'LABORATORY', 'WORKSHOP', 'HALL', 'SPORTS_GROUND', 'LIBRARY', 'COMPUTER_LAB', 'OTHER'];

export default function TimetableSetupPage() {
  const { tenantId, businessId, userId, can } = useElimu(); const f = useFoundation({ teachers: true }); const edit = can('timetable.manage');
  const [rooms, setRooms] = useState([]); const [periods, setPeriods] = useState([]); const [avail, setAvail] = useState([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [room, setRoom] = useState({ name: '', room_type: 'CLASSROOM', capacity: '' }); const [per, setPer] = useState({ name: '', period_type: 'LESSON', start_time: null, end_time: null });
  const [av, setAv] = useState({ staff_id: '', kind: 'UNAVAILABLE_PERIOD', day_of_week: '1', start_time: null, end_time: null, start_date: '', end_date: '', reason: '' });
  const load = useCallback(async () => { setLoading(true); try { const [r, p, a] = await Promise.all([timetableService.rooms(), timetableService.periods(), timetableService.availability()]); setRooms(r); setPeriods(p); setAvail(a); } catch (e) { setErr(e.message); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const run = (fn) => async () => { setErr(null); try { await fn(); await load(); } catch (e) { setErr(e.message); } };
  const base = { tenant_id: tenantId, business_id: businessId, created_by: userId ?? null };
  return (
    <FitPage title="Timetable setup" subtitle="Rooms, periods and teacher availability">
      <ErrorLine error={err} />{loading && <LoadingBlock />}
      <h3 className="text-sm font-bold mb-1">Periods</h3>
      <ul className="mb-2 space-y-1">{periods.map((p) => <li key={p.id} className="flex justify-between items-center text-sm rounded-lg bg-white border border-[#E3DBB8] px-3 py-1.5"><span>{p.name} · {timeRange(p.start_time, p.end_time)}</span><span className="flex gap-1.5 items-center"><Pill tone={p.is_teaching ? 'good' : 'neutral'}>{p.period_type.toLowerCase()}</Pill>{edit && <button className="text-xs text-[#B23A2E] min-h-[36px] px-1" onClick={run(() => timetableService.removePeriod(p.id))}>Remove</button>}</span></li>)}</ul>
      {edit && <div className="grid grid-cols-2 gap-x-3 mb-4"><Field label="Name"><input className={fieldClass} value={per.name} onChange={(e) => setPer({ ...per, name: e.target.value })} /></Field>
        <SelectField label="Type" value={per.period_type} onChange={(v) => setPer({ ...per, period_type: v || 'LESSON' })} options={PERIOD_TYPES.map((t) => ({ value: t, label: t.toLowerCase() }))} placeholder="Lesson" />
        <TimeField label="Starts" value={per.start_time} onChange={(v) => setPer({ ...per, start_time: v })} /><TimeField label="Ends" value={per.end_time} onChange={(v) => setPer({ ...per, end_time: v })} />
        <button className={`${btnPrimary} col-span-2`} disabled={!per.name || !per.start_time || !per.end_time} onClick={run(async () => { await timetableService.savePeriod({ ...base, ...per }); setPer({ name: '', period_type: 'LESSON', start_time: null, end_time: null }); })}>Add period</button></div>}
      <h3 className="text-sm font-bold mb-1">Rooms</h3>
      <ul className="mb-2 space-y-1">{rooms.map((r) => <li key={r.id} className="flex justify-between text-sm rounded-lg bg-white border border-[#E3DBB8] px-3 py-1.5"><span>{r.name}{r.capacity ? ` · seats ${r.capacity}` : ''}</span><Pill tone={r.is_active ? 'good' : 'neutral'}>{r.is_active ? r.room_type.toLowerCase() : 'not in use'}</Pill></li>)}</ul>
      {edit && <div className="grid grid-cols-2 gap-x-3 mb-4"><Field label="Name"><input className={fieldClass} value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} /></Field>
        <Field label="Capacity"><input type="number" min="1" className={fieldClass} value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} /></Field>
        <SelectField label="Type" value={room.room_type} onChange={(v) => setRoom({ ...room, room_type: v || 'CLASSROOM' })} options={ROOM_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ').toLowerCase() }))} placeholder="Classroom" />
        <button className={`${btnPrimary} self-end mb-2.5`} disabled={!room.name} onClick={run(async () => { await timetableService.saveRoom({ ...base, name: room.name.trim(), room_type: room.room_type, capacity: room.capacity ? Number(room.capacity) : null }); setRoom({ name: '', room_type: 'CLASSROOM', capacity: '' }); })}>Add room</button></div>}
      <h3 className="text-sm font-bold mb-1">Teacher availability</h3>
      <ul className="mb-2 space-y-1">{avail.map((a) => <li key={a.id} className="flex justify-between text-sm rounded-lg bg-white border border-[#E3DBB8] px-3 py-1.5"><span>{f.names.teacher(a.staff_id) || 'Teacher'} · {a.kind === 'LEAVE' ? `on leave ${a.start_date} to ${a.end_date}` : a.kind === 'WORKING_DAY' ? `works ${DAY_NAMES[a.day_of_week]}` : `not available ${DAY_NAMES[a.day_of_week]} ${timeRange(a.start_time, a.end_time)}`}</span>{edit && <button className="text-xs text-[#B23A2E] min-h-[36px] px-1" onClick={run(() => timetableService.removeAvailability(a.id))}>Remove</button>}</li>)}</ul>
      {edit && <div className="grid grid-cols-2 gap-x-3"><SelectField label="Teacher" value={av.staff_id} onChange={(v) => setAv({ ...av, staff_id: v || '' })} options={f.teachers.map((t) => ({ value: t.teacher_id, label: t.teacher_name }))} />
        <SelectField label="Kind" value={av.kind} onChange={(v) => setAv({ ...av, kind: v || 'UNAVAILABLE_PERIOD' })} options={[{ value: 'WORKING_DAY', label: 'Works this day' }, { value: 'UNAVAILABLE_PERIOD', label: 'Not available at a time' }, { value: 'LEAVE', label: 'On leave' }]} placeholder="Kind" />
        {av.kind !== 'LEAVE' && <SelectField label="Day" value={av.day_of_week} onChange={(v) => setAv({ ...av, day_of_week: v || '1' })} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: DAY_NAMES[n] }))} placeholder="Day" />}
        {av.kind === 'UNAVAILABLE_PERIOD' && <><TimeField label="From" value={av.start_time} onChange={(v) => setAv({ ...av, start_time: v })} /><TimeField label="To" value={av.end_time} onChange={(v) => setAv({ ...av, end_time: v })} /></>}
        {av.kind === 'LEAVE' && <><Field label="From"><input type="date" className={fieldClass} value={av.start_date} onChange={(e) => setAv({ ...av, start_date: e.target.value })} /></Field><Field label="To"><input type="date" className={fieldClass} value={av.end_date} onChange={(e) => setAv({ ...av, end_date: e.target.value })} /></Field></>}
        <button className={`${btnPrimary} col-span-2`} disabled={!av.staff_id} onClick={run(async () => { const { day_of_week, start_time, end_time, start_date, end_date, ...rest } = av; await timetableService.saveAvailability({ ...base, ...rest, day_of_week: av.kind === 'LEAVE' ? null : Number(day_of_week), start_time: av.kind === 'UNAVAILABLE_PERIOD' ? start_time : null, end_time: av.kind === 'UNAVAILABLE_PERIOD' ? end_time : null, start_date: av.kind === 'LEAVE' ? start_date || null : null, end_date: av.kind === 'LEAVE' ? end_date || null : null }); })}>Add</button></div>}
    </FitPage>
  );
}
