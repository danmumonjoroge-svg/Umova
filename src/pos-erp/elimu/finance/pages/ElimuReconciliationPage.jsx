// Bank / M-Pesa / cash reconciliation: tick the payments that appear on the statement; the total must match the statement total.
// Balanced -> the ticked payments are marked reconciled. Unbalanced -> the attempt is kept with a note and the payments stay open (E006).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { ReconCard } from '../../ui/cards/index.js';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import { fromDb, formatMoney, toCents, toDecimalString, MoneyError } from '../utils/money';
import { readStatement, matchStatement } from '../utils/statementImport';

const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'); };
const METHODS = [['BANK', 'Bank'], ['MPESA', 'M-Pesa'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque']];

export default function ElimuReconciliationPage() {
  const { api, businessId, can, ready } = useElimuFinance();
  const [tab, setTab] = useState('new'); const [f, setF] = useState({ method: 'BANK', label: '', from: monthStart(), to: today(), statement: '', notes: '' });
  const [rows, setRows] = useState(null); const [picked, setPicked] = useState({}); const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); if (['method', 'from', 'to'].includes(k)) { setRows(null); setPicked({}); } };
  const loadHist = useCallback(async () => { try { setHist(await api.list('elimu_fin_reconciliations', businessId, { order: { col: 'created_at', asc: false }, limit: 100 })); } catch (e) { setErr(e.message); setHist([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) loadHist(); }, [ready, can, loadHist]);
  const bookCents = useMemo(() => (rows || []).filter((r) => picked[r.payment_id]).reduce((s, r) => s + fromDb(r.amount), 0), [rows, picked]);
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Reconciliation"><Notice tone="gold">You do not have access to this page.</Notice></FitPage>;
  if (!can('reconcile')) return <FitPage title="Reconciliation"><Notice tone="gold">Reconciling needs the reconcile right (bursar or accountant). You can read past reconciliations below.</Notice>{hist === null ? <LoadingBlock /> : hist.map((h) => <HistCard key={h.id} h={h} />)}</FitPage>;
  let stmt = null; try { stmt = f.statement.trim() ? toCents(f.statement) : null; } catch (e) { stmt = e instanceof MoneyError ? NaN : null; }
  const diff = stmt === null || Number.isNaN(stmt) ? null : stmt - bookCents;
  const load = async () => {
    setErr(null); setNote(null); if (f.from > f.to) return setErr('The start date is after the end date.');
    setBusy(true); try { const r = await api.unreconciled(businessId, f.method, f.from, f.to); setRows(r); setPicked({}); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const importCsv = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file || !rows) return; setErr(null); setNote(null);
    try {
      const { lines, problems } = readStatement(await file.text()); if (problems.length) return setErr(problems[0]);
      const inPeriod = lines.filter((l) => l.date >= f.from && l.date <= f.to);
      const m = matchStatement(inPeriod, rows.map((r) => ({ ...r, amount: fromDb(r.amount) })));
      setPicked(Object.fromEntries(Object.keys(m.matches).map((k) => [k, true])));
      setF((x) => ({ ...x, statement: toDecimalString(m.total) }));
      setNote(`Read ${inPeriod.length} credit line(s) in the period; ${Object.keys(m.matches).length} matched to payments and ticked.${m.unmatchedLines.length ? ` ${m.unmatchedLines.length} line(s) have no payment: ${m.unmatchedLines.slice(0, 5).map((i) => `${inPeriod[i].date} ${formatMoney(inPeriod[i].cents)}`).join(', ')}${m.unmatchedLines.length > 5 ? '…' : ''}. The difference below will show them.` : ' Everything matched.'} Check the ticks before saving.`);
    } catch (x) { setErr(`Could not read the file: ${x.message}`); }
  };
  const all = () => setPicked(Object.fromEntries((rows || []).map((r) => [r.payment_id, true])));
  const save = async () => {
    setErr(null); if (stmt === null || Number.isNaN(stmt)) return setErr('Enter the total shown on the statement.');
    if (diff !== 0 && f.notes.trim().length < 3) return setErr('The totals do not match. Write a note saying why (for example "bank charges", "deposit not yet cleared").');
    setBusy(true);
    try { const r = await api.reconcile(businessId, { method: f.method, accountLabel: f.label.trim() || null, from: f.from, to: f.to, statementCents: stmt, paymentIds: Object.keys(picked).filter((k) => picked[k]), notes: f.notes.trim() || null });
      setNote(r.status === 'BALANCED' ? 'Balanced. The ticked payments are marked reconciled.' : `Saved as unbalanced (difference ${M(r.difference)}). The payments stay open until it balances.`);
      setRows(null); setPicked({}); setF((x) => ({ ...x, statement: '', notes: '' })); await loadHist(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <FitPage title="Reconciliation" subtitle="Match receipts to the bank, M-Pesa or cash statement">
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <div className="flex gap-1.5 mb-3">{[['new', 'New'], ['history', 'Past reconciliations']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
      {tab === 'history' ? (hist === null ? <LoadingBlock /> : !hist.length ? <EmptyBlock>Nothing reconciled yet.</EmptyBlock> : hist.map((h) => <HistCard key={h.id} h={h} />)) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.method} onChange={set('method')}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input className={inputCls} placeholder="Account (e.g. KCB 1234)" value={f.label} onChange={set('label')} /></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-[#6F7461]">From<input className={`${inputCls} mt-1`} type="date" value={f.from} onChange={set('from')} /></label><label className="text-xs text-[#6F7461]">To<input className={`${inputCls} mt-1`} type="date" max={today()} value={f.to} onChange={set('to')} /></label></div>
          <button type="button" disabled={busy} onClick={load} className="w-full h-11 rounded-xl border border-[#1F6B45] text-[#1F6B45] font-semibold disabled:opacity-50">{busy && rows === null ? 'Loading…' : 'Show payments not yet reconciled'}</button>
          {rows !== null && (!rows.length ? <EmptyBlock>No unreconciled {f.method.toLowerCase()} payments in this period.</EmptyBlock> : (<>
            <div className="flex items-center justify-between text-sm"><span>{rows.length} payment(s)</span><span className="flex gap-3"><label className="underline text-[#1F6B45] cursor-pointer">Import statement (CSV)<input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} /></label><button type="button" className="underline text-[#1F6B45]" onClick={all}>Tick all</button></span></div>
            <div className="rounded-xl border border-[#E3DBB8] bg-white divide-y divide-[#F0ECD9] max-h-[40vh] overflow-y-auto">{rows.map((r) => (
              <label key={r.payment_id} className="flex items-center gap-3 p-2 text-sm min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={!!picked[r.payment_id]} onChange={(e) => setPicked((p) => ({ ...p, [r.payment_id]: e.target.checked }))} />
                <span className="flex-1"><b>{r.student_name || 'Payment'}</b> <span className="text-xs text-[#6F7461]">{r.receipt_no} · {r.payment_date}{r.transaction_ref ? ` · ${r.transaction_ref}` : ''}</span></span><b>{M(r.amount)}</b></label>))}</div>
            <input className={inputCls} inputMode="decimal" placeholder="Total on the statement for these dates (KES)" value={f.statement} onChange={set('statement')} />
            <div className={`rounded-xl border p-2 text-sm ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-[#E3DBB8] bg-white'}`}>Ticked: <b>{formatMoney(bookCents)}</b>{diff === null ? '' : diff === 0 ? ' — matches the statement.' : <> — statement is <b>{formatMoney(Math.abs(diff))}</b> {diff > 0 ? 'higher' : 'lower'}.</>}</div>
            {diff !== null && diff !== 0 && <input className={inputCls} placeholder="Why do they differ? (required)" value={f.notes} onChange={set('notes')} />}
            <button type="button" disabled={busy || !Object.values(picked).some(Boolean) && diff !== 0} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : diff === 0 ? 'Save as balanced' : 'Save as unbalanced'}</button>
          </>))}
        </div>)}
    </FitPage>);
}

function HistCard({ h }) {
  return <div className="mb-3"><ReconCard title={`${h.method}${h.account_label ? ` · ${h.account_label}` : ''}`} sub={`${h.period_start} to ${h.period_end} · ${h.payment_count} payment(s)${h.notes ? ` · ${h.notes}` : ''}`} totalText={M(h.statement_total)} balanced={h.status === 'BALANCED'} differenceText={M(h.difference)} /></div>;
}
