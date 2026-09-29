// src/pos-erp/pages/POSPage.jsx -- Sell.
//
// "My Business" redesign of the till (brief section 9). Business logic is
// unchanged: every sale still goes through createOfflineAwareSale() ->
// saleService.create(), STK sales still come from confirm_mpesa_payment().
// What changed:
//   - M-Pesa is a PAYMENT MODE (Cash / M-Pesa / Card / Credit) with two
//     ways to collect it: send the buyer a prompt (STK Push), or record
//     the code when they already paid (works offline). See
//     components/MpesaPayPanel.jsx.
//   - Phones get a two-step flow (Items -> Sale) with a sticky checkout
//     bar instead of two half-height scrolling panes.
//   - Payment methods follow Settings -> "Payment methods accepted".
//   - The catalogue is no longer capped at the first 50 items: it loads
//     up to 500 and searches the server as you type.
//   - Forest / Emerald / Gold styling, 44px+ touch targets.
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
import { Image as ImageIcon, Camera, Search, ArrowLeft, Minus, Plus, Loader2, ShoppingCart } from 'lucide-react';
import MpesaPayPanel from '../components/MpesaPayPanel';
import MpesaPromptModal from '../components/MpesaPromptModal';
import { mpesaService } from '../services/mpesaService';
import { normalizeMpesaCode, isValidMpesaCode, isWholeShillings } from '../utils/mpesa';

const VARIABLE_MODES = ['WEIGHT', 'VOLUME', 'CUSTOM'];

// Owner-facing names. The stored value stays MOBILE_MONEY (that is what
// lb_payments and every report already use) -- only the label changes.
const ALL_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'];
const METHOD_LABEL = { CASH: 'Cash', MOBILE_MONEY: 'M-Pesa', CARD: 'Card', CREDIT: 'Credit' };

