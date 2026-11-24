// Fixed assets: register, monthly depreciation, disposal. Each action posts its own balanced journal in the database (elimu_998); this page presents it.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, inputCls } from '../../../components/CardKit';
import { AssetTag } from '../../ui/cards';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);
const CATS = [['LAND_BUILDINGS', 'Land and buildings'], ['FURNITURE', 'Furniture'], ['EQUIPMENT', 'Equipment'], ['VEHICLES', 'Vehicles'], ['COMPUTERS', 'Computers'], ['OTHER', 'Other']];
const CAT_LABEL = Object.fromEntries(CATS);
const FUND = [['BANK', 'Bank'], ['MPESA', 'M-Pesa'], ['CASH_ON_HAND', 'Cash'], ['SUPPLIER', 'On credit (owed to supplier)'], ['OPENING', 'Already owned (opening balance)']];
const LIFE = { LAND_BUILDINGS: 0, FURNITURE: 120, EQUIPMENT: 60, VEHICLES: 60, COMPUTERS: 36, OTHER: 60 };   // suggestions only; the school may change them
const RECEIVED = [['CASH_ON_HAND', 'Cash'], ['MPESA', 'M-Pesa'], ['BANK', 'Bank'], ['RECEIVABLE', 'Not yet paid (owed to the school)']];
const Btn = ({ children, ...p }) => <button type="button" {...p} className={`px-3 min-h-[38px] rounded-lg text-sm disabled:opacity-50 ${p.tone === 'solid' ? 'bg-[#1F6B45] text-white' : 'border border-[#1F6B45] text-[#1F6B45]'}`}>{children}</button>;

