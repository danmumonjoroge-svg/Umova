// School expenses: record, then an approver approves / marks paid / declines. Every rule lives in the database (E006); this page presents it.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const TABS = [['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['PAID', 'Paid'], ['REJECTED', 'Declined']];
const METHODS = [['CASH', 'Cash'], ['MPESA', 'M-Pesa'], ['BANK', 'Bank']];
const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);

function AddSheet({ ctx, cats, onClose, onDone }) {
  const [f, setF] = useState({ categoryId: '', amount: '', method: 'CASH', description: '', supplier: '', department: '', date: today() });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setErr('');
    if (!f.categoryId) return setErr('Choose a category.');
    if (f.description.trim().length < 3) return setErr('Say what the money was for.');
    let cents; try { cents = toCents(f.amount); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the amount.'); }
    if (cents <= 0) return setErr('The amount must be above zero.');
    setBusy(true);
    try { await ctx.api.recordExpense(ctx.businessId, { categoryId: f.categoryId, amountCents: cents, method: f.method, description: f.description.trim(), supplier: f.supplier.trim() || null, department: f.department.trim() || null, date: f.date, status: 'PENDING' }); onDone(); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Record expense" onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        <select className={inputCls} value={f.categoryId} onChange={set('categoryId')}><option value="">Category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className={inputCls} inputMode="decimal" placeholder="Amount (KES)" value={f.amount} onChange={set('amount')} />
        <input className={inputCls} placeholder="What was it for?" value={f.description} onChange={set('description')} />
        <input className={inputCls} placeholder="Paid to (supplier or person)" value={f.supplier} onChange={set('supplier')} />
        <input className={inputCls} placeholder="Department (e.g. Kitchen, Admin)" value={f.department} onChange={set('department')} />
        <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.method} onChange={set('method')}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className={inputCls} type="date" value={f.date} onChange={set('date')} /></div>
        <p className="text-xs text-[#6F7461]">It is saved as waiting. An approver then approves it and marks it paid.</p>
        <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save expense'}</button>
      </div></Sheet>);
}

export default function ElimuExpensesPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [rows, setRows] = useState(null); const [cats, setCats] = useState([]); const [tab, setTab] = useState('PENDING'); const [err, setErr] = useState(null);
  const [add, setAdd] = useState(false); const [busy, setBusy] = useState(null); const [why, setWhy] = useState(null); const [note, setNote] = useState('');
  const load = useCallback(async () => { try { setErr(null); const [r, c] = await Promise.all([api.expenses(businessId), api.expenseCategories()]); setRows(r); setCats(c); } catch (e) { setErr(e.message); setRows([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  if (!ready) return <LoadingBlock />;
  if (!can('view') && !can('expense')) return <FitPage title="Expenses"><Notice tone="warn">You do not have access to expenses.</Notice></FitPage>;
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const move = async (id, status, n) => { setBusy(id); try { setErr(null); await api.setExpenseStatus(id, status, n || null); setWhy(null); setNote(''); await load(); } catch (e) { setErr(e.message); } finally { setBusy(null); } };
  const shown = (rows || []).filter((r) => r.status === tab); const total = shown.reduce((s, r) => s + fromDb(r.amount), 0);
  return (
    <FitPage title="Expenses" subtitle="What the school spends" action={can('expense') ? <button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={16} />Record</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">{TABS.map(([k, l]) => (
        <button key={k} type="button" onClick={() => setTab(k)} className={`shrink-0 h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l} ({(rows || []).filter((r) => r.status === k).length})</button>))}</div>
      {rows === null ? <LoadingBlock /> : !shown.length ? <EmptyBlock>Nothing here.</EmptyBlock> : <>
        <div className="text-xs text-[#6F7461] mb-2">Total shown: <b>{formatMoney(total)}</b></div>
        {shown.map((r) => (
          <DataCard key={r.id} title={r.description || catName[r.category_id] || 'Expense'} subtitle={`${catName[r.category_id] || 'Uncategorised'}${r.supplier_name ? ` · ${r.supplier_name}` : ''}${r.department ? ` · ${r.department}` : ''} · ${r.expense_date}`} big={M(r.amount)}>
            {r.status === 'REJECTED' && r.approval_note && <div className="text-xs text-[#B3402A] mb-1">Declined: {r.approval_note}</div>}
            {can('approve') && (r.status === 'PENDING' || r.status === 'APPROVED') && (why === r.id ? (
              <div className="space-y-2"><input className={inputCls} placeholder="Why is it declined?" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2"><button type="button" disabled={busy === r.id} onClick={() => move(r.id, 'REJECTED', note)} className="px-3 min-h-[38px] rounded-lg bg-[#B3402A] text-white text-sm">Decline</button>
                  <button type="button" onClick={() => { setWhy(null); setNote(''); }} className="px-3 min-h-[38px] rounded-lg border text-sm">Cancel</button></div></div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {r.status === 'PENDING' && <button type="button" disabled={busy === r.id} onClick={() => move(r.id, 'APPROVED')} className="px-3 min-h-[38px] rounded-lg bg-[#1F6B45] text-white text-sm">Approve</button>}
                <button type="button" disabled={busy === r.id} onClick={() => move(r.id, 'PAID')} className="px-3 min-h-[38px] rounded-lg border border-[#1F6B45] text-[#1F6B45] text-sm">{r.status === 'PENDING' ? 'Approve & mark paid' : 'Mark paid'}</button>
                <button type="button" onClick={() => setWhy(r.id)} className="px-3 min-h-[38px] rounded-lg border text-sm">Decline</button></div>))}
          </DataCard>))}</>}
      {add && <AddSheet ctx={ctx} cats={cats} onClose={() => setAdd(false)} onDone={load} />}
    </FitPage>);
}
