// elimu/attendance/pages/AttendanceReportsPage.jsx -- pick a report + filters, view on screen, export CSV, print. Each run is audit-logged.
import React, { useEffect, useState } from 'react';
import { useElimu } from '../../shared/hooks/ElimuContext';
import { useFoundation } from '../../shared/hooks/useFoundation';
import { foundationService } from '../../shared/services/foundationService';
import { FitPage, DateField, SelectField, classOptions, splitClassValue, LoadingBlock, EmptyBlock, ErrorLine, btn, btnPrimary, NotConnected, Notice } from '../../shared/components/kit';
import { REPORTS, reportByKey } from '../reports/reportDefs';
import { reportService } from '../services/reportService';
import { cellText, downloadCsv, printReport } from '../reports/export';
import { addDays } from '../../shared/utils/time';

export default function AttendanceReportsPage() {
  const { today, schoolName } = useElimu(); const f = useFoundation({ terms: true });
  const [key, setKey] = useState('daily_register'); const [from, setFrom] = useState(addDays(today(), -29)); const [to, setTo] = useState(today());
  const [classVal, setClassVal] = useState(''); const [termId, setTermId] = useState(''); const [studentId, setStudentId] = useState(''); const [students, setStudents] = useState([]);
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState(null);
  const def = reportByKey(key); const { classId, streamId } = splitClassValue(classVal);
  useEffect(() => { setRows(null); setErr(null); }, [key]);
  useEffect(() => { let live = true; setStudentId(''); if (!classId) { setStudents([]); return; } foundationService.roster({ classId, streamId }).then((r) => live && setStudents(r.rows || [])).catch(() => {}); return () => { live = false; }; }, [classId, streamId]);
  const term = f.terms.find((t) => t.term_id === termId);
  const range = def.needs.includes('term') && term ? { from: term.start_date, to: term.end_date } : { from, to: def.needs.includes('date') ? from : to };
  const needMissing = (def.needs.includes('class') && !classId) || (def.needs.includes('student') && !studentId) || (def.needs.includes('term') && !term);
  const run = async () => {
    setLoading(true); setErr(null);
    try { const x = { ...range, classId, streamId, termId: termId || null, studentId: studentId || null }; const r = await def.run(x); setRows(Array.isArray(r) ? r : []); reportService.logGenerated(key, { ...x }, 'SCREEN'); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  };
  const subtitle = `${range.from}${range.to !== range.from ? ` to ${range.to}` : ''}`;
  const exportCsv = () => { downloadCsv(`${key}_${range.from}.csv`, def.columns, rows); reportService.logGenerated(key, range, 'CSV'); };
  const print = () => { printReport({ title: def.label, subtitle, schoolName, columns: def.columns, rows }); reportService.logGenerated(key, range, 'PRINT'); };
  return (
    <FitPage title="Attendance reports" subtitle="Students not marked are shown as not marked, never as absent">
      {!f.loading && !f.connected && <NotConnected />}
      <SelectField label="Report" value={key} onChange={(v) => setKey(v || 'daily_register')} options={REPORTS.map((r) => ({ value: r.key, label: r.label }))} placeholder="Choose" />
      {def.needs.includes('term') ? <SelectField label="Term" value={termId} onChange={(v) => setTermId(v || '')} options={f.terms.map((t) => ({ value: t.term_id, label: t.term_name || t.name }))} /> : (
        <div className="grid grid-cols-2 gap-x-3"><DateField label={def.needs.includes('date') ? 'Date' : 'From'} value={from} onChange={setFrom} max={today()} />{!def.needs.includes('date') && <DateField label="To" value={to} onChange={setTo} max={today()} />}</div>)}
      {!def.needs.includes('term') && <SelectField label={def.needs.includes('class') ? 'Class' : 'Class (optional)'} value={classVal} onChange={(v) => setClassVal(v || '')} options={classOptions(f.classStreams)} placeholder="All classes" />}
      {def.needs.includes('student') && <SelectField label="Student" value={studentId} onChange={(v) => setStudentId(v || '')} options={students.map((s) => ({ value: s.student_id, label: `${s.student_name} (${s.admission_number})` }))} placeholder={classId ? 'Choose student' : 'Choose a class first'} />}
      <ErrorLine error={err} />
      <button className={`${btnPrimary} w-full mb-3`} disabled={loading || needMissing} onClick={run}>{loading ? 'Running…' : 'Show report'}</button>
      {loading ? <LoadingBlock /> : rows && (rows.length === 0 ? <EmptyBlock><b>Nothing to show.</b> No records match these filters.</EmptyBlock> : (
        <>
          <div className="flex gap-2 mb-2"><button className={btn} onClick={exportCsv}>Download CSV</button><button className={btn} onClick={print}>Print</button><span className="text-xs text-[#6F7461] self-center">{rows.length} rows{rows.length >= 500 ? ' (first 500 — narrow the dates)' : ''}</span></div>
          <div className="overflow-x-auto rounded-xl border border-[#E3DBB8] bg-white"><table className="w-full text-xs"><thead><tr className="bg-[#F3EFD6] text-left">{def.columns.map((c) => <th key={c.key} className="px-2 py-1.5 whitespace-nowrap">{c.label}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i} className="border-t border-[#EFE9CB]">{def.columns.map((c) => <td key={c.key} className="px-2 py-1.5 whitespace-nowrap">{cellText(r, c)}</td>)}</tr>)}</tbody></table></div>
        </>))}
    </FitPage>
  );
}