function AddSheet({ ctx, onClose, onDone }) {
  const [f, setF] = useState({ name: '', category: 'EQUIPMENT', date: today(), cost: '', residual: '', life: String(LIFE.EQUIPMENT), fundedFrom: 'BANK', location: '', notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pick = (e) => setF((x) => ({ ...x, category: e.target.value, life: String(LIFE[e.target.value]) }));
  const save = async () => {
    setErr('');
    if (f.name.trim().length < 2) return setErr('Name the asset.');
    let cost, res = 0; try { cost = toCents(f.cost); if (f.residual) res = toCents(f.residual); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the cost.'); }
    if (cost <= 0) return setErr('The cost must be above zero.');
    if (res >= cost) return setErr('The value at the end of its life must be below the cost.');
    const life = parseInt(f.life, 10); if (!Number.isInteger(life) || life < 0 || life > 600) return setErr('Useful life is a number of months (0 for land, which is not depreciated).');
    setBusy(true);
    try { const r = await ctx.api.addAsset(ctx.businessId, { name: f.name.trim(), category: f.category, date: f.date, costCents: cost, residualCents: res, lifeMonths: life, fundedFrom: f.fundedFrom, location: f.location.trim(), notes: f.notes.trim() }); await onDone(`Added ${r.asset_tag}.`); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Add asset" onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="space-y-3">
        <input className={inputCls} placeholder="Name (e.g. School bus, Photocopier)" value={f.name} onChange={set('name')} />
        <select className={inputCls} value={f.category} onChange={pick}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="grid grid-cols-2 gap-2"><input className={inputCls} inputMode="decimal" placeholder="Cost (KES)" value={f.cost} onChange={set('cost')} /><input className={inputCls} type="date" max={today()} value={f.date} onChange={set('date')} /></div>
        <div className="grid grid-cols-2 gap-2"><input className={inputCls} inputMode="decimal" placeholder="Value at end of life (optional)" value={f.residual} onChange={set('residual')} /><input className={inputCls} inputMode="numeric" placeholder="Useful life (months)" value={f.life} onChange={set('life')} /></div>
        <label className="block text-xs text-[#6F7461]">How was it paid for?<select className={`${inputCls} mt-1`} value={f.fundedFrom} onChange={set('fundedFrom')}>{FUND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <input className={inputCls} placeholder="Where it is kept (optional)" value={f.location} onChange={set('location')} />
        <p className="text-xs text-[#6F7461]">The cost is added to the ledger now. Depreciation is charged monthly from the month it was acquired.</p>
        <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save asset'}</button>
      </div></Sheet>);
}

function DetailSheet({ ctx, asset, onClose, onDone }) {
  const [dep, setDep] = useState(null); const [mode, setMode] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [d, setD] = useState({ date: today(), proceeds: '', into: 'CASH_ON_HAND', reason: '' });
  useEffect(() => { ctx.api.assetDepreciation(asset.id).then(setDep).catch((e) => setErr(e.message)); }, [ctx.api, asset.id]);
  const nbv = fromDb(asset.cost) - fromDb(asset.accumulated);
  const run = async (fn, msg) => { setBusy(true); setErr(''); try { await fn(); await onDone(msg); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const dispose = () => { let c = 0; try { c = d.proceeds ? toCents(d.proceeds) : 0; } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Check the amount.'); } run(() => ctx.api.disposeAsset(asset.id, d.date, c, d.into), 'Asset disposed of.'); };
  return (
    <Sheet title={`${asset.asset_tag} · ${asset.name}`} onClose={onClose}>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">{[['Cost', M(asset.cost)], ['Depreciated', M(asset.accumulated)], ['Book value', formatMoney(nbv)]].map(([l, v]) => <div key={l} className="rounded-xl border border-[#E3DBB8] p-2"><div className="text-[11px] text-[#6F7461]">{l}</div><div className="text-sm font-bold">{v}</div></div>)}</div>
      <div className="text-xs text-[#6F7461] mb-3">{CAT_LABEL[asset.category]} · acquired {asset.acquisition_date} · {asset.life_months ? `${asset.life_months} months` : 'not depreciated'}{asset.location ? ` · ${asset.location}` : ''}{asset.status === 'DISPOSED' ? ` · disposed ${asset.disposal_date} for ${M(asset.disposal_proceeds)}` : ''}</div>
      <h4 className="font-bold text-sm mb-1">Depreciation charged</h4>
      {dep === null ? <LoadingBlock /> : !dep.length ? <p className="text-xs text-[#6F7461] mb-3">None yet.</p> : <div className="max-h-40 overflow-y-auto mb-3 text-sm">{dep.map((r) => <div key={r.period_end} className="flex justify-between border-b border-[#F0ECD9] py-1"><span>{r.period_end}</span><span>{M(r.amount)}</span></div>)}</div>}
      {asset.status === 'ACTIVE' && ctx.can('approve') && (mode === null ? (
        <div className="flex gap-2 flex-wrap"><Btn onClick={() => setMode('dispose')}>Sell or dispose</Btn>{!dep?.length && <Btn onClick={() => setMode('void')}>Entered by mistake</Btn>}</div>
      ) : mode === 'dispose' ? (
        <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><input className={inputCls} type="date" min={asset.acquisition_date} max={today()} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /><input className={inputCls} inputMode="decimal" placeholder="Sale proceeds (0 if scrapped)" value={d.proceeds} onChange={(e) => setD({ ...d, proceeds: e.target.value })} /></div>
          <select className={inputCls} value={d.into} onChange={(e) => setD({ ...d, into: e.target.value })}>{RECEIVED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <p className="text-xs text-[#6F7461]">Any difference between the proceeds and the book value is booked as a gain or a loss.</p>
          <div className="flex gap-2"><Btn tone="solid" disabled={busy} onClick={dispose}>Confirm disposal</Btn><Btn onClick={() => setMode(null)}>Cancel</Btn></div></div>
      ) : (
        <div className="space-y-2"><input className={inputCls} placeholder="What was wrong?" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
          <div className="flex gap-2"><Btn tone="solid" disabled={busy || d.reason.trim().length < 3} onClick={() => run(() => ctx.api.voidAsset(asset.id, d.reason.trim()), 'Asset removed and its entry reversed.')}>Remove asset</Btn><Btn onClick={() => setMode(null)}>Cancel</Btn></div></div>
      ))}
    </Sheet>);
}

export default function ElimuAssetsPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [rows, setRows] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null); const [tab, setTab] = useState('ACTIVE');
  const [add, setAdd] = useState(false); const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setErr(null); setRows(await api.assets(businessId)); } catch (e) { setErr(e.message); setRows([]); } }, [api, businessId]);
  useEffect(() => { if (ready && can('view')) load(); }, [ready, can, load]);
  if (!ready) return <LoadingBlock />;
  if (!can('view')) return <FitPage title="Fixed assets"><Notice tone="gold">You do not have access to fixed assets.</Notice></FitPage>;
  const done = async (msg) => { setNote(msg); await load(); };
  const runDep = async () => { setBusy(true); setErr(null); try { const r = await api.runDepreciation(businessId); setNote(r.charges ? `Depreciation charged for ${r.months} month(s), ${r.charges} item charge(s).` : 'Depreciation was already up to date.'); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const shown = (rows || []).filter((r) => r.status === tab); const live = (rows || []).filter((r) => r.status === 'ACTIVE');
  const cost = live.reduce((s, r) => s + fromDb(r.cost), 0); const acc = live.reduce((s, r) => s + fromDb(r.accumulated), 0);
  return (
    <FitPage title="Fixed assets" subtitle="Buildings, vehicles, equipment and their depreciation" action={can('expense') ? <button type="button" onClick={() => setAdd(true)} className="h-10 px-3 rounded-xl bg-[#12261F] text-white text-sm font-semibold flex items-center gap-1"><Plus size={16} />Add</button> : null}>
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">{[['Cost', formatMoney(cost)], ['Depreciated', formatMoney(acc)], ['Book value', formatMoney(cost - acc)]].map(([l, v]) => <div key={l} className="rounded-xl border border-[#E3DBB8] bg-white p-2"><div className="text-[11px] text-[#6F7461]">{l}</div><div className="text-sm font-bold">{v}</div></div>)}</div>
      {can('reconcile') && <button type="button" disabled={busy} onClick={runDep} className="w-full h-11 mb-3 rounded-xl border border-[#1F6B45] text-[#1F6B45] font-semibold disabled:opacity-50">{busy ? 'Working…' : 'Run depreciation up to last month end'}</button>}
      <div className="flex gap-1.5 mb-2">{[['ACTIVE', 'In use'], ['DISPOSED', 'Disposed'], ['VOIDED', 'Removed']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}</div>
      {rows === null ? <LoadingBlock /> : !shown.length ? <EmptyBlock>Nothing here.</EmptyBlock> : shown.map((r) => (
        <AssetTag key={r.id} onClick={() => setOpen(r)} tag={r.asset_tag} name={r.name} sub={`${CAT_LABEL[r.category]} · ${r.acquisition_date}${r.location ? ` · ${r.location}` : ''}`} valueText={formatMoney(fromDb(r.cost) - fromDb(r.accumulated))} />))}
      {add && <AddSheet ctx={ctx} onClose={() => setAdd(false)} onDone={done} />}
      {open && <DetailSheet ctx={ctx} asset={open} onClose={() => setOpen(null)} onDone={done} />}
    </FitPage>);
}
