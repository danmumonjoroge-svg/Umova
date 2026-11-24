// elimu/import/pages/ImportResultsPage.jsx -- past exam results. Layout WIDE (one column per subject) or LONG (one row per mark).
// Steps: file -> match -> check (nothing created) -> review -> save. Saved exams are locked, weight 0, and show in each student's progress report.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { ConfirmSheet } from '../../shared/components/kit.jsx';
import { importService } from '../services/importService.js';
import { readTable } from '../utils/readSheet.js';
import { LONG_FIELDS, LONG_TEMPLATE_CSV, WIDE_TEMPLATE_CSV, autoMapLong, buildLongRows, guessWide, longProblems, pivotWide, wideProblems } from '../utils/resultsImport.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const Tile = ({ n, label, tone = '' }) => <div className={`rounded-xl border border-[#E3DBB8] bg-white p-3 text-center ${tone}`}><div className="text-xl font-bold">{n}</div><div className="text-[11px] text-[#6F7461]">{label}</div></div>;
const MAX_ROWS = 20000;

export default function ImportResultsPage({ basePath = '/elimu' }) {
  const [layout, setLayout] = useState('WIDE'); const [table, setTable] = useState(null); const [fileName, setFileName] = useState('');
  const [map, setMap] = useState({}); const [wide, setWide] = useState({ adm: -1, cls: -1, subjects: [] }); const [fixed, setFixed] = useState({ year: '', term: '', exam: '', class: '', out_of: '100', date: '' });
  const [batch, setBatch] = useState(null); const [rows, setRows] = useState([]); const [filter, setFilter] = useState('ERROR'); const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const problems = useMemo(() => (!table ? [] : layout === 'WIDE' ? wideProblems(wide, fixed) : longProblems(map)), [table, layout, wide, fixed, map]);
  const built = useMemo(() => (!table ? [] : layout === 'WIDE' ? pivotWide(table.headers, table.rows, wide, fixed) : buildLongRows(table.rows, map)), [table, layout, wide, fixed, map]);
  const setF = (k) => (e) => setFixed((f) => ({ ...f, [k]: e.target.value }));
  const toggleSubject = (i) => setWide((w) => ({ ...w, subjects: w.subjects.includes(i) ? w.subjects.filter((x) => x !== i) : [...w.subjects, i].sort((a, b) => a - b) }));

  const pick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return; setErr(''); setTable(null); setBatch(null); setDone(null); setBusy(true);
    try { const t = await readTable(f); setTable(t); setFileName(f.name); setMap(autoMapLong(t.headers)); setWide(guessWide(t.headers)); } catch (x) { setErr(x.message); }
    setBusy(false); e.target.value = '';
  };
  const loadRows = async (id, status) => { try { setRows(await importService.rows(id, status === 'ALL' ? null : status)); } catch (x) { setErr(friendlyError(x)); } };
  const check = async () => {
    setErr(''); if (built.length === 0) return setErr('There are no marks to check.'); if (built.length > MAX_ROWS) return setErr(`Import at most ${MAX_ROWS} marks at a time. Split the file by year or class.`);
    setBusy(true);
    try { const r = await importService.stageResults({ fileName, rows: built }); setBatch(r); const f = r.error_count > 0 ? 'ERROR' : 'WARN'; setFilter(f); await loadRows(r.batch_id, f); } catch (x) { setErr(friendlyError(x)); }
    setBusy(false);
  };
  const commit = async () => { setBusy(true); setErr(''); try { setDone(await importService.commitResults(batch.batch_id)); setConfirm(false); setBatch(null); setTable(null); } catch (x) { setErr(friendlyError(x)); setConfirm(false); } setBusy(false); };
  const startOver = async () => { setBusy(true); try { if (batch) await importService.discard(batch.batch_id); } catch (x) { setErr(friendlyError(x)); } setBatch(null); setRows([]); setBusy(false); };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([layout === 'WIDE' ? WIDE_TEMPLATE_CSV : LONG_TEMPLATE_CSV], { type: 'text/csv' })); a.download = `results-${layout.toLowerCase()}-template.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const n = batch ? batch.ok_count : 0;

  return (
    <FitPage title="Import past results" subtitle="Bring old exam marks so progress reports show a student's history" icon={GraduationCap}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {done && <Notice tone="good">Saved {done.imported} mark{done.imported === 1 ? '' : 's'} in {done.exams} exam{done.exams === 1 ? '' : 's'}.{done.skipped_no_mark > 0 ? ` ${done.skipped_no_mark} blank skipped.` : ''}{done.failed > 0 ? ` ${done.failed} could not be saved; see the import log.` : ''}{done.skipped_with_errors > 0 ? ` ${done.skipped_with_errors} row${done.skipped_with_errors === 1 ? '' : 's'} with errors left out.` : ''} <Link className="underline" to={`${basePath}/import/log`}>Import log</Link></Notice>}

        {!batch && (<>
          <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-3">
            <div className="text-sm font-semibold">1. Choose the layout and the file</div>
            <div className="flex gap-1.5">{[['WIDE', 'One column per subject'], ['LONG', 'One row per mark']].map(([k, l]) => <button key={k} type="button" onClick={() => setLayout(k)} className={`h-10 px-3 rounded-full text-xs font-semibold border ${layout === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btnP} inline-flex items-center cursor-pointer`}>Choose Excel or CSV file<input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={pick} /></label>
              <button type="button" className={btnS} onClick={download}>Download template</button>
            </div>
            <p className="text-xs text-[#6F7461]">{layout === 'WIDE' ? 'One file per exam and class: a row per student, a column per subject (the heading must match the subject name or code in Settings). Total, mean and position columns are ignored.' : 'Each row is one mark: student, year, term, class, subject, exam name and marks (or ABS for absent).'} Years, terms, classes, subjects and students must already exist. Saved exams are locked and carry no weight, so they show in progress reports without changing any current result.</p>
          </div>
          {busy && !table && <LoadingBlock />}
          {table && (
            <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-3">
              <div className="text-sm font-semibold">2. Match the columns <span className="font-normal text-[#6F7461]">({fileName}: {table.rows.length} rows)</span></div>
              {layout === 'LONG' ? (
                <div className="grid sm:grid-cols-2 gap-2">{LONG_FIELDS.map((f) => (
                  <label key={f.key} className="block text-xs text-[#6F7461]">{f.label}{f.required ? ' *' : ''}
                    <select className={`${fieldClass} mt-1`} value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))}>
                      <option value={-1}>— not in my file —</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}</div>
              ) : (<>
                <div className="grid sm:grid-cols-2 gap-2">
                  <label className="block text-xs text-[#6F7461]">Admission number column *<select className={`${fieldClass} mt-1`} value={wide.adm} onChange={(e) => setWide((w) => ({ ...w, adm: parseInt(e.target.value, 10) }))}><option value={-1}>Choose…</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>
                  <label className="block text-xs text-[#6F7461]">Class column (or type the class below)<select className={`${fieldClass} mt-1`} value={wide.cls} onChange={(e) => setWide((w) => ({ ...w, cls: parseInt(e.target.value, 10) }))}><option value={-1}>— none —</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>
                  <label className="block text-xs text-[#6F7461]">Year *<input className={`${fieldClass} mt-1`} placeholder="2025" value={fixed.year} onChange={setF('year')} /></label>
                  <label className="block text-xs text-[#6F7461]">Term *<input className={`${fieldClass} mt-1`} placeholder="Term 1" value={fixed.term} onChange={setF('term')} /></label>
                  <label className="block text-xs text-[#6F7461]">Exam name *<input className={`${fieldClass} mt-1`} placeholder="End of Term 1" value={fixed.exam} onChange={setF('exam')} /></label>
                  {wide.cls < 0 && <label className="block text-xs text-[#6F7461]">Class *<input className={`${fieldClass} mt-1`} placeholder="Grade 5" value={fixed.class} onChange={setF('class')} /></label>}
                  <label className="block text-xs text-[#6F7461]">Marks are out of<input className={`${fieldClass} mt-1`} inputMode="decimal" value={fixed.out_of} onChange={setF('out_of')} /></label>
                  <label className="block text-xs text-[#6F7461]">Exam date (optional)<input type="date" className={`${fieldClass} mt-1`} value={fixed.date} onChange={setF('date')} /></label>
                </div>
                <div><div className="text-xs text-[#6F7461] mb-1">Subject columns (tick the subjects; leave out totals and positions)</div>
                  <div className="flex flex-wrap gap-1.5">{table.headers.map((h, i) => (i === wide.adm || i === wide.cls ? null : (
                    <button key={i} type="button" onClick={() => toggleSubject(i)} className={`h-9 px-3 rounded-full text-xs font-semibold border ${wide.subjects.includes(i) ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white border-[#E3DBB8]'}`}>{h || `Column ${i + 1}`}</button>)))}</div></div>
              </>)}
              {problems.map((p) => <Notice key={p} tone="gold">{p}</Notice>)}
              {built[0] && <div className="text-xs rounded-xl bg-[#F7F4E8] p-2">{built.length} mark{built.length === 1 ? '' : 's'} found. First: adm <b>{built[0].admission_no || '—'}</b> · {built[0].year} {built[0].term} · {built[0].class} · {built[0].subject} · {built[0].exam} · <b>{built[0].marks}</b>{built[0].out_of ? ` / ${built[0].out_of}` : ''}</div>}
              <button type="button" className={`${btnP} w-full`} disabled={busy || problems.length > 0} onClick={check}>{busy ? 'Checking…' : `3. Check ${built.length} marks`}</button>
            </div>)}
        </>)}

        {batch && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2"><Tile n={batch.total} label="marks" /><Tile n={batch.ok_count} label="ready" tone="text-emerald-800" /><Tile n={batch.error_count} label="with errors" tone={batch.error_count ? 'text-red-800' : ''} /><Tile n={batch.exam_count} label="exams" /></div>
            {batch.error_count > 0 && <Notice tone="gold">Nothing is saved yet. The simplest route is to fix the errors in your file and upload it again. If you save the ready marks now, those exams will exist, and the remaining rows then have to be added through the marks screen (the same exam cannot be imported twice).</Notice>}
            <div className="flex gap-1.5 flex-wrap">{[['ERROR', 'Errors'], ['WARN', 'Warnings'], ['OK', 'Ready'], ['ALL', 'All']].map(([k, l]) => <button key={k} type="button" onClick={() => { setFilter(k); loadRows(batch.batch_id, k); }} className={`h-9 px-3 rounded-full text-xs font-semibold border ${filter === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
            {rows.length === 0 ? <p className="text-sm text-[#6F7461] p-3">Nothing in this list.</p> : (
              <ul className="space-y-1.5">{rows.map((r) => (<li key={r.row_no} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><div><b>Row {r.row_no}</b> · adm {r.raw.admission_no || '—'} · {r.raw.subject || '—'} · {r.raw.exam || '—'} · {r.raw.marks || '—'}</div>
                {r.errors.map((e, i) => <div key={`e${i}`} className="text-xs text-red-800">✗ {e}</div>)}{r.warnings.map((w, i) => <div key={`w${i}`} className="text-xs text-amber-800">! {w}</div>)}</li>))}</ul>)}
            {rows.length >= 200 && <p className="text-xs text-[#6F7461]">Showing the first 200 rows of this list.</p>}
            <div className="flex gap-2"><button type="button" className={btnS} disabled={busy} onClick={startOver}>Start over</button><button type="button" className={`${btnP} flex-1`} disabled={busy || n === 0} onClick={() => setConfirm(true)}>4. Save {n} mark{n === 1 ? '' : 's'}</button></div>
          </div>)}
      </div>
      {confirm && <ConfirmSheet title="Save these past results?" confirmLabel={`Save ${n}`} busy={busy} onConfirm={commit} onCancel={() => setConfirm(false)}>
        <p>{n} mark{n === 1 ? '' : 's'} in {batch.exam_count} exam{batch.exam_count === 1 ? '' : 's'} will be added as locked past exams with no weight. Students with no enrolment in that year get a completed past enrolment.</p><p>Saved marks can only be changed through an authorised correction, so check the list first.</p></ConfirmSheet>}
    </FitPage>);
}
