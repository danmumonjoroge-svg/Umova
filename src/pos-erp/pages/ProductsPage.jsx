// src/pos-erp/pages/ProductsPage.jsx
//
// FIXED alongside productService.js/useProducts.js:
//   - Delete -> Deactivate/Reactivate (was a hard delete that would fail
//     via FK on any product with sales/GRN/PO history).
//   - Added an actual edit path — previously create-only.
//   - Added reorder_level and allow_negative_stock to the form. Neither
//     was collectable before, which mattered more than it looked:
//     saleService.js's oversell guard and the low-stock notifications
//     both depend on reorder_level, and there was no way to set it above
//     its default of 0 for any product.
//   - Added CUSTOM to the selling-mode dropdown — POSPage.jsx's
//     VARIABLE_MODES already treats it as valid; it just wasn't
//     selectable here.
//   - Wired up checkBarcodeAvailable(), which existed in
//     productResolverService.js but was never called from this form —
//     two products could previously share a barcode with no warning.

import React, { useState, useEffect } from 'react';
import { useProducts } from '../hooks/useProducts';
import { ScannerModal, useBarcodeScanner } from '../index';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { checkBarcodeAvailable } from '../services/productResolverService';
import { productService } from '../services/productService';
import { Image as ImageIcon, Package, Plus, Pencil, Power, Store, Layers } from 'lucide-react';
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, CardGrid, DataCard, IconBtn, IconTile, Pill, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import { singleFlight } from '../utils/singleFlight';
// My Business Network: only used when the owner has switched the capability on AND this person may manage items.
import { useCapabilities } from '../navigation/CapabilitiesContext';
import { usePermissions } from '../navigation/PermissionsContext';
import PublishSheet from '../components/network/PublishSheet';
import { networkService } from '../services/networkService';
import ClassManager from '../components/ClassManager';
import { productClassService } from '../services/productClassService';

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', selling_price: '', cost_price: '',
  category_id: '', class_id: '', unit_id: '', selling_mode: 'PER_UNIT',
  track_inventory: true, allow_negative_stock: false, reorder_level: '0',
  image_url: '',
};

