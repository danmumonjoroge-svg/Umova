// elimu/teachers/pages/TeacherReportPage.jsx -- one teacher, one term. `own` = "My report" (a teacher sees only themself).
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, Printer, FileText, Table } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { friendlyError } from '../../utils/validation.js';
import { C, HBars } from '../../dashboard/components/charts.jsx';
import { Wash, InfoCard, StatPill, EmptyNote, V } from '../../ui/cards/index.js';
import { reportCsv, reportPdfLines, buildPdf, download, fileSafe } from '../services/teacherExport.js';
import { teacherService, teacherNotes, groupName, pts, pctText, money, KIND_LABEL, ROLE_LABEL, LEVEL_LABEL } from '../services/teacherService.js';

// Printing: only the report is drawn (whatever menus the app has around it are hidden), with the dark header kept dark.
const PRINT_CSS = '.tr-printonly{display:none}@media print{.tr-printonly{display:block!important;font-size:20px;font-weight:800;margin-bottom:8px}body *{visibility:hidden}#teacher-report,#teacher-report *{visibility:visible}#teacher-report{position:absolute;left:0;top:0;width:100%}#teacher-report section,#teacher-report div{-webkit-print-color-adjust:exact;print-color-adjust:exact}#teacher-report .print\\:hidden{display:none!important}}';
const day = (v) => new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const btn = 'min-h-[40px] px-3.5 rounded-xl text-xs font-semibold border disabled:opacity-50';
const toneColor = { bad: V.bad, ok: V.primary, info: V.muted };

function Big({ label, value, sub }) { return <div className="min-w-0"><div className="text-[11px] uppercase tracking-wide" style={{ color: V.muted }}>{label}</div><div className="text-[26px] leading-none font-black tabular-nums" style={{ color: V.dark }}>{value}</div>{sub && <div className="text-xs mt-1">{sub}</div>}</div>; }
const Change = ({ v }) => (v == null ? null : <span style={{ color: Number(v) < 0 ? V.bad : V.primary }}>{Number(v) < 0 ? '▼' : '▲'} {pts(Math.abs(v)).replace('+', '')}</span>);

function PerformanceCard({ r }) {
  const grades = Object.entries(r.grades || {});
  const bars = (r.streams || []).map((s) => ({ label: s.name, value: Number(s.mean), color: s.is_mine ? C.primary : C.accent }));
  return (
    <InfoCard title={groupName(r)} aside={r.subject_rank ? <span className="text-xs" style={{ color: V.muted }}>{r.subject_rank} of {r.subjects_in_class} subjects in class</span> : null}>
      {r.learners === 0 ? <p className="text-sm" style={{ color: V.muted }}>No finished results for this class this term yet.</p> : (<div className="space-y-3">
        <div className="grid grid-cols-3 gap-3"><Big label="Average" value={pctText(r.mean)} sub={<Change v={r.change} />} /><Big label="Class average" value={pctText(r.class_mean)} /><Big label="Pass rate" value={r.pass_rate == null ? '-' : `${Math.round(r.pass_rate)}%`} /></div>
        <div className="text-xs" style={{ color: V.muted }}>{r.learners} learners - highest {pctText(r.highest)} - lowest {pctText(r.lowest)}{r.previous_mean != null && ` - last term ${pctText(r.previous_mean)}`}</div>
        {grades.length > 0 && <div className="flex flex-wrap gap-1.5">{grades.sort().map(([g, n]) => <StatPill key={g} label={`grade ${g}`} value={n} />)}</div>}
        {bars.length >= 2 && (<div><div className="text-xs font-semibold mb-1.5" style={{ color: V.text }}>Compared with the other streams{r.stream_rank ? ` - ranked ${r.stream_rank} of ${r.stream_count}` : ''} <span className="font-normal" style={{ color: V.muted }}>(green = this teacher)</span></div>
          <HBars rows={bars} format={(v) => `${Number(v).toFixed(1)}%`} />
          <div className="text-[11px] mt-1" style={{ color: V.muted }}>{(r.streams || []).filter((s) => !s.is_mine && s.teacher).map((s) => `${s.name}: ${s.teacher}`).join(' - ')}</div></div>)}
      </div>)}
    </InfoCard>);
}

