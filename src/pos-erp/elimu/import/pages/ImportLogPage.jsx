// elimu/import/pages/ImportLogPage.jsx -- every import with its result. Records are kept; a staged import can be discarded.
import React, { useState } from 'react';
import { History } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { importService } from '../services/importService.js';
import { friendlyError } from '../../utils/validation.js';

const ST = { STAGED: ['Not saved yet', 'bg-amber-50 text-amber-900'], COMMITTED: ['Saved', 'bg-emerald-50 text-emerald-900'], DISCARDED: ['Discarded', 'bg-slate-100 text-slate-600'] };
const when = (t) => (t ? new Date(t).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function ImportLogPage() {
  const list = useAsync(() => importService.batches(), []);
  const [open, setOpen] = useState(null); const [rows, setRows] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const show = async (b) => { if (open === b.id) return setOpen(null); setOpen(b.id); try { setRows(await importService.rows(b.id, b.status === 'COMMITTED' ? 'FAILED' : 'ERROR')); } catch (x) { setErr(friendlyError(x)); } };
  const discard = async (b) => { setBusy(true); setErr(''); try { await importService.discard(b.id); list.reload && list.reload(); } catch (x) { setErr(friendlyError(x)); } setBusy(false); };
  return (
    <FitPage title="Import log" subtitle="Every import and what happened to it" icon={History}>
      {err && <Notice tone="bad">{err}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : (list.data || []).length === 0 ? <EmptyBlock>No imports yet.</EmptyBlock> : (
        <ul className="space-y-2">{list.data.map((b) => { const [l, c] = ST[b.status] || [b.status, 'bg-slate-100'];
          return (<li key={b.id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-semibold truncate">{b.file_name || (b.kind === 'BALANCES' ? 'Fee balance import' : b.kind === 'RESULTS' ? 'Past results import' : 'Student import')}</div><div className="text-xs text-[#6F7461]">{when(b.created_at)}{b.created_by_name ? ` · ${b.created_by_name}` : ''} · {b.kind === 'BALANCES' ? `fee balances as at ${b.as_of}` : b.kind === 'RESULTS' ? 'past exam results' : `students, year ${b.academic_year}`}</div></div><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{l}</span></div>
            <div className="text-xs mt-1">{b.kind === 'BALANCES' && b.status === 'COMMITTED' ? `KES ${Number(b.total_owed).toLocaleString()} owed, KES ${Number(b.total_credit).toLocaleString()} credit · ` : ''}{b.row_count} rows · {b.status === 'COMMITTED' ? `${b.imported_count} saved${b.failed_count ? `, ${b.failed_count} failed at saving` : ''}, ${b.error_count} left out with errors` : `${b.ok_count} ready, ${b.error_count} with errors`}</div>
            <div className="mt-2 flex gap-2">{(b.error_count > 0 || b.failed_count > 0) && <button type="button" onClick={() => show(b)} className="text-xs underline">{open === b.id ? 'Hide problems' : 'Show problems'}</button>}{b.status === 'STAGED' && <button type="button" disabled={busy} onClick={() => discard(b)} className="text-xs underline text-red-800">Discard</button>}</div>
            {open === b.id && <ul className="mt-2 space-y-1">{rows.map((r) => <li key={r.row_no} className="text-xs rounded-lg bg-[#F7F4E8] p-2"><b>Row {r.row_no}</b> {r.raw.first_name} {r.raw.last_name} · adm {r.raw.admission_no}{r.errors.map((e, i) => <div key={i} className="text-red-800">✗ {e}</div>)}</li>)}</ul>}
          </li>); })}</ul>)}
    </FitPage>);
}
