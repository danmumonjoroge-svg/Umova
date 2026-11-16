// elimu/attendance/pages/AttendanceDashboardPage.jsx -- today's picture: which registers are done, totals, open absence cases.
// "Not marked" is shown as its own number and is never added to Absent.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
      <DateField value={date} onChange={setDate} />
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
          <div className="flex gap-2 mb-3 flex-wrap">
            {can('absence.manage') && <Link to="../absences" className={btn}>{sum.unresolved_absence_cases} open absence cases</Link>}
            {can('reports.view') && <Link to="../reports" className={btn}>{sum.repeated_absence_students} repeated absences</Link>}
          </div>
          {rows.length === 0 ? <EmptyBlock><b>No classes found.</b> Class lists come from the school's student records.</EmptyBlock> : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={`${r.class_id}|${r.stream_id || ''}`} className="flex items-center justify-between rounded-xl border border-[#E3DBB8] bg-white px-3 py-2.5">
                  <div><div className="text-sm font-semibold text-[#23382B]">{[r.class_name, r.stream_name].filter(Boolean).join(' ')}</div>
                    <div className="text-xs text-[#6F7461]">{r.marked ?? 0} of {r.enrolled ?? 0} marked{r.absent ? ` · ${r.absent} absent` : ''}</div></div>
                  <CompletionPill state={r.completion_state} />
                </li>))}
            </ul>)}
        </>)}
    </FitPage>
  );
}
