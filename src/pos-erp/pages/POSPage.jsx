import React, { useState, useCallback, useEffect } from 'react';
import { useProducts } from '../hooks/useProducts';
import { useCashierShifts } from '../hooks/useCashierShifts';
import { useCustomers } from '../hooks/useCustomers';
import { ScannerModal, useBarcodeScanner, SCAN_RESULTS } from '../index';
import { usePosErpAuth } from '../auth/usePosErpAuth';
// Stage 1B (offline-first) -- see AUDIT.md Phase 11. createOfflineAwareSale()
// is the ONLY place this page's checkout decides online vs offline; it
// still calls the existing saleService.create() when online, so nothing
// about a normal, connected sale changes.
import { useNetStatus } from '../offline/useNetStatus';
import { createOfflineAwareSale } from '../offline/offlineSaleService';
import { cacheProducts } from '../offline/offlineCache';
// Stage 2 (M-Pesa STK) -- see AUDIT.md Phase 12 and the stage-order note
// there. Kept to its own hook/modal so the existing CASH/CARD/CREDIT
// checkout path above (completeSale) is completely unchanged.
import { useMpesaPayment } from '../hooks/useMpesaPayment';
// Phase 14 -- the sale receipt itself: print / WhatsApp / email.
import ReceiptModal from '../components/ReceiptModal';
import { receiptService } from '../services/receiptService';
import { settingsService } from '../services/settingsService';

const VARIABLE_MODES = ['WEIGHT', 'VOLUME', 'CUSTOM'];

