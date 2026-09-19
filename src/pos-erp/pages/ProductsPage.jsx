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

import React, { useState } from 'react';
import { useProducts } from '../hooks/useProducts';
import { ScannerModal, useBarcodeScanner } from '../index';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { checkBarcodeAvailable } from '../services/productResolverService';

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', selling_price: '', cost_price: '',
  category_id: '', unit_id: '', selling_mode: 'PER_UNIT',
  track_inventory: true, allow_negative_stock: false, reorder_level: '0',
};

export default function ProductsPage() {
  const { staffId } = usePosErpAuth();
  const { products, loading, error, create, update, deactivate, reactivate } = useProducts();
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

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
      unit_id: product.unit_id || '',
      selling_mode: product.selling_mode || 'PER_UNIT',
      track_inventory: product.track_inventory ?? true,
      allow_negative_stock: product.allow_negative_stock ?? false,
      reorder_level: String(product.reorder_level ?? 0),
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
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
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Items</h1>
        <button onClick={() => (showForm ? setShowForm(false) : openCreateForm())} className="bg-blue-600 text-white px-4 py-2 rounded">
          {showForm ? 'Cancel' : '+ Product'}
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded shadow mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {formError && <div className="md:col-span-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
          <input required placeholder="Product Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="border rounded px-3 py-2" />
          <input placeholder="SKU" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} className="border rounded px-3 py-2" />
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input placeholder="Barcode" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="border rounded px-3 py-2 flex-1" />
              <button type="button" onClick={() => setShowScanner(true)} className="bg-gray-800 text-white px-3 rounded">📷</button>
            </div>
            <span className="text-xs text-gray-400">{form.barcode ? '✓ Barcode set' : '⚠ No barcode'}</span>
          </div>
          <input required type="number" placeholder="Selling Price" value={form.selling_price} onChange={e => setForm({...form, selling_price: e.target.value})} className="border rounded px-3 py-2" />
          <input type="number" placeholder="Cost Price" value={form.cost_price} onChange={e => setForm({...form, cost_price: e.target.value})} className="border rounded px-3 py-2" />
          <select value={form.selling_mode} onChange={e => setForm({...form, selling_mode: e.target.value})} className="border rounded px-3 py-2">
            <option value="PER_UNIT">Per Unit</option>
            <option value="WEIGHT">By Weight</option>
            <option value="VOLUME">By Volume</option>
            <option value="CUSTOM">Custom</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.track_inventory} onChange={e => setForm({...form, track_inventory: e.target.checked})} />
            Track inventory
          </label>
          {form.track_inventory && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Reorder level</label>
                <input type="number" min="0" placeholder="0" value={form.reorder_level} onChange={e => setForm({...form, reorder_level: e.target.value})} className="border rounded px-3 py-2" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={form.allow_negative_stock} onChange={e => setForm({...form, allow_negative_stock: e.target.checked})} />
                Allow selling below zero stock
              </label>
            </>
          )}

          <button type="submit" disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded md:col-span-3 disabled:opacity-60">
            {saving ? 'Saving…' : editingProduct ? 'Save changes' : 'Save'}
          </button>
        </form>
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
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3">
          Couldn't load products: {error}
        </div>
      ) : (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50"><tr><th className="px-4 py-2">Name</th><th>SKU</th><th>Barcode</th><th>Price</th><th>Mode</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">{p.name}</td><td>{p.sku || '-'}</td>
                  <td>{p.barcode ? <span title="Registered">✓ {p.barcode}</span> : <span className="text-yellow-600" title="No barcode">⚠ none</span>}</td>
                  <td>{p.selling_price?.toLocaleString()}</td><td>{p.selling_mode}</td>
                  <td>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${p.is_active === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="flex gap-3 py-2">
                    <button onClick={() => openEditForm(p)} className="text-blue-600 text-sm">Edit</button>
                    <button
                      onClick={() => (p.is_active === 'active' ? deactivate(p.id) : reactivate(p.id))}
                      className="text-sm text-gray-500 hover:text-red-600"
                    >
                      {p.is_active === 'active' ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No products</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
