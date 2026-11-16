// Trial balance as at a date: every account with a balance, debit and credit columns that must agree.
import React, { useCallback, useEffect, useState } from 'react';
import { FitPage, LoadingBlock, Notice, inputCls } from '../../../components/CardKit';
import { useLedger, SetupCard, AccountLedgerSheet, M, TYPE_LABEL, TYPE_ORDER } from './ledgerKit.jsx';

const today = () => new Date().toISOString().slice(0, 10);
export default function ElimuTrialBalancePage() {
  const { ctx, accounts, err: loadErr, load, ready } = useLedger(); const [asAt, setAsAt] = useState(today()); const [tb, setTb] = useState(null); const [err, setErr] = useState(''); const [view, setView] = useState(null);
  const run = useCallback(async () => { try { setErr(''); setTb(await ctx.api.trialBalance(ctx.businessId, asAt)); } catch (e) { setErr(e.message); } }, [ctx.api, ctx.businessId, asAt]);
  useEffect(() => { if (ready && ctx.can('report') && accounts?.length) run(); }, [ready, accounts, run, ctx]);
  if (!ready) return <LoadingBlock />;
  if (!ctx.can('report')) return <FitPage title="Trial balance"><Notice tone="gold">You do not have access to the ledger.</Notice></FitPage>;
  return (
    <FitPage title="Trial balance" subtitle="Every account balance. Debits must equal credits.">
      {(err || loadErr) && <Notice tone="bad">{err || loadErr}</Notice>}
      {accounts === null ? <LoadingBlock /> : !accounts.length ? <SetupCard ctx={ctx} onDone={load} /> : <>
        <div className="flex items-center gap-2 mb-3"><span className="text-sm text-[#6F7461]">As at</span><input type="date" className={inputCls} value={asAt} max={today()} onChange={(e) => setAsAt(e.target.value)} /></div>
        {!tb ? <LoadingBlock /> : !tb.rows.length ? <Notice tone="gold">No journals up to this date yet.</Notice> : <>
          <div className={`rounded-xl p-2.5 text-sm font-semibold mb-3 text-center ${tb.balanced ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{tb.balanced ? 'Balanced' : 'NOT BALANCED - contact support'}</div>
          {TYPE_ORDER.map((t) => { const rows = tb.rows.filter((r) => r.type === t); if (!rows.length) return null; return (
            <div key={t} className="mb-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[#6F7461] mb-1">{TYPE_LABEL[t]}</h3>
              {rows.map((r) => (<button key={r.account_id} type="button" onClick={() => setView({ id: r.account_id, code: r.code, name: r.name })} className="w-full flex items-center justify-between gap-2 rounded-xl border border-[#E3DBB8] bg-white p-2.5 mb-1 text-left text-sm">
                <span className="min-w-0 truncate"><span className="font-mono text-xs text-[#6F7461] mr-2">{r.code}</span>{r.name}</span>
                <span className="shrink-0 text-right"><span className="block text-xs text-[#6F7461]">{Number(r.debit) > 0 ? 'Debit' : 'Credit'}</span><b>{M(Number(r.debit) > 0 ? r.debit : r.credit)}</b></span></button>))}</div>); })}
          <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-[#F4EFD3] p-2"><div className="text-[11px] text-[#6F7461]">Total debit</div><b className="text-sm">{M(tb.total_debit)}</b></div>
            <div className="rounded-xl bg-[#F4EFD3] p-2"><div className="text-[11px] text-[#6F7461]">Total credit</div><b className="text-sm">{M(tb.total_credit)}</b></div></div></>}</>}
      {view && <AccountLedgerSheet ctx={ctx} account={view} onClose={() => setView(null)} />}
    </FitPage>);
}
