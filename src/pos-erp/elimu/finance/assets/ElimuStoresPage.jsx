// School stores: what is in store, receive, issue, count corrections. Weighted-average cost; every movement posts to ledger account 1200 (elimu_998).
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);
const CATS = [['FOOD', 'Food'], ['STATIONERY', 'Stationery'], ['CLEANING', 'Cleaning'], ['UNIFORMS', 'Uniforms'], ['LAB', 'Laboratory'], ['SPORTS', 'Sports'], ['OTHER', 'Other']];
const PAID = [['CASH_ON_HAND', 'Cash'], ['MPESA', 'M-Pesa'], ['BANK', 'Bank'], ['SUPPLIER', 'On credit (owed to supplier)']];
const qtyOk = (v) => /^\d+(\.\d{1,3})?$/.test(String(v).trim()) && Number(v) > 0;
const Go = ({ busy, onClick, children }) => <button type="button" disabled={busy} onClick={onClick} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : children}</button>;

function ItemSheet({ ctx, onClose, onDone }) {
  const [f, setF] = useState({ name: '', unit: 'kg', category: 'FOOD', reorder: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => { setErr(''); if (f.name.trim().length < 2) return setErr('Name the item.'); if (f.reorder && !/^\d+(\.\d{1,3})?$/.test(f.reorder)) return setErr('Reorder level must be a number.');
    setBusy(true); try { await ctx.api.stSaveItem(ctx.businessId, { name: f.name.trim(), unit: f.unit.trim() || 'each', category: f.category, reorder_level: f.reorder || '0' }); await onDone('Item added.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (<Sheet title="New stores item" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <input className={inputCls} placeholder="Item (e.g. Rice, Chalk)" value={f.name} onChange={set('name')} />
    <div className="grid grid-cols-2 gap-2"><input className={inputCls} placeholder="Unit (kg, box, each)" value={f.unit} onChange={set('unit')} /><select className={inputCls} value={f.category} onChange={set('category')}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <input className={inputCls} inputMode="decimal" placeholder="Warn me when less than (optional)" value={f.reorder} onChange={set('reorder')} />
    <Go busy={busy} onClick={save}>Save item</Go></div></Sheet>);
}

function MoveSheet({ ctx, item, kind, onClose, onDone }) {
  const [f, setF] = useState({ qty: '', total: '', date: today(), paid: 'CASH_ON_HAND', dept: '', memo: '', sign: '-' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setErr(''); if (!qtyOk(f.qty)) return setErr('Enter a quantity above zero.');
    setBusy(true);
    try {
      if (kind === 'receive') { let c; try { c = toCents(f.total); } catch (e) { setBusy(false); return setErr(e instanceof MoneyError ? e.message : 'Enter what it cost.'); } if (c <= 0) { setBusy(false); return setErr('Enter what the stock cost in total.'); } await ctx.api.stReceive(ctx.businessId, item.id, f.qty.trim(), c, f.date, f.paid, f.memo.trim()); }
      else if (kind === 'issue') await ctx.api.stIssue(ctx.businessId, item.id, f.qty.trim(), f.date, f.dept.trim(), f.memo.trim());
      else { if (f.memo.trim().length < 3) { setBusy(false); return setErr('Say why the count is being corrected.'); } await ctx.api.stAdjust(ctx.businessId, item.id, `${f.sign === '-' ? '-' : ''}${f.qty.trim()}`, f.date, f.memo.trim()); }
      await onDone(kind === 'receive' ? 'Stock received.' : kind === 'issue' ? 'Stock issued.' : 'Count corrected.'); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const title = { receive: 'Receive stock', issue: 'Issue stock', adjust: 'Correct the count' }[kind];
  return (<Sheet title={`${title} · ${item.name}`} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <div className="text-xs text-[#6F7461]">In store: <b>{Number(item.qty_on_hand)} {item.unit}</b> worth {M(item.value)}</div>
    <div className="grid grid-cols-2 gap-2">{kind === 'adjust' && <select className={inputCls} value={f.sign} onChange={set('sign')}><option value="-">Fewer than recorded</option><option value="+">More than recorded</option></select>}<input className={inputCls} inputMode="decimal" placeholder={`Quantity (${item.unit})`} value={f.qty} onChange={set('qty')} />{kind !== 'adjust' && <input className={inputCls} type="date" max={today()} value={f.date} onChange={set('date')} />}</div>
    {kind === 'adjust' && <input className={inputCls} type="date" max={today()} value={f.date} onChange={set('date')} />}
    {kind === 'receive' && <><input className={inputCls} inputMode="decimal" placeholder="Total cost (KES)" value={f.total} onChange={set('total')} /><select className={inputCls} value={f.paid} onChange={set('paid')}>{PAID.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></>}
    {kind === 'issue' && <input className={inputCls} placeholder="Used by (e.g. Kitchen, Science dept)" value={f.dept} onChange={set('dept')} />}
    <input className={inputCls} placeholder={kind === 'adjust' ? 'Reason (required)' : 'Note (optional)'} value={f.memo} onChange={set('memo')} />
    <p className="text-xs text-[#6F7461]">{kind === 'receive' ? 'The cost goes into stores on the ledger.' : kind === 'issue' ? 'It is charged to expenses at the average cost of what is in store.' : 'Missing stock is written off as a loss; extra stock is added at the average cost.'}</p>
    <Go busy={busy} onClick={save}>{title}</Go></div></Sheet>);
}

function History({ ctx, item, onClose }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { ctx.api.stMovements(item.id).then(setRows).catch((e) => setErr(e.message)); }, [ctx.api, item.id]);
  return (<Sheet title={`${item.name} · history`} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}{rows === null ? <LoadingBlock /> : !rows.length ? <EmptyBlock>No movements yet.</EmptyBlock> :
    rows.map((r) => <div key={r.id} className="flex justify-between gap-2 border-b border-[#F0ECD9] py-2 text-sm"><div><div className="font-semibold">{{ RECEIPT: 'Received', ISSUE: 'Issued', ADJUST: 'Count correction' }[r.kind]} · {Number(r.qty) > 0 ? '+' : ''}{Number(r.qty)} {item.unit}</div><div className="text-xs text-[#6F7461]">{r.move_date}{r.department ? ` · ${r.department}` : ''}{r.memo ? ` · ${r.memo}` : ''}</div></div><div className="font-bold">{M(r.amount)}</div></div>)}</Sheet>);
}

export default function ElimuStoresPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [items, setItems] = useState(null); const [val, setVal] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null);
  const [add, setAdd] = useState(false); const [move, setMove] = useState(null); const [hist, setHist] = useState(null); const [q, setQ] = useState('');
  const load = useCallback(async () => { try { setErr(null); const [i, v] = await Promise.all([api.stItems(businessId), api.stValuation(businessId)]); setItems(i); setVal(v); } catch (e) { setErr(e.message); setItems([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Stores"><Notice tone="gold">You do not have access to the stores.</Notice></FitPage>;
  const done = async (m) => { setNote(m); await load(); };
  const shown = (items || []).filter((i) => i.is_active && i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <FitPage title="Stores & inventory" subtitle="Food, stationery, uniforms and supplies" action={can('expense') ? <button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1"><Plus size={16} />Item</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      {val && <div className={`rounded-xl border p-2 mb-3 text-sm ${val.agrees ? 'border-[#E3DBB8] bg-white' : 'border-[#B3402A] bg-[#B3402A]/5'}`}>Stores value <b>{M(val.stores_value)}</b>{val.agrees ? ' — agrees with the ledger.' : <> — the ledger shows <b>{M(val.ledger_value)}</b>. Something was posted outside this page; ask the accountant to check account 1200.</>}</div>}
      <input className={`${inputCls} mb-2`} placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
      {items === null ? <LoadingBlock /> : !shown.length ? <EmptyBlock>No items yet. Add one, then receive stock.</EmptyBlock> : shown.map((i) => {
        const low = Number(i.reorder_level) > 0 && Number(i.qty_on_hand) <= Number(i.reorder_level);
        return (<DataCard key={i.id} alert={low} title={i.name} subtitle={`${CATS.find((c) => c[0] === i.category)?.[1] || i.category}${low ? ' · running low' : ''}`} big={`${Number(i.qty_on_hand)} ${i.unit}`} metrics={[{ label: 'Value', value: M(i.value) }]}>
          <div className="flex gap-2 flex-wrap mt-1">
            {can('expense') && <><button type="button" onClick={() => setMove({ item: i, kind: 'receive' })} className="px-3 min-h-[38px] rounded-lg bg-[#1F6B45] text-white text-sm">Receive</button>
              <button type="button" disabled={!Number(i.qty_on_hand)} onClick={() => setMove({ item: i, kind: 'issue' })} className="px-3 min-h-[38px] rounded-lg border border-[#1F6B45] text-[#1F6B45] text-sm disabled:opacity-40">Issue</button>
              <button type="button" onClick={() => setMove({ item: i, kind: 'adjust' })} className="px-3 min-h-[38px] rounded-lg border text-sm">Count</button></>}
            <button type="button" onClick={() => setHist(i)} className="px-3 min-h-[38px] rounded-lg border text-sm">History</button></div></DataCard>);
      })}
      {add && <ItemSheet ctx={ctx} onClose={() => setAdd(false)} onDone={done} />}
      {move && <MoveSheet ctx={ctx} item={move.item} kind={move.kind} onClose={() => setMove(null)} onDone={done} />}
      {hist && <History ctx={ctx} item={hist} onClose={() => setHist(null)} />}
    </FitPage>);
}
