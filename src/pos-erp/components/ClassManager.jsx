// src/pos-erp/components/ClassManager.jsx
// Pop-up on My Items: set up product/service classes, then put items in them (a whole category at once, or let the
// system suggest and you confirm). Needs products.manage; the database refuses anyone without it.
import React, { useCallback, useEffect, useState } from 'react';
import { productClassService, CLASS_KINDS, CLASS_PRESETS } from '../services/productClassService';
import { inputCls, saveBtnCls } from './CardKit';
import { singleFlight } from '../utils/singleFlight';

export default function ClassManager({ tenant, onClose, onChanged }) {
  const businessId = tenant?.business_id;
  const [classes, setClasses] = useState([]);
  const [cats, setCats] = useState([]);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('OTHER');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const [c, k] = await Promise.all([productClassService.list(businessId), productClassService.categories()]); setClasses(c); setCats(k); }
    catch (e) { setErr(e?.code === '42P01' ? 'Classes are not set up in the database yet.' : (e?.message || 'Could not load classes.')); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const run = (key, fn) => singleFlight(`ClassManager.${key}`, async (...a) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(...a); } catch (e) { setErr(e?.code === '42501' ? 'Only someone who can manage items can change classes.' : (e?.message || 'That did not work.')); }
    finally { setBusy(false); }
  });

  const seed = run('seed', async (preset) => { const n = await productClassService.seed(businessId, preset); setMsg(n ? `${n} class${n === 1 ? '' : 'es'} added.` : 'Those classes already exist.'); await load(); onChanged?.(); });
  const add = run('add', async (e) => { e.preventDefault(); if (!name.trim()) return; await productClassService.add({ tenantId: tenant.id, businessId, name, kind, sortOrder: classes.length + 1 }); setName(''); await load(); onChanged?.(); });
  const rename = run('rename', async (c) => { const v = window.prompt('New name for this class', c.name); if (!v || v.trim() === c.name) return; await productClassService.rename(c.id, v); await load(); onChanged?.(); });
  const toggle = run('toggle', async (c) => { await productClassService.setActive(c.id, !c.is_active); await load(); onChanged?.(); });
  const suggest = run('suggest', async () => { setPreview(await productClassService.autoAssign(businessId, false)); });
  const apply = run('apply', async () => { const r = await productClassService.autoAssign(businessId, true); setMsg(`${r.filter((x) => x.applied).length} items placed in a class.`); setPreview(null); onChanged?.(); });
  const moveCat = run('cat', async (catId, classId) => { if (!catId) return; const n = await productClassService.assignCategory(businessId, catId, classId); setMsg(`${n} item${n === 1 ? '' : 's'} moved.`); onChanged?.(); });

  const [catPick, setCatPick] = useState('');
  const [catClass, setCatClass] = useState('');

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Item classes">
      <div className="bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] p-4 rounded-t-2xl sm:rounded-xl w-full sm:max-w-xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-[#23382B]">Classes of items and services</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full text-xl leading-none text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <p className="text-[12px] text-[#6F7461] mb-3">A class says which part of the business an item belongs to (Restaurant, Lounge &amp; Bar, Accommodation...). Reports and targets are then given for each class.</p>
        {err && <div className="mb-2 px-3 py-2 rounded-lg bg-[#FBE4E0] text-[12.5px] text-[#8F2E24]">{err}</div>}
        {msg && <div className="mb-2 px-3 py-2 rounded-lg bg-[#EEF5E8] text-[12.5px] text-[#1B5138]">{msg}</div>}

        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mb-1">1. Your classes</h3>
        {classes.length === 0 && (
          <div className="mb-2">
            <p className="text-[12.5px] text-[#23382B] mb-1.5">Start with a ready-made set (you can rename or add later):</p>
            <div className="grid gap-1.5">
              {CLASS_PRESETS.map(([k, l, d]) => (
                <button key={k} type="button" disabled={busy} onClick={() => seed(k)} className="text-left rounded-lg border border-[#E3DBB8] px-3 py-2 hover:border-[#C9A227] disabled:opacity-60">
                  <span className="block text-sm font-semibold text-[#23382B]">{l}</span><span className="block text-[11.5px] text-[#6F7461]">{d}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {classes.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-[#EEEBDD]">
            <span className={`text-sm ${c.is_active ? 'text-[#23382B] font-semibold' : 'text-[#9A987F] line-through'}`}>{c.name}</span>
            <span className="flex gap-3 text-[12px] font-semibold">
              <button type="button" disabled={busy} onClick={() => rename(c)} className="text-[#1F6B45] underline">Rename</button>
              <button type="button" disabled={busy} onClick={() => toggle(c)} className="text-[#8A6A12] underline">{c.is_active ? 'Hide' : 'Show'}</button>
            </span>
          </div>
        ))}
        <form onSubmit={add} className="flex gap-2 mt-2">
          <input className={inputCls} placeholder="Add your own, e.g. Conference hall" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={`${inputCls} !w-36`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of class">{CLASS_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button type="submit" disabled={busy || !name.trim()} className={`${saveBtnCls} px-4`}>Add</button>
        </form>

        {classes.length > 0 && (
          <>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mt-4 mb-1">2. Put items in a class</h3>
            <div className="rounded-lg border border-[#E3DBB8] p-2.5 mb-2">
              <p className="text-[12.5px] text-[#23382B] mb-1.5 font-semibold">A whole category at once</p>
              <div className="flex gap-2">
                <select className={inputCls} value={catPick} onChange={(e) => setCatPick(e.target.value)} aria-label="Category"><option value="">Category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <select className={inputCls} value={catClass} onChange={(e) => setCatClass(e.target.value)} aria-label="Class"><option value="">Class…</option>{classes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <button type="button" disabled={busy || !catPick || !catClass} onClick={() => moveCat(catPick, catClass)} className={`${saveBtnCls} px-4`}>Move</button>
              </div>
            </div>
            <div className="rounded-lg border border-[#E3DBB8] p-2.5">
              <p className="text-[12.5px] text-[#23382B] mb-1 font-semibold">Let the system suggest</p>
              <p className="text-[11.5px] text-[#6F7461] mb-1.5">It reads item and category names (beer, room, swimming, soda...). You see the list first; nothing changes until you confirm, and items you already classified are never touched.</p>
              <button type="button" disabled={busy} onClick={suggest} className="px-3 min-h-[38px] rounded-lg border border-[#1F6B45] text-[#1F6B45] text-sm font-semibold">Show suggestions</button>
              {preview && (
                <div className="mt-2">
                  {preview.length === 0 ? <p className="text-[12.5px] text-[#6F7461]">Every item already has a class, or none could be guessed.</p> : (
                    <>
                      <div className="max-h-48 overflow-y-auto border border-[#EEEBDD] rounded-lg divide-y divide-[#EEEBDD]">
                        {preview.map((r) => <div key={r.product_id} className="px-2.5 py-1.5 text-[12.5px] flex justify-between gap-2"><span className="truncate text-[#23382B]">{r.product_name}</span><span className="shrink-0 font-semibold text-[#1F6B45]">{r.suggested_class}</span></div>)}
                      </div>
                      <button type="button" disabled={busy} onClick={apply} className={`${saveBtnCls} px-4 mt-2`}>Place these {preview.length} items</button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
