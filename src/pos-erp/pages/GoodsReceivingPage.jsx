import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePurchaseOrders, useGoodsReceived } from '../hooks/usePurchases';
import { useSuppliers } from '../hooks/useSuppliers';
import { useProducts } from '../hooks/useProducts';
import { ScannerModal, useBarcodeScanner, SCAN_RESULTS } from '../index';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

/**
 * Goods Receiving with scanning (spec sections 14–18, 41).
 *
 * Two modes, matching the rebuilt goodsReceivedService:
 *   - FROM PO   -> goodsReceivedService.createFromPO(poId, {...})
 *   - QUICK     -> goodsReceivedService.createQuickReceipt({...})
 *      (tenant_id/business_id/received_by are stamped automatically by
 *       useGoodsReceived via usePosErpAuth — no bypass, no direct
 *       inventory writes from this page.)
 *
 * Scanning only ever identifies a product and builds a *line* on screen.
 * The actual inventory increase, PO received-qty rollup, PO status
 * update, and stock movement recording all happen inside
 * goodsReceivedService — this page only calls it.
 *
 * FIELD NAMES — updated to match the real schema (this page previously
 * read po.order_number / poItem.quantity_ordered / poItem.quantity_received,
 * none of which exist; the real columns are po_number / quantity /
 * received_quantity). Internal line state (l.quantity_received,
 * l.batch_number) is left as local UI naming — only the payload sent to
 * the service maps those to the real column names (quantity, batch_no).
 */

const emptyLineDefaults = { batch_number: '', expiry_date: '' };

