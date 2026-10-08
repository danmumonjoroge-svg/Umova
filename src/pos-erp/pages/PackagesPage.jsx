// src/pos-erp/pages/PackagesPage.jsx
//
// Packages: one price for a bundle of things you already sell (Family Package,
// Bed & Breakfast). Components are ordinary products/services, or a free-text
// item. Cards on a phone; one stacked form. Selling a package happens on the
// guest's bill (Add charge -> Packages).

import React, { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Loader2, Trash2 } from 'lucide-react';
import { packageService } from '../services/packageService';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, kes } from '../components/workspace/WorkspaceKit';
import Sheet, { fieldClass as field } from '../components/workspace/Sheet';

const lab = 'block text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-1';
const blankItem = () => ({ product_id: '', description: '', quantity: '1', list_price: '' });

function PackageSheet({ packageId, products, onClose, onSaved }) {
  const { tenant, staffId } = usePosErpAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!packageId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!packageId) return;
    packageService.get(packageId).then((p) => {
      setName(p.name); setDescription(p.description || ''); setPrice(String(Number(p.price)));
      setItems(p.items.map((i) => ({ product_id: i.product_id || '', description: i.description, quantity: String(Number(i.quantity)), list_price: String(Number(i.list_price)) })));
      setLoading(false);
    }).catch((err) => { setError(err.message || 'Could not load the package.'); setLoading(false); });
  }, [packageId]);

  const setItem = (i, patch) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const pick = (i, id) => {
    const p = products.find((x) => x.id === id);
    setItem(i, { product_id: id, description: p ? p.name : '', list_price: p ? String(Number(p.selling_price || 0)) : '' });
  };
  const normal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.list_price) || 0), 0);
  const saving = normal - (Number(price) || 0);
  const ready = name.trim() && price !== '' && Number(price) >= 0 && items.length > 0 && items.every((i) => (i.product_id || i.description.trim()) && Number(i.quantity) > 0);

  const save = async () => {
    setBusy(true); setError('');
    try { await packageService.save({ id: packageId, businessId: tenant?.business_id, name, description, price, items, createdBy: staffId }); onSaved(); }
    catch (err) { setError(err.message || 'Could not save the package.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={packageId ? 'Edit package' : 'New package'} onClose={onClose}>
      {loading ? <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div> : (
        <div className="space-y-4">
          <input className={field} placeholder="Package name (e.g. Family Package)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <span className={lab}>What is in it</span>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="border border-[#DDE3DD] rounded-xl p-2 space-y-2">
                  <select className={field} value={it.product_id} onChange={(e) => pick(i, e.target.value)}>
                    <option value="">Something not on my item list (type it)</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {!it.product_id && <input className={field} placeholder="Name (e.g. Late check-out)" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />}
                  <div className="flex gap-2">
                    <input className={field} type="number" inputMode="decimal" placeholder="How many" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
                    <input className={field} type="number" inputMode="decimal" placeholder="Normal price each" value={it.list_price} onChange={(e) => setItem(i, { list_price: e.target.value })} />
                    <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1} className="w-12 shrink-0 rounded-xl border border-[#DDE3DD] flex items-center justify-center text-red-600 disabled:opacity-30"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems([...items, blankItem()])} className="text-sm font-semibold text-[#237A52] min-h-[44px]">+ Add another item</button>
          </div>
          <div>
            <span className={lab}>Package price</span>
            <input className={field} type="number" inputMode="decimal" placeholder="Price for the whole package" value={price} onChange={(e) => setPrice(e.target.value)} />
            <p className="text-xs text-[#68756D] mt-1">
              Items add up to {kes(normal)} at normal prices{price !== '' && normal > 0 ? (saving >= 0 ? `, so the guest saves ${kes(saving)}.` : `, so this costs ${kes(-saving)} MORE than buying them separately.`) : '.'}
              {' '}The price is shared across the items in proportion to their normal prices, so the bill always adds up exactly.
            </p>
          </div>
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <button disabled={busy || !ready} onClick={save} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save package'}</button>
        </div>
      )}
    </Sheet>
  );
}

export default function PackagesPage() {
  const { isOnline } = useNetStatus();
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // { id? }

  const load = useCallback(async () => {
    try { setRows(await packageService.list()); setError(''); }
    catch (err) { setError(err.message || 'Could not load the packages.'); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openSheet = async (id = null) => {
    setError('');
    try { if (!products.length) setProducts((await productService.getAll({ activeOnly: true, limit: 500 })).data); setSheet({ id }); }
    catch (err) { setError(err.message || 'Could not load your items.'); }
  };
  const retire = async (r) => { try { await packageService.setActive(r.id, false); load(); } catch (err) { setError(err.message || 'That did not work.'); } };

  return (
    <WorkspacePage title="Packages" subtitle="Sell a bundle at one price. It lands on the guest's bill item by item.">
      <button onClick={() => openSheet()} disabled={!isOnline} className="w-full sm:w-auto min-h-[48px] px-5 rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center justify-center gap-1.5 mb-3 disabled:opacity-50"><Plus size={16} /> New package</button>
      {!isOnline && <p className="text-xs text-[#68756D] mb-2">Creating and changing packages need a connection.</p>}
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {rows?.length === 0 && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
          <Package className="mx-auto mb-2 text-[#237A52]" />
          No packages yet. A package is a few things sold together at one price, like swimming + lunch + drinks.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(rows || []).map((r) => (
          <div key={r.id} className="bg-white border border-[#DDE3DD] rounded-xl p-4 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-[#26352D] truncate">{r.name}</div>
                <div className="text-xs text-[#68756D] truncate">{r.item_count} item{r.item_count === 1 ? '' : 's'}{r.description ? ` · ${r.description}` : ''}</div>
              </div>
              <div className="font-bold text-lg tabular-nums text-[#1B5138] shrink-0">{kes(r.price)}</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#EEF1EC] rounded-lg px-3 py-2"><div className="text-[#68756D]">Bought separately</div><div className="font-semibold tabular-nums">{kes(r.list_total)}</div></div>
              <div className="bg-[#EEF1EC] rounded-lg px-3 py-2"><div className="text-[#68756D]">Guest saves</div><div className={`font-semibold tabular-nums ${Number(r.guest_saving) < 0 ? 'text-red-600' : ''}`}>{kes(r.guest_saving)}</div></div>
            </div>
            {Number(r.est_cost) > 0 && <div className="text-xs text-[#68756D] mt-2">Cost of stocked items {kes(r.est_cost)} · left over {kes(r.est_margin)}</div>}
            {isOnline && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => openSheet(r.id)} className="min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white">Edit</button>
                <button onClick={() => retire(r)} className="min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white text-red-600">Stop selling</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {sheet && <PackageSheet packageId={sheet.id} products={products} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
    </WorkspacePage>
  );
}