export default function POSPage() {
  const { staffId, tenant } = usePosErpAuth();
  const { products, create: createProduct, fetch: fetchProducts } = useProducts();
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

  // ---- M-Pesa as a payment mode ----
  const [mpesaMode, setMpesaMode] = useState('PROMPT'); // 'PROMPT' (STK push) | 'MANUAL' (buyer already paid; enter code)
  const [mpesaCode, setMpesaCode] = useState('');
  const [promptPhone, setPromptPhone] = useState(''); // the number the live prompt went to
  const [mpesaConfig, setMpesaConfig] = useState(undefined); // undefined = still checking, null = none saved
  const [mobileView, setMobileView] = useState('items'); // phones only: 'items' | 'sale'

  // Is a prompt possible right now? Needs internet AND M-Pesa switched on
  // with all three credentials saved (the same test the Edge Function
  // applies, so the cashier finds out here instead of after tapping).
  useEffect(() => {
    if (!tenant?.business_id || !isOnline) return undefined;
    let alive = true;
    mpesaService.getConfig(tenant.business_id)
      .then((c) => { if (alive) setMpesaConfig(c || null); })
      .catch(() => { if (alive) setMpesaConfig(null); });
    return () => { alive = false; };
  }, [tenant?.business_id, isOnline]);
  const stkConfigured = !!(mpesaConfig?.is_active && mpesaConfig.has_consumer_key && mpesaConfig.has_consumer_secret && mpesaConfig.has_passkey);
  const stkStatus = !isOnline ? 'offline' : mpesaConfig === undefined ? 'checking' : stkConfigured ? 'ready' : 'not_setup';
  // When a prompt isn't possible the till quietly uses "Already paid".
  const effectiveMpesaMode = stkStatus === 'ready' ? mpesaMode : 'MANUAL';

  // Payment methods follow Settings (default: all four).
  const enabledMethods = (() => {
    const list = posSettings?.settings?.payment_methods_enabled;
    const filtered = Array.isArray(list) ? ALL_METHODS.filter((m) => list.includes(m)) : ALL_METHODS;
    return filtered.length > 0 ? filtered : ALL_METHODS;
  })();

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

  // If Settings turned off the method currently selected, fall back to the first one still on.
  useEffect(() => {
    if (!enabledMethods.includes(paymentMethod)) setPaymentMethod(enabledMethods[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSettings]);

  // Catalogue: up to 500 items when browsing, and a server-side search as
  // the cashier types (so item #501+ is still findable). useProducts()'s
  // own first load only fetches 50. Online only -- offline the cached list
  // (see offlineFallbackProducts) is used and nothing is fetched.
  useEffect(() => {
    if (!isOnline) return undefined;
    const term = search.trim();
    const t = setTimeout(() => { fetchProducts({ search: term || undefined, limit: term ? 100 : 500 }); }, term ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, isOnline, fetchProducts]);

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
    tenantId: tenant?.id,
    businessId: tenant?.business_id,
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
    if (!phone) { setSaleError('Enter the buyer\'s M-Pesa phone number.'); return; }
    // STK Push charges whole shillings only (the Edge Function rounds), so
    // a total with cents would charge a different amount than the sale
    // records. Say so up front instead of creating that mismatch.
    if (!isWholeShillings(total)) {
      setSaleError(`M-Pesa prompts work in whole shillings and this sale is KES ${total.toLocaleString()}. Adjust a discount to a whole amount, or choose "Already paid" and enter the code.`);
      return;
    }

    const cartSnapshot = cart.map(i => ({
      product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price,
      cost_price: i.cost_price, discount_amount: i.discount_amount || 0, selling_mode: i.selling_mode,
    }));

    setPromptPhone(phone);
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

  // A request that is still waiting must never be forgotten about: hiding
  // the modal keeps it alive (banner on the till), and the modal comes
  // back by itself the moment the result arrives.
  useEffect(() => {
    if ((mpesa.phase === 'paid' || mpesa.phase === 'failed') && !showMpesaModal) setShowMpesaModal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpesa.phase]);
  const mpesaBusy = mpesa.phase === 'sending' || mpesa.phase === 'pending';

  const retryMpesaPrompt = () => { mpesa.reset(); handleMpesaCheckout(); };
  const switchToMpesaCode = () => { mpesa.reset(); setShowMpesaModal(false); setMpesaMode('MANUAL'); };

  const closeMpesaModal = () => {
    const wasPaid = mpesa.phase === 'paid';
    if (wasPaid) {
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId(''); setMpesaPhone('');
      setMpesaCode(''); setMobileView('items');
    }
    setShowMpesaModal(false);
    if (wasPaid && mpesaReceipt) {
      const customer = customers.find(c => c.id === mpesa.transaction?.customer_id) || null;
      setReceiptModal({ receipt: mpesaReceipt, customer, isOffline: false });
    }
    mpesa.reset();
  };

  // Stops one M-Pesa SMS being used to "pay" for two sales. Online only:
  // offline the code can't be looked up, so it is saved as typed and the
  // owner can review it on the M-Pesa page once it syncs. A failed lookup
  // never blocks a real sale.
  const codeAlreadyUsed = async (code) => {
    if (!isOnline || !tenant?.business_id) return false;
    try {
      if (await mpesaService.isCodeUsed(tenant.business_id, code)) {
        setSaleError(`M-Pesa code ${code} was already used on another sale. Check the buyer's SMS.`);
        return true;
      }
    } catch (err) {
      console.error('[POS] M-Pesa code lookup failed (sale not blocked):', err);
    }
    return false;
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
      // An M-Pesa line in a split sale is always "already paid" -- a
      // prompt can't cover part of a cart (the STK sale is created for the
      // whole cart on confirmation) -- so its code is required.
      const mpesaLines = validLines.filter(p => p.method === 'MOBILE_MONEY');
      if (mpesaLines.some(p => !isValidMpesaCode(p.reference_no))) {
        setSaleError('Enter the M-Pesa code (from the SMS) for each M-Pesa payment.');
        return;
      }
      const codes = mpesaLines.map(p => normalizeMpesaCode(p.reference_no));
      if (new Set(codes).size !== codes.length) {
        setSaleError('The same M-Pesa code is entered twice.');
        return;
      }
      for (const c of codes) { if (await codeAlreadyUsed(c)) return; }
      payments = validLines.map(p => ({
        payment_method: p.method,
        amount: parseFloat(p.amount),
        change_amount: 0,
        reference_no: p.method === 'MOBILE_MONEY' ? normalizeMpesaCode(p.reference_no) : (p.reference_no || null),
      }));
    } else {
      // Same requirement the DB trigger enforces — checked here too so the
      // cashier gets a clear message instead of a raw exception from
      // process_credit_sale_payment after the request round-trips.
      if (paymentMethod === 'CREDIT' && !selectedCustomerId) {
        setSaleError('Select a customer before completing a credit sale.');
        return;
      }
      if (paymentMethod === 'MOBILE_MONEY') {
        // "Already paid": the buyer paid the till/paybill themselves and
        // the cashier types the code from their SMS. Recorded as a normal
        // MOBILE_MONEY payment with the code as its reference, so it works
        // offline and shows on the M-Pesa page under "Recorded by cashier".
        const code = normalizeMpesaCode(mpesaCode);
        if (!isValidMpesaCode(code)) {
          setSaleError('Enter the M-Pesa code from the buyer\'s SMS (like SHK7X9ABCD).');
          return;
        }
        if (await codeAlreadyUsed(code)) return;
        payments = [{ payment_method: 'MOBILE_MONEY', amount: total, change_amount: 0, reference_no: code }];
      } else {
        const changeAmount = paymentMethod === 'CASH' ? Math.max(0, change) : 0;
        payments = [{
          payment_method: paymentMethod,
          amount: total,
          change_amount: changeAmount,
        }];
      }
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
      setSplitPayments([]); setSplitMode(false); setMpesaCode(''); setMobileView('items');
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

  const cartCount = cart.reduce((n, i) => n + (VARIABLE_MODES.includes(i.selling_mode) ? 1 : i.quantity), 0);
  const isMpesaSingle = !splitMode && paymentMethod === 'MOBILE_MONEY';
  const isPrompt = isMpesaSingle && effectiveMpesaMode === 'PROMPT';
  const isMpesaCode = isMpesaSingle && effectiveMpesaMode === 'MANUAL';
  const creditPicked = splitMode ? splitPayments.some(p => p.method === 'CREDIT') : paymentMethod === 'CREDIT';
  const canSubmit = cart.length > 0
    && !mpesaBusy
    && !(splitMode && Math.abs(splitRemaining) > 0.01)
    && !(isPrompt && stkStatus !== 'ready')
    && !(isMpesaCode && !isValidMpesaCode(mpesaCode));
  const submitLabel = isPrompt ? `Send M-Pesa prompt · KES ${total.toLocaleString()}` : `Complete sale · KES ${total.toLocaleString()}`;

  if (!activeShift) {
    return (
      <div className="p-4 sm:p-6 max-w-md mx-auto">
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-5 text-center">
          <div className="w-12 h-12 rounded-full bg-[#237A52]/10 text-[#237A52] flex items-center justify-center mx-auto mb-3"><ShoppingCart size={22} /></div>
          <h2 className="text-lg font-bold text-[#26352D]">Start your shift to sell</h2>
          <p className="text-sm text-[#68756D] mt-1 mb-4">Enter the cash you are starting the till with. It can be 0.</p>
          {!showShiftModal ? (
            <button onClick={() => setShowShiftModal(true)} className="w-full min-h-[48px] bg-[#237A52] hover:bg-[#1B5138] text-white font-semibold rounded-xl">Open shift</button>
          ) : (
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" placeholder="Opening cash (float)" value={shiftFloat} onChange={e => setShiftFloat(e.target.value)} className="flex-1 min-w-0 border border-[#DDE3DD] rounded-xl px-3 py-3 text-base" autoFocus />
              <button onClick={() => { openShift(parseFloat(shiftFloat) || 0); setShowShiftModal(false); }} className="shrink-0 min-h-[48px] px-5 bg-[#237A52] hover:bg-[#1B5138] text-white font-semibold rounded-xl">Start</button>
            </div>
          )}
        </div>
        {/* Shown once, right after a close, so the cashier actually sees
            whether the till balanced -- this is the entire point of
            collecting actual cash in the first place. */}
        {closeSummary && (
          <div className="mt-4 bg-white border border-[#DDE3DD] rounded-xl p-5 text-left">
            <h3 className="font-bold text-[#26352D] mb-3">Shift closed — {closeSummary.shift_number}</h3>
            <div className="flex justify-between text-sm py-1"><span className="text-[#68756D]">Expected cash</span><span className="font-semibold">{Number(closeSummary.expected_cash).toLocaleString()}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-[#68756D]">Actual cash</span><span className="font-semibold">{Number(closeSummary.actual_cash).toLocaleString()}</span></div>
            <div className={`flex justify-between text-sm py-1 font-bold ${Number(closeSummary.variance) === 0 ? 'text-[#237A52]' : 'text-red-600'}`}>
              <span>Variance</span><span>{Number(closeSummary.variance) > 0 ? '+' : ''}{Number(closeSummary.variance).toLocaleString()}</span>
            </div>
            <button onClick={() => setCloseSummary(null)} className="mt-3 w-full min-h-[44px] bg-[#F7F6F0] text-[#26352D] text-sm font-semibold rounded-xl">Dismiss</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="bg-[#1B5138] text-white px-3 sm:px-4 py-2 flex flex-wrap justify-between items-center gap-2">
        <span className="font-semibold text-sm">Selling · shift open</span>
        <button onClick={() => setShowCloseShiftModal(true)} className="bg-white/15 hover:bg-white/25 px-3 min-h-[36px] rounded-lg text-xs font-semibold shrink-0">Close shift</button>
      </div>

      {/* Phones show ONE of the two panes at a time (Items, then Sale),
          switched by the sticky bar / the back button. md and up shows both
          side by side, as before. */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
        {/* ============ ITEMS ============ */}
        <div className={`${mobileView === 'items' ? 'block' : 'hidden'} md:block flex-1 basis-0 min-h-0 min-w-0 p-3 md:p-4 overflow-y-auto bg-[#F7F6F0]`}>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#68756D]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search or scan barcode"
                className="w-full min-w-0 border border-[#DDE3DD] bg-white rounded-xl pl-9 pr-3 min-h-[48px] text-base"
              />
            </div>
            <button
              onClick={() => setShowScanner(true)}
              className="bg-[#237A52] hover:bg-[#1B5138] text-white px-4 min-h-[48px] rounded-xl font-semibold shrink-0 flex items-center gap-2"
              aria-label="Scan barcode"
            >
              <Camera size={20} /> <span className="hidden sm:inline">Scan</span>
            </button>
          </div>

          {stockWarning && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{stockWarning}</div>
          )}

          {recentScans.length > 0 && (
            <div className="bg-white border border-[#DDE3DD] rounded-xl p-3 mb-3">
              <h4 className="text-[11px] font-bold text-[#68756D] uppercase mb-2">Recently scanned</h4>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {recentScans.map((s, idx) => (
                  <div key={idx} className="flex justify-between gap-2 text-sm">
                    <span className={`min-w-0 truncate ${s.result === SCAN_RESULTS.RESOLVED ? 'text-[#26352D]' : 'text-red-500'}`}>
                      {s.result === SCAN_RESULTS.RESOLVED ? s.product.name : `Not found: ${s.barcode}`}
                    </span>
                    <span className="text-[#68756D] text-xs shrink-0">{new Date(s.at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* grid-cols-2 until lg: this pane is only half-width from md up,
              so three image cards in a half pane got cramped early. The
              square image box keeps every card the same height. */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {filteredProducts.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className="bg-white border border-[#DDE3DD] rounded-xl hover:border-[#237A52] active:bg-emerald-50 text-left overflow-hidden flex flex-col min-w-0">
                <div className="w-full aspect-square bg-[#F7F6F0] flex items-center justify-center overflow-hidden shrink-0">
                  {p.image_url
                    ? <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <ImageIcon size={24} className="text-[#DDE3DD]" />}
                </div>
                <div className="p-2.5 min-w-0">
                  <div className="font-semibold text-sm truncate">{p.name}</div>
                  <div className="text-[#237A52] font-bold">{p.selling_price?.toLocaleString()}</div>
                </div>
              </button>
            ))}
          </div>
          {filteredProducts.length === 0 && (
            <div className="text-center text-sm text-[#68756D] py-10">
              {search ? `No items match "${search}".` : isOnline ? 'No items yet. Add some under Retail → My Items.' : 'No items saved on this device yet. Connect once to load them.'}
            </div>
          )}

          {/* Phone-only checkout bar. Sticks to the bottom of THIS pane, so
              it always sits just above the bottom navigation. */}
          {cart.length > 0 && (
            <div className="md:hidden sticky bottom-0 -mx-3 -mb-3 mt-3 px-3 py-2.5 bg-white border-t border-[#DDE3DD]">
              <button
                onClick={() => setMobileView('sale')}
                className="w-full min-h-[52px] rounded-xl bg-[#237A52] active:bg-[#1B5138] text-white font-semibold flex items-center justify-between px-4"
              >
                <span className="flex items-center gap-2"><ShoppingCart size={18} /> {cartCount} item{cartCount === 1 ? '' : 's'}</span>
                <span>View sale · KES {total.toLocaleString()}</span>
              </button>
            </div>
          )}
        </div>

        {/* ============ SALE ============ */}
        <div className={`${mobileView === 'sale' ? 'flex' : 'hidden'} md:flex flex-1 basis-0 min-h-0 min-w-0 p-3 md:p-4 overflow-y-auto bg-white flex-col md:border-l border-[#DDE3DD]`}>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setMobileView('items')} className="md:hidden -ml-2 p-2 text-[#26352D]" aria-label="Back to items"><ArrowLeft size={20} /></button>
            <h3 className="font-bold text-[#26352D]">Current sale{cart.length > 0 ? ` (${cartCount})` : ''}</h3>
            {cart.length > 0 && <button onClick={() => { setCart([]); setMobileView('items'); }} className="ml-auto text-xs font-semibold text-[#68756D] hover:text-red-600 min-h-[36px] px-2">Clear</button>}
          </div>

          <div className="flex-1">
            {cart.map(item => (
              <div key={item.product_id} className="py-2.5 border-b border-[#DDE3DD]">
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-sm text-[#68756D]">{item.unit_price?.toLocaleString()} × {item.quantity}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => updateQty(item.product_id, item.quantity - 1)} className="w-9 h-9 bg-[#F7F6F0] border border-[#DDE3DD] rounded-lg flex items-center justify-center" aria-label="Less"><Minus size={16} /></button>
                    <span className="w-7 text-center font-semibold">{item.quantity}</span>
                    <button onClick={() => updateQty(item.product_id, item.quantity + 1)} className="w-9 h-9 bg-[#F7F6F0] border border-[#DDE3DD] rounded-lg flex items-center justify-center" aria-label="More"><Plus size={16} /></button>
                  </div>
                  <span className="font-bold w-20 text-right shrink-0">{item.total?.toLocaleString()}</span>
                </div>
                {/* Per-line discount, KES amount -- clamped in updateDiscount
                    so it can never exceed this line's own subtotal. */}
                <div className="flex justify-end items-center gap-2 mt-1.5">
                  <span className="text-xs text-[#68756D]">Discount (KES)</span>
                  <input
                    type="number" inputMode="decimal" min="0" step="0.01"
                    value={item.discount_amount || ''}
                    onChange={e => updateDiscount(item.product_id, parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-24 border border-[#DDE3DD] rounded-lg px-2 py-1.5 text-sm text-right"
                  />
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <div className="text-[#68756D] text-center py-10 text-sm">
                No items yet.
                <button onClick={() => setMobileView('items')} className="md:hidden block mx-auto mt-3 text-[#237A52] font-semibold underline min-h-[44px]">Add items</button>
              </div>
            )}
          </div>

          <div className="border-t border-[#DDE3DD] pt-4 mt-4">
            <div className="flex justify-between mb-1.5"><span className="text-[#68756D]">Subtotal</span><span className="font-semibold">{subtotal.toLocaleString()}</span></div>
            {discountTotal > 0 && (
              <div className="flex justify-between mb-1.5 text-[#237A52]"><span>Discount</span><span className="font-semibold">-{discountTotal.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-xl mb-4"><span className="font-semibold">Total</span><span className="font-bold text-[#237A52]">KES {total.toLocaleString()}</span></div>

            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#68756D] uppercase">How is the buyer paying?</span>
              <button
                onClick={() => { setSplitMode(!splitMode); setSplitPayments([]); setSaleError(''); }}
                className={`text-xs font-semibold px-2.5 min-h-[32px] rounded-lg ${splitMode ? 'bg-[#237A52] text-white' : 'bg-[#F7F6F0] border border-[#DDE3DD] text-[#26352D]'}`}
              >
                {splitMode ? 'Split payment: on' : 'Split payment'}
              </button>
            </div>

            {!splitMode ? (
              <div className={`grid gap-2 mb-3 ${enabledMethods.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {enabledMethods.map(m => (
                  <button
                    key={m}
                    onClick={() => { setPaymentMethod(m); setSaleError(''); }}
                    aria-pressed={paymentMethod === m}
                    className={`min-h-[48px] rounded-xl text-sm font-semibold border transition-colors ${
                      paymentMethod === m ? 'bg-[#237A52] text-white border-[#237A52]' : 'bg-white text-[#26352D] border-[#DDE3DD] hover:bg-[#F7F6F0]'
                    }`}
                  >{METHOD_LABEL[m]}</button>
                ))}
              </div>
            ) : (
              // Split / mixed payment: one or more lines, each its own
              // method + amount. No change handling here -- Complete Sale
              // stays disabled until the lines add up exactly.
              <div className="mb-3 space-y-2">
                {splitPayments.map(p => (
                  <div key={p.id} className="rounded-xl border border-[#DDE3DD] p-2 space-y-2">
                    <div className="flex gap-2 items-center">
                      <select
                        value={p.method}
                        onChange={e => updateSplitPayment(p.id, 'method', e.target.value)}
                        className="border border-[#DDE3DD] rounded-lg px-2 min-h-[44px] text-sm shrink-0 bg-white"
                      >
                        {enabledMethods.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                      </select>
                      <input
                        type="number" inputMode="decimal" min="0" step="0.01" placeholder="Amount"
                        value={p.amount}
                        onChange={e => updateSplitPayment(p.id, 'amount', e.target.value)}
                        className="border border-[#DDE3DD] rounded-lg px-3 min-h-[44px] flex-1 min-w-0"
                      />
                      <button onClick={() => removeSplitPayment(p.id)} className="text-red-500 text-sm w-9 h-9 shrink-0" aria-label="Remove payment">✕</button>
                    </div>
                    {p.method === 'MOBILE_MONEY' && (
                      <input
                        type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12}
                        placeholder="M-Pesa code from the SMS"
                        value={p.reference_no}
                        onChange={e => updateSplitPayment(p.id, 'reference_no', normalizeMpesaCode(e.target.value))}
                        className="w-full min-w-0 border border-[#DDE3DD] rounded-lg px-3 min-h-[44px] font-mono tracking-wider text-sm"
                      />
                    )}
                  </div>
                ))}
                <button onClick={addSplitPayment} className="text-sm text-[#237A52] font-semibold min-h-[40px]">+ Add payment</button>
                {splitPayments.some(p => p.method === 'MOBILE_MONEY') && (
                  <p className="text-[11px] text-[#68756D] leading-snug">
                    In a split sale an M-Pesa payment is recorded by its code (the buyer has already paid). To send the buyer an M-Pesa prompt, sell with M-Pesa alone.
                  </p>
                )}
                <div className={`flex justify-between text-sm font-semibold pt-1 ${Math.abs(splitRemaining) < 0.01 ? 'text-[#237A52]' : 'text-red-600'}`}>
                  <span>Remaining</span><span>{splitRemaining.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* M-Pesa: a payment mode with two ways to collect it. */}
            {isMpesaSingle && (
              <MpesaPayPanel
                mode={effectiveMpesaMode} onModeChange={setMpesaMode}
                phone={mpesaPhone || customers.find(c => c.id === selectedCustomerId)?.phone || ''}
                onPhoneChange={setMpesaPhone}
                code={mpesaCode} onCodeChange={setMpesaCode}
                total={total} isOnline={isOnline} stkStatus={stkStatus}
              />
            )}

            {/* Customer picker. Required for CREDIT (enforced here and by
                the DB trigger); optional otherwise. */}
            <div className="mb-3">
              <select
                value={selectedCustomerId}
                onChange={e => setSelectedCustomerId(e.target.value)}
                className={`w-full border rounded-xl px-3 min-h-[48px] text-sm bg-white ${creditPicked && !selectedCustomerId ? 'border-red-400' : 'border-[#DDE3DD]'}`}
              >
                <option value="">{creditPicked ? 'Select customer (required)' : 'Customer (optional)'}</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>

            {!splitMode && paymentMethod === 'CASH' && (
              <div className="flex gap-2 mb-3">
                <input type="number" inputMode="decimal" placeholder="Amount received" value={customerAmount} onChange={e => setCustomerAmount(e.target.value)} className="border border-[#DDE3DD] rounded-xl px-3 min-h-[48px] flex-1 min-w-0" />
                <div className="px-3 min-h-[48px] flex items-center bg-[#237A52]/10 text-[#1B5138] font-semibold rounded-xl shrink-0 whitespace-nowrap">Change: {change >= 0 ? change.toLocaleString() : '-'}</div>
              </div>
            )}

            {saleError && (
              <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{saleError}</div>
            )}

            {/* A prompt that's still live but hidden must stay visible. */}
            {mpesa.phase === 'pending' && !showMpesaModal && (
              <button onClick={() => setShowMpesaModal(true)} className="w-full mb-3 flex items-center gap-2 text-left bg-[#C6A15B]/15 border border-[#C6A15B]/40 text-[#7a5f1f] rounded-xl px-3 py-2.5 text-sm font-semibold">
                <Loader2 size={16} className="animate-spin shrink-0" /> Waiting for the buyer's M-Pesa… tap to open
              </button>
            )}

            {/* Sticky so the action is always reachable on a phone. */}
            <div className="sticky bottom-0 -mx-3 md:-mx-4 px-3 md:px-4 pt-2 pb-2 bg-white border-t border-[#DDE3DD]">
              <button
                onClick={isPrompt ? handleMpesaCheckout : completeSale}
                disabled={!canSubmit}
                className="w-full min-h-[52px] bg-[#237A52] hover:bg-[#1B5138] text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* M-Pesa prompt status (brief section 36/37). Never says "paid"
          until mpesa.phase === 'paid', which only happens on the realtime
          UPDATE the callback function produces -- see useMpesaPayment.js. */}
      {showMpesaModal && (
        <MpesaPromptModal
          mpesa={mpesa}
          total={total}
          phone={promptPhone}
          onDone={closeMpesaModal}
          onHide={() => setShowMpesaModal(false)}
          onRetry={retryMpesaPrompt}
          onUseCode={switchToMpesaCode}
        />
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
              className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5 mb-4 text-lg"
              placeholder="0.00"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setPendingVariableProduct(null); setVariableQty(''); }}
                className="flex-1 bg-[#F7F6F0] text-[#26352D] py-2 rounded"
              >
                Cancel
              </button>
              <button
                onClick={confirmVariableQty}
                disabled={!variableQty || parseFloat(variableQty) <= 0}
                className="flex-1 bg-[#237A52] text-white py-2 rounded disabled:opacity-50"
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
              className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5"
            />
            <input
              required
              type="number"
              placeholder="Selling Price"
              value={quickCreateForm.selling_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, selling_price: e.target.value })}
              className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5"
            />
            <input
              type="number"
              placeholder="Cost Price (optional)"
              value={quickCreateForm.cost_price}
              onChange={e => setQuickCreateForm({ ...quickCreateForm, cost_price: e.target.value })}
              className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5"
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setQuickCreateBarcode(null)}
                className="flex-1 bg-[#F7F6F0] text-[#26352D] py-2 rounded"
              >
                Cancel
              </button>
              <button type="submit" className="flex-1 bg-[#237A52] text-white py-2 rounded">
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
                className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Closing float (left for next shift)</label>
              <input
                type="number" step="0.01" min="0"
                value={closeFloat} onChange={e => setCloseFloat(e.target.value)}
                className="w-full border border-[#DDE3DD] rounded-lg px-3 py-2.5"
                placeholder="0"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowCloseShiftModal(false)} className="flex-1 bg-[#F7F6F0] text-[#26352D] py-2 rounded">Cancel</button>
              <button type="submit" disabled={closing} className="flex-1 bg-red-600 text-white py-2 rounded-lg disabled:opacity-50">
                {closing ? 'Closing…' : 'Close Shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
