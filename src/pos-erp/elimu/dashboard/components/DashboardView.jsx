// elimu/dashboard/components/DashboardView.jsx -- the school at a glance.
// Cards are different sizes and shapes on purpose: the biggest thing (the people in school) is the biggest card, today's attendance is a dial,
// fees look like a ledger page, gate passes like a ticket, what needs attention like a sticky note. Every block is optional: a section the
// person may not see arrives as null and its card is simply not drawn, and the grid closes up around it.
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Notice } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { dashboardService, attentionItems } from '../services/dashboardService.js';
import { friendlyError } from '../../utils/validation.js';
import { C, HBars, StackedBars } from './charts.jsx';
import { HeroStudents, AttendanceGauge, FeesLedger, GateTicket, BookSpine, AttentionNote, ClassMosaic, StatPill, Wash, ActionDock, DashboardSkeleton, V, num } from '../../ui/cards/index.js';

const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function DashboardView({ basePath = '/school', heading, subheading, attention = [], links = [] }) {
  const s = useAsync(() => dashboardService.get(), []); const tr = useAsync(() => dashboardService.trends(), []);
  const d = s.data; const t = tr.data; const todo = attentionItems(d);
  const reload = () => { s.reload(); tr.reload(); };
  const refresh = <button type="button" onClick={reload} aria-label="Refresh" className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-full text-xs font-semibold hover:bg-[#F4EFD3]" style={{ border: `1px dashed ${V.mutedSoft}`, color: V.text }}><RefreshCw size={14} className={s.loading ? 'animate-spin' : ''} />Refresh</button>;
  const head = (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0"><p className="text-[13px] font-semibold" style={{ color: V.accentDeep }}>{greeting()}</p>
        <h1 className="text-[22px] md:text-[28px] leading-tight font-black truncate" style={{ color: V.dark }}>{heading || 'Dashboard'}</h1>
        <p className="text-sm" style={{ color: V.muted }}>{subheading || new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>{refresh}</div>);
  if (s.loading && !d) return <div>{head}<DashboardSkeleton /></div>;
  if (s.error && !d) return <div>{head}<Notice tone="bad">{friendlyError(s.error)}</Notice></div>;
  const st = d.students, at = d.attendance, fe = d.fees, ga = d.gate, up = d.upcoming;
  const rate = at ? (Number(at.marked) > 0 ? Math.round((Number(at.present) / Number(at.marked)) * 100) : null) : null;
  const attDays = t?.attendance_days || []; const feeDays = t?.fee_days || []; const methods = t?.fee_methods || [];
  const needs = [...attention, ...todo.map((x) => ({ id: x, title: x }))];
  const classRows = (st?.by_class || []).map((c) => ({ label: c.class_name, value: Number(c.students) }));
  const attClassRows = (t?.attendance_by_class || []).map((c) => ({ label: c.class_name, value: Number(c.marked) > 0 ? Math.round((Number(c.present) / Number(c.marked)) * 100) : 0 }));
  const pills = up ? [{ label: 'live notices', v: up.live_notices }, { label: 'trips in 14 days', v: up.trips_14_days }, { label: 'open assignments', v: up.open_assignments }] : [];
  return (
    <div>
      {head}
      {(links.length > 0 || pills.length > 0) && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <ActionDock links={links} />
          <div className="flex flex-wrap gap-1.5">{pills.map((p) => <StatPill key={p.label} label={p.label} value={p.v} />)}</div>
        </div>)}

      {/* 6 columns on a tablet, 12 on a laptop. The spans are uneven on purpose. */}
      <div className="grid grid-cols-6 lg:grid-cols-12 gap-3 md:gap-4">
        {st && <div className="col-span-6 lg:col-span-5"><HeroStudents active={st.active} boys={st.boys} girls={st.girls} left30={st.left_30_days} pending={st.pending_admissions} to={`${basePath}/students`} /></div>}
        {at && <div className="col-span-6 md:col-span-3 lg:col-span-4"><AttendanceGauge rate={rate} present={at.present} excused={at.excused} absent={at.absent} submitted={at.classes_submitted} expected={at.classes_expected} to={`${basePath}/attendance`} /></div>}
        {(ga || up) && (
          <div className={`col-span-6 md:col-span-3 ${st ? 'lg:col-span-3' : 'lg:col-span-4'} flex flex-col gap-3 md:gap-4`}>
            {ga && <div className="flex-1"><GateTicket waiting={ga.waiting_parent} cleared={ga.cleared_waiting_gate} exited={ga.exited_today} to={`${basePath}/gate-passes`} /></div>}
            {up && <BookSpine title={Number(up.overdue_books) === 1 ? 'book overdue' : 'books overdue'} count={up.overdue_books} tone={Number(up.overdue_books) > 0 ? 'bad' : 'ok'} hint={Number(up.overdue_books) > 0 ? 'Remind the borrowers' : 'All books are back on time'} to={`${basePath}/academics/books`} />}
          </div>)}

        {fe && <div className="col-span-6 lg:col-span-7"><FeesLedger today={fe.collected_today} week={fe.collected_7_days} month={fe.collected_30_days} outstanding={fe.outstanding} owing={fe.students_owing} days={feeDays} methods={methods} /></div>}
        <div className={`col-span-6 ${fe ? 'lg:col-span-5' : 'lg:col-span-12'}`}><AttentionNote items={needs} /></div>

        {at && (
          <div className={`col-span-6 ${attClassRows.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
            <Wash title="How the last two weeks went" aside={<span className="text-xs" style={{ color: V.muted }}>school days only</span>}>
              {attDays.length >= 2
                ? <StackedBars label="Attendance by day" days={attDays.map((x) => ({ label: dayLabel(x.date), parts: [{ value: Number(x.present), color: C.primary }, { value: Number(x.excused), color: C.accent }, { value: Number(x.absent), color: C.bad }] }))}
                    legend={[{ label: 'Present', color: C.primary }, { label: 'Excused', color: C.accent }, { label: 'Absent', color: C.bad }]} />
                : <p className="text-sm" style={{ color: V.muted }}>{tr.data === null && !tr.loading ? 'The daily trend appears once the chart update (elimu_1019) is installed.' : 'The trend appears after a few days of registers.'}</p>}
            </Wash>
          </div>)}
        {attClassRows.length > 0 && <div className="col-span-6 lg:col-span-4"><Wash tone="white" title="Class by class, today"><HBars rows={attClassRows.map((r) => ({ ...r, color: r.value < 85 ? C.bad : C.primary }))} format={(v) => `${v}%`} /></Wash></div>}

        {st && <div className="col-span-6 lg:col-span-12"><Wash tone="white" title="Who is in which class" aside={<span className="text-xs" style={{ color: V.muted }}>{num(classRows.length)} classes</span>}><ClassMosaic rows={classRows} to={`${basePath}/classes`} /></Wash></div>}
      </div>
      <p className="text-xs mt-4" style={{ color: V.muted }}>Updated {new Date(d.as_of).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}.</p>
    </div>
  );
}
