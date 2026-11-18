// elimu/import/pages/ImportBalancesPage.jsx -- opening fee balances from the old system. Same steps as the student import:
// file -> match columns -> check (nothing posted) -> review -> save. Positive = the family owes the school; negative = the school holds credit.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { ConfirmSheet } from '../../shared/components/kit.jsx';
import { importService } from '../services/importService.js';
import { readTable } from '../utils/readSheet.js';
import { BALANCE_FIELDS, BALANCE_TEMPLATE_CSV, autoMapBalances, balanceProblems, buildBalanceRows } from '../utils/balanceImport.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const Tile = ({ n, label, tone = '' }) => <div className={`rounded-xl border border-[#E3DBB8] bg-white p-3 text-center ${tone}`}><div className="text-lg font-bold">{n}</div><div className="text-[11px] text-[#6F7461]">{label}</div></div>;
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function ImportBalancesPage({ basePath = '/elimu' }) {
  const [asOf, setAsOf] = useState(today()); const [table, setTable] = useState(null); const [fileName, setFileName] = useState(''); const [map, setMap] = useState({});
  const [batch, setBatch] = useState(null); const [rows, setRows] = useState([]); const [filter, setFilter] = useState('ERROR'); const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const problems = useMemo(() => (table ? balanceProblems(map) : []), [table, map]);
  const built = useMemo(() => (table ? buildBalanceRows(table.rows, map) : []), [table, map]);

  const pick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return; setErr(''); setTable(null); setBatch(null); setDone(null); setBusy(true);
    try { const t = await readTable(f); setTable(t); setFileName(f.name); setMap(autoMapBalances(t.headers)); } catch (x) { setErr(x.message); }
    setBusy(false); e.target.value = '';
  };
  const loadRows = async (id, status) => { try { setRows(await importService.rows(id, status === 'ALL' ? null : status)); } catch (x) { setErr(friendlyError(x)); } };
  const check = async () => {
    setErr(''); if (!asOf) return setErr('Choose the date the balances are as at.'); if (built.length === 0) return setErr('There are no balance rows to check.');
    setBusy(true);
    try { const r = await importService.stageBalances({ fileName, asOf, rows: built }); setBatch(r); const f = r.error_count > 0 ? 'ERROR' : 'WARN'; setFilter(f); await loadRows(r.batch_id, f); } catch (x) { setErr(friendlyError(x)); }
    setBusy(false);
  };
  const commit = async () => { setBusy(true); setErr(''); try { setDone(await importService.commitBalances(batch.batch_id)); setConfirm(false); setBatch(null); setTable(null); } catch (x) { setErr(friendlyError(x)); setConfirm(false); } setBusy(false); };
  const startOver = async () => { setBusy(true); try { if (batch) await importService.discard(batch.batch_id); } catch (x) { setErr(friendlyError(x)); } setBatch(null); setRows([]); setBusy(false); };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([BALANCE_TEMPLATE_CSV], { type: 'text/csv' })); a.download = 'fee-balances-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const n = batch ? batch.ok_count : 0;

  return (
    <FitPage title="Import fee balances" subtitle="Opening balance for each student from your old system" icon={Wallet}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {done && <Notice tone="good">Posted {done.imported} balance{done.imported === 1 ? '' : 's'}: {kes(done.total_owed)} owed and {kes(done.total_credit)} credit.{done.skipped_zero > 0 ? ` ${done.skipped_zero} zero balance${done.skipped_zero === 1 ? '' : 's'} skipped.` : ''}{done.failed > 0 ? ` ${done.failed} could not be posted; see the import log.` : ''}{done.skipped_with_errors > 0 ? ` ${done.skipped_with_errors} row${done.skipped_with_errors === 1 ? '' : 's'} with errors left out.` : ''} <Link className="underline" to={`${basePath}/import/log`}>Import log</Link></Notice>}

        {!batch && (<>
          <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 space-y-3">
            <div className="text-sm font-semibold">1. Choose the date and the file</div>
            <label className="block text-xs text-[#6F7461]">Balances are as at<input type="date" max={today()} className={`${fieldClass} mt-1`} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btnP} inline-flex items-center cursor-pointer`}>Choose Excel or CSV file<input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={pick} /></label>
              <button type="button" className={btnS} onClick={download}>Download template</button>
            </div>
            <p className="text-xs text-[#6F7461]">One row per student: admission number and balance. A balance above zero is money the family owes; a minus (or brackets, or "CR") is credit the school holds. Import students first. A student who already has an opening balance is refused, so a file cannot be imported twice by accident. Nothing is posted until you check and press Save.</p>
          </div>
          {busy && !table && <LoadingBlock />}
          {table && (
            <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 space-y-3">
              <div className="text-sm font-semibold">2. Match the columns <span className="font-normal text-[#6F7461]">({fileName}: {table.rows.length} rows)</span></div>
              <div className="grid sm:grid-cols-3 gap-2">{BALANCE_FIELDS.map((f) => (
                <label key={f.key} className="block text-xs text-[#6F7461]">{f.label}{f.required ? ' *' : ''}
                  <select className={`${fieldClass} mt-1`} value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))}>
                    <option value={-1}>— not in my file —</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}</div>
              {problems.map((p) => <Notice key={p} tone="gold">{p}</Notice>)}
              {built[0] && <div className="text-xs rounded-xl bg-[#F7F4E8] p-2">First row will be read as: adm <b>{built[0].admission_no || '—'}</b> · balance <b>{built[0].balance || '—'}</b>{built[0].note ? ` · ${built[0].note}` : ''}</div>}
              <button type="button" className={`${btnP} w-full`} disabled={busy || problems.length > 0} onClick={check}>{busy ? 'Checking…' : `3. Check ${built.length} rows`}</button>
            </div>)}
        </>)}

        {batch && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2"><Tile n={batch.total} label="rows" /><Tile n={batch.ok_count} label="ready to post" tone="text-emerald-800" /><Tile n={batch.error_count} label="with errors" tone={batch.error_count ? 'text-red-800' : ''} /></div>
            <div className="grid grid-cols-2 gap-2"><Tile n={kes(batch.total_owed)} label="owed to the school" /><Tile n={kes(batch.total_credit)} label="credit held for families" /></div>
            {batch.error_count > 0 && <Notice tone="gold">Rows with errors will not be posted. Fix them in your file and upload again, or post the {batch.ok_count} ready rows now.</Notice>}
            <div className="flex gap-1.5 flex-wrap">{[['ERROR', 'Errors'], ['WARN', 'Warnings'], ['OK', 'Ready'], ['ALL', 'All']].map(([k, l]) => <button key={k} type="button" onClick={() => { setFilter(k); loadRows(batch.batch_id, k); }} className={`h-9 px-3 rounded-full text-xs font-semibold border ${filter === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
            {rows.length === 0 ? <p className="text-sm text-[#6F7461] p-3">Nothing in this list.</p> : (
              <ul className="space-y-1.5">{rows.map((r) => (<li key={r.row_no} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><div><b>Row {r.row_no}</b> · adm {r.raw.admission_no || '—'} · {r.raw.balance || '—'}</div>
                {r.errors.map((e, i) => <div key={`e${i}`} className="text-xs text-red-800">✗ {e}</div>)}{r.warnings.map((w, i) => <div key={`w${i}`} className="text-xs text-amber-800">! {w}</div>)}</li>))}</ul>)}
            <div className="flex gap-2"><button type="button" className={btnS} disabled={busy} onClick={startOver}>Start over</button><button type="button" className={`${btnP} flex-1`} disabled={busy || n === 0} onClick={() => setConfirm(true)}>4. Post {n} balance{n === 1 ? '' : 's'}</button></div>
          </div>)}
      </div>
      {confirm && <ConfirmSheet title="Post these opening balances?" confirmLabel={`Post ${n}`} busy={busy} onConfirm={commit} onCancel={() => setConfirm(false)}>
        <p>This posts {kes(batch.total_owed)} owed and {kes(batch.total_credit)} credit to the student accounts and the general ledger, dated {asOf}.</p><p>A posted balance cannot be deleted. A mistake is corrected with a reversing entry, so check the list first.</p></ConfirmSheet>}
    </FitPage>);
}
