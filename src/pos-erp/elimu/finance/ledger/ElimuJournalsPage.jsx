// Journals: every entry in the ledger (automatic ones from fees, payments and expenses, and manual ones), open one to see its lines or reverse it.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { useLedger, SetupCard, M } from './ledgerKit.jsx';
import { toCents, toDecimalString, MoneyError, formatMoney } from '../utils/money';

const today = () => new Date().toISOString().slice(0, 10);
const TAG = { AUTO: ['Auto', 'bg-sky-100 text-sky-800'], MANUAL: ['Manual', 'bg-amber-100 text-amber-800'], REVERSAL: ['Reversal', 'bg-zinc-200 text-zinc-700'] };
const blank = () => ({ accountId: '', debit: '', credit: '' });

function NewJournal({ ctx, accounts, onClose, onDone }) {
  const [date, setDate] = useState(today()); const [memo, setMemo] = useState(''); const [lines, setLines] = useState([blank(), blank()]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const setL = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  let dr = 0, cr = 0; try { for (const l of lines) { dr += l.debit ? toCents(l.debit) : 0; cr += l.credit ? toCents(l.credit) : 0; } } catch { /* shown on save */ }
  const save = async () => {
    setErr(''); const out = [];
    try { for (const l of lines) { if (!l.accountId && !l.debit && !l.credit) continue; if (!l.accountId) throw new Error('Choose an account on every line.');
      const d = l.debit ? toCents(l.debit) : 0, c = l.credit ? toCents(l.credit) : 0; if ((d > 0) === (c > 0)) throw new Error('Each line needs either a debit or a credit.');
      out.push({ account_id: l.accountId, debit: toDecimalString(d), credit: toDecimalString(c) }); } } catch (e) { return setErr(e instanceof MoneyError || e.message ? e.message : 'Check the amounts.'); }
    if (out.length < 2) return setErr('A journal needs at least two lines.'); if (dr !== cr) return setErr('Debits and credits must be equal.');
    setBusy(true); try { await ctx.api.glManualJournal(ctx.businessId, date, memo, out); await onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New journal" onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        <input className={inputCls} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        <input className={inputCls} placeholder="What is this journal for?" value={memo} onChange={(e) => setMemo(e.target.value)} />
        {lines.map((l, i) => (
          <div key={i} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 space-y-2">
            <select className={inputCls} value={l.accountId} onChange={(e) => setL(i, 'accountId', e.target.value)}><option value="">Account…</option>{accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2"><input className={inputCls} inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => setL(i, 'debit', e.target.value)} />
              <input className={inputCls} inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => setL(i, 'credit', e.target.value)} />
              <button type="button" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="h-11 w-10 flex items-center justify-center text-[#B3402A]"><Trash2 size={16} /></button></div></div>))}
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="w-full h-10 rounded-xl border border-dashed border-[#12261F] text-sm font-semibold flex items-center justify-center gap-1.5"><Plus size={15} />Add line</button>
        <div className={`text-sm text-center font-semibold ${dr === cr && dr > 0 ? 'text-emerald-700' : 'text-[#B3402A]'}`}>Debit {formatMoney(dr)} · Credit {formatMoney(cr)}</div>
        <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Posting…' : 'Post journal'}</button>
      </div></Sheet>);
}

function Detail({ ctx, j, accounts, onClose, onDone }) {
  const [lines, setLines] = useState(null); const [err, setErr] = useState(''); const [why, setWhy] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { ctx.api.glJournalLines(j.id).then(setLines).catch((e) => setErr(e.message)); }, [ctx.api, j.id]);
  const acct = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const reverse = async () => { setBusy(true); setErr(''); try { await ctx.api.glReverse(j.id, why); await onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Sheet title={`J${j.journal_no}`} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <p className="text-sm font-semibold">{j.memo}</p><p className="text-xs text-[#6F7461] mb-3">{j.entry_date} · {M(j.total)}{j.reversed_by ? ' · reversed' : ''}</p>
      {!lines ? <LoadingBlock /> : <div className="space-y-1.5">{lines.map((l) => (
        <div key={l.line_no} className="flex justify-between gap-2 rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><span className="min-w-0 truncate"><span className="font-mono text-xs text-[#6F7461] mr-2">{acct[l.account_id]?.code}</span>{acct[l.account_id]?.name}</span>
          <b className="shrink-0">{Number(l.debit) > 0 ? `Dr ${M(l.debit)}` : `Cr ${M(l.credit)}`}</b></div>))}</div>}
      {ctx.can('reconcile') && !j.reversed_by && j.source !== 'REVERSAL' && (why === null
        ? <button type="button" onClick={() => setWhy('')} className="mt-4 w-full h-11 rounded-xl border border-[#B3402A] text-[#B3402A] text-sm font-semibold">Reverse this journal</button>
        : <div className="mt-4 space-y-2"><input className={inputCls} placeholder="Why is it reversed?" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button type="button" disabled={busy} onClick={reverse} className="w-full h-11 rounded-xl bg-[#B3402A] text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Reversing…' : 'Confirm reversal'}</button></div>)}
    </Sheet>);
}

export default function ElimuJournalsPage() {
  const { ctx, accounts, waiting, err: loadErr, load, ready } = useLedger(); const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [add, setAdd] = useState(false); const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const reload = useCallback(async () => { try { setErr(''); setRows(await ctx.api.glJournals(ctx.businessId)); await load(); } catch (e) { setErr(e.message); setRows([]); } }, [ctx.api, ctx.businessId, load]);
  useEffect(() => { if (ready && ctx.can('report') && accounts?.length) ctx.api.glJournals(ctx.businessId).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, [ready, accounts, ctx]);
  if (!ready) return <LoadingBlock />;
  if (!ctx.can('report')) return <FitPage title="Journals"><Notice tone="gold">You do not have access to the ledger.</Notice></FitPage>;
  const post = async () => { setBusy(true); setMsg(''); try { const r = await ctx.api.glPostPending(ctx.businessId); setMsg(`${r.posted} entr${r.posted === 1 ? 'y' : 'ies'} posted${r.waiting ? `, ${r.waiting} still waiting for an account to be set` : ''}.`); await reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <FitPage title="Journals" subtitle="Every entry in the ledger" action={ctx.can('reconcile') && accounts?.length ? <button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={16} />New</button> : null}>
      {(err || loadErr) && <Notice tone="bad">{err || loadErr}</Notice>}
      {accounts === null ? <LoadingBlock /> : !accounts.length ? <SetupCard ctx={ctx} onDone={reload} /> : <>
        {waiting > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 mb-3 text-sm"><b>{waiting}</b> entr{waiting === 1 ? 'y is' : 'ies are'} waiting to be posted.
          {ctx.can('reconcile') && <button type="button" disabled={busy} onClick={post} className="ml-2 underline font-semibold">{busy ? 'Posting…' : 'Post now'}</button>}</div>}
        {msg && <Notice tone="good">{msg}</Notice>}
        {rows === null ? <LoadingBlock /> : !rows.length ? <EmptyBlock>No journals yet. They appear as fees, payments and expenses are recorded.</EmptyBlock> : rows.map((j) => { const [lab, cls] = TAG[j.source]; return (
          <button key={j.id} type="button" onClick={() => setOpen(j)} className="w-full text-left rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 mb-2">
            <div className="flex items-center justify-between gap-2"><b className="text-sm">J{j.journal_no} · {j.entry_date}</b><b className="text-sm">{M(j.total)}</b></div>
            <div className="text-xs text-[#6F7461] mt-0.5 flex items-center gap-1.5"><span className={`px-1.5 rounded text-[10px] font-bold ${cls}`}>{lab}</span>{j.reversed_by && <span className="px-1.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Reversed</span>}<span className="truncate">{j.memo}</span></div></button>); })}</>}
      {add && <NewJournal ctx={ctx} accounts={accounts} onClose={() => setAdd(false)} onDone={reload} />}
      {open && <Detail ctx={ctx} j={open} accounts={accounts} onClose={() => setOpen(null)} onDone={reload} />}
    </FitPage>);
}