export default function ProductsPage() {
  const { staffId, tenant } = usePosErpAuth();
  const { products, loading, error, fetch: refetchProducts, create, update, deactivate, reactivate } = useProducts();
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const closeForm = () => { setShowForm(false); setEditingProduct(null); };
  useEffect(() => {
    if (!showForm) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeForm(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showForm]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // Classes (phase42): Restaurant, Lounge & Bar, Accommodation, Outdoor... Optional: an item with no class still sells.
  const { can } = usePermissions();
  const [classes, setClasses] = useState([]);
  const [showClasses, setShowClasses] = useState(false);
  const loadClasses = React.useCallback(() => {
    if (!tenant?.business_id) return;
    productClassService.list(tenant.business_id).then(setClasses).catch(() => setClasses([]));
  }, [tenant?.business_id]);
  useEffect(() => { loadClasses(); }, [loadClasses]);
  const className = (id) => classes.find((c) => c.id === id)?.name;
  // Publish to Network (added): which of my items are on the network, and the item being published right now.
  const { enabled: enabledCapabilities } = useCapabilities();
  const { can: canDo } = usePermissions();
  const networkOn = enabledCapabilities.includes('network') && canDo('products.manage');
  const [netOffers, setNetOffers] = useState({});
  const [publishFor, setPublishFor] = useState(null);
  const loadNetOffers = React.useCallback(() => {
    if (!networkOn) return;
    networkService.myOffers().then((rows) => setNetOffers(Object.fromEntries(rows.map((o) => [o.product_id, o])))).catch(() => {});  // a failure just hides the badge
  }, [networkOn]);
  React.useEffect(() => { loadNetOffers(); }, [loadNetOffers]);

  // On the product form, scanning a barcode that ISN'T registered yet is the
  // normal/expected outcome — it just fills the field. If it happens to
  // match an existing active product, warn instead of silently overwriting.
  const { processScan, lastOutcome } = useBarcodeScanner({
    contextType: 'PRODUCT_FORM',
    userId: staffId,
    onResolved: (outcome) => {
      if (outcome.barcode) setForm((f) => ({ ...f, barcode: outcome.barcode }));
      if (outcome.result === 'RESOLVED') return; // handled inline via lastOutcome warning below
      setShowScanner(false);
    },
  });

  const openCreateForm = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setForm({
      name: product.name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      selling_price: product.selling_price ?? '',
      cost_price: product.cost_price ?? '',
      category_id: product.category_id || '',
      class_id: product.class_id || '',
      unit_id: product.unit_id || '',
      selling_mode: product.selling_mode || 'PER_UNIT',
      track_inventory: product.track_inventory ?? true,
      allow_negative_stock: product.allow_negative_stock ?? false,
      reorder_level: String(product.reorder_level ?? 0),
      image_url: product.image_url || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = singleFlight('ProductsPage.handleSubmit', async (e) => {
    e.preventDefault();
    setFormError('');

    if (form.barcode) {
      const check = await checkBarcodeAvailable({
        barcode: form.barcode,
        excludeProductId: editingProduct?.id,
      });
      if (!check.available) {
        setFormError(`That barcode is already used by "${check.conflictingProduct.name}".`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        category_id: form.category_id || null,
        class_id: form.class_id || null,
        unit_id: form.unit_id || null,
        selling_price: parseFloat(form.selling_price),
        cost_price: parseFloat(form.cost_price) || 0,
        reorder_level: parseFloat(form.reorder_level) || 0,
      };
      if (editingProduct) {
        await update(editingProduct.id, payload);
      } else {
        await create(payload);
      }
      setShowForm(false);
      setEditingProduct(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  });

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingProduct) return;
    if (!file.type.startsWith('image/')) { setFormError('Photo must be an image file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setFormError('Photo must be under 2MB.'); return; }
    setFormError('');
    setUploadingImage(true);
    try {
      const url = await productService.uploadImage(tenant?.business_id, editingProduct.id, file);
      setForm(f => ({ ...f, image_url: url }));
    } catch (err) {
      setFormError(err.message || 'Failed to upload photo.');
    } finally {
      setUploadingImage(false);
    }
  };

  const activeCount = products.filter((p) => p.is_active === 'active').length;
  const noBarcode = products.filter((p) => !p.barcode).length;
  const shown = products.filter((p) => {
    const q = search.toLowerCase();
    const okSearch = !search || p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(search);
    const okFilter = filter === 'all' || (filter === 'active' && p.is_active === 'active') || (filter === 'inactive' && p.is_active !== 'active') || (filter === 'nobarcode' && !p.barcode);
    return okSearch && okFilter;
  });

  return (
    <FitPage
      title="My Items"
      icon={Package}
      subtitle="Everything you sell."
      action={(
        <div className="flex items-center gap-2">
          {can('products.manage') && <button type="button" onClick={() => setShowClasses(true)} className="min-h-[38px] px-3 rounded-lg border border-[#E3DBB8] bg-white text-[#23382B] text-sm font-semibold inline-flex items-center gap-1.5"><Layers size={15} /> Classes</button>}
          <AddButton onClick={() => (showForm ? setShowForm(false) : openCreateForm())} open={showForm} label="Product" icon={Plus} />
        </div>
      )}
      summary={!loading && !error && (
        <MiniStats items={[
          { label: 'Items', value: products.length },
          { label: 'Active', value: activeCount, tone: 'good' },
          { label: 'No barcode', value: noBarcode, tone: noBarcode ? 'gold' : undefined },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name, SKU or barcode…" />
          <FilterChips value={filter} onChange={setFilter} options={[
            { key: 'all', label: 'All' }, { key: 'active', label: 'Active' },
            { key: 'inactive', label: 'Inactive' }, { key: 'nobarcode', label: 'No barcode' },
          ]} />
        </div>
      )}
    >
      {showForm && (
        // A pop-up over the screen, so Edit never sends the person back to the top of a long list. Tapping outside or Esc closes it.
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeForm(); }} role="dialog" aria-modal="true" aria-label={editingProduct ? 'Edit item' : 'Add item'}>
        <form onSubmit={handleSubmit} className="bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] p-3 sm:p-4 rounded-t-2xl sm:rounded-xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-2.5 shadow-xl">
          <div className="md:col-span-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#23382B]">{editingProduct ? 'Edit item' : 'Add item'}</h2>
            <button type="button" onClick={closeForm} aria-label="Close" className="w-9 h-9 rounded-full text-xl leading-none text-gray-500 hover:bg-gray-100">×</button>
          </div>
          {formError && <div className="md:col-span-3 bg-[#FBE4E0] text-[#8F2E24] text-sm rounded-lg px-3 py-2">{formError}</div>}

          {/* Photo upload only works once the product has an id (the
              storage path is keyed by product id) — new products save a
              photo-less row first, then get a photo added in Edit. */}
          <div className="md:col-span-3 flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {form.image_url
                ? <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                : <ImageIcon size={22} className="text-gray-300" />}
            </div>
            {editingProduct ? (
              <label className="text-xs font-semibold text-[#1F6B45] hover:underline cursor-pointer">
                {uploadingImage ? 'Uploading…' : form.image_url ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/*" onChange={handleImageChange} disabled={uploadingImage} className="hidden" />
              </label>
            ) : (
              <span className="text-xs text-gray-400">Save the product first, then edit it to add a photo.</span>
            )}
          </div>

          <input required placeholder="Product Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]" />
          <input placeholder="SKU" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]" />
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input placeholder="Barcode" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm flex-1 min-w-0 focus:outline-none focus:border-[#C9A227]" />
              <button type="button" onClick={() => setShowScanner(true)} className="bg-[#17553A] text-white px-3 rounded-lg">📷</button>
            </div>
            <span className="text-xs text-gray-400">{form.barcode ? '✓ Barcode set' : '⚠ No barcode'}</span>
          </div>
          <input required type="number" placeholder="Selling Price" value={form.selling_price} onChange={e => setForm({...form, selling_price: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]" />
          <input type="number" placeholder="Cost Price" value={form.cost_price} onChange={e => setForm({...form, cost_price: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]" />
          <select value={form.selling_mode} onChange={e => setForm({...form, selling_mode: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]">
            <option value="PER_UNIT">Per Unit</option>
            <option value="WEIGHT">By Weight</option>
            <option value="VOLUME">By Volume</option>
            <option value="CUSTOM">Custom</option>
          </select>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Class (which part of the business)</label>
            <select value={form.class_id} onChange={e => setForm({...form, class_id: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]">
              <option value="">Not classified</option>
              {classes.filter((c) => c.is_active || c.id === form.class_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {classes.length === 0 && can('products.manage') && <button type="button" onClick={() => setShowClasses(true)} className="text-xs text-[#1F6B45] underline text-left">Set up classes</button>}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.track_inventory} onChange={e => setForm({...form, track_inventory: e.target.checked})} />
            Track inventory
          </label>
          {form.track_inventory && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Reorder level</label>
                <input type="number" min="0" placeholder="0" value={form.reorder_level} onChange={e => setForm({...form, reorder_level: e.target.value})} className="border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] text-sm focus:outline-none focus:border-[#C9A227]" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={form.allow_negative_stock} onChange={e => setForm({...form, allow_negative_stock: e.target.checked})} />
                Allow selling below zero stock
              </label>
            </>
          )}

          <button type="submit" disabled={saving} className="bg-[#1F6B45] hover:bg-[#17553A] border-b-2 border-[#C9A227] text-white font-semibold min-h-[42px] rounded-lg md:col-span-3 disabled:opacity-60">
            {saving ? 'Saving…' : editingProduct ? 'Save changes' : 'Save'}
          </button>
        </form>
        </div>
      )}

      <ScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        scan={processScan}
        lastOutcome={lastOutcome}
        title="Scan Barcode"
        onAccept={() => setShowScanner(false)}
      />
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Notice>Couldn't load products: {error}</Notice>
      ) : shown.length === 0 ? (
        <EmptyBlock>{products.length === 0 ? 'No products yet. Tap "Product" to add your first.' : 'No items match.'}</EmptyBlock>
      ) : (
        <CardGrid>
          {shown.map((p) => {
            const active = p.is_active === 'active';
            return (
              <DataCard
                key={p.id}
                dim={!active}
                thumb={<IconTile icon={ImageIcon} src={p.image_url} tone="gold" />}
                title={p.name}
                subtitle={[className(p.class_id), p.sku || (p.barcode ? `# ${p.barcode}` : 'No SKU')].filter(Boolean).join(' · ')}
                pill={{ tone: active ? 'good' : 'neutral', label: active ? 'Active' : 'Off' }}
                big={{ value: Number(p.selling_price || 0).toLocaleString(), label: 'KES' }}
                metrics={[
                  { label: 'Sold', value: (p.selling_mode || 'PER_UNIT').replace('_', ' ').toLowerCase() },
                  { label: 'Barcode', value: p.barcode ? '✓ set' : '⚠ none', tone: p.barcode ? 'good' : 'gold' },
                ]}
                actions={(
                  <>
                    <IconBtn title="Edit" onClick={() => openEditForm(p)}><Pencil size={14} /></IconBtn>
                    {networkOn && active && (
                      <IconBtn
                        title={netOffers[p.id]?.status === 'ACTIVE' ? 'On the network (tap to change)' : netOffers[p.id] ? 'Paused on the network (tap to change)' : 'Publish to Network'}
                        onClick={() => setPublishFor(p)}
                      ><Store size={14} className={netOffers[p.id]?.status === 'ACTIVE' ? 'text-[#C9A227]' : undefined} /></IconBtn>
                    )}
                    <IconBtn
                      title={active ? 'Deactivate' : 'Reactivate'}
                      tone={active ? 'danger' : undefined}
                      onClick={() => (active ? deactivate(p.id) : reactivate(p.id))}
                    ><Power size={14} /></IconBtn>
                  </>
                )}
              />
            );
          })}
        </CardGrid>
      )}
      {showClasses && <ClassManager tenant={tenant} onClose={() => setShowClasses(false)} onChanged={() => { loadClasses(); try { refetchProducts?.(); } catch { /* list refreshes on next visit */ } }} />}
      {publishFor && <PublishSheet product={publishFor} offer={netOffers[publishFor.id] || null} onClose={() => setPublishFor(null)} onSaved={loadNetOffers} />}
    </FitPage>
  );
}
