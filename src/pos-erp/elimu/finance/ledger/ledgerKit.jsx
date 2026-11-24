// Shared bits of the ledger pages: loading the chart, the set-up card, and one account's ledger.
import React, { useCallback, useEffect, useState } from 'react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { Notice, LoadingBlock } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney } from '../utils/money';

export const M = (v) => formatMoney(fromDb(v));
export const TYPE_LABEL = { ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Funds', INCOME: 'Income', EXPENSE: 'Expenses' };
export const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
export const SECTIONS = { ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'], LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'], EQUITY: ['FUND'], INCOME: ['INCOME'], EXPENSE: ['EXPENSE'] };
export const SECTION_LABEL = { CURRENT_ASSET: 'Current', NON_CURRENT_ASSET: 'Non-current', CURRENT_LIABILITY: 'Current', NON_CURRENT_LIABILITY: 'Non-current', FUND: 'Fund', INCOME: 'Income', EXPENSE: 'Expense' };

/** Loads the chart and how many entries are waiting. */
export function useLedger() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [accounts, setAccounts] = useState(null); const [waiting, setWaiting] = useState(0); const [err, setErr] = useState(null);
  const load = useCallback(async () => { try { setErr(null); const [a, w] = await Promise.all([api.glAccounts(businessId), api.glWaiting(businessId).catch(() => 0)]); setAccounts(a); setWaiting(w); } catch (e) { setErr(e.message); setAccounts([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('report')) load(); }, [ready, can, load]);
  return { ctx, accounts, waiting, err, setErr, load, ready };
}

export function SetupCard({ ctx, onDone }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await ctx.api.glSetup(ctx.businessId); await onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const allowed = ctx.can('configure') || ctx.can('reconcile');
  return (
    <div className="rounded-2xl border border-[#C9A227] bg-[#C9A227]/10 p-4">
      <h3 className="font-bold text-[#12261F]">Set up the school ledger</h3>
      <p className="text-sm text-[#23382B] mt-1">This creates a standard chart of accounts for a school and starts recording fees, payments, discounts and expenses as balanced journals. Entries from before today are not copied across: enter opening balances with a manual journal.</p>
      {err && <div className="mt-2"><Notice tone="bad">{err}</Notice></div>}
      {allowed ? <button type="button" disabled={busy} onClick={go} className="mt-3 w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Setting up…' : 'Set up ledger'}</button>
        : <p className="text-xs text-[#6F7461] mt-2">Ask the bursar, accountant or principal to set it up.</p>}
    </div>);
}

/** One account: opening balance, every line with a running balance, closing balance. */
export function AccountLedgerSheet({ ctx, account, onClose }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { ctx.api.accountLedger(account.id).then(setD).catch((e) => setErr(e.message)); }, [ctx.api, account.id]);
  return (
    <Sheet title={`${account.code} · ${account.name}`} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      {!d && !err ? <LoadingBlock /> : d && <>
        <div className="grid grid-cols-2 gap-2 text-center mb-3"><div className="rounded-xl bg-[#F4EFD3] p-2"><div className="text-[11px] text-[#6F7461]">Opening</div><div className="text-sm font-bold">{M(d.opening)}</div></div>
          <div className="rounded-xl bg-[#F4EFD3] p-2"><div className="text-[11px] text-[#6F7461]">Closing</div><div className="text-sm font-bold">{M(d.closing)}</div></div></div>
        {!d.rows.length ? <p className="text-sm text-[#6F7461]">No journals on this account yet.</p> : (
          <div className="space-y-1.5">{d.rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><div className="flex justify-between gap-2"><span className="truncate"><b>J{r.journal_no}</b> · {r.date}</span><b>{M(r.balance)}</b></div>
              <div className="text-xs text-[#6F7461] flex justify-between gap-2"><span className="truncate">{r.memo}</span><span>{fromDb(r.debit) > 0 ? `Dr ${M(r.debit)}` : `Cr ${M(r.credit)}`}</span></div></div>))}</div>)}</>}
    </Sheet>);
}

const iso = (d) => d.toISOString().slice(0, 10);
export const PARTY_LABEL = { STUDENTS: 'Students (parents)', GOVERNMENT: 'Government and sponsors', SUPPLIERS: 'Suppliers', STAFF: 'Staff', OTHER: 'Other' };

/** From / To dates with quick presets, and a Print button (browser print = save as PDF). */
export function PeriodBar({ from, to, onChange, single = false }) {
  const now = new Date(); const y = now.getFullYear();
  const presets = [['This year', iso(new Date(y, 0, 1)), iso(now)], ['Last year', iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))], ['This month', iso(new Date(y, now.getMonth(), 1)), iso(now)]];
  return (
    <div className="mb-3 space-y-2 print:hidden">
      <div className="flex items-center gap-2 flex-wrap">
        {!single && <><span className="text-sm text-[#6F7461]">From</span><input type="date" className="h-11 px-3 rounded-xl border border-[#D9D2B4] bg-white text-[16px]" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} /></>}
        <span className="text-sm text-[#6F7461]">{single ? 'As at' : 'To'}</span><input type="date" className="h-11 px-3 rounded-xl border border-[#D9D2B4] bg-white text-[16px]" value={to} max={iso(now)} onChange={(e) => onChange(from, e.target.value)} /></div>
      <div className="flex gap-1.5 overflow-x-auto">{!single && presets.map(([l, f, t]) => <button key={l} type="button" onClick={() => onChange(f, t)} className="shrink-0 h-8 px-3 rounded-full border border-[#E3DBB8] bg-white text-xs font-semibold">{l}</button>)}
        <button type="button" onClick={() => window.print()} className="shrink-0 h-8 px-3 rounded-full border border-[#12261F] text-xs font-semibold">Print / save PDF</button></div>
    </div>);
}
export function Line({ label, amount, bold, indent, tone }) {
  return (<div className={`flex justify-between gap-3 py-1.5 text-sm ${bold ? 'font-bold border-t border-[#D9D2B4] mt-1 pt-2' : ''} ${indent ? 'pl-3' : ''}`}><span className="min-w-0">{label}</span><span className={`shrink-0 ${tone === 'bad' ? 'text-[#B3402A]' : ''}`}>{M(amount)}</span></div>);
}
export function Section({ title, children }) { return <div className="mb-4 rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[#6F7461] mb-1">{title}</h3>{children}</div>; }

/** Runs a statement loader whenever the period changes (and the school has a ledger). */
export function useStatement(loader, deps) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { let live = true; setData(null); setErr(''); loader().then((d) => live && setData(d)).catch((e) => live && setErr(e.message)); return () => { live = false; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, err };
}
export const yearStart = () => iso(new Date(new Date().getFullYear(), 0, 1));
export const todayIso = () => iso(new Date());
