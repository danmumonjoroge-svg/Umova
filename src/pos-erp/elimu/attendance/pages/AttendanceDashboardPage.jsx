// elimu/attendance/pages/AttendanceDashboardPage.jsx -- today's picture: which registers are done, totals, open absence cases.
// "Not marked" is shown as its own number and is never added to Absent.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, ClipboardList, AlertCircle } from 'lucide-react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { FitPage, DateField, MiniStats, LoadingBlock, EmptyBlock, CompletionPill, Notice, ErrorLine, btn } from '../../shared/components/kit';
import { attendanceService } from '../services/attendanceService';
import { calendarService, eventsOn } from '../../calendar/services/calendarService';

export default function AttendanceDashboardPage() {
  const { today, can } = useElimu();
  const [date, setDate] = useState(today()); const [sum, setSum] = useState(null); const [rows, setRows] = useState([]); const [day, setDay] = useState(null); const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, o, d, ev] = await Promise.all([attendanceService.summary({ date }), attendanceService.overview({ date }), attendanceService.isSchoolDay(date).catch(() => null), calendarService.range(date, date).catch(() => [])]);
      setSum(s); setRows(o || []); setDay(d); setEvents(eventsOn(ev, date));
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);
  const notSchool = day && day.is_school_day === false;
  return (
    <FitPage title="Attendance today" subtitle="Registers, totals and open cases">
      <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-[#DCE9DF] bg-gradient-to-br from-[#F1F8F3] to-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DCEFE2] text-[#1F6B45]"><CalendarCheck2 size={21} /></span><div><div className="text-sm font-semibold text-[#1D3B2A]">Register overview</div><div className="text-xs text-[#637267]">Choose a date to review submissions and attendance totals.</div></div></div>
        <div className="sm:min-w-[190px]"><DateField value={date} onChange={setDate} /></div>
      </div>
      <ErrorLine error={err} />
      {events.length > 0 && <Notice tone="good">{events.map((e) => e.title).join(' · ')}</Notice>}
      {notSchool && <Notice tone="good">{day.reason || 'This is not a school day.'} Registers are not expected.</Notice>}
      {loading ? <LoadingBlock /> : sum && (
        <>
          <MiniStats items={[
            { label: 'Present', value: sum.present }, { label: 'Absent', value: sum.absent }, { label: 'Late', value: sum.late },
            { label: 'Excused', value: sum.excused }, { label: 'Left early', value: sum.left_early }, { label: 'Not marked', value: sum.not_marked },
          ]} />
          <p className="text-xs text-[#6F7461] mb-2">Registers submitted: {sum.classes_submitted} of {sum.classes_total} ({sum.completion_pct}%). Deadline {String(sum.attendance_deadline || '').slice(0, 5)}. Students not yet marked are not counted as absent.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {(can('attendance.take_own') || can('attendance.take_any')) && <Link to="../take" className={`${btn} inline-flex items-center gap-2`}><ClipboardList size={15} /> Take attendance</Link>}
            {can('absence.manage') && <Link to="../absences" className={`${btn} inline-flex items-center gap-2`}><AlertCircle size={15} /> {sum.unresolved_absence_cases} open absence cases</Link>}
            {can('reports.view') && <Link to="../reports" className={btn}>{sum.repeated_absence_students} repeated absences</Link>}
          </div>
          {rows.length === 0 ? <EmptyBlock><b>No classes found.</b> Class lists come from the school's student records.</EmptyBlock> : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={`${r.class_id}|${r.stream_id || ''}`} className="flex flex-col gap-2 rounded-2xl border border-[#E1E8E1] bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="min-w-0"><div className="text-sm font-semibold text-[#23382B]">{[r.class_name, r.stream_name].filter(Boolean).join(' ')}</div>
                    <div className="mt-1 text-xs text-[#6F7461]">{r.marked ?? 0} of {r.enrolled ?? 0} marked{r.absent ? ` · ${r.absent} absent` : ''}</div></div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#E8EEE8]"><div className="h-full rounded-full bg-[#2E7D52]" style={{ width: `${Math.max(0, Math.min(100, Number(r.enrolled) ? (Number(r.marked || 0) / Number(r.enrolled)) * 100 : 0))}%` }} /></div><CompletionPill state={r.completion_state} /></div>
                </li>))}
            </ul>)}
        </>)}
    </FitPage>
  );
}
