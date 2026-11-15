// src/pos-erp/pages/POSPage.jsx -- Sell.
//
// "My Business" redesign of the till (brief section 9). Business logic is
// unchanged: every sale still goes through createOfflineAwareSale() ->
// saleService.create(), STK sales still come from confirm_mpesa_payment().
// What changed:
//   - M-Pesa is a PAYMENT METHOD (Cash / M-Pesa / Card / Credit). Picking it
//     shows ONE compact section: a transaction-code field and a Prompt
//     button. Typing a code records a manual payment (needs no Daraja, works
//     offline); Prompt sends an STK Push and, once Safaricom confirms, the
//     real code fills the same field. See components/MpesaPayPanel.jsx.
//   - Phones get a two-step flow (Items -> Sale) with a sticky checkout
//     bar instead of two half-height scrolling panes.
//   - Payment methods follow Settings -> "Payment methods accepted".
//   - The catalogue is no longer capped at the first 50 items: it loads
//     up to 500 and searches the server as you type.
//   - Forest / Emerald / Gold styling, 44px+ touch targets.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { createOfflineAwareSale, findQueuedMpesaCode } from '../offline/offlineSaleService';
import { nextLocalId } from '../offline/idGenerator';
import { cacheProducts, cacheValue, readCachedValue } from '../offline/offlineCache';
import { isNetworkFailure } from '../offline/netErrors';
// Stage 2 (M-Pesa STK) -- see AUDIT.md Phase 12 and the stage-order note
// there. Kept to its own hook/modal so the existing CASH/CARD/CREDIT
// checkout path above (completeSale) is completely unchanged.
import { useMpesaPayment, mpesaInflight } from '../hooks/useMpesaPayment';
// Phase 14 -- the sale receipt itself: print / WhatsApp / email.
import ReceiptModal from '../components/ReceiptModal';
import { receiptService } from '../services/receiptService';
import { settingsService } from '../services/settingsService';
import { folioService } from '../services/folioService';
import { appointmentService } from '../services/salonService';
import { useProviders } from '../hooks/useSalon';
import { printDocument } from '../utils/printDocument';
import { buildFolioDocumentHtml } from '../utils/folioDocument';
import { kes } from '../components/workspace/WorkspaceKit';
import { useCapabilities } from '../navigation/CapabilitiesContext';
import { Image as ImageIcon, Camera, Search, ArrowLeft, Minus, Plus, Loader2, ShoppingCart } from 'lucide-react';
import MpesaPayPanel from '../components/MpesaPayPanel';
import { mpesaService } from '../services/mpesaService';
import { normalizeMpesaCode, isValidMpesaCode, isWholeShillings } from '../utils/mpesa';
import { singleFlight } from '../utils/singleFlight';
import { resolveEnabledMethods } from '../utils/paymentMethods';

const VARIABLE_MODES = ['WEIGHT', 'VOLUME', 'CUSTOM'];

