// src/pos-erp/pages/PurchaseOrdersPage.jsx
//
// This was the actual gap: purchaseOrderService.create()/getAll()/
// updateStatus() were already fully built, and GoodsReceivingPage's
// "From Purchase Order" mode already reads from them — but nothing
// anywhere ever created one, so that dropdown was always empty. This
// page is what creates them.
//
// New POs are created DRAFT (matches purchaseOrderService.create()'s
// own default) and need an explicit "Mark as Sent" — only SENT/
// PARTIALLY_RECEIVED orders show up as receivable in GoodsReceivingPage,
// so a PO sitting in DRAFT is a deliberate "not ready yet" state, not a
// bug.

import React, { useState } from 'react';
import { ClipboardList, Loader2, Plus, X, Trash2 } from 'lucide-react';
import { usePurchaseOrders } from '../hooks/usePurchases';
import { useSuppliers } from '../hooks/useSuppliers';
import { useProducts } from '../hooks/useProducts';

const STATUS_COLORS = {
  DRAFT: 'bg-slate-100 text-slate-500',
  SENT: 'bg-amber-50 text-amber-700',
  PARTIALLY_RECEIVED: 'bg-blue-50 text-blue-700',
  RECEIVED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-700',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseOrdersPage() {
  const { orders, loading, error, create, setStatus } = usePurchaseOrders();
  const { suppliers } = useSuppliers();
  const { products } = useProducts();

  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([]); // { product_id, name, quantity, unit_cost }
  const [productQuery, setProductQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

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

  const resetForm = () => { setSupplierId(''); setItems([]); setProductQuery(''); setFormError(''); };

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!supplierId) { setFormError('Select a supplier.'); return; }
    if (items.length === 0) { setFormError('Add at least one item.'); return; }
    if (items.some(i => !i.quantity || i.quantity <= 0)) { setFormError('Every item needs a quantity greater than zero.'); return; }
    setSaving(true);
    try {
      await create({
        supplier_id: supplierId,
        items: items.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) })),
      });
      setShowForm(false);
      resetForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ClipboardList size={22} className="text-amber-600" /> Purchase Orders
          </h1>
          <p className="text-slate-500 text-sm">Create an order, send it, then receive against it in Goods Receiving.</p>
        </div>
        <button
          onClick={() => (showForm ? setShowForm(false) : setShowForm(true))}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />} {showForm ? 'Cancel' : 'New PO'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 space-y-3">
          {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
          <select required value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2">
            <option value="">Select supplier *</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="relative">
            <input
              placeholder="Search products by name or SKU to add…"
              value={productQuery}
              onChange={e => setProductQuery(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none"
            />
            {matches.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                {matches.map(p => (
                  <button
                    type="button" key={p.id} onClick={() => addItem(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-slate-400 text-xs">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              {/* overflow-x-auto added alongside overflow-hidden: the
                  rounded-corner clip still applies vertically, but a
                  5-column table (Product/Qty/Unit Cost/Total/action) no
                  longer has content silently cut off on a phone-width
                  screen — it scrolls sideways instead. */}
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr><th className="text-left px-3 py-2">Product</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Unit Cost</th><th className="px-3 py-2">Total</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map(i => (
                    <tr key={i.product_id}>
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2">
                        <input type="number" min="0.01" step="0.01" value={i.quantity} onChange={e => updateItem(i.product_id, 'quantity', e.target.value)} className="w-20 border border-slate-200 rounded px-2 py-1" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={i.unit_cost} onChange={e => updateItem(i.product_id, 'unit_cost', e.target.value)} className="w-24 border border-slate-200 rounded px-2 py-1" />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(Number(i.quantity) * Number(i.unit_cost))}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => removeItem(i.product_id)}><Trash2 size={14} className="text-red-500" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end text-sm font-bold text-slate-800">Total: {fmt(total)}</div>

          <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
            {saving ? 'Saving…' : 'Save Purchase Order (Draft)'}
          </button>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">PO Number</th><th className="text-left px-5 py-3">Supplier</th>
              <th className="text-left px-5 py-3">Date</th><th className="text-right px-5 py-3">Total</th>
              <th className="text-center px-5 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {error && <tr><td colSpan={6} className="text-center py-6 text-red-600">{error}</td></tr>}
            {!loading && orders.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No purchase orders yet.</td></tr>}
            {orders.map(po => (
              <tr key={po.id}>
                <td className="px-5 py-3 font-mono text-xs text-slate-600">{po.po_number}</td>
                <td className="px-5 py-3 text-slate-700">{po.supplier?.name}</td>
                <td className="px-5 py-3 text-slate-500">{po.order_date}</td>
                <td className="px-5 py-3 text-right">{fmt(po.total_amount)}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[po.status] || 'bg-slate-100'}`}>{po.status?.replace('_', ' ')}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  {po.status === 'DRAFT' && (
                    <button onClick={() => setStatus(po.id, 'SENT')} className="text-amber-700 text-xs font-semibold hover:underline">Mark as Sent</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
