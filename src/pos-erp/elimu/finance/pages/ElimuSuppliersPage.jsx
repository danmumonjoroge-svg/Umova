// Suppliers: who the school owes. Bills and payments each post their own journal in the database (elimu_1000); this page presents them.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);
const FOR = [['5000', 'General expenses'], ['5100', 'Salaries and wages'], ['5200', 'Food and catering'], ['5300', 'Utilities'], ['5400', 'Repairs and maintenance'], ['1200', 'Stores and inventory'], ['1500', 'Equipment or buildings'], ['3100', 'Amount already owed before the ledger (opening balance)']];
const PAY = [['BANK', 'Bank'], ['MPESA', 'M-Pesa'], ['CASH_ON_HAND', 'Cash']];
const Btn = ({ children, tone, ...p }) => <button type="button" {...p} className={`px-3 min-h-[38px] rounded-lg text-sm disabled:opacity-50 ${tone === 'solid' ? 'bg-[#1F6B45] text-white' : 'border border-[#1F6B45] text-[#1F6B45]'}`}>{children}</button>;

function SupplierSheet({ ctx, onClose, onDone }) {
  const [f, setF] = useState({ name: '', phone: '', terms: '30' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (f.name.trim().length < 2) return setErr('Enter the supplier name.');
    const t = parseInt(f.terms, 10); if (!Number.isInteger(t) || t < 0 || t > 365) return setErr('Payment terms are a number of days (0 to 365).');
    setBusy(true); try { await ctx.api.spSaveSupplier(ctx.businessId, { name: f.name.trim(), phone: f.phone.trim(), terms_days: String(t) }); await onDone('Supplier added.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <Sheet title="Add supplier" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <input className={inputCls} placeholder="Supplier name" value={f.name} onChange={set('name')} /><input className={inputCls} inputMode="tel" placeholder="Phone (optional)" value={f.phone} onChange={set('phone')} />
    <label className="text-xs text-[#6F7461]">Days allowed to pay<input className={`${inputCls} mt-1`} inputMode="numeric" value={f.terms} onChange={set('terms')} /></label>
    <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save supplier'}</button></div></Sheet>;
}

function BillSheet({ ctx, suppliers, onClose, onDone }) {
  const [f, setF] = useState({ supplier: suppliers[0]?.id || '', date: today(), due: '', amount: '', code: '5000', ref: '', desc: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.supplier) return setErr('Choose a supplier.');
    let cents; try { cents = toCents(f.amount); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the amount.'); }
    if (cents <= 0) return setErr('The amount must be above zero.');
    if (f.due && f.due < f.date) return setErr('The due date is before the bill date.');
    setBusy(true); try { const r = await ctx.api.spAddBill(ctx.businessId, { supplierId: f.supplier, date: f.date, dueDate: f.due, cents, code: f.code, ref: f.ref.trim(), description: f.desc.trim() }); await onDone(`Bill ${r.bill_no} recorded.`); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <Sheet title="Record a bill" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <select className={inputCls} value={f.supplier} onChange={set('supplier')}>{suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <select className={inputCls} value={f.code} onChange={set('code')}>{FOR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    <input className={inputCls} inputMode="decimal" placeholder="Amount (KES)" value={f.amount} onChange={set('amount')} />
    <div className="grid grid-cols-2 gap-2"><label className="text-xs text-[#6F7461]">Bill date<input className={`${inputCls} mt-1`} type="date" max={today()} value={f.date} onChange={set('date')} /></label><label className="text-xs text-[#6F7461]">Due (optional)<input className={`${inputCls} mt-1`} type="date" value={f.due} onChange={set('due')} /></label></div>
    <input className={inputCls} placeholder="Supplier's invoice number (optional)" value={f.ref} onChange={set('ref')} /><input className={inputCls} placeholder="What was it for?" value={f.desc} onChange={set('desc')} />
    <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Record bill'}</button></div></Sheet>;
}

function PaySheet({ ctx, bill, onClose, onDone }) {
  const owed = fromDb(bill.amount) - fromDb(bill.paid);
  const [f, setF] = useState({ amount: String(owed / 100), date: today(), from: 'BANK', ref: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    let cents; try { cents = toCents(f.amount); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the amount.'); }
    if (cents <= 0 || cents > owed) return setErr(`Enter an amount up to ${formatMoney(owed)}.`);
    setBusy(true); try { await ctx.api.spPayBill(bill.id, cents, f.date, f.from, f.ref.trim()); await onDone('Payment recorded.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <Sheet title={`Pay ${bill.bill_no}`} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <p className="text-sm">Balance on this bill: <b>{formatMoney(owed)}</b></p>
    <input className={inputCls} inputMode="decimal" value={f.amount} onChange={set('amount')} />
    <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.from} onChange={set('from')}>{PAY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input className={inputCls} type="date" max={today()} min={bill.bill_date} value={f.date} onChange={set('date')} /></div>
    <input className={inputCls} placeholder="Cheque / M-Pesa reference (optional)" value={f.ref} onChange={set('ref')} />
    <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Record payment'}</button></div></Sheet>;
}

export default function ElimuSuppliersPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [tab, setTab] = useState('suppliers'); const [sup, setSup] = useState(null); const [bills, setBills] = useState(null);
  const [sheet, setSheet] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null);
  const load = useCallback(async () => {
    try { const [s, b] = await Promise.all([api.spSummary(businessId), api.list('elimu_sp_bills', businessId, { order: { col: 'bill_date', asc: false }, limit: 200 })]); setSup(s || []); setBills(b); }
    catch (e) { setErr(e.message); setSup([]); setBills([]); }
  }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  const done = async (m) => { setNote(m); setErr(null); await load(); };
  const act = async (fn, msg) => { const reason = window.prompt(msg); if (!reason || reason.trim().length < 3) return; try { await fn(reason.trim()); await done('Done.'); } catch (e) { setErr(e.message); } };
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Suppliers"><Notice tone="gold">You do not have access to this page.</Notice></FitPage>;
  if (sup === null) return <FitPage title="Suppliers"><LoadingBlock /></FitPage>;
  const name = Object.fromEntries(sup.map((s) => [s.id, s.name]));
  const owedAll = sup.reduce((t, s) => t + fromDb(s.owed), 0); const overdueAll = sup.reduce((t, s) => t + fromDb(s.overdue), 0);
  return (
    <FitPage title="Suppliers" subtitle="Bills, balances and payments">
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <DataCard title="Owed to suppliers" big={formatMoney(owedAll)} metrics={[{ label: 'Overdue', value: formatMoney(overdueAll) }]} alert={overdueAll > 0} />
      <div className="flex items-center gap-1.5 my-3">{[['suppliers', 'Suppliers'], ['bills', 'Bills']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}
        <span className="flex-1" />{can('expense') && (tab === 'suppliers' ? <Btn tone="solid" onClick={() => setSheet('supplier')}><Plus size={14} className="inline" /> Supplier</Btn> : <Btn tone="solid" disabled={!sup.some((s) => s.is_active)} onClick={() => setSheet('bill')}><Plus size={14} className="inline" /> Bill</Btn>)}</div>
      {tab === 'suppliers' ? (!sup.length ? <EmptyBlock>No suppliers yet.</EmptyBlock> : sup.map((s) => (
        <DataCard key={s.id} title={s.name} subtitle={`${s.phone || 'No phone'} · ${s.terms_days} day terms${s.is_active ? '' : ' · switched off'}`} big={M(s.owed)} metrics={[{ label: 'Billed', value: M(s.billed) }, { label: 'Paid', value: M(s.paid) }, { label: 'Overdue', value: M(s.overdue) }]} alert={fromDb(s.overdue) > 0} />)))
        : (bills === null ? <LoadingBlock /> : !bills.length ? <EmptyBlock>No bills yet.</EmptyBlock> : bills.map((b) => {
          const left = fromDb(b.amount) - fromDb(b.paid); const late = b.status === 'OPEN' && left > 0 && b.due_date < today();
          return <div key={b.id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 mb-2 text-sm">
            <div className="flex justify-between"><b>{b.bill_no} · {name[b.supplier_id] || 'Supplier'}</b><b>{M(b.amount)}</b></div>
            <div className="text-xs text-[#6F7461]">{b.bill_date} · due {b.due_date}{b.supplier_ref ? ` · ${b.supplier_ref}` : ''}{b.description ? ` · ${b.description}` : ''}</div>
            <div className="mt-1">{b.status === 'VOIDED' ? <span className="text-[#8A3B2E]">Voided</span> : left === 0 ? <span className="text-emerald-700">Paid in full</span> : <span className={late ? 'text-[#8A3B2E]' : ''}>{late ? 'Overdue — ' : ''}balance {formatMoney(left)}</span>}</div>
            {b.status === 'OPEN' && can('approve') && <div className="flex gap-2 mt-2">{left > 0 && <Btn tone="solid" onClick={() => setSheet({ pay: b })}>Pay</Btn>}{fromDb(b.paid) === 0 && <Btn onClick={() => act((r) => api.spVoidBill(b.id, r), 'Why is this bill voided?')}>Void</Btn>}</div>}
          </div>; }))}
      {sheet === 'supplier' && <SupplierSheet ctx={ctx} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'bill' && <BillSheet ctx={ctx} suppliers={sup} onClose={() => setSheet(null)} onDone={done} />}
      {sheet && sheet.pay && <PaySheet ctx={ctx} bill={sheet.pay} onClose={() => setSheet(null)} onDone={done} />}
    </FitPage>);
}