// Owner-facing names. The stored value stays MOBILE_MONEY (that is what
// lb_payments and every report already use) -- only the label changes.
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
    // Online: fetch and remember a copy. No internet: use the copy from the last online session, so offline receipts
    // still carry the business name/logo and the payment methods the owner chose.
    const bKey = `business:${tenant.business_id}`;
    const sKey = `posSettings:${tenant.business_id}`;
    settingsService.getBusinessProfile(tenant.business_id)
      .then((b) => { setBusiness(b); cacheValue(bKey, b); })
      .catch(() => { readCachedValue(bKey).then((b) => { if (b) setBusiness(b); }); });
    settingsService.getPosSettings(tenant.business_id)
      .then((v) => { setPosSettings(v); cacheValue(sKey, v); })
      .catch(() => { readCachedValue(sKey).then((v) => { if (v) setPosSettings(v); }); });
  }, [tenant?.business_id]);
  const [mpesaPhone, setMpesaPhone] = useState('');

  // ---- M-Pesa as a payment method ----
  const [mpesaCode, setMpesaCode] = useState(''); // typed by the cashier, or filled from the trusted confirmation
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
  // Availability of M-Pesa as a payment method does NOT depend on any of this: only the Prompt button does
  // (see mpesaPanelState in utils/mpesa.js). A missing/failed config lookup just means "no prompts".

  // Payment methods follow Settings (default: all four).
  const enabledMethods = resolveEnabledMethods(posSettings?.settings?.payment_methods_enabled);

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
  // Phase 19 (folios). Only present when the business has switched on "Customer Folios"; otherwise
  // none of this renders and the till behaves exactly as before.
  const { enabled: enabledCaps } = useCapabilities();
  const foliosOn = enabledCaps.includes('folios');
  // Phase 54 (salon). The Sell page is the ONE place money is taken. Two hand-offs arrive here:
  //   ?appointment=<id>  a booking being completed: its service goes in the cart for its customer, with the optional provider
  //   ?folio=<id>        a customer's running bill being settled: the balance is the amount to pay, paid like any sale
  const salonOn = enabledCaps.includes('salon');
  const { providers } = useProviders(salonOn);
  const [searchParams, setSearchParams] = useSearchParams();
  const apptParam = searchParams.get('appointment');
  const folioParam = searchParams.get('folio');
  const [folioSettle, setFolioSettle] = useState(null); // the folio being settled on this page, or null
  const [folioDone, setFolioDone] = useState(null);     // the settled folio, for the receipt/invoice prompt
  const [openFolio, setOpenFolio] = useState(null);      // the selected customer's open folio, if any
  const [chargeToFolio, setChargeToFolio] = useState(false);
  const [folioChecked, setFolioChecked] = useState(false); // have we looked yet (so we don't flash "no folio")
  const folioMode = foliosOn && chargeToFolio && !!selectedCustomerId;
  useEffect(() => {
    setChargeToFolio(false); setOpenFolio(null); setFolioChecked(false);
    if (!foliosOn || !selectedCustomerId) return undefined;
    let alive = true;
    folioService.getOpenForCustomer(selectedCustomerId)
      .then((f) => { if (alive) { setOpenFolio(f); setFolioChecked(true); } })
      .catch(() => { if (alive) setFolioChecked(true); });
    return () => { alive = false; };
  }, [selectedCustomerId, foliosOn]);
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
    if (folioSettle) { setStockWarning('A folio is being settled. Finish or cancel it before adding items.'); return; }
    setStockWarning('');
    setCart(prevCart => {
      const existing = prevCart.find(i => i.product_id === product.id && !i.appointment_id);
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
          i === existing
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
        is_service: product.track_inventory === false, // phase54: a service line can name who served it
        employee_id: null,
      }];
    });
  }, [folioSettle]);

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

  // A booking line is keyed by its appointment (so two bookings of the same service stay separate lines).
  const lineKey = (i) => i.line_id || i.product_id;
  const setLineProvider = (id, employeeId) => setCart(cart.map(i => (lineKey(i) === id ? { ...i, employee_id: employeeId || null } : i)));

  const updateQty = (id, qty) => {
    if (qty <= 0) { setCart(cart.filter(i => lineKey(i) !== id)); return; }
    setCart(cart.map(i => {
      if (lineKey(i) !== id) return i;
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
      if (lineKey(i) !== id) return i;
      const lineSubtotal = i.quantity * i.unit_price;
      const clamped = Math.max(0, Math.min(discountAmount, lineSubtotal));
      return { ...i, discount_amount: clamped, total: lineSubtotal - clamped };
    }));
  };

  // Settling a folio: the amount to pay is the folio's balance, and everything below (cash, split, M-Pesa prompt) works on `total`.
  const subtotal = folioSettle ? Number(folioSettle.balance_due) : cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const discountTotal = folioSettle ? 0 : cart.reduce((s, i) => s + (i.discount_amount || 0), 0);
  const total = subtotal - discountTotal;
  const hasItems = folioSettle ? total > 0 : cart.length > 0;
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

  // Stage 2 -- the Prompt button (STK Push). Deliberately separate from
  // completeSale(): a sale for an STK payment isn't created by this page at
  // all -- confirm_mpesa_payment() creates it server-side, only once
  // Safaricom confirms (section 37). This only sends the request; the panel
  // shows "waiting", and the code field fills itself on confirmation.
  const customerPhone = customers.find(c => c.id === selectedCustomerId)?.phone || '';
  const promptPhoneValue = mpesaPhone || customerPhone;
  const handlePrompt = async () => {
    if (!activeShift) { alert('Open a shift first'); return; }
    if (!hasItems) return;
    setSaleError('');
    if (!promptPhoneValue) { setSaleError('Enter the buyer\'s M-Pesa phone number.'); return; }
    // STK Push charges whole shillings only (the Edge Function rounds), so
    // a total with cents would charge a different amount than the sale
    // records. Say so up front instead of creating that mismatch.
    if (!isWholeShillings(total)) {
      setSaleError(`M-Pesa prompts work in whole shillings and this sale is KES ${total.toLocaleString()}. Adjust a discount to a whole amount, or enter the M-Pesa code instead.`);
      return;
    }
    if (!isOnline) { setSaleError('Prompts need internet. Enter the M-Pesa code instead.'); return; }

    // A folio is paid by the prompt without a cart: the server reads the balance itself and settles the folio on confirmation.
    const cartSnapshot = folioSettle ? null : cart.map(i => ({
      product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price,
      cost_price: i.cost_price, discount_amount: i.discount_amount || 0, selling_mode: i.selling_mode,
      employee_id: i.employee_id || null, appointment_id: i.appointment_id || null,
    }));
    try {
      await mpesa.send({
        phone: promptPhoneValue, amount: total, cartSnapshot, folioId: folioSettle?.id || null, customerId: selectedCustomerId || null, shiftId: activeShift.id,
        // Kept on this device while the buyer answers, so a refresh / app restart does not lose the sale.
        resumeState: folioSettle
          ? { folioId: folioSettle.id, customerId: selectedCustomerId || '', phone: promptPhoneValue, total }
          : { cart, customerId: selectedCustomerId || '', phone: promptPhoneValue, total },
      });
    } catch (err) {
      setSaleError(err.message || 'Failed to send the M-Pesa request.');
    }
  };

  // Trusted confirmation arrived -> the REAL M-Pesa receipt code appears in the same field. Only ever the code
  // Safaricom's callback supplied (never a request id or sale number); if it carried none, the field stays empty.
  useEffect(() => {
    if (mpesa.confirmedCode) setMpesaCode(normalizeMpesaCode(mpesa.confirmedCode));
  }, [mpesa.confirmedCode]);

  // ---- Auto-reconcile ----
  // The sale itself is created by the server the moment Safaricom confirms (confirm_mpesa_payment builds it from the
  // cart that was sent with the prompt). So when the till hears "paid" there is nothing left for the cashier to
  // re-select or re-submit: clear the till, show the receipt, done. Never calls completeSale() (that would record the
  // sale twice).
  const [paidNotice, setPaidNotice] = useState('');
  const finishedTxnRef = useRef(null);
  useEffect(() => {
    const txn = mpesa.transaction;
    if (mpesa.phase !== 'paid' || !txn?.id || finishedTxnRef.current === txn.id) return undefined;
    finishedTxnRef.current = txn.id;
    let alive = true;
    (async () => {
      // A folio paid by prompt: the server settled it. Show the bill's invoice/receipt prompt, not a till receipt.
      if (txn.folio_id) {
        let fresh = null;
        try { fresh = await folioService.getById(txn.folio_id); } catch { /* the settlement is recorded either way */ }
        if (!alive) return;
        setFolioSettle(null); setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId(''); setMpesaPhone('');
        setMpesaCode(''); setMobileView('items');
        if (fresh) setFolioDone(fresh);
        else setPaidNotice(`M-Pesa payment of KES ${Number(txn.amount).toLocaleString()} confirmed${txn.mpesa_receipt_number ? ` (${txn.mpesa_receipt_number})` : ''}. The folio is settled; print its receipt from Customer Folios.`);
        mpesa.reset();
        return;
      }
      // The receipt is written a moment after the status flips, so look a few times before giving up.
      let receipt = null;
      for (let i = 0; i < 4 && !receipt && txn.sale_id; i += 1) {
        try { receipt = await receiptService.getBySaleId(txn.sale_id); } catch { /* try again */ }
        if (!receipt && i < 3) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!alive) return;
      const customer = customers.find(c => c.id === txn.customer_id) || null;
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId(''); setMpesaPhone('');
      setMpesaCode(''); setMobileView('items');
      if (receipt) setReceiptModal({ receipt, customer, isOffline: false });
      else setPaidNotice(`M-Pesa payment of KES ${Number(txn.amount).toLocaleString()} confirmed${txn.mpesa_receipt_number ? ` (${txn.mpesa_receipt_number})` : ''}. The sale is recorded; the receipt is under Sales.`);
      mpesa.reset();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpesa.phase, mpesa.transaction?.id]);

  // ---- Pick up after a refresh / app restart ----
  // The cart and the request id were saved on this device when the prompt was sent (see useMpesaPayment).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !tenant?.id) return;
    resumedRef.current = true;
    mpesa.resume().then(({ state, saved }) => {
      if (state === 'none' || !saved) return;
      if (state === 'paid') return; // the auto-reconcile effect above shows the receipt and clears the till
      // Only pick the sale back up while the buyer may still be paying (or it failed moments ago).
      // Anything older starts the till clean: no old cart, no old phone number, no old error.
      const ageMs = Date.now() - (saved.savedAt || 0);
      if (state === 'failed' && ageMs > 3 * 60 * 1000) { mpesaInflight.clear(tenant?.id); mpesa.reset(); return; }
      if (saved.folioId) {
        folioService.getById(saved.folioId).then((f) => { if (f.status === 'OPEN') setFolioSettle(f); }).catch(() => {});
      }
      if (Array.isArray(saved.cart) && saved.cart.length) setCart(saved.cart);
      setSelectedCustomerId(saved.customerId || '');
      setMpesaPhone(saved.phone || '');
      setPaymentMethod('MOBILE_MONEY');
      setMobileView('sale');
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const mpesaBusy = mpesa.phase === 'sending' || mpesa.phase === 'pending';
  const mpesaPaid = mpesa.phase === 'paid';
  // While a prompt is live (or just confirmed) the cart, customer and method must not change underneath it: the
  // sale Safaricom's confirmation creates is the cart as it was when the prompt was sent.
  const mpesaLocked = mpesaBusy || mpesaPaid;

  // Paid is handled automatically above; this only stays as the button's action for the split second before it does.
  const finishMpesaSale = () => {};

  const selectPaymentMethod = (m) => {
    if (mpesaLocked) return;
    // Leaving M-Pesa after a failed/unanswered prompt starts clean. (A late confirmation for an abandoned prompt is
    // still recorded by the server and appears on the M-Pesa page under "Needs attention" -- it is never lost.)
    if (m !== 'MOBILE_MONEY' && mpesa.phase === 'failed') mpesa.reset();
    setPaymentMethod(m); setSaleError('');
  };

  // Stops one M-Pesa SMS being used to "pay" for two sales. Online only:
  // offline the code can't be looked up, so it is saved as typed and the
  // owner can review it on the M-Pesa page once it syncs. A failed lookup
  // never blocks a real sale.
  const codeAlreadyUsed = async (code) => {
    // Same phone, still waiting to be sent: catches the same SMS code typed on two offline sales (works with no internet).
    try {
      if (await findQueuedMpesaCode(code, tenant?.id)) {
        setSaleError(`M-Pesa code ${code} was already used on a sale saved on this phone. Check the buyer's SMS.`);
        return true;
      }
    } catch (err) { console.error('[POS] queued M-Pesa code check failed (sale not blocked):', err); }
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

  // ---- Hand-offs from Appointments / Customer Folios (phase54) ----
  const handoffRef = useRef({ appt: null, folio: null });
  const clearParam = (key) => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete(key); return n; }, { replace: true });
  useEffect(() => {
    if (!apptParam || handoffRef.current.appt === apptParam) return;
    handoffRef.current.appt = apptParam;
    (async () => {
      try {
        const a = await appointmentService.getById(apptParam);
        if (!['SCHEDULED', 'CONFIRMED'].includes(a.status)) { setSaleError(`That appointment is already ${String(a.status).toLowerCase().replace('_', ' ')}.`); return; }
        const price = Number(a.service?.selling_price) || 0;
        setFolioSettle(null);
        setCart((prev) => (prev.some((i) => i.appointment_id === a.id) ? prev : [...prev, {
          line_id: `appt:${a.id}`, appointment_id: a.id, product_id: a.product_id, name: a.service?.name || 'Service',
          quantity: 1, unit_price: price, cost_price: 0, selling_mode: 'PER_UNIT', weight_value: null,
          discount_amount: 0, total: price, is_service: true, employee_id: a.employee_id || null,
        }]));
        setSelectedCustomerId(a.customer_id || '');
        setMobileView('sale');
      } catch (err) { setSaleError(err.message || 'Could not load that appointment.'); }
      finally { clearParam('appointment'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptParam]);
  useEffect(() => {
    if (!folioParam || handoffRef.current.folio === folioParam) return;
    handoffRef.current.folio = folioParam;
    (async () => {
      try {
        const f = await folioService.getById(folioParam);
        if (f.status !== 'OPEN') { setSaleError(`That folio is already ${String(f.status).toLowerCase()}.`); return; }
        if (!(Number(f.balance_due) > 0)) { setSaleError('That folio has nothing to pay.'); return; }
        setCart([]); setSplitMode(false); setSplitPayments([]); setCustomerAmount(''); setMpesaCode('');
        setPaymentMethod((m) => (m === 'CREDIT' ? 'CASH' : m));
        setFolioSettle(f);
        setSelectedCustomerId(f.customer_id || '');
        setMobileView('sale');
      } catch (err) { setSaleError(err.message || 'Could not load that folio.'); }
      finally { clearParam('folio'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioParam]);

  const checkoutRef = useRef(null); // { sig, ref }: idempotency key for the checkout in progress
  const completeSale = singleFlight('POSPage.completeSale', async () => {
    if (!activeShift) { alert('Open a shift first'); return; }
    if (!hasItems) return;
    setSaleError('');

    let payments;
    let folioId = null;
    if (folioMode) {
      // Charge to folio: nothing is paid now; the amount goes on the customer's bill and is settled later.
      if (openFolio) {
        folioId = openFolio.id;
      } else {
        // First charge for this customer: open their folio. Needs the server (it is not created offline).
        if (!isOnline) { setSaleError('Open this customer\'s folio while you have a connection, then charge to it.'); return; }
        try {
          folioId = await folioService.open({ businessId: tenant?.business_id, customerId: selectedCustomerId, createdBy: staffId });
        } catch (err) { setSaleError(err.message || 'Could not open a folio for this customer.'); return; }
      }
      payments = [];
    } else if (splitMode) {
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

    // Phase 54: settling a customer's folio. Same payment choices as a sale; the money is recorded on the folio
    // (settle_folio) and the folio closes with its invoice and receipt. Needs a connection.
    if (folioSettle) {
      if (!isOnline) { setSaleError('Settling a folio needs internet. Try again when you are back online.'); return; }
      try {
        await folioService.settle({
          folioId: folioSettle.id, settledBy: staffId, shiftId: activeShift.id, tenantId: tenant?.id,
          payments: payments.map((p) => ({ payment_method: p.payment_method, amount: p.amount, reference_no: p.reference_no || null })),
        });
        const fresh = await folioService.getById(folioSettle.id);
        setFolioSettle(null); setFolioDone(fresh);
        setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId('');
        setSplitPayments([]); setSplitMode(false); setMpesaCode(''); setMobileView('items');
        setMpesaPhone(''); if (mpesa.phase !== 'idle') mpesa.reset();
      } catch (err) {
        if (err?.code === '23505' || /uq_lb_payments_mpesa_ref|M-PESA_CODE_USED/i.test(String(err?.message || ''))) setSaleError('That M-Pesa code was just used on another payment. Check the buyer\'s SMS.');
        else setSaleError(err.message || 'Could not settle the folio.');
      }
      return;
    }

    // shift_id is required — without it, closing this shift can never
    // find these sales when computing expected_cash (see conversation:
    // cashierService.js's closeShift filters lb_sales by shift_id).
    const sale = {
      shift_id: activeShift.id,
      customer_id: selectedCustomerId || null, // guaranteed non-empty for CREDIT by the checks above
      folio_id: folioId, // phase19: null for every ordinary sale
      items: cart.map(i => ({
        product_id: i.product_id,
        name: i.name, // Phase 14: captured onto the receipt snapshot at sale time
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price,
        selling_mode: i.selling_mode,
        weight_value: i.weight_value,
        discount_amount: i.discount_amount || 0,
        employee_id: i.employee_id || null,       // phase54: optional provider -> commission to payroll
        appointment_id: i.appointment_id || null, // phase54: the booking this line completes
      })),
      payments,
    };

    try {
      // Stage 1B: goes through saleService.create() when online (identical
      // to before this change) or the offline queue when it isn't. See
      // offlineSaleService.js's header for the three possible outcomes.
      // One key per distinct checkout. A retry of the SAME cart/payment (after an error or a lost reply)
      // reuses it, so the server can tell it is the same sale and not post it twice.
      const sig = JSON.stringify([sale.items, sale.payments, sale.customer_id, sale.folio_id, sale.shift_id]);
      if (checkoutRef.current?.sig !== sig) checkoutRef.current = { sig, ref: await nextLocalId('SALE') };
      const fullSale = { ...sale, client_reference: checkoutRef.current.ref, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, cashier_id: staffId };
      const result = await createOfflineAwareSale(fullSale, { isOnline });
      checkoutRef.current = null; // sale is recorded: the next checkout gets a new key
      const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || null;
      setCart([]); setCustomerAmount(''); setSearch(''); setSelectedCustomerId('');
      setSplitPayments([]); setSplitMode(false); setMpesaCode(''); setMobileView('items');
      setChargeToFolio(false); setOpenFolio(null);
      // This sale is finished: forget any earlier prompt that did not go through, so a refresh cannot bring its cart back.
      setMpesaPhone(''); if (mpesa.phase !== 'idle') mpesa.reset();
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
              ...(sale.folio_id ? { charged_to_folio: true } : {}),
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
      // Another till recorded the same M-Pesa code a moment ago: the database's unique rule refused it.
      if (err?.code === '23505' || /uq_lb_payments_mpesa_ref|M-PESA_CODE_USED/i.test(String(err?.message || ''))) {
        setSaleError('That M-Pesa code was just used on another sale. Check the buyer\'s SMS.');
      } else {
        setSaleError(err.message || 'Failed to complete sale.');
      }
    }
  });

  const submitCloseShift = singleFlight('POSPage.submitCloseShift', async (e) => {
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
      setCloseError(isNetworkFailure(err)
        ? 'Closing a shift needs internet, so the cash total is worked out from every sale. You can keep selling; close the shift when you are back online.'
        : (err.message || 'Failed to close shift.'));
    } finally {
      setClosing(false);
    }
  });

  const cartCount = cart.reduce((n, i) => n + (VARIABLE_MODES.includes(i.selling_mode) ? 1 : i.quantity), 0);
  const isMpesaSingle = !folioMode && !splitMode && paymentMethod === 'MOBILE_MONEY';
  const creditPicked = splitMode ? splitPayments.some(p => p.method === 'CREDIT') : paymentMethod === 'CREDIT';
  const canSubmit = hasItems
    && !mpesaBusy
    && !(!folioMode && splitMode && Math.abs(splitRemaining) > 0.01)
    && !(isMpesaSingle && !mpesaPaid && !isValidMpesaCode(mpesaCode));
  const submitLabel = mpesaPaid ? 'Done · view receipt'
    : folioSettle ? `Settle folio · KES ${total.toLocaleString()}`
    : folioMode ? `Charge to folio · KES ${total.toLocaleString()}` : `Complete sale · KES ${total.toLocaleString()}`;
  // A folio cannot be settled on credit (settle_folio refuses it), so the choice is not offered while settling one.
  const payMethods = folioSettle ? enabledMethods.filter(m => m !== 'CREDIT') : enabledMethods;

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
          <div className={`grid grid-cols-2 lg:grid-cols-3 gap-2 ${mpesaLocked ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={mpesaLocked}>
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
            <h3 className="font-bold text-[#26352D]">{folioSettle ? 'Settle folio' : `Current sale${cart.length > 0 ? ` (${cartCount})` : ''}`}</h3>
            {folioSettle && <button disabled={mpesaLocked} onClick={() => { setFolioSettle(null); setSelectedCustomerId(''); setMobileView('items'); setMpesaPhone(''); setMpesaCode(''); if (mpesa.phase === 'failed') mpesa.reset(); }} className="ml-auto text-xs text-red-500 font-semibold min-h-[32px] disabled:opacity-40">Cancel</button>}
            {!folioSettle && cart.length > 0 && <button disabled={mpesaLocked} onClick={() => { setCart([]); setMobileView('items'); setMpesaPhone(''); if (mpesa.phase === 'failed') mpesa.reset(); }} className="ml-auto text-xs font-semibold text-[#68756D] hover:text-red-600 min-h-[36px] px-2">Clear</button>}
          </div>

          <div className={`flex-1 ${mpesaLocked ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={mpesaLocked}>
            {folioSettle && (
              <div className="pb-2">
                <div className="text-sm text-[#68756D] mb-1">{folioSettle.customer?.name} · {folioSettle.title ? `${folioSettle.title} · ` : ''}{folioSettle.folio_number}</div>
                {folioService.sections(folioSettle.lines).map((g) => (
                  <div key={g.key} className="mt-2">
                    <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-[#68756D]"><span>{g.label}</span><span className="tabular-nums">{kes(g.subtotal)}</span></div>
                    {!g.isPackage && g.lines.map((l) => (
                      <div key={l.id} className="flex justify-between gap-2 text-sm py-1 border-b border-[#DDE3DD]">
                        <span className="min-w-0 truncate">{l.shown}{Number(l.quantity) !== 1 ? ` × ${Number(l.quantity).toLocaleString()}` : ''}</span>
                        <span className="tabular-nums shrink-0">{kes(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {(folioSettle.payments || []).length > 0 && (
                  <div className="flex justify-between text-sm text-[#68756D] mt-2"><span>Already paid</span><span className="tabular-nums">-{kes(folioSettle.total_paid)}</span></div>
                )}
                <p className="text-xs text-[#68756D] mt-2">Pay the balance below, any way you would take a sale. The folio then closes with its invoice and receipt.</p>
              </div>
            )}
            {!folioSettle && cart.map(item => (
              <div key={lineKey(item)} className="py-2.5 border-b border-[#DDE3DD]">
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-sm text-[#68756D]">{item.unit_price?.toLocaleString()} × {item.quantity}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => updateQty(lineKey(item), item.quantity - 1)} className="w-9 h-9 bg-[#F7F6F0] border border-[#DDE3DD] rounded-lg flex items-center justify-center" aria-label="Less"><Minus size={16} /></button>
                    <span className="w-7 text-center font-semibold">{item.quantity}</span>
                    <button onClick={() => updateQty(lineKey(item), item.quantity + 1)} className="w-9 h-9 bg-[#F7F6F0] border border-[#DDE3DD] rounded-lg flex items-center justify-center" aria-label="More"><Plus size={16} /></button>
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
                    onChange={e => updateDiscount(lineKey(item), parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-24 border border-[#DDE3DD] rounded-lg px-2 py-1.5 text-sm text-right"
                  />
                </div>
                {/* Phase 54: who served this service. Optional; when set, their commission goes to payroll. */}
                {item.is_service && providers.length > 0 && (
                  <div className="flex justify-end items-center gap-2 mt-1.5">
                    <span className="text-xs text-[#68756D]">Served by</span>
                    <select value={item.employee_id || ''} onChange={e => setLineProvider(lineKey(item), e.target.value)}
                      className="w-40 min-w-0 border border-[#DDE3DD] rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="">Anyone</option>
                      {providers.map(pv => <option key={pv.id} value={pv.id}>{pv.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
            {!folioSettle && cart.length === 0 && (
              <div className="text-[#68756D] text-center py-10 text-sm">
                No items yet.
                <button onClick={() => setMobileView('items')} className="md:hidden block mx-auto mt-3 text-[#237A52] font-semibold underline min-h-[44px]">Add items</button>
              </div>
            )}
          </div>

          <div className="border-t border-[#DDE3DD] pt-4 mt-4">
            <div className="flex justify-between mb-1.5"><span className="text-[#68756D]">{folioSettle ? 'Balance due' : 'Subtotal'}</span><span className="font-semibold">{subtotal.toLocaleString()}</span></div>
            {discountTotal > 0 && (
              <div className="flex justify-between mb-1.5 text-[#237A52]"><span>Discount</span><span className="font-semibold">-{discountTotal.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-xl mb-4"><span className="font-semibold">Total</span><span className="font-bold text-[#237A52]">KES {total.toLocaleString()}</span></div>

            {/* Customer picker. Required for CREDIT (enforced here and by
                the DB trigger); optional otherwise. */}
            <div className="mb-3">
              <select
                value={selectedCustomerId} disabled={mpesaLocked || !!folioSettle}
                onChange={e => setSelectedCustomerId(e.target.value)}
                className={`w-full border rounded-xl px-3 min-h-[48px] text-sm bg-white ${creditPicked && !selectedCustomerId ? 'border-red-400' : 'border-[#DDE3DD]'}`}
              >
                <option value="">{creditPicked ? 'Select customer (required)' : 'Customer (optional)'}</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>

            {/* Phase 19: pay now, or put it on the customer's folio. Only when Customer Folios is switched on. */}
            {foliosOn && selectedCustomerId && !folioSettle && (
              <div className="mb-3">
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="When is this paid?">
                  {[[false, 'Pay now'], [true, 'Charge to folio']].map(([val, label]) => (
                    <button
                      key={label} type="button" onClick={() => { setChargeToFolio(val); setSaleError(''); }}
                      aria-pressed={chargeToFolio === val}
                      className={`min-h-[48px] rounded-xl text-sm font-semibold border transition-colors ${chargeToFolio === val ? 'bg-[#1B5138] text-white border-[#1B5138]' : 'bg-white text-[#26352D] border-[#DDE3DD] hover:bg-[#F7F6F0]'}`}
                    >{label}</button>
                  ))}
                </div>
                {chargeToFolio && (
                  <p className="text-xs text-[#68756D] mt-1.5">
                    {!folioChecked ? 'Checking for an open folio…'
                      : openFolio ? `Goes on ${openFolio.title || 'their folio'} (${openFolio.folio_number}). Paid when the folio is settled.`
                      : isOnline ? 'This customer has no open folio yet. One will be opened for this charge.'
                      : 'No open folio on this device. Reconnect to open one.'}
                  </p>
                )}
              </div>
            )}

            {!folioMode && (<>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#68756D] uppercase">How is the buyer paying?</span>
              <button
                onClick={() => { setSplitMode(!splitMode); setSplitPayments([]); setSaleError(''); }}
                disabled={mpesaLocked}
                className={`disabled:opacity-60 text-xs font-semibold px-2.5 min-h-[32px] rounded-lg ${splitMode ? 'bg-[#237A52] text-white' : 'bg-[#F7F6F0] border border-[#DDE3DD] text-[#26352D]'}`}
              >
                {splitMode ? 'Split payment: on' : 'Split payment'}
              </button>
            </div>

            {!splitMode ? (
              <div className={`grid gap-2 mb-3 ${payMethods.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {payMethods.map(m => (
                  <button
                    key={m}
                    onClick={() => selectPaymentMethod(m)}
                    aria-pressed={paymentMethod === m} disabled={mpesaLocked}
                    className={`min-h-[48px] rounded-xl text-sm font-semibold border transition-colors disabled:opacity-60 ${
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
                        {payMethods.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
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

            </>)}

            {/* M-Pesa: ONE section -- code field + Prompt + a status line. Always available when M-Pesa is
                accepted; only Prompt depends on Daraja. */}
            {isMpesaSingle && (
              <MpesaPayPanel
                code={mpesaCode} onCodeChange={setMpesaCode}
                phone={promptPhoneValue} onPhoneChange={setMpesaPhone} phoneFromCustomer={!mpesaPhone && !!customerPhone}
                total={total} isOnline={isOnline} config={mpesaConfig} businessId={tenant?.business_id}
                phase={mpesa.phase} txStatus={mpesa.transaction?.status} error={mpesa.error}
                connectionIssue={mpesa.connectionIssue} onCheck={mpesa.refresh}
                onPrompt={handlePrompt}
              />
            )}

            {!folioMode && !splitMode && paymentMethod === 'CASH' && (
              <div className="flex gap-2 mb-3">
                <input type="number" inputMode="decimal" placeholder="Amount received" value={customerAmount} onChange={e => setCustomerAmount(e.target.value)} className="border border-[#DDE3DD] rounded-xl px-3 min-h-[48px] flex-1 min-w-0" />
                <div className="px-3 min-h-[48px] flex items-center bg-[#237A52]/10 text-[#1B5138] font-semibold rounded-xl shrink-0 whitespace-nowrap">Change: {change >= 0 ? change.toLocaleString() : '-'}</div>
              </div>
            )}

            {paidNotice && (
              <div className="bg-[#237A52]/10 text-[#1B5138] text-sm rounded-lg px-3 py-2 mb-3 flex items-start justify-between gap-2">
                <span>{paidNotice}</span>
                <button type="button" onClick={() => setPaidNotice('')} className="shrink-0 font-semibold underline">OK</button>
              </div>
            )}

            {saleError && (
              <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{saleError}</div>
            )}

            {/* Sticky so the action is always reachable on a phone. */}
            <div className="sticky bottom-0 -mx-3 md:-mx-4 px-3 md:px-4 pt-2 pb-2 bg-white border-t border-[#DDE3DD]">
              <button
                onClick={mpesaPaid ? finishMpesaSale : completeSale}
                disabled={!canSubmit}
                className="w-full min-h-[52px] bg-[#237A52] hover:bg-[#1B5138] text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Phase 14 -- the sale receipt (print/WhatsApp/email). Mounted
          last so it renders on top of everything else, including the
          M-Pesa modal it can appear right after. */}
      {folioDone && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg text-[#26352D]">Folio settled</h3>
            <p className="text-sm text-[#68756D]">{folioDone.customer?.name} · {kes(folioDone.total_charges)} paid. Invoice {folioDone.invoice_number} · Receipt {folioDone.receipt_number}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { try { printDocument(`Invoice ${folioDone.customer?.name || ''}`, buildFolioDocumentHtml(folioDone, 'invoice')); } catch (e) { setSaleError(e.message); } }} className="min-h-[48px] rounded-xl border border-[#DDE3DD] text-sm font-semibold">Print invoice</button>
              <button onClick={() => { try { printDocument(`Receipt ${folioDone.customer?.name || ''}`, buildFolioDocumentHtml(folioDone, 'receipt')); } catch (e) { setSaleError(e.message); } }} className="min-h-[48px] rounded-xl bg-[#237A52] text-white text-sm font-bold">Print receipt</button>
            </div>
            <button onClick={() => setFolioDone(null)} className="w-full min-h-[44px] rounded-xl bg-[#F7F6F0] text-[#26352D] text-sm font-semibold">Done</button>
          </div>
        </div>
      )}
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
