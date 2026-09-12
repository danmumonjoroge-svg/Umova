import React, { useState, useCallback } from 'react';
import { useProducts } from '../hooks/useProducts';
import { useSales } from '../hooks/useSales';
import { useCashierShifts } from '../hooks/useCashierShifts';
import { useCustomers } from '../hooks/useCustomers';
import { ScannerModal, useBarcodeScanner, SCAN_RESULTS } from '../index';
import { usePosErpAuth } from '../auth/usePosErpAuth';

const VARIABLE_MODES = ['WEIGHT', 'VOLUME', 'CUSTOM'];

export default function POSPage() {
  const { staffId } = usePosErpAuth();
  const { products, create: createProduct } = useProducts();
  const { create: createSale } = useSales();
  const { activeShift, openShift, closeShift } = useCashierShifts();
  // Only needed once CREDIT is picked — process_credit_sale_payment (the
  // trigger that already handles CREDIT sales at the DB level) raises
  // "A customer must be selected for credit sales" if customer_id is null,
  // so this isn't optional polish, it's what makes CREDIT actually work.
  const { customers } = useCustomers();

  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [customerAmount, setCustomerAmount] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [saleError, setSaleError] = useState('');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftFloat, setShiftFloat] = useState('');
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [closeActualCash, setCloseActualCash] = useState('');
  const [closeFloat, setCloseFloat] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closeSummary, setCloseSummary] = useState(null); // set after a successful close, to show expected/actual/variance
  const [closing, setClosing] = useState(false);

  // Scanning UI state
  const [showScanner, setShowScanner] = useState(false);
  const [pendingVariableProduct, setPendingVariableProduct] = useState(null); // { product, stock }
  const [variableQty, setVariableQty] = useState('');
  const [stockWarning, setStockWarning] = useState('');
  const [quickCreateBarcode, setQuickCreateBarcode] = useState(null);
  const [quickCreateForm, setQuickCreateForm] = useState({ name: '', selling_price: '', cost_price: '' });
  const [quickCreateError, setQuickCreateError] = useState('');

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku?.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode?.includes(search)
  );

  // Adds/merges a product into the cart. Enforces allow_negative_stock the
  // same way manual "+"/search-based adds already do, so scanning never
  // bypasses existing inventory controls (spec section 12).
  //
  // FIELD NAMES updated to match real lb_sale_items columns directly
  // (cost_price, not unit_cost — see saleService.js rebuild). For
  // WEIGHT/VOLUME/CUSTOM products, weight_value mirrors the entered
  // quantity — ASSUMPTION (unverified): there's no schema signal for
  // whether quantity and weight_value should differ for these modes, so
  // both are set to the same entered amount. Revisit if that's wrong.
  const addToCart = useCallback((product, qty = 1, stock = null) => {
    setStockWarning('');
    setCart(prevCart => {
      const existing = prevCart.find(i => i.product_id === product.id);
      const requestedQty = existing ? existing.quantity + qty : qty;

      if (product.track_inventory && !product.allow_negative_stock && stock && requestedQty > stock.quantity) {
        setStockWarning(`Insufficient stock. Available: ${stock.quantity}, Requested: ${requestedQty}`);
        return prevCart;
      }

      if (existing) {
        return prevCart.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: requestedQty, total: requestedQty * i.unit_price }
            : i
        );
      }
      const price = product.selling_price;
      const isVariable = VARIABLE_MODES.includes(product.selling_mode);
      return [...prevCart, {
        product_id: product.id,
        name: product.name,
        quantity: qty,
        unit_price: price,
        cost_price: product.cost_price || 0,
        selling_mode: product.selling_mode || 'PER_UNIT',
        weight_value: isVariable ? qty : null,
        total: qty * price,
      }];
    });
  }, []);

  // Every scan (camera, USB/Bluetooth, or manual) funnels through here —
  // the SAME resolution logic used by search/manual entry, per the
  // "scanning must not bypass the transaction layer" principle.
  const handleScanResolved = useCallback((outcome) => {
    if (outcome.result !== SCAN_RESULTS.RESOLVED) return;
    const { product, stock } = outcome;

    if (VARIABLE_MODES.includes(product.selling_mode)) {
      // Weight/volume/custom products: resolve, then ask for the quantity —
      // never blindly increment by 1 (spec section 13).
      setPendingVariableProduct({ product, stock });
      setShowScanner(false);
      return;
    }
    addToCart(product, 1, stock);
  }, [addToCart]);

  const { processScan, lastOutcome, recentScans } = useBarcodeScanner({
    userId: staffId,
    contextType: 'SALE',
    onResolved: handleScanResolved,
    hardwareEnabled: !!activeShift, // only listen for USB/Bluetooth scans once a shift is open
  });

  const confirmVariableQty = () => {
    const qty = parseFloat(variableQty);
    if (!qty || qty <= 0) return;
    addToCart(pendingVariableProduct.product, qty, pendingVariableProduct.stock);
    setPendingVariableProduct(null);
    setVariableQty('');
  };

  const handleCreateProductFromScan = (barcode) => {
    setQuickCreateBarcode(barcode);
    setQuickCreateForm({ name: '', selling_price: '', cost_price: '' });
    setQuickCreateError('');
    setShowScanner(false);
  };

  const submitQuickCreate = async (e) => {
    e.preventDefault();
    setQuickCreateError('');
    try {
      const product = await createProduct({
        name: quickCreateForm.name,
        barcode: quickCreateBarcode,
        selling_price: parseFloat(quickCreateForm.selling_price) || 0,
        cost_price: parseFloat(quickCreateForm.cost_price) || 0,
        selling_mode: 'PER_UNIT',
        track_inventory: true,
      });
      // Return to the sale and add the newly-created product automatically
      // (spec section 18 — "Return to current transaction, add product
      // automatically"). Passing null (not a fake { quantity: 0 } stock
      // object) skips the client-side stock check entirely — a product
      // that was just created has nothing meaningful to check yet, and
      // saleService.create() now does the authoritative check server-side
      // at checkout anyway.
      addToCart(product, 1, null);
      setQuickCreateBarcode(null);
      setQuickCreateForm({ name: '', selling_price: '', cost_price: '' });
    } catch (err) {
      setQuickCreateError(err.message);
    }
  };

  const updateQty = (id, qty) => {
    if (qty <= 0) { setCart(cart.filter(i => i.product_id !== id)); return; }
    setCart(cart.map(i => i.product_id === id
      ? { ...i, quantity: qty, total: qty * i.unit_price, weight_value: VARIABLE_MODES.includes(i.selling_mode) ? qty : i.weight_value }
      : i
    ));
  };

  const subtotal = cart.reduce((s, i) => s + i.total, 0);
  const total = subtotal;
  const change = parseFloat(customerAmount || 0) - total;

  const completeSale = async () => {
    if (!activeShift) { alert('Open a shift first'); return; }
    if (cart.length === 0) return;
    setSaleError('');

    // Same requirement the DB trigger enforces — checked here too so the
    // cashier gets a clear message instead of a raw exception from
    // process_credit_sale_payment after the request round-trips.
    if (paymentMethod === 'CREDIT' && !selectedCustomerId) {
      setSaleError('Select a customer before completing a credit sale.');
      return;
    }

    // shift_id is required — without it, closing this shift can never
    // find these sales when computing expected_cash (see conversation:
    // cashierService.js's closeShift filters lb_sales by shift_id).
    const changeAmount = paymentMethod === 'CASH' ? Math.max(0, change) : 0;

    const sale = {
      shift_id: activeShift.id,
      customer_id: selectedCustomerId || null, // guaranteed non-empty for CREDIT by the check above
      items: cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price,
        selling_mode: i.selling_mode,
        weight_value: i.weight_value,
      })),
      payments: [{
        payment_method: paymentMethod,
        amount: total,
        change_amount: changeAmount,
      }],
    };

    try {
      await createSale(sale);
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId('');
      alert('Sale completed!');
    } catch (err) {
      setSaleError(err.message || 'Failed to complete sale.');
    }
  };

  const submitCloseShift = async (e) => {
    e.preventDefault();
    setCloseError('');
    if (closeActualCash === '' || Number(closeActualCash) < 0) {
      setCloseError('Enter the actual cash counted.');
      return;
    }
    setClosing(true);
    try {
      const result = await closeShift(
        Number(closeActualCash),
        closeFloat === '' ? 0 : Number(closeFloat),
        ''
      );
      setShowCloseShiftModal(false);
      setCloseSummary(result); // has expected_cash/actual_cash/variance from the DB, not recomputed here
      setCloseActualCash('');
      setCloseFloat('');
    } catch (err) {
      setCloseError(err.message || 'Failed to close shift.');
    } finally {
      setClosing(false);
    }
  };

  if (!activeShift) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold mb-4">No Active Shift</h2>
        <button onClick={() => setShowShiftModal(true)} className="bg-blue-600 text-white px-6 py-3 rounded">Open Shift</button>
        {showShiftModal && (
          <div className="mt-4">
            <input type="number" placeholder="Opening float" value={shiftFloat} onChange={e => setShiftFloat(e.target.value)} className="border rounded px-3 py-2 mr-2" />
            <button onClick={() => { openShift(parseFloat(shiftFloat) || 0); setShowShiftModal(false); }} className="bg-green-600 text-white px-4 py-2 rounded">Start</button>
          </div>
        )}
        {/* Shown once, right after a close, so the cashier actually sees
            whether the till balanced — this is the entire point of
            collecting actual cash in the first place. */}
        {closeSummary && (
          <div className="mt-6 mx-auto max-w-sm bg-white rounded-xl shadow p-5 text-left">
            <h3 className="font-bold text-slate-800 mb-3">Shift Closed — {closeSummary.shift_number}</h3>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-500">Expected cash</span><span className="font-semibold">{Number(closeSummary.expected_cash).toLocaleString()}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-500">Actual cash</span><span className="font-semibold">{Number(closeSummary.actual_cash).toLocaleString()}</span></div>
            <div className={`flex justify-between text-sm py-1 font-bold ${Number(closeSummary.variance) === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              <span>Variance</span><span>{Number(closeSummary.variance) > 0 ? '+' : ''}{Number(closeSummary.variance).toLocaleString()}</span>
            </div>
            <button onClick={() => setCloseSummary(null)} className="mt-3 w-full bg-slate-100 text-slate-600 text-sm py-2 rounded-lg">Dismiss</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-gray-800 text-white p-3 flex justify-between items-center">
        <span className="font-bold">POS — Shift Open</span>
        <button onClick={() => setShowCloseShiftModal(true)} className="bg-red-600 px-3 py-1 rounded text-sm">Close Shift</button>
      </div>
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        <div className="w-full md:w-1/2 p-4 overflow-y-auto bg-gray-50">
          <div className="flex gap-2 mb-4">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search / Scan barcode..."
              className="flex-1 border rounded px-3 py-2"
            />
            {/* Large, thumb-friendly scan button — mobile-first per spec section 27 */}
            <button
              onClick={() => setShowScanner(true)}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold text-lg shrink-0"
              aria-label="Scan Barcode"
            >
              📷 Scan
            </button>
          </div>

          {stockWarning && (
            <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-3">{stockWarning}</div>
          )}

          {recentScans.length > 0 && (
            <div className="bg-white rounded shadow p-3 mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Recently Scanned</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {recentScans.map((s, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className={s.result === SCAN_RESULTS.RESOLVED ? 'text-gray-800' : 'text-red-500'}>
                      {s.result === SCAN_RESULTS.RESOLVED ? s.product.name : `Not found: ${s.barcode}`}
                    </span>
                    <span className="text-gray-400 text-xs">{new Date(s.at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {filteredProducts.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className="bg-white p-3 rounded shadow hover:bg-blue-50 text-left">
                <div className="font-semibold text-sm truncate">{p.name}</div>
                <div className="text-blue-600 font-bold">{p.selling_price?.toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="w-full md:w-1/2 p-4 bg-white flex flex-col">
          <h3 className="font-bold mb-2">Current Sale</h3>
          <div className="flex-1 overflow-y-auto">
            {cart.map(item => (
              <div key={item.product_id} className="flex justify-between items-center py-2 border-b">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-gray-500">{item.unit_price?.toLocaleString()} x {item.quantity}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.product_id, item.quantity - 1)} className="w-6 h-6 bg-gray-200 rounded">-</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQty(item.product_id, item.quantity + 1)} className="w-6 h-6 bg-gray-200 rounded">+</button>
                  <span className="font-bold w-20 text-right">{item.total?.toLocaleString()}</span>
                </div>
              </div>
            ))}
            {cart.length === 0 && <div className="text-gray-400 text-center py-10">No items</div>}
          </div>
          <div className="border-t pt-4 mt-4">
            <div className="flex justify-between text-lg mb-2"><span>Subtotal</span><span className="font-bold">{subtotal.toLocaleString()}</span></div>
            <div className="flex justify-between text-xl mb-4"><span>TOTAL</span><span className="font-bold text-blue-600">{total.toLocaleString()}</span></div>
            <div className="flex gap-2 mb-3">
              {['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'].map(m => (
                <button key={m} onClick={() => setPaymentMethod(m)} className={`flex-1 py-2 rounded text-sm ${paymentMethod === m ? 'bg-emerald-800 text-white' : 'bg-gray-100'}`}>{m.replace('_', ' ')}</button>
              ))}
            </div>
            {/* Customer picker. Required for CREDIT (enforced both here and
                by the DB trigger); optional otherwise so a walk-in cash
                sale can still be tagged to a customer if useful. */}
            <div className="mb-3">
              <select
                value={selectedCustomerId}
                onChange={e => setSelectedCustomerId(e.target.value)}
                className={`w-full border rounded px-3 py-2 text-sm ${paymentMethod === 'CREDIT' && !selectedCustomerId ? 'border-red-400' : 'border-gray-200'}`}
              >
                <option value="">{paymentMethod === 'CREDIT' ? 'Select customer (required)' : 'Customer (optional)'}</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>
            {saleError && (
              <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-3">{saleError}</div>
            )}
            {paymentMethod === 'CASH' && (
              <div className="flex gap-2 mb-3">
                <input type="number" placeholder="Amount received" value={customerAmount} onChange={e => setCustomerAmount(e.target.value)} className="border rounded px-3 py-2 flex-1" />
                <div className="px-3 py-2 bg-green-100 text-green-700 rounded">Change: {change >= 0 ? change.toLocaleString() : '-'}</div>
              </div>
            )}
            <button onClick={completeSale} disabled={cart.length === 0} className="w-full bg-green-600 text-white py-3 rounded font-bold disabled:opacity-50">COMPLETE SALE</button>
          </div>
        </div>
      </div>

      {/* Camera / manual scan surface — used for every scan-to-sale flow */}
      <ScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        scan={processScan}
        lastOutcome={lastOutcome}
        title="Scan Product"
        onCreateProduct={handleCreateProductFromScan}
      />

      {/* Weight/Volume/Custom quantity prompt (spec section 13) */}
      {pendingVariableProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5">
            <h3 className="font-bold text-lg mb-1">{pendingVariableProduct.product.name}</h3>
            <p className="text-sm text-gray-500 mb-4">
              Selling mode: {pendingVariableProduct.product.selling_mode}
            </p>
            <label className="text-sm text-gray-600 mb-1 block">
              Enter {pendingVariableProduct.product.selling_mode === 'WEIGHT' ? 'weight (KG)' : pendingVariableProduct.product.selling_mode === 'VOLUME' ? 'volume (L)' : 'quantity'}
            </label>
            <input
              type="number"
              step="0.01"
              autoFocus
              value={variableQty}
              onChange={e => setVariableQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmVariableQty(); }}
              className="w-full border rounded px-3 py-2 mb-4 text-lg"
              placeholder="0.00"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setPendingVariableProduct(null); setVariableQty(''); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded"
              >
                Cancel
              </button>
              <button
                onClick={confirmVariableQty}
                disabled={!variableQty || parseFloat(variableQty) <= 0}
                className="flex-1 bg-blue-600 text-white py-2 rounded disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unknown barcode → quick product create, without leaving the sale (spec section 18) */}
      {quickCreateBarcode && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitQuickCreate} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg">Create Product</h3>
            <p className="text-xs text-gray-500 font-mono">Barcode: {quickCreateBarcode}</p>
            {quickCreateError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{quickCreateError}</div>}
            <input
              required
              autoFocus
              placeholder="Product Name"
              value={quickCreateForm.name}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, name: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
            <input
              required
              type="number"
              placeholder="Selling Price"
              value={quickCreateForm.selling_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, selling_price: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
            <input
              type="number"
              placeholder="Cost Price (optional)"
              value={quickCreateForm.cost_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, cost_price: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setQuickCreateBarcode(null)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded"
              >
                Cancel
              </button>
              <button type="submit" className="flex-1 bg-green-600 text-white py-2 rounded">
                Save & Add to Sale
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Close Shift — collects actual cash counted + closing float,
          replacing the old closeShift(0, '') stub that never asked the
          cashier what was actually in the till. */}
      {showCloseShiftModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitCloseShift} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg">Close Shift</h3>
            <p className="text-sm text-gray-500">Count the till and enter what's actually there.</p>
            {closeError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{closeError}</div>}
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Actual cash counted *</label>
              <input
                required autoFocus type="number" step="0.01" min="0"
                value={closeActualCash} onChange={e => setCloseActualCash(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Closing float (left for next shift)</label>
              <input
                type="number" step="0.01" min="0"
                value={closeFloat} onChange={e => setCloseFloat(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="0"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowCloseShiftModal(false)} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded">Cancel</button>
              <button type="submit" disabled={closing} className="flex-1 bg-red-600 text-white py-2 rounded disabled:opacity-50">
                {closing ? 'Closing…' : 'Close Shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
