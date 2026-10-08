// src/pos-erp/pages/ProductionPage.jsx
//
// Production runs. Start a run from a recipe ("make 100 cakes"), then record what
// really happened: how much was made, what was really used, why anything was lost.
// Posting moves stock and shows yield, wastage and what each unit really cost, so the
// owner sees that poor yield makes every unit dearer. Phone-first cards.

import React, { useCallback, useEffect, useState } from 'react';
import { Factory, Plus, Loader2 } from 'lucide-react';
import { productionService, WASTAGE_REASONS } from '../services/productionService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, kes } from '../components/workspace/WorkspaceKit';
import Sheet, { fieldClass as field } from '../components/workspace/Sheet';
import { todayLocal, formatDay } from '../services/roomService';

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const lab = 'block text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-1';
const TABS = [['draft', 'To do', ['DRAFT']], ['done', 'Done', ['POSTED', 'REVERSED']]];

function StartSheet({ recipes, onClose, onDone }) {
  const { staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [form, setForm] = useState({ recipeId: '', qty: '', date: todayLocal() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = recipes.find((x) => x.id === form.recipeId);
  const go = async () => {
    setBusy(true); setError('');
    try { onDone(await productionService.startRun({ recipeId: form.recipeId, plannedQuantity: form.qty, runDate: form.date, createdBy: staffId })); }
    catch (err) { setError(err.message || 'Could not start the run.'); setBusy(false); }
  };
  return (
    <Sheet title="Start production" onClose={onClose}>
      <div className="space-y-3">
        <select className={field} value={form.recipeId} onChange={(e) => setForm({ ...form, recipeId: e.target.value })}>
          <option value="">Choose a recipe</option>
          {recipes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div><span className={lab}>{r ? `How many ${r.primary_product_name} to make` : 'How many to make'}</span>
          <input className={field} type="number" inputMode="decimal" placeholder={r ? `e.g. ${Number(r.primary_quantity) * 10}` : ''} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></div>
        <div><span className={lab}>Date</span><input className={field} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        {r && Number(form.qty) > 0 && Number(r.cost_per_batch) > 0 && (
          <div className="bg-[#EEF1EC] rounded-xl p-3 text-sm flex justify-between"><span className="text-[#68756D]">Materials will cost about</span><span className="font-bold text-[#1B5138]">{kes((Number(form.qty) / Number(r.primary_quantity)) * Number(r.cost_per_batch))}</span></div>
        )}
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        {!isOnline && <p className="text-xs text-[#68756D]">Starting a run needs a connection.</p>}
        <button disabled={!isOnline || busy || !form.recipeId || !(Number(form.qty) > 0)} onClick={go} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Starting…' : 'Start'}</button>
      </div>
    </Sheet>
  );
}

function ResultSheet({ runId, onClose, onPosted }) {
  const { staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [run, setRun] = useState(null);
  const [out, setOut] = useState({});
  const [inp, setInp] = useState({});
  const [showUse, setShowUse] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    productionService.getRun(runId).then((r) => {
      setRun(r);
      setOut(Object.fromEntries(r.outputs.map((o) => [o.product_id, String(Number(o.expected_quantity))])));
      setInp(Object.fromEntries(r.inputs.map((i) => [i.product_id, String(Number(i.planned_quantity))])));
    }).catch((err) => setError(err.message || 'Could not load the run.'));
  }, [runId]);

  if (!run) return <Sheet title="Record the result" onClose={onClose}>{error ? <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div> : <Loader2 size={16} className="animate-spin" />}</Sheet>;

  const primary = run.outputs.find((o) => o.is_primary);
  const pAct = Number(out[primary.product_id]);
  const short = pAct < Number(primary.expected_quantity);
  const yieldPct = Number(primary.expected_quantity) > 0 && out[primary.product_id] !== '' ? (pAct / Number(primary.expected_quantity)) * 100 : null;
  const allOut = run.outputs.every((o) => out[o.product_id] !== '' && Number(out[o.product_id]) >= 0);
  const allIn = run.inputs.every((i) => inp[i.product_id] !== '' && Number(inp[i.product_id]) >= 0);
  const changedInputs = run.inputs.filter((i) => Number(inp[i.product_id]) !== Number(i.planned_quantity));

  const post = async () => {
    setBusy(true); setError('');
    try {
      const r = await productionService.postRun({
        runId, postedBy: staffId, wastageReason: short ? reason || null : null, notes: notes.trim() || null,
        outputs: run.outputs.map((o) => ({ product_id: o.product_id, actual_quantity: out[o.product_id] })),
        inputs: changedInputs.length ? changedInputs.map((i) => ({ product_id: i.product_id, actual_quantity: inp[i.product_id] })) : null,
      });
      setResult(r); onPosted();
    } catch (err) { setError(err.message || 'Could not post the run.'); }
    finally { setBusy(false); }
  };

  if (result) {
    const dearer = Number(result.cost_per_actual_unit) > Number(result.cost_per_expected_unit) + 0.005;
    return (
      <Sheet title={`${result.run_number} posted`} onClose={onClose}>
        <div className="space-y-2 text-sm">
          <Row k="Planned / made" v={`${num(result.expected_output)} / ${num(result.actual_output)}`} />
          <Row k="Yield" v={`${num(result.yield_pct)}%`} strong />
          <Row k="Lost" v={`${num(result.wastage_qty)} · ${kes(result.wastage_cost)}`} />
          <Row k="Materials cost" v={kes(result.input_cost)} />
          <Row k="Cost per unit, as planned" v={kes(result.cost_per_expected_unit)} />
          <Row k="Cost per unit, really" v={kes(result.cost_per_actual_unit)} strong />
        </div>
        {dearer && <p className="text-sm text-[#7a5f1f] bg-[#C6A15B]/15 rounded-lg px-3 py-2 mt-3">Each unit cost {kes(Number(result.cost_per_actual_unit) - Number(result.cost_per_expected_unit))} more than planned because less came out than expected.</p>}
        {Number(result.inputs_missing_cost) > 0 && <p className="text-xs text-red-700 mt-3">{result.inputs_missing_cost} material{result.inputs_missing_cost > 1 ? 's have' : ' has'} no cost on record, so the cost above is too low. Set a cost price or receive stock with a cost.</p>}
        <p className="text-xs text-[#68756D] mt-3">Stock has been updated. Materials went down and finished goods went up.</p>
        <button onClick={onClose} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold mt-4">Done</button>
      </Sheet>
    );
  }

  return (
    <Sheet title={`${run.recipe?.name} · ${run.run_number}`} onClose={onClose}>
      <p className="text-xs text-[#68756D] mb-3">{formatDay(run.run_date)} · planned {num(primary.expected_quantity)} {primary.product?.name}</p>
      <div className="space-y-3">
        <div>
          <span className={lab}>What was actually made</span>
          {run.outputs.map((o) => (
            <div key={o.id} className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0 text-sm text-[#26352D] truncate">{o.product?.name}<span className="block text-xs text-[#68756D]">expected {num(o.expected_quantity)}{o.unit ? ` ${o.unit}` : ''}</span></div>
              <input className={`${field} !w-28 text-right`} type="number" inputMode="decimal" value={out[o.product_id] ?? ''} onChange={(e) => setOut({ ...out, [o.product_id]: e.target.value })} />
            </div>
          ))}
          {yieldPct != null && <div className={`text-sm font-semibold ${yieldPct < 100 ? 'text-[#7a5f1f]' : 'text-[#1B5138]'}`}>Yield {num(yieldPct)}%{short ? ` · ${num(Number(primary.expected_quantity) - pAct)} lost` : ''}</div>}
        </div>

        {short && (
          <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Why was some lost? (optional)</option>
            {WASTAGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}

        <div>
          <button type="button" onClick={() => setShowUse(!showUse)} className="text-sm font-semibold text-[#237A52] min-h-[44px]">{showUse ? 'Hide' : 'Used more or less than planned?'}</button>
          {changedInputs.length > 0 && !showUse && <span className="text-xs text-[#7a5f1f] ml-2">{changedInputs.length} changed</span>}
          {showUse && run.inputs.map((i) => (
            <div key={i.id} className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0 text-sm text-[#26352D] truncate">{i.product?.name}<span className="block text-xs text-[#68756D]">planned {num(i.planned_quantity)}{i.unit ? ` ${i.unit}` : ''}</span></div>
              <input className={`${field} !w-28 text-right`} type="number" inputMode="decimal" value={inp[i.product_id] ?? ''} onChange={(e) => setInp({ ...inp, [i.product_id]: e.target.value })} />
            </div>
          ))}
        </div>

        <input className={field} placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        {!isOnline && <p className="text-xs text-[#68756D]">Posting changes your stock and costs, so it needs a connection.</p>}
        <button disabled={!isOnline || busy || !allOut || !allIn} onClick={post} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Posting…' : 'Post to stock'}</button>
        <p className="text-xs text-[#68756D]">A posted run cannot be edited. Fix a mistake with a stock adjustment.</p>
      </div>
    </Sheet>
  );
}

function Row({ k, v, strong }) {
  return <div className="flex justify-between"><span className="text-[#68756D]">{k}</span><span className={`tabular-nums ${strong ? 'font-bold text-[#1B5138]' : 'font-semibold text-[#26352D]'}`}>{v}</span></div>;
}

export default function ProductionPage() {
  const { isOnline } = useNetStatus();
  const { staffId } = usePosErpAuth();
  const [tab, setTab] = useState('draft');
  const [rows, setRows] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // {kind:'start'} | {kind:'result', id}

  const load = useCallback(async () => {
    setRows(null);
    try { setRows(await productionService.listRuns({ statuses: TABS.find(([k]) => k === tab)[2] })); setError(''); }
    catch (err) { setError(err.message || 'Could not load production.'); setRows([]); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const openStart = async () => {
    setError('');
    try { setRecipes((await productionService.listRecipes()).rows); setSheet({ kind: 'start' }); }
    catch (err) { setError(err.message || 'Could not load the recipes.'); }
  };
  const reverse = async (r) => {
    const reason = window.prompt(`Why reverse ${r.run_number}? Materials go back into stock and the finished goods come out.`);
    if (!reason) return;
    try { await productionService.reverseRun(r.id, reason, staffId); setError(''); load(); } catch (err) { setError(err.message || 'That did not work.'); }
  };
  const cancel = async (r) => { try { await productionService.cancelRun(r.id); load(); } catch (err) { setError(err.message || 'That did not work.'); } };

  return (
    <WorkspacePage title="Production" subtitle="Make things from your materials and see exactly what it cost.">
      <div className="flex items-center gap-2 mb-3">
        <div className="grid grid-cols-2 gap-1 bg-[#EEF1EC] rounded-xl p-1 flex-1">
          {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-[40px] rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1B5138]' : 'text-[#68756D]'}`}>{l}</button>)}
        </div>
        <button onClick={openStart} disabled={!isOnline} className="shrink-0 min-h-[48px] px-4 rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"><Plus size={16} /> New</button>
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {rows?.length === 0 && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]"><Factory className="mx-auto mb-2 text-[#237A52]" />
          {tab === 'draft' ? 'Nothing waiting. Tap New to plan a batch from a recipe.' : 'No finished runs yet.'}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(rows || []).map((r) => (
          <div key={r.id} className="bg-white border border-[#DDE3DD] rounded-xl p-4 min-w-0">
            <div className="flex justify-between gap-3"><div className="min-w-0"><div className="font-bold text-[#26352D] truncate">{r.recipe?.name}</div><div className="text-xs text-[#68756D]">{r.run_number} · {formatDay(r.run_date)}</div></div>
              {r.status === 'REVERSED' && <span className="shrink-0 self-start text-xs font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-700">Reversed</span>}
              {r.status === 'POSTED' && <span className={`shrink-0 self-start text-xs font-bold px-2.5 py-1 rounded-full ${Number(r.yield_pct) >= 100 ? 'bg-[#237A52]/10 text-[#1B5138]' : 'bg-[#C6A15B]/20 text-[#7a5f1f]'}`}>{num(r.yield_pct)}% yield</span>}</div>
            {r.status === 'DRAFT' ? (<>
              <div className="text-sm mt-2">Plan: <span className="font-semibold">{num(r.planned_quantity)}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => setSheet({ kind: 'result', id: r.id })} className="min-h-[44px] rounded-xl text-sm font-bold bg-[#237A52] text-white">Record result</button>
                <button onClick={() => cancel(r)} disabled={!isOnline} className="min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white text-red-600 disabled:opacity-50">Cancel</button>
              </div></>) : (
              <div className="mt-2 space-y-1 text-sm">
                <Row k="Made / planned" v={`${num(r.actual_output)} / ${num(r.expected_output)}`} />
                <Row k="Lost" v={`${num(r.wastage_qty)} · ${kes(r.wastage_cost)}${r.wastage_reason ? ` · ${r.wastage_reason}` : ''}`} />
                <Row k="Cost per unit" v={`${kes(r.cost_per_actual_unit)} (planned ${kes(r.cost_per_expected_unit)})`} strong />
                {r.status === 'REVERSED' && <div className="text-xs text-red-700">Reversed: {r.reverse_reason}. Not counted in yield or wastage.</div>}
                {r.status === 'POSTED' && <button onClick={() => reverse(r)} disabled={!isOnline} className="mt-2 w-full min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white text-red-600 disabled:opacity-50">Reverse this run</button>}
              </div>)}
          </div>
        ))}
      </div>
      {sheet?.kind === 'start' && <StartSheet recipes={recipes} onClose={() => setSheet(null)} onDone={(id) => { setSheet({ kind: 'result', id }); setTab('draft'); load(); }} />}
      {sheet?.kind === 'result' && <ResultSheet runId={sheet.id} onClose={() => { setSheet(null); load(); }} onPosted={load} />}
    </WorkspacePage>
  );
}
