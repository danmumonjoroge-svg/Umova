// Budgets: draft with lines (category + optional department + amount), approve, then budget against actual (approved and paid expenses).
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const yearNow = () => String(new Date().getFullYear());

function EditSheet({ ctx, cats, existing, onClose, onDone }) {
  const [name, setName] = useState(existing?.name || ''); const [year, setYear] = useState(existing?.academic_year || yearNow());
  const [lines, setLines] = useState(existing?.lines || [{ categoryId: '', department: '', amount: '' }]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const setL = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = async () => {
    setErr(''); if (name.trim().length < 2) return setErr('Give the budget a name.');
    const out = []; try { for (const l of lines) { if (!l.categoryId && !l.amount) continue; if (!l.categoryId) throw new Error('Choose a category on every line.'); out.push({ category_id: l.categoryId, department: l.department.trim() || null, amountCents: toCents(l.amount) }); } }
    catch (e) { return setErr(e instanceof MoneyError || e.message ? e.message : 'Check the amounts.'); }
    if (!out.length) return setErr('Add at least one line.');
    setBusy(true);
    try { await ctx.api.saveBudget(ctx.businessId, { id: existing?.id, name: name.trim(), academic_year: year.trim(), lines: out }); onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={existing ? 'Edit draft budget' : 'New budget'} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        <input className={inputCls} placeholder="Budget name (e.g. 2027 Term 1)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Academic year" value={year} onChange={(e) => setYear(e.target.value)} disabled={!!existing} />
        {lines.map((l, i) => (
          <div key={i} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 space-y-2">
            <select className={inputCls} value={l.categoryId} onChange={(e) => setL(i, 'categoryId', e.target.value)}><option value="">Category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2"><input className={inputCls} placeholder="Department (optional)" value={l.department} onChange={(e) => setL(i, 'department', e.target.value)} />
              <input className={inputCls} inputMode="decimal" placeholder="Amount" value={l.amount} onChange={(e) => setL(i, 'amount', e.target.value)} />
              <button type="button" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="h-11 w-10 flex items-center justify-center text-[#B3402A]"><Trash2 size={16} /></button></div></div>))}
        <button type="button" onClick={() => setLines((ls) => [...ls, { categoryId: '', department: '', amount: '' }])} className="w-full h-10 rounded-xl border border-dashed border-[#12261F] text-sm font-semibold flex items-center justify-center gap-1.5"><Plus size={15} />Add line</button>
        <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button>
      </div></Sheet>);
}

function ReportSheet({ ctx, budget, cats, onClose, onChanged }) {
  const [rep, setRep] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState(null);
  const load = useCallback(async () => { try { setRep(await ctx.api.budgetReport(budget.id)); } catch (e) { setErr(e.message); } }, [ctx.api, budget.id]);
  useEffect(() => { if (ctx.can('report')) load(); }, [ctx.can, load]);
  const approve = async () => { setBusy(true); try { await ctx.api.approveBudget(budget.id); onChanged(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const openEdit = async () => { try { const ls = await ctx.api.budgetLines(budget.id); setEdit({ ...budget, lines: ls.map((l) => ({ categoryId: l.category_id, department: l.department || '', amount: String(l.amount) })) }); } catch (e) { setErr(e.message); } };
  if (edit) return <EditSheet ctx={ctx} cats={cats} existing={edit} onClose={() => setEdit(null)} onDone={() => { onChanged(); onClose(); }} />;
  return (
    <Sheet title={budget.name} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <p className="text-xs text-[#6F7461] mb-2">{budget.academic_year} · {budget.status === 'DRAFT' ? 'Draft' : budget.status === 'APPROVED' ? 'Approved' : 'Closed'}</p>
      {!ctx.can('report') ? <Notice tone="warn">You can edit drafts, but the budget-against-actual view needs the finance report permission.</Notice> : !rep ? <LoadingBlock /> : <>
        <div className="grid grid-cols-3 gap-2 text-center mb-3">{[['Budget', rep.total_budget], ['Spent', rep.total_actual], ['Left', rep.total_variance]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-[#F4EFD3] p-2"><div className="text-[11px] text-[#6F7461]">{l}</div><div className={`text-sm font-bold ${l === 'Left' && fromDb(v) < 0 ? 'text-[#B3402A]' : ''}`}>{M(v)}</div></div>))}</div>
        <div className="space-y-1.5">{(rep.lines || []).map((l, i) => (
          <div key={i} className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 text-sm"><div className="flex justify-between gap-2"><b>{l.category}</b><span>{M(l.budget)}</span></div>
            <div className="text-xs text-[#6F7461]">{l.department || 'All departments'} · spent {M(l.actual)} · {fromDb(l.variance) < 0 ? <span className="text-[#B3402A] font-semibold">over by {formatMoney(-fromDb(l.variance))}</span> : `left ${M(l.variance)}`}</div></div>))}</div>
        <p className="text-[11px] text-[#6F7461] mt-2">{rep.note}</p></>}
      {budget.status === 'DRAFT' && <div className="grid grid-cols-2 gap-2 mt-4">
        {(ctx.can('expense') || ctx.can('configure')) && <button type="button" onClick={openEdit} className="h-11 rounded-xl border border-[#12261F] text-sm font-semibold">Edit lines</button>}
        {ctx.can('approve') && <button type="button" disabled={busy} onClick={approve} className="h-11 rounded-xl bg-[#1F6B45] text-white text-sm font-semibold">Approve budget</button>}</div>}
    </Sheet>);
}

export default function ElimuBudgetsPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [rows, setRows] = useState(null); const [cats, setCats] = useState([]); const [err, setErr] = useState(null); const [add, setAdd] = useState(false); const [open, setOpen] = useState(null);
  const load = useCallback(async () => { try { setErr(null); const [b, c] = await Promise.all([api.budgets(businessId), api.expenseCategories()]); setRows(b); setCats(c); } catch (e) { setErr(e.message); setRows([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Budgets"><Notice tone="warn">You do not have access to budgets.</Notice></FitPage>;
  return (
    <FitPage title="Budgets" subtitle="Plan, then compare with what was spent" action={(can('expense') || can('configure')) ? <button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={16} />New</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}
      {rows === null ? <LoadingBlock /> : !rows.length ? <EmptyBlock>No budgets yet.</EmptyBlock> : rows.map((b) => (
        <button key={b.id} type="button" onClick={() => setOpen(b)} className="block w-full text-left"><DataCard title={b.name} subtitle={`${b.academic_year} · ${b.status === 'DRAFT' ? 'Draft' : b.status === 'APPROVED' ? 'Approved' : 'Closed'}`} /></button>))}
      {add && <EditSheet ctx={ctx} cats={cats} onClose={() => setAdd(false)} onDone={load} />}
      {open && <ReportSheet ctx={ctx} budget={open} cats={cats} onClose={() => setOpen(null)} onChanged={load} />}
    </FitPage>);
}
