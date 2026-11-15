// src/pos-erp/pages/PurchaseOrdersPage.jsx
//
// purchaseOrderService.create()/getAll()/updateStatus() were already
// fully built, and GoodsReceivingPage's "From Purchase Order" mode
// already reads from them — but nothing anywhere ever created one, so
// that dropdown was always empty. This page is what creates them.
//
// FIX: "Mark as Sent" used to set status to 'SENT', which doesn't exist
// in lb_po_status — confirmed via purchaseService.js's own receiving
// rollup (`anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED'`), which only
// makes sense if APPROVED is the pre-receiving ready state, not SENT.
// The real workflow is an approval chain, not a "sent to supplier" step:
// DRAFT -> PENDING_APPROVAL -> APPROVED -> (receiving) -> PARTIALLY_RECEIVED
// -> RECEIVED. GoodsReceivingPage's receivablePOs filter is the other
// half of this same fix (separate file) — it was filtering for
// ['SENT', 'PARTIALLY_RECEIVED'], so a PO could never legally reach a
// status that made it show up there at all.

import React, { useState } from 'react';
import { ClipboardList, Loader2, Plus, X, Trash2 } from 'lucide-react';
import { usePurchaseOrders } from '../hooks/usePurchases';
import { purchaseOrderService } from '../services/purchaseService';
import Sheet from '../components/workspace/Sheet';
import { useSuppliers } from '../hooks/useSuppliers';
import { useProducts } from '../hooks/useProducts';
import ContactActions from '../components/ContactActions';
import DocumentActions from '../components/DocumentActions';
import TriangulationSheet from '../components/TriangulationSheet';
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, CardGrid, DataCard, TextBtn, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import { singleFlight } from '../utils/singleFlight';

const STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warn',
  APPROVED: 'info',
  PARTIALLY_RECEIVED: 'info',
  RECEIVED: 'good',
  CANCELLED: 'bad',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseOrdersPage() {
  const { orders, loading, error, create, setStatus, fetch } = usePurchaseOrders();
  const { suppliers } = useSuppliers();
  const { products } = useProducts();

  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [matchFor, setMatchFor] = useState(null); // PO id whose three documents are being compared
  const [reviseFor, setReviseFor] = useState(null); // PO whose delivery date is being changed
  const [reviseDate, setReviseDate] = useState('');
  const [reviseNote, setReviseNote] = useState('');
  const [items, setItems] = useState([]); // { product_id, name, quantity, unit_cost }
  const [productQuery, setProductQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const matches = productQuery.trim()
    ? products.filter(p =>
        p.name.toLowerCase().includes(productQuery.toLowerCase()) ||
        p.sku?.toLowerCase().includes(productQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  const addItem = (product) => {
    if (items.some(i => i.product_id === product.id)) { setProductQuery(''); return; }
    setItems(prev => [...prev, { product_id: product.id, name: product.name, quantity: 1, unit_cost: product.cost_price || 0 }]);
    setProductQuery('');
  };

  const updateItem = (productId, field, value) => {
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, [field]: value } : i));
  };

  const removeItem = (productId) => setItems(prev => prev.filter(i => i.product_id !== productId));

  const total = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost), 0);

  const resetForm = () => { setExpectedDate(''); setSupplierId(''); setItems([]); setProductQuery(''); setFormError(''); };

  const submit = singleFlight('PurchaseOrdersPage.submit', async (e) => {
    e.preventDefault();
    setFormError('');
    if (!supplierId) { setFormError('Select a supplier.'); return; }
    if (items.length === 0) { setFormError('Add at least one item.'); return; }
    if (items.some(i => !i.quantity || i.quantity <= 0)) { setFormError('Every item needs a quantity greater than zero.'); return; }
    setSaving(true);
    try {
      await create({
        supplier_id: supplierId,
        expected_date: expectedDate || null,
        items: items.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) })),
      });
      setShowForm(false);
      resetForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  });

  const open = orders.filter(o => ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(o.status));
  const openValue = open.reduce((n, o) => n + Number(o.total_amount || 0), 0);
  const shown = orders.filter(o => {
    const q = search.toLowerCase();
    const okSearch = !search || o.po_number?.toLowerCase().includes(q) || o.supplier?.name?.toLowerCase().includes(q);
    const okFilter = filter === 'all' || (filter === 'open' && open.includes(o)) || (filter === 'draft' && o.status === 'DRAFT') || (filter === 'done' && o.status === 'RECEIVED');
    return okSearch && okFilter;
  });

  return (
    <FitPage
      title="Purchase Orders"
      icon={ClipboardList}
      subtitle="Order, get it approved, then receive it."
      action={<AddButton onClick={() => setShowForm(v => !v)} open={showForm} label="New PO" icon={Plus} />}
      summary={!loading && (
        <MiniStats items={[
          { label: 'Orders', value: orders.length },
          { label: 'Open', value: open.length, tone: open.length ? 'gold' : undefined },
          { label: 'Open value', value: fmt(openValue).replace(/\.00$/, '') },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search PO number or supplier…" />
          <FilterChips value={filter} onChange={setFilter} options={[
            { key: 'all', label: 'All' }, { key: 'open', label: 'Open', count: open.length },
            { key: 'draft', label: 'Draft' }, { key: 'done', label: 'Received' },
          ]} />
        </div>
      )}
    >
      {showForm && (
        <form onSubmit={submit} className="bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] rounded-xl p-3 mb-3 space-y-2.5">
          {formError && <div className="bg-[#FBE4E0] text-[#8F2E24] text-sm rounded-lg px-3 py-2">{formError}</div>}
          <select required value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full border border-[#E3DBB8] rounded-lg px-3 min-h-[40px]">
            <option value="">Select supplier *</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="block text-xs font-semibold text-[#6F7461]">When do you expect delivery? (optional)
            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className="mt-1 w-full border border-[#E3DBB8] rounded-lg px-3 min-h-[40px]" />
          </label>

          <div className="relative">
            <input
              placeholder="Search products by name or SKU to add…"
              value={productQuery}
              onChange={e => setProductQuery(e.target.value)}
              className="w-full border border-[#E3DBB8] rounded-lg px-3 min-h-[40px] focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/25 outline-none"
            />
            {matches.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                {matches.map(p => (
                  <button
                    type="button" key={p.id} onClick={() => addItem(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#FAF7EA] flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-slate-400 text-xs">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border border-[#E3DBB8] rounded-lg overflow-x-auto">
              {/* overflow-x-auto added alongside overflow-hidden: the
                  rounded-corner clip still applies vertically, but a
                  5-column table (Product/Qty/Unit Cost/Total/action) no
                  longer has content silently cut off on a phone-width
                  screen — it scrolls sideways instead. */}
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-[#FAF7EA] text-[#6F7461] text-xs uppercase">
                  <tr><th className="text-left px-3 py-2">Product</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Unit Cost</th><th className="px-3 py-2">Total</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-[#F0EACF]">
                  {items.map(i => (
                    <tr key={i.product_id}>
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2">
                        <input type="number" min="0.01" step="0.01" value={i.quantity} onChange={e => updateItem(i.product_id, 'quantity', e.target.value)} className="w-20 border border-[#E3DBB8] rounded px-2 py-1" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={i.unit_cost} onChange={e => updateItem(i.product_id, 'unit_cost', e.target.value)} className="w-24 border border-[#E3DBB8] rounded px-2 py-1" />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(Number(i.quantity) * Number(i.unit_cost))}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => removeItem(i.product_id)}><Trash2 size={14} className="text-red-500" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end text-sm font-bold text-[#23382B]">Total: {fmt(total)}</div>

          <button type="submit" disabled={saving} className="w-full bg-[#1F6B45] hover:bg-[#17553A] border-b-2 border-[#C9A227] text-white min-h-[42px] rounded-lg font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Purchase Order (Draft)'}
          </button>
        </form>
      )}

      {loading ? <LoadingBlock /> : error ? <Notice>{error}</Notice> : shown.length === 0 ? (
        <EmptyBlock>{orders.length === 0 ? 'No purchase orders yet.' : 'No orders match.'}</EmptyBlock>
      ) : (
        <CardGrid>
          {shown.map(po => (
            <DataCard
              key={po.id}
              alert={po.status === 'PENDING_APPROVAL'}
              title={po.supplier?.name || 'Supplier'}
              subtitle={`${po.po_number || ''} · ${po.order_date || ''}${(po.revised_delivery_date || po.expected_date) ? ` · due ${po.revised_delivery_date || po.expected_date}` : ''}`}
              pill={{ tone: STATUS_TONE[po.status] || 'neutral', label: (po.status || '').replace(/_/g, ' ') }}
              big={{ value: fmt(po.total_amount).replace(/\.00$/, ''), label: 'KES' }}
              actions={(
                <>
                  <ContactActions size="sm" recipient={{ kind: 'SUPPLIER', id: po.supplier?.id || po.supplier_id, name: po.supplier?.name, phone: po.supplier?.phone, email: po.supplier?.email }}
                    purpose={['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) ? 'SUPPLIER_DELIVERY_REMINDER' : 'SUPPLIER_PURCHASE_ORDER'} reference={{ type: 'PURCHASE_ORDER', id: po.id, label: po.po_number }} />
                  <DocumentActions items={[['PURCHASE_ORDER', 'Print', po.id]]} />
                  {['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status) && <TextBtn onClick={() => setMatchFor(po.id)}>Check documents</TextBtn>}
                  {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && <TextBtn onClick={() => { setReviseFor(po); setReviseDate(po.revised_delivery_date || po.expected_date || ''); setReviseNote(''); }}>Delivery date</TextBtn>}
                  {po.status === 'DRAFT' && <TextBtn tone="gold" onClick={() => setStatus(po.id, 'PENDING_APPROVAL')}>Submit</TextBtn>}
                  {po.status === 'PENDING_APPROVAL' && <TextBtn onClick={() => setStatus(po.id, 'APPROVED')}>Approve</TextBtn>}
                  {['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status) && <TextBtn tone="danger" onClick={() => setStatus(po.id, 'CANCELLED')}>Cancel</TextBtn>}
                </>
              )}
            />
          ))}
        </CardGrid>
      )}
      {matchFor && <TriangulationSheet poId={matchFor} onClose={() => setMatchFor(null)} />}
      {reviseFor && (
        <Sheet title="Change delivery date" onClose={() => setReviseFor(null)}>
          <div className="space-y-3">
            <p className="text-sm text-[#4A5240]">{reviseFor.supplier?.name} · {reviseFor.po_number}{reviseFor.expected_date ? ` · originally expected ${reviseFor.expected_date}` : ''}. The original date is kept on record.</p>
            <input type="date" value={reviseDate} onChange={e => setReviseDate(e.target.value)} className="w-full border border-[#E3DBB8] rounded-xl px-3 min-h-[48px]" />
            <input placeholder="Reason (optional)" value={reviseNote} onChange={e => setReviseNote(e.target.value)} className="w-full border border-[#E3DBB8] rounded-xl px-3 min-h-[48px]" />
            <button disabled={!reviseDate} onClick={async () => { try { await purchaseOrderService.reviseDelivery(reviseFor.id, { date: reviseDate, note: reviseNote }); setReviseFor(null); fetch(); } catch (err) { setFormError(err.message); setReviseFor(null); } }}
              className="w-full min-h-[48px] rounded-xl bg-[#1F6B45] text-white font-semibold border-b-2 border-[#C9A227] disabled:opacity-50">Save new date</button>
          </div>
        </Sheet>
      )}
    </FitPage>
  );
}