export default function GoodsReceivingPage() {
  const { staffId } = usePosErpAuth();

  const { suppliers } = useSuppliers();
  const { products } = useProducts();
  const { orders: purchaseOrders, loading: poLoading } = usePurchaseOrders({ status: undefined });
  const { createFromPO, createQuickReceipt } = useGoodsReceived();

  const [mode, setMode] = useState('PO'); // 'PO' | 'QUICK'
  const [selectedPOId, setSelectedPOId] = useState('');
  const [quickSupplierId, setQuickSupplierId] = useState('');
  const [referenceInvoice, setReferenceInvoice] = useState('');
  const [scanEntryMode, setScanEntryMode] = useState('ONE_BY_ONE'); // 'ONE_BY_ONE' | 'QUANTITY'
  const [manualQuery, setManualQuery] = useState(''); // search-and-add without scanning — for no-barcode items or when scanning just isn't wanted

  // GRN lines being built on screen. Keyed by product_id.
  // { product_id, purchase_order_item_id, name, sku, quantity_received,
  //   unit_id, unit_cost, batch_number, expiry_date, notOnPO }
  const [lines, setLines] = useState([]);

  const [showScanner, setShowScanner] = useState(false);
  const [pendingQtyLine, setPendingQtyLine] = useState(null); // line awaiting a quantity/cost/batch entry
  const [overReceiveWarning, setOverReceiveWarning] = useState('');
  const [postError, setPostError] = useState('');
  const [posting, setPosting] = useState(false);
  const [quickCreateBarcode, setQuickCreateBarcode] = useState(null);
  const [quickCreateForm, setQuickCreateForm] = useState({ name: '', selling_price: '', cost_price: '' });

  const selectedPO = useMemo(
    () => purchaseOrders.find(po => po.id === selectedPOId) || null,
    [purchaseOrders, selectedPOId]
  );

  const receivablePOs = useMemo(
    () => purchaseOrders.filter(po => ['SENT', 'PARTIALLY_RECEIVED'].includes(po.status)),
    [purchaseOrders]
  );

  // Reset the working lines whenever the PO selection or mode changes —
  // starting a fresh GRN.
  useEffect(() => {
    setLines([]);
    setOverReceiveWarning('');
    setPostError('');
  }, [mode, selectedPOId]);

  const poItemFor = useCallback(
    (productId) => selectedPO?.items?.find(i => i.product_id === productId) || null,
    [selectedPO]
  );

  const remainingOnPO = (poItem) => {
    if (!poItem) return null;
    return (poItem.quantity || 0) - (poItem.received_quantity || 0);
  };

  // Adds one unit (rapid mode) or opens the quantity/cost/batch prompt
  // (quantity mode) for a resolved scan (spec section 15).
  const handleScanResolved = useCallback((outcome) => {
    if (outcome.result !== SCAN_RESULTS.RESOLVED) return;
    const { product } = outcome;
    const poItem = mode === 'PO' ? poItemFor(product.id) : null;

    setLines((prev) => {
      const existing = prev.find(l => l.product_id === product.id);

      if (scanEntryMode === 'ONE_BY_ONE') {
        if (existing) {
          const nextQty = existing.quantity_received + 1;
          checkOverReceive(poItem, nextQty);
          return prev.map(l => l.product_id === product.id ? { ...l, quantity_received: nextQty } : l);
        }
        checkOverReceive(poItem, 1);
        return [...prev, buildLine(product, poItem, 1)];
      }

      // QUANTITY mode: open a prompt instead of guessing a number.
      setShowScanner(false);
      setPendingQtyLine({
        line: existing || buildLine(product, poItem, poItem ? remainingOnPO(poItem) || 0 : 0),
        poItem,
        isNew: !existing,
      });
      return prev;
    });
  }, [mode, scanEntryMode, poItemFor]);

  const buildLine = (product, poItem, qty) => ({
    product_id: product.id,
    purchase_order_item_id: poItem?.id || null,
    name: product.name,
    sku: product.sku,
    unit_id: poItem?.unit_id || product.unit_id,
    unit_cost: poItem?.unit_cost ?? product.cost_price ?? 0,
    quantity_received: qty,
    notOnPO: mode === 'PO' && !poItem,
    ...emptyLineDefaults,
  });

  // Manual add — search by name/SKU and add directly, no scan required.
  // This is the only way to add an item that has no barcode at all (or
  // one you don't have handy to scan); it works identically for barcoded
  // products too. In PO mode this still checks whether the picked
  // product is on the PO (poItemFor) so over-receive warnings and the
  // Ordered/Prev.Received columns work the same as a scanned line.
  const manualMatches = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return [];
    const alreadyAdded = new Set(lines.map(l => l.product_id));
    return products
      .filter(p => !alreadyAdded.has(p.id) && (p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [manualQuery, products, lines]);

  const addManualLine = (product) => {
    const poItem = mode === 'PO' ? poItemFor(product.id) : null;
    setLines((prev) => [...prev, buildLine(product, poItem, 1)]);
    if (poItem) checkOverReceive(poItem, 1);
    setManualQuery('');
  };

  const checkOverReceive = (poItem, requestedTotal) => {
    if (!poItem) { setOverReceiveWarning(''); return; }
    const remaining = remainingOnPO(poItem);
    if (requestedTotal > remaining) {
      setOverReceiveWarning(
        `${poItem.product?.name || 'Item'}: only ${remaining} remain on this PO. Requested: ${requestedTotal}.`
      );
    } else {
      setOverReceiveWarning('');
    }
  };

  const { processScan, lastOutcome, recentScans } = useBarcodeScanner({
    userId: staffId,
    contextType: 'GRN',
    onResolved: handleScanResolved,
    hardwareEnabled: mode === 'PO' ? !!selectedPOId : !!quickSupplierId,
  });

  const confirmQtyLine = (updates) => {
    const { line, poItem, isNew } = pendingQtyLine;
    const merged = { ...line, ...updates };
    checkOverReceive(poItem, merged.quantity_received);
    setLines((prev) => {
      if (isNew) return [...prev, merged];
      return prev.map(l => l.product_id === merged.product_id ? merged : l);
    });
    setPendingQtyLine(null);
  };

  const removeLine = (productId) => setLines(lines.filter(l => l.product_id !== productId));

  const updateLineField = (productId, field, value) => {
    setLines(lines.map(l => l.product_id === productId ? { ...l, [field]: value } : l));
  };

  const handleCreateProductFromScan = (barcode) => {
    setQuickCreateBarcode(barcode);
    setQuickCreateForm({ name: '', selling_price: '', cost_price: '' });
    setShowScanner(false);
  };

  const submitQuickCreate = async (e) => {
    e.preventDefault();
    const product = await productService.create({
      name: quickCreateForm.name,
      barcode: quickCreateBarcode,
      selling_price: parseFloat(quickCreateForm.selling_price) || 0,
      cost_price: parseFloat(quickCreateForm.cost_price) || 0,
      selling_mode: 'PER_UNIT',
      track_inventory: true,
      created_by: staffId,
    });
    setLines((prev) => [...prev, buildLine(product, null, 1)]);
    setQuickCreateBarcode(null);
  };

  const canPost = lines.length > 0 && lines.every(l => l.quantity_received > 0 && l.unit_cost >= 0) &&
    (mode === 'PO' ? !!selectedPOId : !!quickSupplierId);

  const postGRN = async () => {
    setPostError('');
    setPosting(true);
    try {
      const items = lines.map(l => ({
        product_id: l.product_id,
        purchase_order_item_id: l.purchase_order_item_id,
        quantity: l.quantity_received,
        unit_cost: l.unit_cost,
        batch_no: l.batch_number || null,
        expiry_date: l.expiry_date || null,
      }));

      if (mode === 'PO') {
        await createFromPO(selectedPOId, {
          invoice_no: referenceInvoice || null,
          items,
        });
      } else {
        await createQuickReceipt({
          supplier_id: quickSupplierId,
          invoice_no: referenceInvoice || null,
          items,
        });
      }

      setLines([]);
      setSelectedPOId('');
      setQuickSupplierId('');
      setReferenceInvoice('');
      setOverReceiveWarning('');
      alert('GRN posted. Inventory updated.');
    } catch (err) {
      setPostError(err.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Receive Stock</h1>

      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('PO')}
            className={`flex-1 py-2 rounded text-sm font-semibold ${mode === 'PO' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            From Purchase Order
          </button>
          <button
            onClick={() => setMode('QUICK')}
            className={`flex-1 py-2 rounded text-sm font-semibold ${mode === 'QUICK' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Quick Receipt (no PO)
          </button>
        </div>

        {mode === 'PO' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={selectedPOId}
              onChange={e => setSelectedPOId(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="">{poLoading ? 'Loading purchase orders…' : 'Select Purchase Order'}</option>
              {receivablePOs.map(po => (
                <option key={po.id} value={po.id}>
                  {po.po_number} — {po.supplier?.name} ({po.status})
                </option>
              ))}
            </select>
            <input
              placeholder="Reference invoice #"
              value={referenceInvoice}
              onChange={e => setReferenceInvoice(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={quickSupplierId}
              onChange={e => setQuickSupplierId(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="">Select Supplier</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input
              placeholder="Reference invoice #"
              value={referenceInvoice}
              onChange={e => setReferenceInvoice(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
        )}
      </div>

      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center justify-between mb-3">
          <button
            onClick={() => setShowScanner(true)}
            disabled={mode === 'PO' ? !selectedPOId : !quickSupplierId}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-semibold disabled:opacity-40"
          >
            📷 Scan Product
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Scan Mode:</span>
            <label className="flex items-center gap-1">
              <input type="radio" checked={scanEntryMode === 'ONE_BY_ONE'} onChange={() => setScanEntryMode('ONE_BY_ONE')} />
              One by One
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={scanEntryMode === 'QUANTITY'} onChange={() => setScanEntryMode('QUANTITY')} />
              Quantity
            </label>
          </div>
        </div>

        {/* Manual add — no scan needed. The only way to add an item with
            no barcode (or when scanning one isn't convenient); works the
            same for barcoded products too. */}
        <div className="relative mb-4">
          <input
            placeholder="Or type a product name / SKU to add manually (no scanning)…"
            value={manualQuery}
            onChange={e => setManualQuery(e.target.value)}
            disabled={mode === 'PO' ? !selectedPOId : !quickSupplierId}
            className="w-full border rounded px-3 py-2.5 disabled:bg-gray-50 disabled:text-gray-400"
          />
          {manualMatches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {manualMatches.map(p => {
                const poItem = mode === 'PO' ? poItemFor(p.id) : null;
                return (
                  <button
                    type="button" key={p.id} onClick={() => addManualLine(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center"
                  >
                    <span>{p.name} <span className="text-gray-400 text-xs">{p.sku}</span></span>
                    {mode === 'PO' && !poItem && <span className="text-xs text-yellow-600">not on PO</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {overReceiveWarning && (
          <div className="bg-yellow-50 text-yellow-800 text-sm rounded px-3 py-2 mb-3">
            ⚠ {overReceiveWarning}
          </div>
        )}
        {postError && (
          <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-3">{postError}</div>
        )}

        {recentScans.length > 0 && (
          <div className="text-xs text-gray-500 mb-3">
            Last scan: {recentScans[0].result === SCAN_RESULTS.RESOLVED ? recentScans[0].product.name : `not found (${recentScans[0].barcode})`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2">Product</th>
                {mode === 'PO' && <th>Ordered</th>}
                {mode === 'PO' && <th>Prev. Received</th>}
                <th>Received</th>
                <th>Unit Cost</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const poItem = poItemFor(l.product_id);
                return (
                  <tr key={l.product_id} className="border-t">
                    <td className="px-3 py-2">
                      {l.name}
                      {l.notOnPO && <span className="ml-2 text-xs text-yellow-600">not on PO</span>}
                    </td>
                    {mode === 'PO' && <td>{poItem?.quantity ?? '-'}</td>}
                    {mode === 'PO' && <td>{poItem?.received_quantity ?? 0}</td>}
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={l.quantity_received}
                        onChange={e => updateLineField(l.product_id, 'quantity_received', parseFloat(e.target.value) || 0)}
                        className="border rounded px-2 py-1 w-20"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={l.unit_cost}
                        onChange={e => updateLineField(l.product_id, 'unit_cost', parseFloat(e.target.value) || 0)}
                        className="border rounded px-2 py-1 w-24"
                      />
                    </td>
                    <td>
                      <input
                        value={l.batch_number}
                        onChange={e => updateLineField(l.product_id, 'batch_number', e.target.value)}
                        className="border rounded px-2 py-1 w-24"
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={l.expiry_date}
                        onChange={e => updateLineField(l.product_id, 'expiry_date', e.target.value)}
                        className="border rounded px-2 py-1 w-36"
                      />
                    </td>
                    <td>
                      <button onClick={() => removeLine(l.product_id)} className="text-red-600 text-xs">Remove</button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr><td colSpan={mode === 'PO' ? 7 : 5} className="px-3 py-8 text-center text-gray-400">No items scanned yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          onClick={postGRN}
          disabled={!canPost || posting}
          className="mt-4 w-full bg-green-600 text-white py-3 rounded font-bold disabled:opacity-50"
        >
          {posting ? 'Posting…' : 'POST GRN'}
        </button>
      </div>

      <ScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        scan={processScan}
        lastOutcome={lastOutcome}
        title="Scan Product"
        onCreateProduct={handleCreateProductFromScan}
      />

      {/* Quantity-mode prompt: quantity + unit cost + batch + expiry (spec section 15/17) */}
      {pendingQtyLine && (
        <QtyCostPrompt
          initial={pendingQtyLine.line}
          poItem={pendingQtyLine.poItem}
          onCancel={() => setPendingQtyLine(null)}
          onConfirm={confirmQtyLine}
        />
      )}

      {/* Unknown barcode -> quick product create (spec section 18) */}
      {quickCreateBarcode && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitQuickCreate} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg">Create Product & Add to GRN</h3>
            <p className="text-xs text-gray-500 font-mono">Barcode: {quickCreateBarcode}</p>
            <input required autoFocus placeholder="Product Name" value={quickCreateForm.name}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, name: e.target.value })}
              className="w-full border rounded px-3 py-2" />
            <input required type="number" placeholder="Selling Price" value={quickCreateForm.selling_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, selling_price: e.target.value })}
              className="w-full border rounded px-3 py-2" />
            <input type="number" placeholder="Cost Price" value={quickCreateForm.cost_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, cost_price: e.target.value })}
              className="w-full border rounded px-3 py-2" />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setQuickCreateBarcode(null)} className="flex-1 bg-gray-100 py-2 rounded">Cancel</button>
              <button type="submit" className="flex-1 bg-green-600 text-white py-2 rounded">Save & Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/** Small controlled form for QUANTITY scan mode. */
function QtyCostPrompt({ initial, poItem, onCancel, onConfirm }) {
  const [qty, setQty] = useState(initial.quantity_received || '');
  const [cost, setCost] = useState(initial.unit_cost ?? '');
  const [batch, setBatch] = useState(initial.batch_number || '');
  const [expiry, setExpiry] = useState(initial.expiry_date || '');

  const submit = (e) => {
    e.preventDefault();
    const quantity = parseFloat(qty) || 0;
    if (quantity <= 0) return;
    onConfirm({
      quantity_received: quantity,
      unit_cost: parseFloat(cost) || 0,
      batch_number: batch,
      expiry_date: expiry,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3">
        <h3 className="font-bold text-lg">{initial.name}</h3>
        {poItem && (
          <p className="text-xs text-gray-500">
            Ordered: {poItem.quantity} · Previously received: {poItem.received_quantity || 0} · Remaining: {(poItem.quantity || 0) - (poItem.received_quantity || 0)}
          </p>
        )}
        <label className="text-sm text-gray-600 block">Quantity received</label>
        <input required type="number" min="0.01" step="0.01" autoFocus value={qty}
          onChange={e => setQty(e.target.value)} className="w-full border rounded px-3 py-2 text-lg" />
        <label className="text-sm text-gray-600 block">Unit cost</label>
        <input type="number" min="0" step="0.01" value={cost}
          onChange={e => setCost(e.target.value)} className="w-full border rounded px-3 py-2" />
        <label className="text-sm text-gray-600 block">Batch (optional)</label>
        <input value={batch} onChange={e => setBatch(e.target.value)} className="w-full border rounded px-3 py-2" />
        <label className="text-sm text-gray-600 block">Expiry (optional)</label>
        <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="w-full border rounded px-3 py-2" />
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 bg-gray-100 py-2 rounded">Cancel</button>
          <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded">Add to GRN</button>
        </div>
      </form>
    </div>
  );
}
