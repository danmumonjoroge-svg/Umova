// elimu/import/pages/ImportStudentsPage.jsx -- bring students (and their guardians) from the old system.
//   1 Choose the academic year and the file (Excel .xlsx or CSV).   2 Match the file's columns.   3 Check: every row is checked, nothing is saved yet.   4 Save the rows that passed.
// Rows with errors are never saved; fix them in the file and upload again (or save the good ones now and add the rest later).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { ConfirmSheet } from '../../shared/components/kit.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { setupService } from '../../services/ElimuSetupService.js';
import { importService } from '../services/importService.js';
import { readTable } from '../utils/readSheet.js';
import { FIELDS, MAX_ROWS, TEMPLATE_CSV, autoMap, buildRows, mappingProblems } from '../utils/studentImport.js';
import { friendlyError } from '../../utils/validation.js';
import { csvFile } from '../../utils/fileDownload.js';

const Tile = ({ n, label, tone = '' }) => <div className={`rounded-xl border border-[#E3DBB8] bg-white p-3 text-center ${tone}`}><div className="text-xl font-bold">{n}</div><div className="text-[11px] text-[#6F7461]">{label}</div></div>;
const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';

export default function ImportStudentsPage({ basePath = '/elimu' }) {
  const years = useAsync(() => setupService.years(), []);
  const [yearId, setYearId] = useState(''); const [table, setTable] = useState(null); const [fileName, setFileName] = useState(''); const [map, setMap] = useState({});
  const [batch, setBatch] = useState(null); const [rows, setRows] = useState([]); const [filter, setFilter] = useState('ERROR'); const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const yearList = years.data || [];
  const effectiveYear = yearId || yearList.find((y) => y.status === 'CURRENT')?.id || '';
  const problems = useMemo(() => (table ? mappingProblems(map) : []), [table, map]);
  const built = useMemo(() => (table ? buildRows(table.rows, map) : []), [table, map]);

  const pick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return; setErr(''); setTable(null); setBatch(null); setDone(null); setBusy(true);
    try { const t = await readTable(f); setTable(t); setFileName(f.name); setMap(autoMap(t.headers)); } catch (x) { setErr(x.message); }
    setBusy(false); e.target.value = '';
  };
  const loadRows = async (id, status) => { try { setRows(await importService.rows(id, status === 'ALL' ? null : status === 'WARN' ? 'WARN' : status)); } catch (x) { setErr(friendlyError(x)); } };
  const check = async () => {
    setErr(''); if (!effectiveYear) return setErr('Choose the academic year these students belong to.');
    if (built.length === 0) return setErr('There are no student rows to check.'); if (built.length > MAX_ROWS) return setErr(`Import at most ${MAX_ROWS} students at a time. Split the file by class or year.`);
    setBusy(true);
    try { const r = await importService.stage({ fileName, yearId: effectiveYear, rows: built }); setBatch(r); const f = r.error_count > 0 ? 'ERROR' : 'WARN'; setFilter(f); await loadRows(r.batch_id, f); } catch (x) { setErr(friendlyError(x)); }
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true); setErr('');
    try { const r = await importService.commit(batch.batch_id); setDone(r); setConfirm(false); setBatch(null); setTable(null); } catch (x) { setErr(friendlyError(x)); setConfirm(false); }
    setBusy(false);
  };
  const startOver = async () => { setBusy(true); try { if (batch) await importService.discard(batch.batch_id); } catch (x) { setErr(friendlyError(x)); } setBatch(null); setRows([]); setBusy(false); };
  const download = () => { csvFile('student-import-template.csv', TEMPLATE_CSV); };

  return (
    <FitPage title="Import students" subtitle="Bring students and their guardians from your old system" icon={Upload}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {done && (<Notice tone="good">Saved {done.imported} student{done.imported === 1 ? '' : 's'}.{done.failed > 0 ? ` ${done.failed} could not be saved at the last moment; see the import log.` : ''}{done.skipped_with_errors > 0 ? ` ${done.skipped_with_errors} row${done.skipped_with_errors === 1 ? '' : 's'} with errors were left out.` : ''} <Link className="underline" to={`${basePath}/students`}>Open students</Link> · <Link className="underline" to={`${basePath}/import/log`}>Import log</Link></Notice>)}

        {!batch && (<>
          <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-3">
            <div className="text-sm font-semibold">1. Choose the year and the file</div>
            {years.loading && !years.data ? <LoadingBlock /> : (
              <label className="block text-xs text-[#6F7461]">Academic year the students are in now
                <select className={`${fieldClass} mt-1`} value={effectiveYear} onChange={(e) => setYearId(e.target.value)}><option value="">Choose…</option>{yearList.map((y) => <option key={y.id} value={y.id}>{y.name}{y.status === 'CURRENT' ? ' (current)' : ''}</option>)}</select></label>)}
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btnP} inline-flex items-center cursor-pointer`}>Choose Excel or CSV file<input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={pick} /></label>
              <button type="button" className={btnS} onClick={download}>Download template</button>
            </div>
            <p className="text-xs text-[#6F7461]">One row per student; up to two guardians on the same row. Classes and streams must already be set up. A guardian whose phone number is already on record is linked, not duplicated. The file is read on your device; nothing is saved until you check it and press Save.</p>
          </div>

          {busy && !table && <LoadingBlock />}
          {table && (
            <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-3">
              <div className="text-sm font-semibold">2. Match the columns <span className="font-normal text-[#6F7461]">({fileName}: {table.rows.length} rows)</span></div>
              <div className="grid sm:grid-cols-2 gap-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block text-xs text-[#6F7461]">{f.label}{f.required ? ' *' : ''}
                    <select className={`${fieldClass} mt-1`} value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))}>
                      <option value={-1}>— not in my file —</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}
              </div>
              {problems.map((p) => <Notice key={p} tone="gold">{p}</Notice>)}
              {built[0] && (<div className="text-xs rounded-xl bg-[#F7F4E8] p-2">First row will be read as: <b>{[built[0].first_name, built[0].middle_name, built[0].last_name].filter(Boolean).join(' ') || '—'}</b> · adm {built[0].admission_no || '—'} · {built[0].class || '—'}{built[0].stream ? ` ${built[0].stream}` : ''}{built[0].date_of_birth ? ` · born ${built[0].date_of_birth}` : ''}{built[0].g1_name ? ` · guardian ${built[0].g1_name} ${built[0].g1_phone || ''}` : ''}</div>)}
              <button type="button" className={`${btnP} w-full`} disabled={busy || problems.length > 0} onClick={check}>{busy ? 'Checking…' : `3. Check ${built.length} rows`}</button>
            </div>)}
        </>)}

        {batch && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2"><Tile n={batch.total} label="rows" /><Tile n={batch.ok_count} label="ready to save" tone="text-emerald-800" /><Tile n={batch.error_count} label="with errors" tone={batch.error_count ? 'text-red-800' : ''} /><Tile n={batch.warning_count} label="with warnings" tone={batch.warning_count ? 'text-amber-800' : ''} /></div>
            {batch.error_count > 0 && <Notice tone="gold">Rows with errors will not be saved. Fix them in your file and upload again, or save the {batch.ok_count} ready rows now and add the others later.</Notice>}
            <div className="flex gap-1.5 flex-wrap">{[['ERROR', 'Errors'], ['WARN', 'Warnings'], ['OK', 'Ready'], ['ALL', 'All']].map(([k, l]) => <button key={k} type="button" onClick={() => { setFilter(k); loadRows(batch.batch_id, k); }} className={`h-9 px-3 rounded-full text-xs font-semibold border ${filter === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
            {rows.length === 0 ? <p className="text-sm text-[#6F7461] p-3">Nothing in this list.</p> : (
              <ul className="space-y-1.5">{rows.map((r) => (
                <li key={r.row_no} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm">
                  <div><b>Row {r.row_no}</b> · {[r.raw.first_name, r.raw.last_name].filter(Boolean).join(' ') || '(no name)'} · adm {r.raw.admission_no || '—'} · {r.raw.class || '—'}</div>
                  {r.errors.map((e, i) => <div key={`e${i}`} className="text-xs text-red-800">✗ {e}</div>)}{r.warnings.map((w, i) => <div key={`w${i}`} className="text-xs text-amber-800">! {w}</div>)}
                </li>))}</ul>)}
            {rows.length >= 200 && <p className="text-xs text-[#6F7461]">Showing the first 200 rows of this list.</p>}
            <div className="flex gap-2"><button type="button" className={btnS} disabled={busy} onClick={startOver}>Start over</button><button type="button" className={`${btnP} flex-1`} disabled={busy || batch.ok_count === 0} onClick={() => setConfirm(true)}>4. Save {batch.ok_count} student{batch.ok_count === 1 ? '' : 's'}</button></div>
          </div>)}
      </div>
      {confirm && (<ConfirmSheet title="Save these students?" confirmLabel={`Save ${batch.ok_count}`} busy={busy} onConfirm={commit} onCancel={() => setConfirm(false)}>
        <p>{batch.ok_count} student{batch.ok_count === 1 ? '' : 's'} will be added and enrolled for the chosen year. {batch.error_count > 0 ? `${batch.error_count} row${batch.error_count === 1 ? '' : 's'} with errors will be left out.` : ''}</p><p>You cannot undo an import in one click, so check the list first.</p></ConfirmSheet>)}
    </FitPage>);
}
