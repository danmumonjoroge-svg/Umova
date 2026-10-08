// src/pos-erp/pages/RecipesPage.jsx
//
// Recipes: what one batch needs and what it should make. Generic on purpose: a cake,
// a carcass cut into joints, a chicken meal, a batch of juice are all "materials in,
// finished goods out". Cards on a phone, one stacked form. Materials and finished
// goods are ordinary products (no separate catalogue).

import React, { useCallback, useEffect, useState } from 'react';
import { ChefHat, Plus, Loader2, Trash2 } from 'lucide-react';
import { productionService } from '../services/productionService';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, kes } from '../components/workspace/WorkspaceKit';
import Sheet, { fieldClass as field } from '../components/workspace/Sheet';

const lab = 'block text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-1';
function ProductSelect({ value, onChange, list, placeholder }) {
  return (
    <select className={field} value={value} onChange={onChange}>
      <option value="">{placeholder}</option>
      {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
const blankLine = () => ({ product_id: '', quantity: '', unit: '' });

function RecipeSheet({ recipeId, products, onClose, onSaved }) {
  const { tenant, staffId } = usePosErpAuth();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [main, setMain] = useState({ product_id: '', quantity: '1', unit: '', cost_share_pct: '100' });
  const [extras, setExtras] = useState([]);
  const [inputs, setInputs] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!recipeId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!recipeId) return;
    productionService.getRecipe(recipeId).then((r) => {
      setName(r.name); setNotes(r.notes || '');
      const [p, ...rest] = r.outputs;
      if (p) setMain({ product_id: p.product_id, quantity: String(Number(p.quantity)), unit: p.unit || '', cost_share_pct: String(Number(p.cost_share_pct)) });
      setExtras(rest.map((o) => ({ product_id: o.product_id, quantity: String(Number(o.quantity)), unit: o.unit || '', cost_share_pct: String(Number(o.cost_share_pct)) })));
      setInputs(r.inputs.map((i) => ({ product_id: i.product_id, quantity: String(Number(i.quantity)), unit: i.unit || '' })));
      setLoading(false);
    }).catch((err) => { setError(err.message || 'Could not load the recipe.'); setLoading(false); });
  }, [recipeId]);

  const tracked = products.filter((p) => p.track_inventory);
  const upd = (list, setList, i, k) => (e) => setList(list.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const hasExtras = extras.length > 0;
  const shareSum = hasExtras ? [main, ...extras].reduce((s, o) => s + (Number(o.cost_share_pct) || 0), 0) : 100;
  const ready = name.trim() && main.product_id && Number(main.quantity) > 0
    && inputs.length > 0 && inputs.every((i) => i.product_id && Number(i.quantity) > 0)
    && extras.every((o) => o.product_id && Number(o.quantity) > 0) && Math.abs(shareSum - 100) < 0.01;

  const save = async () => {
    setBusy(true); setError('');
    try {
      await productionService.saveRecipe({
        id: recipeId, businessId: tenant?.business_id, name, notes, createdBy: staffId, inputs,
        outputs: [{ ...main, is_primary: true, cost_share_pct: hasExtras ? main.cost_share_pct : 100 }, ...extras.map((o) => ({ ...o, is_primary: false }))],
      });
      onSaved();
    } catch (err) { setError(err.message || 'Could not save the recipe.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={recipeId ? 'Edit recipe' : 'New recipe'} onClose={onClose}>
      {loading ? <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div> : (
        <div className="space-y-4">
          <input className={field} placeholder="Recipe name (e.g. Chocolate Cake)" value={name} onChange={(e) => setName(e.target.value)} />

          <div>
            <span className={lab}>One batch makes</span>
            <ProductSelect value={main.product_id} onChange={(e) => setMain({ ...main, product_id: e.target.value })} list={products} placeholder="Choose the finished item" />
            {main.product_id && !products.find((p) => p.id === main.product_id)?.track_inventory && (
              <p className="text-xs text-[#7a5f1f] mt-1">This item is not stock-tracked, so finished stock will not be counted. Materials are still used up and costed.</p>
            )}
            <div className="flex gap-2 mt-2">
              <input className={field} type="number" inputMode="decimal" placeholder="How many" value={main.quantity} onChange={(e) => setMain({ ...main, quantity: e.target.value })} />
              <input className={field} placeholder="Unit (cake, kg…)" value={main.unit} onChange={(e) => setMain({ ...main, unit: e.target.value })} />
              {hasExtras && <input className={field} type="number" inputMode="decimal" placeholder="Cost %" value={main.cost_share_pct} onChange={(e) => setMain({ ...main, cost_share_pct: e.target.value })} />}
            </div>
          </div>

          <div>
            <span className={lab}>Materials for one batch</span>
            <div className="space-y-2">
              {inputs.map((l, i) => (
                <div key={i} className="border border-[#DDE3DD] rounded-xl p-2 space-y-2">
                  <ProductSelect value={l.product_id} onChange={upd(inputs, setInputs, i, 'product_id')} list={tracked} placeholder="Choose a material" />
                  <div className="flex gap-2">
                    <input className={field} type="number" inputMode="decimal" placeholder="Amount" value={l.quantity} onChange={upd(inputs, setInputs, i, 'quantity')} />
                    <input className={field} placeholder="Unit (kg, L…)" value={l.unit} onChange={upd(inputs, setInputs, i, 'unit')} />
                    <button type="button" aria-label="Remove" onClick={() => setInputs(inputs.filter((_, j) => j !== i))} disabled={inputs.length === 1} className="w-12 shrink-0 rounded-xl border border-[#DDE3DD] flex items-center justify-center text-red-600 disabled:opacity-30"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setInputs([...inputs, blankLine()])} className="text-sm font-semibold text-[#237A52] min-h-[44px]">+ Add a material</button>
            {tracked.length === 0 && <p className="text-xs text-[#68756D]">Only stock-tracked items can be materials. Add them under My Items first.</p>}
          </div>

          <div>
            <span className={lab}>Also makes (optional)</span>
            {extras.map((o, i) => (
              <div key={i} className="border border-[#DDE3DD] rounded-xl p-2 space-y-2 mb-2">
                <ProductSelect value={o.product_id} onChange={upd(extras, setExtras, i, 'product_id')} list={products} placeholder="Bones, offcuts…" />
                <div className="flex gap-2">
                  <input className={field} type="number" inputMode="decimal" placeholder="How many" value={o.quantity} onChange={upd(extras, setExtras, i, 'quantity')} />
                  <input className={field} placeholder="Unit" value={o.unit} onChange={upd(extras, setExtras, i, 'unit')} />
                  <input className={field} type="number" inputMode="decimal" placeholder="Cost %" value={o.cost_share_pct} onChange={upd(extras, setExtras, i, 'cost_share_pct')} />
                  <button type="button" aria-label="Remove" onClick={() => setExtras(extras.filter((_, j) => j !== i))} className="w-12 shrink-0 rounded-xl border border-[#DDE3DD] flex items-center justify-center text-red-600"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setExtras([...extras, { product_id: '', quantity: '', unit: '', cost_share_pct: '0' }])} className="text-sm font-semibold text-[#237A52] min-h-[44px]">+ Another thing it makes</button>
            {hasExtras && <p className={`text-xs ${Math.abs(shareSum - 100) < 0.01 ? 'text-[#68756D]' : 'text-red-700'}`}>Cost % across everything it makes must add up to 100 (now {shareSum}). It decides how the materials' cost is shared.</p>}
          </div>

          <input className={field} placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <button disabled={busy || !ready} onClick={save} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save recipe'}</button>
        </div>
      )}
    </Sheet>
  );
}

export default function RecipesPage() {
  const { isOnline } = useNetStatus();
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // { id? }

  const load = useCallback(async () => {
    try { const r = await productionService.listRecipes(); setRows(r.rows); setFromCache(r.fromCache); setError(''); }
    catch (err) { setError(err.message || 'Could not load the recipes.'); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openSheet = async (id = null) => {
    setError('');
    try { if (!products.length) setProducts((await productService.getAll({ activeOnly: true, limit: 500 })).data); setSheet({ id }); }
    catch (err) { setError(err.message || 'Could not load your items.'); }
  };
  const retire = async (r) => {
    try { await productionService.setRecipeActive(r.id, false); load(); } catch (err) { setError(err.message || 'That did not work.'); }
  };
  const canWrite = isOnline && !fromCache;

  return (
    <WorkspacePage title="Recipes" subtitle="What goes in, and what should come out, for one batch.">
      <button onClick={() => openSheet()} disabled={!canWrite} className="w-full sm:w-auto min-h-[48px] px-5 rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center justify-center gap-1.5 mb-3 disabled:opacity-50"><Plus size={16} /> New recipe</button>
      {fromCache && <p className="text-xs text-[#68756D] mb-2">Showing recipes saved on this device. Costs may be out of date until you are back online.</p>}
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {rows?.length === 0 && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
          <ChefHat className="mx-auto mb-2 text-[#237A52]" />
          No recipes yet. A recipe says, for one batch, which materials you use and what you make, so you can see your cost and your wastage.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(rows || []).map((r) => {
          const per = Number(r.primary_quantity) > 0 ? Number(r.cost_per_batch) / Number(r.primary_quantity) : 0;
          return (
            <div key={r.id} className="bg-white border border-[#DDE3DD] rounded-xl p-4 min-w-0">
              <div className="font-bold text-[#26352D] truncate">{r.name}</div>
              <div className="text-xs text-[#68756D] truncate">Makes {Number(r.primary_quantity)} {r.primary_unit || ''} {r.primary_product_name}</div>
              <div className="mt-2 flex items-baseline justify-between bg-[#EEF1EC] rounded-lg px-3 py-2 text-sm">
                <span className="text-[#68756D]">Cost per {r.primary_unit || 'unit'}</span>
                <span className="font-bold tabular-nums text-[#1B5138]">{r.cost_per_batch == null ? '—' : kes(per)}</span>
              </div>
              {canWrite && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => openSheet(r.id)} className="min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white">Edit</button>
                  <button onClick={() => retire(r)} className="min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white text-red-600">Stop using</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {sheet && <RecipeSheet recipeId={sheet.id} products={products} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
    </WorkspacePage>
  );
}