function PayCard({ rep, onChanged }) {
  const p = rep.pay; const [open, setOpen] = useState(false); const [list, setList] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const link = async (emp) => { setBusy(true); setErr(''); try { await teacherService.payLink(rep.teacher.id, emp); setOpen(false); onChanged(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  const choose = async () => { setOpen(true); try { setList(await teacherService.payCandidates()); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <InfoCard title="Pay" aside={<span className="text-xs" style={{ color: V.muted }}>Only people with the finance approval right see this</span>}>
      {err && <Notice tone="bad">{err}</Notice>}
      {p?.linked ? (<div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Big label="Basic" value={money(p.basic)} /><Big label="Allowances" value={money(p.allowances)} /><Big label="Gross a month" value={money(p.gross)} />{p.last_net != null && <Big label={`Take-home ${p.last_period || ''}`} value={money(p.last_net)} />}</div>) : (
        <div className="space-y-2"><p className="text-sm" style={{ color: V.muted }}>This teacher is not yet linked to a payroll employee, so their pay cannot be shown. Link them once and it stays linked.</p>
          {p?.suggested && <button type="button" disabled={busy} className={btn} style={{ borderColor: V.border, background: '#fff' }} onClick={() => link(p.suggested.id)}>Link to "{p.suggested.name}"</button>}
          <button type="button" className={`${btn} ml-2`} style={{ borderColor: V.border, background: '#fff' }} onClick={choose}>Choose another employee</button></div>)}
      {p?.linked && <button type="button" className={`${btn} mt-3`} style={{ borderColor: V.border, background: '#fff' }} onClick={choose}>Change link</button>}
      {open && <Sheet title="Link to a payroll employee" onClose={() => setOpen(false)}><div className="space-y-2">{list.length === 0 ? <p className="text-sm">There are no unlinked payroll employees.</p> : list.map((e) => <button key={e.id} type="button" disabled={busy} className="w-full text-left min-h-[48px] px-3 rounded-xl border text-sm" style={{ borderColor: V.border }} onClick={() => link(e.id)}><b>{e.name}</b>{e.job_title && <span style={{ color: V.muted }}> - {e.job_title}</span>}</button>)}</div></Sheet>}
    </InfoCard>);
}

export function ReportBody({ d, own, basePath, term, setTerm, reload }) {
  const notes = teacherNotes(d); const base = `teacher-report-${fileSafe(d.teacher.name)}-${fileSafe(`${d.term.name}-${d.term.year}`)}`;
  return (
    <div id="teacher-report" className="space-y-3">
      <style>{PRINT_CSS}</style>
      <h1 className="tr-printonly">{`Teacher report - ${d.teacher.name} - ${d.term.name} ${d.term.year}`}</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {!own && <Link to={`${basePath}/teachers`} className={btn} style={{ borderColor: V.border, background: '#fff', display: 'inline-flex', alignItems: 'center' }}>All teachers</Link>}
          <select aria-label="Term" className={`${fieldClass} !w-auto`} value={term || d.term.id} onChange={(e) => setTerm(e.target.value)}>{d.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button type="button" className={btn} style={{ borderColor: V.border, background: '#fff' }} onClick={() => window.print()}><Printer size={14} className="inline mr-1" />Print</button>
          <button type="button" className={btn} style={{ borderColor: V.border, background: '#fff' }} onClick={() => download(`${base}.csv`, reportCsv(d), 'text/csv;charset=utf-8')}><Table size={14} className="inline mr-1" />CSV</button>
          <button type="button" className={btn} style={{ borderColor: V.border, background: '#fff' }} onClick={() => download(`${base}.pdf`, buildPdf(reportPdfLines(d)), 'application/pdf')}><FileText size={14} className="inline mr-1" />PDF</button>
        </div>
        <section className="p-4 md:p-5" style={{ background: V.dark, color: V.onDark, borderRadius: '34px 34px 34px 10px' }}>
          <div className="text-xs opacity-80">{(d.teacher.roles || []).map((x) => x.replace('_', ' ')).join(' - ')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
            <div><div className="text-[11px] uppercase opacity-70">Average</div><div className="text-[30px] font-black leading-none">{pctText(d.performance.overall_mean)}</div><div className="text-xs mt-1 opacity-90">{d.performance.change != null ? `${Number(d.performance.change) < 0 ? '▼' : '▲'} ${Math.abs(d.performance.change)} pts on last term` : ''}</div></div>
            <div><div className="text-[11px] uppercase opacity-70">Learners taught</div><div className="text-[30px] font-black leading-none">{d.load.learners}</div></div>
            <div><div className="text-[11px] uppercase opacity-70">Classes - subjects</div><div className="text-[30px] font-black leading-none">{d.load.classes} - {d.load.subjects}</div></div>
            <div><div className="text-[11px] uppercase opacity-70">Lessons a week</div><div className="text-[30px] font-black leading-none">{d.load.lessons_per_week}</div></div>
          </div>
        </section>
        {notes.length > 0 && <Wash title="Worth a look"><ul className="space-y-1.5">{notes.map((n, i) => <li key={i} className="text-sm flex gap-2"><span aria-hidden style={{ color: toneColor[n.tone] }}>●</span><span>{n.text}</span></li>)}</ul></Wash>}
        <h2 className="text-[15px] font-extrabold pt-1" style={{ color: V.dark }}>Classes and subjects taught</h2>
        {d.performance.rows.length === 0 ? <EmptyNote title="No classes allocated">This teacher has no subjects allocated for this term. Allocate them under Academics &gt; Teacher allocations.</EmptyNote> : <div className="grid gap-3 md:grid-cols-2">{d.performance.rows.map((x) => <PerformanceCard key={`${x.class_id}-${x.stream_id}-${x.subject_id}`} r={x} />)}</div>}
        {d.class_teacher.length > 0 && <InfoCard title="Class teacher duties"><ul className="space-y-2">{d.class_teacher.map((c) => <li key={`${c.class_id}${c.stream_id}`} className="text-sm"><b>{c.class_name}{c.stream_name ? ` ${c.stream_name}` : ''}</b> - {c.learners} learners{c.class_mean != null && ` - class average ${pctText(c.class_mean)}`}{Number(c.cards_total) > 0 && ` - ${c.cards_with_remarks} of ${c.cards_total} report cards have a remark`}</li>)}</ul></InfoCard>}
        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard title="Marking"><div className="text-sm space-y-1"><div>{d.marking.assessments} exams and tests set</div><div>{d.marking.locked} finished and locked</div><div style={{ color: Number(d.marking.marks_pending) > 0 ? V.bad : V.text }}>{d.marking.marks_pending} marks still to enter</div></div></InfoCard>
          <InfoCard title="Registers"><div className="text-sm space-y-1"><div>{d.attendance?.lessons_taken ?? 0} lesson registers opened</div><div>{d.attendance?.lessons_submitted ?? 0} submitted</div></div></InfoCard>
          <InfoCard title="Assignments"><div className="text-sm space-y-1"><div>{d.assignments?.set ?? 0} set this term</div><div>{d.assignments?.handed_in ?? 0} handed in</div><div>{d.assignments?.marked ?? 0} marked</div></div></InfoCard>
        </div>
        <InfoCard title="Games, clubs and other activities" aside={<span className="text-xs" style={{ color: V.muted }}>This year</span>}>
          {d.activities.length === 0 ? <p className="text-sm" style={{ color: V.muted }}>Not on any activity this year.</p> : <ul className="space-y-1.5">{d.activities.map((a) => <li key={a.activity_id} className="text-sm"><b>{a.name}</b> - {KIND_LABEL[a.kind]} - <span style={{ color: a.role === 'LEADER' ? V.primary : V.muted }}>{ROLE_LABEL[a.role]}</span></li>)}</ul>}
          {d.events.length > 0 && <div className="mt-3 pt-3 border-t" style={{ borderColor: V.border2 }}><div className="text-xs font-semibold mb-1.5">Events and results this term</div><ul className="space-y-1">{d.events.map((e, i) => <li key={i} className="text-sm">{day(e.date)} - {e.activity}: {e.title} ({LEVEL_LABEL[e.level]}){e.result ? ` - ${e.result}` : ''}</li>)}</ul></div>}
        </InfoCard>
        {d.pay_visible && <PayCard rep={d} onChanged={reload} />}
      </div>
  );
}

export default function TeacherReportPage({ basePath = '/school', own = false }) {
  const params = useParams(); const staff = own ? null : params.id; const [term, setTerm] = useState('');
  const r = useAsync(() => teacherService.report(staff, term), [staff, term]);
  const d = r.data;
  return (
    <FitPage title={own ? 'My report' : (d?.teacher?.name || 'Teacher report')} icon={ClipboardList} subtitle={d ? `${d.term.name} ${d.term.year}` : 'Teacher report'}>
      {r.error && !d && <Notice tone="bad">{r.error}</Notice>}
      {r.loading && !d && <LoadingBlock />}
      {d && <ReportBody d={d} own={own} basePath={basePath} term={term} setTerm={setTerm} reload={r.reload} />}
    </FitPage>);
}