export default function POSPage() {
  const { staffId, tenant } = usePosErpAuth();
  const { products, create: createProduct } = useProducts();
  // Stage 1B: checkout no longer calls useSales().create() directly --
  // createOfflineAwareSale() (imported above) wraps saleService.create()
  // itself, so this hook (which also fires an unrelated sales-list fetch
  // on mount) is no longer needed on this page.
  const { activeShift, openShift, closeShift } = useCashierShifts();
  // Only needed once CREDIT is picked — process_credit_sale_payment (the
  // trigger that already handles CREDIT sales at the DB level) raises
  // "A customer must be selected for credit sales" if customer_id is null,
  // so this isn't optional polish, it's what makes CREDIT actually work.
  const { customers } = useCustomers();
  const { isOnline } = useNetStatus();
  const mpesa = useMpesaPayment();

  // Phase 14 -- receipt state. `business` is fetched once (it barely
  // changes) rather than via the heavier useSettings() hook, which also
  // pulls in POS settings this page doesn't need.
  const [business, setBusiness] = useState(null);
  const [posSettings, setPosSettings] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null); // { receipt, customer, isOffline } | null
  useEffect(() => {
    if (!tenant?.business_id) return;
    settingsService.getBusinessProfile(tenant.business_id).then(setBusiness).catch(() => {});
    settingsService.getPosSettings(tenant.business_id).then(setPosSettings).catch(() => {});
  }, [tenant?.business_id]);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [showMpesaModal, setShowMpesaModal] = useState(false);

  // Keep the offline product cache warm every time the online product
  // list refreshes. This is the ONLY writer of products_cache -- if the
  // till is opened offline from a fresh install with nothing cached yet,
  // search will come back empty, which is the honest result (there is
  // genuinely nothing on this device to search), not a bug to paper over.
  useEffect(() => { cacheProducts(products); }, [products]);

  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [customerAmount, setCustomerAmount] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [saleError, setSaleError] = useState('');
  // Split/mixed payment (spec section 3 — "mixed payment if architecture
  // supports it"). saleService.create() already takes a payments[] array
  // (it always has — see the header note re: FIELD MAPPING); this is a
  // UI-only addition, off by default so single-payment behavior below is
  // completely unchanged unless the cashier explicitly turns it on.
  const [splitMode, setSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState([]); // [{ method, amount, reference_no }]
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

  // Stage 1B (brief section 22 -- "search items" must work offline).
  // Covers the case section 32's Test 6 describes: the app is closed
  // and reopened while offline, so the online fetch above never
  // populated `products` and it's still []. Falls back to whatever was
  // cached on this device from its last online session -- never the
  // reverse (a live, connected fetch is always preferred over the
  // cache, so the cache can't shadow fresher data).
  const [offlineFallbackProducts, setOfflineFallbackProducts] = useState([]);
  useEffect(() => {
    if (!isOnline && products.length === 0) {
      import('../offline/offlineCache').then(m => m.getCachedProducts()).then(rows => {
        // Shape cached rows enough like a live product row for the cart/
        // pricing code below (it reads .selling_price/.unit_price etc.
        // depending on call site) -- unit_price mirrors selling_price so
        // either naming works without touching every read site in this file.
        setOfflineFallbackProducts(rows.map(r => ({ ...r, unit_price: r.selling_price })));
      });
    } else if (products.length > 0) {
      setOfflineFallbackProducts([]); // live data is back -- stop shadowing it
    }
  }, [isOnline, products]);

  const searchableProducts = products.length > 0 ? products : offlineFallbackProducts;

  const filteredProducts = searchableProducts.filter(p =>
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
        // Requesting more/less of a line keeps its existing per-line
        // discount amount, but clamps it so a discount can never exceed
        // the new line subtotal (e.g. quantity reduced after a discount
        // was applied).
        const clampedDiscount = Math.min(existing.discount_amount || 0, requestedQty * existing.unit_price);
        return prevCart.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: requestedQty, discount_amount: clampedDiscount, total: requestedQty * i.unit_price - clampedDiscount }
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
        discount_amount: 0,
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
    setCart(cart.map(i => {
      if (i.product_id !== id) return i;
      const clampedDiscount = Math.min(i.discount_amount || 0, qty * i.unit_price);
      return {
        ...i,
        quantity: qty,
        discount_amount: clampedDiscount,
        total: qty * i.unit_price - clampedDiscount,
        weight_value: VARIABLE_MODES.includes(i.selling_mode) ? qty : i.weight_value,
      };
    }));
  };

  // Per-line discount, entered as a KES amount (matches lb_sale_items'
  // real discount_amount column directly — no percent-to-amount
  // conversion needed at save time). Clamped to [0, line subtotal] so a
  // discount can never make a line negative.
  const updateDiscount = (id, discountAmount) => {
    setCart(cart.map(i => {
      if (i.product_id !== id) return i;
      const lineSubtotal = i.quantity * i.unit_price;
      const clamped = Math.max(0, Math.min(discountAmount, lineSubtotal));
      return { ...i, discount_amount: clamped, total: lineSubtotal - clamped };
    }));
  };

  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const discountTotal = cart.reduce((s, i) => s + (i.discount_amount || 0), 0);
  const total = subtotal - discountTotal;
  const change = parseFloat(customerAmount || 0) - total;

  // Split-payment helpers. Amounts are entered as strings in the inputs;
  // parsed here so splitPaidTotal/splitRemaining always reflect valid
  // numbers even mid-typing (a blank or partial entry counts as 0, not NaN).
  const addSplitPayment = () => {
    setSplitPayments(prev => [...prev, { id: Date.now() + Math.random(), method: 'CASH', amount: '', reference_no: '' }]);
  };
  const updateSplitPayment = (id, field, value) => {
    setSplitPayments(prev => prev.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  };
  const removeSplitPayment = (id) => {
    setSplitPayments(prev => prev.filter(p => p.id !== id));
  };
  const splitPaidTotal = splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const splitRemaining = total - splitPaidTotal;

  // Stage 2 -- M-Pesa STK checkout. Deliberately separate from
  // completeSale(): a sale for an STK payment isn't created by this
  // page at all -- confirm_mpesa_payment() creates it server-side, only
  // once Safaricom confirms (section 37). This function only sends the
  // request and opens the waiting modal; the modal's own effect clears
  // the cart once mpesa.phase reaches 'paid'.
  const handleMpesaCheckout = async () => {
    if (!activeShift) { alert('Open a shift first'); return; }
    if (cart.length === 0) return;
    setSaleError('');
    const phone = mpesaPhone || customers.find(c => c.id === selectedCustomerId)?.phone || '';
    if (!phone) { setSaleError('Enter the customer\'s M-Pesa phone number.'); return; }

    const cartSnapshot = cart.map(i => ({
      product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price,
      cost_price: i.cost_price, discount_amount: i.discount_amount || 0, selling_mode: i.selling_mode,
    }));

    setShowMpesaModal(true);
    try {
      await mpesa.send({ phone, amount: total, cartSnapshot, customerId: selectedCustomerId || null, shiftId: activeShift.id });
    } catch (err) {
      setSaleError(err.message || 'Failed to send the M-Pesa request.');
      setShowMpesaModal(false);
    }
  };

  // Phase 14: once M-Pesa confirms, fetch the receipt
  // confirm_mpesa_payment() now writes (see schema/phase14_receipts.sql)
  // in the background, so it's ready the moment the cashier presses
  // "Done" below -- no extra wait on top of the STK confirmation itself.
  const [mpesaReceipt, setMpesaReceipt] = useState(null);
  useEffect(() => {
    if (mpesa.phase === 'paid' && mpesa.transaction?.sale_id) {
      receiptService.getBySaleId(mpesa.transaction.sale_id).then(setMpesaReceipt).catch(() => {});
    }
    if (mpesa.phase === 'idle') setMpesaReceipt(null);
  }, [mpesa.phase, mpesa.transaction]);

  const closeMpesaModal = () => {
    const wasPaid = mpesa.phase === 'paid';
    if (wasPaid) {
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId(''); setMpesaPhone('');
    }
    setShowMpesaModal(false);
    if (wasPaid && mpesaReceipt) {
      const customer = customers.find(c => c.id === mpesa.transaction?.customer_id) || null;
      setReceiptModal({ receipt: mpesaReceipt, customer, isOffline: false });
    }
    mpesa.reset();
  };

  const completeSale = async () => {
    if (!activeShift) { alert('Open a shift first'); return; }
    if (cart.length === 0) return;
    setSaleError('');

    let payments;
    if (splitMode) {
      const validLines = splitPayments.filter(p => parseFloat(p.amount) > 0);
      if (validLines.length === 0) {
        setSaleError('Add at least one payment.');
        return;
      }
      // Exact match required in split mode — no change handling across
      // multiple payment lines (e.g. how much of an overpayment on a
      // CASH+MOBILE_MONEY split is "change" vs a second line is
      // ambiguous). A single-payment CASH sale still supports change via
      // the non-split flow below.
      if (Math.abs(splitRemaining) > 0.01) {
        setSaleError(splitRemaining > 0
          ? `Payments are short by ${splitRemaining.toLocaleString()}.`
          : `Payments exceed the total by ${Math.abs(splitRemaining).toLocaleString()}.`);
        return;
      }
      if (validLines.some(p => p.method === 'CREDIT') && !selectedCustomerId) {
        setSaleError('Select a customer before completing a credit sale.');
        return;
      }
      payments = validLines.map(p => ({
        payment_method: p.method,
        amount: parseFloat(p.amount),
        change_amount: 0,
        reference_no: p.reference_no || null,
      }));
    } else {
      // Same requirement the DB trigger enforces — checked here too so the
      // cashier gets a clear message instead of a raw exception from
      // process_credit_sale_payment after the request round-trips.
      if (paymentMethod === 'CREDIT' && !selectedCustomerId) {
        setSaleError('Select a customer before completing a credit sale.');
        return;
      }
      const changeAmount = paymentMethod === 'CASH' ? Math.max(0, change) : 0;
      payments = [{
        payment_method: paymentMethod,
        amount: total,
        change_amount: changeAmount,
      }];
    }

    // shift_id is required — without it, closing this shift can never
    // find these sales when computing expected_cash (see conversation:
    // cashierService.js's closeShift filters lb_sales by shift_id).
    const sale = {
      shift_id: activeShift.id,
      customer_id: selectedCustomerId || null, // guaranteed non-empty for CREDIT by the checks above
      items: cart.map(i => ({
        product_id: i.product_id,
        name: i.name, // Phase 14: captured onto the receipt snapshot at sale time
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price,
        selling_mode: i.selling_mode,
        weight_value: i.weight_value,
        discount_amount: i.discount_amount || 0,
      })),
      payments,
    };

    try {
      // Stage 1B: goes through saleService.create() when online (identical
      // to before this change) or the offline queue when it isn't. See
      // offlineSaleService.js's header for the three possible outcomes.
      const fullSale = { ...sale, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, cashier_id: staffId };
      const result = await createOfflineAwareSale(fullSale, { isOnline });
      const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || null;
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId('');
      setSplitPayments([]); setSplitMode(false);
      // Phase 14: show the receipt instead of a bare alert(). For an
      // online sale, fetch the REAL lb_receipts row saleService.create()
      // already wrote (has a server-issued receipt_number). For an
      // offline/LOCAL_PENDING sale there is no server row yet -- a
      // synthetic receipt object, shaped identically, lets the cashier
      // print/share it immediately without waiting for sync (brief
      // section 27's own "must not have to wait for Supabase").
      if (result._offlineStatus === 'LOCAL_PENDING') {
        setReceiptModal({
          receipt: {
            receipt_number: result.sale_number, // no real one exists yet
            created_at: result.completed_at,
            receipt_data: {
              sale_number: result.sale_number, items: result.items, payments: result.payments,
              subtotal: result.subtotal, discount_total: result.discount_total,
              tax_total: result.tax_total, total_amount: result.total_amount,
              completed_at: result.completed_at,
            },
          },
          customer: selectedCustomer, isOffline: true,
        });
      } else {
        try {
          const receipt = await receiptService.getBySaleId(result.id);
          if (receipt) setReceiptModal({ receipt, customer: selectedCustomer, isOffline: false });
        } catch {
          // Sale itself already succeeded -- a failed receipt FETCH
          // shouldn't look like the sale failed. It's still in
          // lb_receipts and reachable later; just nothing pops up now.
        }
      }
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
    <div className="h-full flex flex-col">
      <div className="bg-gray-800 text-white p-3 flex flex-wrap justify-between items-center gap-2">
        <span className="font-bold">POS — Shift Open</span>
        <button onClick={() => setShowCloseShiftModal(true)} className="bg-red-600 px-3 py-1 rounded text-sm shrink-0">Close Shift</button>
      </div>
      {/* Phone fix: on mobile this becomes a single stacked column
          (catalog, then cart+payment below it), so it needs to scroll
          as ONE page — hence overflow-y-auto here on small screens.
          At md: it switches to the two-pane side-by-side layout, and
          overflow-hidden here is what lets each pane (left: overflow-y-auto
          catalog, right: its own internal flex layout) scroll
          independently instead of the whole row scrolling as a unit.
          Without this split, content below the fold on a phone was
          unreachable — clipped by overflow-hidden with nothing to
          scroll it, not just visually cramped. */}
      <div className="flex flex-1 overflow-y-auto md:overflow-hidden flex-col md:flex-row">
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
              <div key={item.product_id} className="py-2 border-b">
                <div className="flex flex-wrap justify-between items-center gap-y-1">
                  <div className="min-w-0 pr-2">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-sm text-gray-500">{item.unit_price?.toLocaleString()} x {item.quantity}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => updateQty(item.product_id, item.quantity - 1)} className="w-6 h-6 bg-gray-200 rounded">-</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQty(item.product_id, item.quantity + 1)} className="w-6 h-6 bg-gray-200 rounded">+</button>
                    <span className="font-bold w-20 text-right">{item.total?.toLocaleString()}</span>
                  </div>
                </div>
                {/* Per-line discount, KES amount — clamped in updateDiscount so it
                    can never exceed this line's own subtotal. */}
                <div className="flex justify-end items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">Discount (KES)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount_amount || ''}
                    onChange={e => updateDiscount(item.product_id, parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-24 border rounded px-2 py-1 text-sm text-right"
                  />
                </div>
              </div>
            ))}
            {cart.length === 0 && <div className="text-gray-400 text-center py-10">No items</div>}
          </div>
          <div className="border-t pt-4 mt-4">
            <div className="flex justify-between text-lg mb-2"><span>Subtotal</span><span className="font-bold">{subtotal.toLocaleString()}</span></div>
            {discountTotal > 0 && (
              <div className="flex justify-between text-lg mb-2 text-emerald-700"><span>Discount</span><span className="font-bold">-{discountTotal.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-xl mb-4"><span>TOTAL</span><span className="font-bold text-blue-600">{total.toLocaleString()}</span></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase">Payment</span>
              <button
                onClick={() => { setSplitMode(!splitMode); setSplitPayments([]); setSaleError(''); }}
                className={`text-xs font-semibold px-2 py-1 rounded ${splitMode ? 'bg-emerald-800 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {splitMode ? 'Split payment: ON' : 'Split payment'}
              </button>
            </div>

            {!splitMode ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'].map(m => {
                  // Section 23: M-Pesa STK cannot be initiated offline --
                  // disabled here rather than left to fail after the tap.
                  const disabled = m === 'MOBILE_MONEY' && !isOnline;
                  return (
                    <button
                      key={m} disabled={disabled}
                      onClick={() => setPaymentMethod(m)}
                      title={disabled ? "No internet connection. M-Pesa request will be available when you're back online." : undefined}
                      className={`flex-1 min-w-[70px] py-2 rounded text-sm ${paymentMethod === m ? 'bg-emerald-800 text-white' : 'bg-gray-100'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >{m.replace('_', ' ')}</button>
                  );
                })}
              </div>
            ) : (
              // Split/mixed payment: one or more lines, each its own
              // method + amount (e.g. part CASH, part MOBILE_MONEY on the
              // same sale). No change handling here — Complete Sale stays
              // disabled until the lines add up exactly (see completeSale).
              <div className="mb-3 space-y-2">
                {splitPayments.map(p => (
                  <div key={p.id} className="flex gap-2 items-center">
                    <select
                      value={p.method}
                      onChange={e => updateSplitPayment(p.id, 'method', e.target.value)}
                      className="border rounded px-2 py-2 text-sm"
                    >
                      {['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'].map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                    </select>
                    <input
                      type="number" min="0" step="0.01" placeholder="Amount"
                      value={p.amount}
                      onChange={e => updateSplitPayment(p.id, 'amount', e.target.value)}
                      className="border rounded px-3 py-2 flex-1"
                    />
                    <button onClick={() => removeSplitPayment(p.id)} className="text-red-500 text-sm px-2">✕</button>
                  </div>
                ))}
                <button onClick={addSplitPayment} className="text-sm text-emerald-700 font-semibold">+ Add payment</button>
                <div className={`flex justify-between text-sm font-semibold pt-1 ${Math.abs(splitRemaining) < 0.01 ? 'text-emerald-700' : 'text-red-600'}`}>
                  <span>Remaining</span><span>{splitRemaining.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Customer picker. Required for CREDIT (enforced both here and
                by the DB trigger); optional otherwise so a walk-in cash
                sale can still be tagged to a customer if useful. */}
            <div className="mb-3">
              <select
                value={selectedCustomerId}
                onChange={e => setSelectedCustomerId(e.target.value)}
                className={`w-full border rounded px-3 py-2 text-sm ${(splitMode ? splitPayments.some(p => p.method === 'CREDIT') : paymentMethod === 'CREDIT') && !selectedCustomerId ? 'border-red-400' : 'border-gray-200'}`}
              >
                <option value="">{(splitMode ? splitPayments.some(p => p.method === 'CREDIT') : paymentMethod === 'CREDIT') ? 'Select customer (required)' : 'Customer (optional)'}</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>
            {saleError && (
              <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-3">{saleError}</div>
            )}
            {!splitMode && paymentMethod === 'CASH' && (
              <div className="flex gap-2 mb-3">
                <input type="number" placeholder="Amount received" value={customerAmount} onChange={e => setCustomerAmount(e.target.value)} className="border rounded px-3 py-2 flex-1" />
                <div className="px-3 py-2 bg-green-100 text-green-700 rounded">Change: {change >= 0 ? change.toLocaleString() : '-'}</div>
              </div>
            )}
            {!splitMode && paymentMethod === 'MOBILE_MONEY' && (
              <input
                type="tel" placeholder="07XX XXX XXX (customer's M-Pesa number)"
                value={mpesaPhone || customers.find(c => c.id === selectedCustomerId)?.phone || ''}
                onChange={e => setMpesaPhone(e.target.value)}
                className="w-full border rounded px-3 py-2 mb-3 text-sm"
              />
            )}
            <button
              onClick={(!splitMode && paymentMethod === 'MOBILE_MONEY') ? handleMpesaCheckout : completeSale}
              disabled={cart.length === 0 || (splitMode && Math.abs(splitRemaining) > 0.01) || (!splitMode && paymentMethod === 'MOBILE_MONEY' && !isOnline)}
              className="w-full bg-green-600 text-white py-3 rounded font-bold disabled:opacity-50"
            >
              {(!splitMode && paymentMethod === 'MOBILE_MONEY') ? 'SEND M-PESA REQUEST' : 'COMPLETE SALE'}
            </button>
          </div>
        </div>
      </div>

      {/* Stage 2 -- M-Pesa STK status modal (brief section 36/37).
          Never says "Paid" until mpesa.phase === 'paid', which only
          happens on the realtime UPDATE the callback function produces
          (see useMpesaPayment.js) -- never on the strength of the
          request having been sent. */}
      {showMpesaModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-6 text-center max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-1">M-Pesa Payment</h3>
            <p className="text-sm text-gray-500 mb-4">Amount: <span className="font-semibold text-gray-800">KES {total.toLocaleString()}</span></p>

            {mpesa.phase === 'sending' && (
              <p className="text-sm text-gray-600 py-4">Sending request…</p>
            )}
            {mpesa.phase === 'pending' && (
              <div className="py-4">
                <div className="animate-pulse text-amber-600 font-semibold mb-2">Waiting for the customer…</div>
                <p className="text-sm text-gray-500">M-Pesa request sent. Ask the customer to check their phone.</p>
                <button onClick={mpesa.refresh} className="mt-3 text-xs text-emerald-700 underline">Check status again</button>
              </div>
            )}
            {mpesa.phase === 'paid' && (
              <div className="py-4">
                <div className="text-emerald-700 text-2xl mb-1">✓</div>
                <p className="font-semibold text-emerald-700">Payment received</p>
                {mpesa.transaction?.mpesa_receipt_number && (
                  <p className="text-xs text-gray-400 mt-1">Receipt: {mpesa.transaction.mpesa_receipt_number}</p>
                )}
              </div>
            )}
            {mpesa.phase === 'failed' && (
              <div className="py-4">
                <p className="font-semibold text-red-600 mb-1">
                  {mpesa.transaction?.status === 'CANCELLED' ? 'Payment cancelled by customer'
                    : mpesa.transaction?.status === 'TIMED_OUT' ? 'No response — request timed out'
                    : 'Payment failed'}
                </p>
                {mpesa.transaction?.result_desc && <p className="text-xs text-gray-400">{mpesa.transaction.result_desc}</p>}
                <p className="text-xs text-gray-400 mt-1">The cart has not been cleared — try again or choose another payment method.</p>
              </div>
            )}
            {mpesa.error && <p className="text-sm text-red-600 py-2">{mpesa.error}</p>}

            <button
              onClick={closeMpesaModal}
              disabled={mpesa.phase === 'sending'}
              className="mt-2 w-full bg-gray-100 text-gray-700 py-2 rounded font-semibold disabled:opacity-50"
            >
              {mpesa.phase === 'paid' ? 'Done' : mpesa.phase === 'pending' ? 'Cancel / keep cart' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {/* Phase 14 -- the sale receipt (print/WhatsApp/email). Mounted
          last so it renders on top of everything else, including the
          M-Pesa modal it can appear right after. */}
      {receiptModal && (
        <ReceiptModal
          receipt={receiptModal.receipt}
          customer={receiptModal.customer}
          isOffline={receiptModal.isOffline}
          business={business}
          posSettings={posSettings}
          tenantId={tenant?.id}
          businessId={tenant?.business_id}
          staffId={staffId}
          isOnline={isOnline}
          onClose={() => setReceiptModal(null)}
        />
      )}

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
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 max-h-[90vh] overflow-y-auto">
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
          <form onSubmit={submitQuickCreate} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
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
          <form onSubmit={submitCloseShift} className="bg-white rounded-xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
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
