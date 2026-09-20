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
  const { orders, loading, error, fetch, create, setStatus } = usePurchaseOrders();
  const { suppliers } = useSuppliers();
  const { products } = useProducts();

  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [items, setItems] = useState([]); // { product_id, name, quantity, unit_cost }
  const [productQuery, setProductQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

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

  const resetForm = () => {
    setSupplierId(''); setItems([]); setProductQuery(''); setFormError('');
    setExpectedDeliveryDate(''); setPoNotes('');
  };

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
        expected_delivery_date: expectedDeliveryDate || null,
        notes: poNotes || null,
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

  const cancelOrder = async (po) => {
    if (!window.confirm(`Cancel ${po.po_number}? This can't be undone.`)) return;
    setCancellingId(po.id);
    try {
      await setStatus(po.id, 'CANCELLED');
    } catch (err) {
      alert(err.message || 'Failed to cancel purchase order.');
    } finally {
      setCancellingId(null);
    }
  };

  const isOverdue = (po) =>
    po.expected_delivery_date &&
    !['RECEIVED', 'CANCELLED'].includes(po.status) &&
    new Date(po.expected_delivery_date) < new Date(new Date().toDateString());

  const STATUS_TABS = ['ALL', 'DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];
  const changeStatusFilter = (tab) => {
    setStatusFilter(tab);
    setExpandedId(null);
    fetch({ status: tab === 'ALL' ? undefined : tab });
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected delivery date (optional)</label>
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={e => setExpectedDeliveryDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Notes (optional)</label>
              <input
                placeholder="e.g. call before delivery"
                value={poNotes}
                onChange={e => setPoNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>
          </div>

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
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
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

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => changeStatusFilter(tab)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${statusFilter === tab ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {tab === 'ALL' ? 'All' : tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">PO Number</th><th className="text-left px-5 py-3">Supplier</th>
              <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Expected</th>
              <th className="text-right px-5 py-3">Total</th>
              <th className="text-center px-5 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {error && <tr><td colSpan={7} className="text-center py-6 text-red-600">{error}</td></tr>}
            {!loading && orders.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-400">No purchase orders yet.</td></tr>}
            {orders.map(po => (
              <React.Fragment key={po.id}>
                <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpandedId(expandedId === po.id ? null : po.id)}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{po.po_number}</td>
                  <td className="px-5 py-3 text-slate-700">{po.supplier?.name}</td>
                  <td className="px-5 py-3 text-slate-500">{po.order_date}</td>
                  <td className={`px-5 py-3 ${isOverdue(po) ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                    {po.expected_delivery_date || '—'}{isOverdue(po) ? ' (overdue)' : ''}
                  </td>
                  <td className="px-5 py-3 text-right">{fmt(po.total_amount)}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[po.status] || 'bg-slate-100'}`}>{po.status?.replace('_', ' ')}</span>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {po.status === 'DRAFT' && (
                      <button onClick={() => setStatus(po.id, 'SENT')} className="text-amber-700 text-xs font-semibold hover:underline mr-3">Mark as Sent</button>
                    )}
                    {['DRAFT', 'SENT'].includes(po.status) && (
                      <button
                        onClick={() => cancelOrder(po)}
                        disabled={cancellingId === po.id}
                        className="text-red-600 text-xs font-semibold hover:underline disabled:opacity-50"
                      >
                        {cancellingId === po.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === po.id && (
                  <tr>
                    <td colSpan={7} className="bg-slate-50 px-5 py-4">
                      {po.notes && <div className="text-xs text-slate-500 mb-2">Note: {po.notes}</div>}
                      <table className="w-full text-xs">
                        <thead className="text-slate-400 uppercase">
                          <tr><th className="text-left py-1">Product</th><th className="text-right py-1">Ordered</th><th className="text-right py-1">Received</th><th className="text-right py-1">Unit Cost</th><th className="text-right py-1">Total</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {(po.items || []).map(i => (
                            <tr key={i.id}>
                              <td className="py-1.5">{i.product?.name || i.product_id}</td>
                              <td className="py-1.5 text-right">{i.quantity}</td>
                              <td className="py-1.5 text-right">{i.received_quantity || 0}</td>
                              <td className="py-1.5 text-right">{fmt(i.unit_cost)}</td>
                              <td className="py-1.5 text-right">{fmt(i.total_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
