import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePurchaseOrders, useGoodsReceived } from '../hooks/usePurchases';
import { useSuppliers } from '../hooks/useSuppliers';
import { useProducts } from '../hooks/useProducts';
import { ScannerModal, useBarcodeScanner, SCAN_RESULTS } from '../index';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';
import { Truck, ScanLine, Search, Trash2, ListPlus, PackageCheck, Loader2 } from 'lucide-react';
import { FitPage, MiniStats, Pill, IconBtn, Notice, EmptyBlock, inputCls, saveBtnCls } from '../components/CardKit';
import Sheet from '../components/workspace/Sheet';

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
  const { staffId, tenant } = usePosErpAuth();

  const { suppliers, fetch: refetchSuppliers } = useSuppliers();
  const { products } = useProducts();
  // No-arg call: `{ status: undefined }` was a brand-new object on every
  // render, which can make the hook's fetch effect re-run forever (the
  // endless spinner). We filter to receivable POs below anyway.
  const { orders: purchaseOrders, loading: poLoading } = usePurchaseOrders();
  const { createFromPO, createQuickReceipt } = useGoodsReceived();

  const [mode, setMode] = useState('PO'); // 'PO' | 'QUICK'
  const [selectedPOId, setSelectedPOId] = useState('');
  const [quickSupplierId, setQuickSupplierId] = useState('');
  const [referenceInvoice, setReferenceInvoice] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState(''); // what the supplier's invoice says, for the three-way match
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

  // How this purchase is being paid for. Deliberately starts EMPTY (not
  // defaulted to cash) so a cashier can't silently record a payment that
  // never happened — they must pick one before POST GRN enables.
  //   CASH    = paid in full now      CREDIT  = pay the supplier later
  //   PARTIAL = part now, rest owed
  const [paymentType, setPaymentType] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const selectedPO = useMemo(
    () => purchaseOrders.find(po => po.id === selectedPOId) || null,
    [purchaseOrders, selectedPOId]
  );

  const receivablePOs = useMemo(
    // FIX: was ['SENT', 'PARTIALLY_RECEIVED'] — SENT isn't a real
    // lb_po_status value (see PurchaseOrdersPage.jsx's header note), so
    // a PO could never legally reach a status this filter would match,
    // and this dropdown was always empty. APPROVED is the real
    // pre-receiving ready state.
    () => purchaseOrders.filter(po => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)),
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

  // Fills the GRN from the selected PO: one line per item still
  // outstanding, pre-set to the remaining quantity. Cashier then only
  // edits what actually arrived.
  const loadPOItems = () => {
    if (!selectedPO?.items?.length) return;
    const newLines = selectedPO.items
      .filter(it => remainingOnPO(it) > 0)
      .map(it => {
        const prod = products.find(p => p.id === it.product_id);
        return {
          product_id: it.product_id,
          purchase_order_item_id: it.id,
          name: it.product?.name || prod?.name || 'Item',
          sku: it.product?.sku || prod?.sku,
          unit_id: it.unit_id || prod?.unit_id,
          unit_cost: it.unit_cost ?? prod?.cost_price ?? 0,
          quantity_received: remainingOnPO(it),
          notOnPO: false,
          ...emptyLineDefaults,
        };
      });
    setLines(newLines);
    setOverReceiveWarning('');
  };

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
    tenantId: tenant?.id,
    businessId: tenant?.business_id,
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

  const submitQuickCreate = singleFlight('GoodsReceivingPage.submitQuickCreate', async (e) => {
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
  });

  const grnTotal = lines.reduce((sum, l) => sum + (Number(l.quantity_received) || 0) * (Number(l.unit_cost) || 0), 0);
  const partialAmount = Number(amountPaid) || 0;
  const paidNow = paymentType === 'CASH' ? grnTotal : paymentType === 'PARTIAL' ? Math.min(partialAmount, grnTotal) : 0;
  const owedToSupplier = grnTotal - paidNow;

  const activeSupplierId = mode === 'PO' ? selectedPO?.supplier_id : quickSupplierId;
  const activeSupplier = suppliers.find(s => s.id === activeSupplierId) || null;
  const projectedBalance = Number(activeSupplier?.outstanding_balance || 0) + owedToSupplier;
  const overCreditLimit = !!activeSupplier && Number(activeSupplier.credit_limit) > 0 && projectedBalance > Number(activeSupplier.credit_limit);

  const paymentValid =
    paymentType === 'CASH' || paymentType === 'CREDIT' ||
    (paymentType === 'PARTIAL' && partialAmount > 0 && partialAmount < grnTotal);

  const canPost = lines.length > 0 && lines.every(l => l.quantity_received > 0 && l.unit_cost >= 0) &&
    (mode === 'PO' ? !!selectedPOId : !!quickSupplierId) && paymentValid;

  const postGRN = singleFlight('GoodsReceivingPage.postGRN', async () => {
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

      const payment = {
        type: paymentType,
        amount_paid: paymentType === 'PARTIAL' ? partialAmount : undefined,
        method: paymentType === 'CREDIT' ? null : paymentMethod,
        reference_no: paymentType === 'CREDIT' ? null : (paymentRef || null),
      };

      let grn;
      if (mode === 'PO') {
        grn = await createFromPO(selectedPOId, {
          invoice_no: referenceInvoice || null,
          supplier_invoice_amount: invoiceAmount === '' ? null : Number(invoiceAmount),
          items,
          payment,
        });
      } else {
        grn = await createQuickReceipt({
          supplier_id: quickSupplierId,
          invoice_no: referenceInvoice || null,
          supplier_invoice_amount: invoiceAmount === '' ? null : Number(invoiceAmount),
          items,
          payment,
        });
      }

      setLines([]);
      setSelectedPOId('');
      setQuickSupplierId('');
      setReferenceInvoice(''); setInvoiceAmount('');
      setOverReceiveWarning('');
      setPaymentType('');
      setAmountPaid('');
      setPaymentRef('');
      setPaymentMethod('CASH');
      refetchSuppliers(); // outstanding balances just changed
      const pr = grn?.payment_result;
      if (pr?.error) {
        // Stock is in; only the money side needs attention. Not an
        // exception, so the form still clears (re-posting would receive
        // the goods a second time).
        alert(`GRN posted. Inventory updated.\n\n⚠ ${pr.error}`);
      } else if (pr) {
        alert(`GRN posted. Inventory updated.\nPaid: ${pr.paid.toLocaleString()} · Owed to supplier: ${pr.owed.toLocaleString()}`);
      } else {
        alert('GRN posted. Inventory updated.');
      }
    } catch (err) {
      setPostError(err.message);
    } finally {
      setPosting(false);
    }
  });


  const sourceReady = mode === 'PO' ? !!selectedPOId : !!quickSupplierId;
  const totalUnits = lines.reduce((s, l) => s + (Number(l.quantity_received) || 0), 0);
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <FitPage
      title="Receive Stock"
      icon={Truck}
      subtitle="Record a delivery, add what arrived, then say how it was paid."
      summary={(
        <MiniStats items={[
          { label: 'Items', value: lines.length },
          { label: 'Units', value: money(totalUnits) },
          { label: 'Delivery total', value: money(grnTotal), tone: grnTotal > 0 ? 'gold' : undefined },
        ]} />
      )}
    >
      {/* ── 1. Delivery ─────────────────────────────────────────── */}
      <StepCard n={1} title="Delivery">
        <Segmented
          value={mode} onChange={setMode}
          options={[{ key: 'PO', label: 'From Purchase Order' }, { key: 'QUICK', label: 'Quick Receipt (no PO)' }]}
        />

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {mode === 'PO' ? (
            <Field label="Purchase order">
              <select value={selectedPOId} onChange={e => setSelectedPOId(e.target.value)} className={inputCls}>
                <option value="">{poLoading ? 'Loading purchase orders…' : 'Select Purchase Order'}</option>
                {receivablePOs.map(po => (
                  <option key={po.id} value={po.id}>{po.po_number} — {po.supplier?.name} ({po.status})</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Supplier">
              <select value={quickSupplierId} onChange={e => setQuickSupplierId(e.target.value)} className={inputCls}>
                <option value="">Select Supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Reference invoice #">
            <input placeholder="Optional" value={referenceInvoice} onChange={e => setReferenceInvoice(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Invoice amount (KES)">
            <input type="number" min="0" step="0.01" placeholder="Total on the supplier's invoice" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {mode === 'PO' && !poLoading && receivablePOs.length === 0 && (
          <div className="mt-2.5"><Notice tone="gold">No approved purchase orders to receive against. Create one and approve it on the Purchase Orders page.</Notice></div>
        )}

        {mode === 'PO' && selectedPO && (
          <div className="mt-2.5 rounded-xl bg-[#F3F8EF] border border-[#CFE0C3] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-[#1B5138] truncate">{selectedPO.po_number} — {selectedPO.supplier?.name}</div>
              <div className="text-[11px] text-[#5E6350]">
                {selectedPO.items?.length || 0} item(s) ordered · {selectedPO.status?.replace('_', ' ')}
              </div>
            </div>
            <button
              type="button" onClick={loadPOItems} disabled={!selectedPO.items?.length}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-[#1F6B45] hover:bg-[#17553A] text-white text-[12px] font-semibold border-b-2 border-[#C9A227] disabled:opacity-40"
            >
              <ListPlus size={14} /> Load all PO items
            </button>
          </div>
        )}
      </StepCard>

      {/* ── 2. Add items ────────────────────────────────────────── */}
      <StepCard n={2} title="Add items" dim={!sourceReady} hint={!sourceReady ? (mode === 'PO' ? 'Pick a purchase order first' : 'Pick a supplier first') : undefined}>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button" onClick={() => setShowScanner(true)} disabled={!sourceReady}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-xl bg-[#1F6B45] hover:bg-[#17553A] text-white text-[13px] font-semibold border-b-2 border-[#C9A227] disabled:opacity-40 flex-1 sm:flex-none"
          >
            <ScanLine size={16} /> Scan Product
          </button>
          <div className="flex-1 min-w-[220px]">
            <Segmented
              value={scanEntryMode} onChange={setScanEntryMode} small
              options={[{ key: 'ONE_BY_ONE', label: 'One by one' }, { key: 'QUANTITY', label: 'Enter quantity' }]}
            />
          </div>
        </div>

        {/* Manual add — the only way to add an item with no barcode. */}
        <div className="relative mt-2.5">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A59B6A]" />
          <input
            placeholder="Or type a product name / SKU to add it (no scanning)…"
            value={manualQuery} onChange={e => setManualQuery(e.target.value)} disabled={!sourceReady}
            className={`${inputCls} pl-9 disabled:bg-[#F6F4E8] disabled:text-[#A9A58A]`}
          />
          {manualMatches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E3DBB8] rounded-xl shadow-lg max-h-56 overflow-y-auto divide-y divide-[#F0EACF]">
              {manualMatches.map(p => {
                const poItem = mode === 'PO' ? poItemFor(p.id) : null;
                return (
                  <button
                    type="button" key={p.id} onClick={() => addManualLine(p)}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#FAF7EA] flex justify-between items-center gap-2"
                  >
                    <span className="min-w-0 truncate font-medium text-[#23382B]">{p.name} <span className="text-[#A29E80] text-[11px] font-normal">{p.sku}</span></span>
                    {mode === 'PO' && !poItem && <Pill tone="warn">Not on PO</Pill>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {(overReceiveWarning || postError) && (
          <div className="mt-2.5">
            {overReceiveWarning && <Notice tone="gold">⚠ {overReceiveWarning}</Notice>}
            {postError && <Notice tone="bad">{postError}</Notice>}
          </div>
        )}

        {recentScans.length > 0 && (
          <div className="mt-2 text-[11.5px] text-[#8B8766]">
            Last scan: {recentScans[0].result === SCAN_RESULTS.RESOLVED ? recentScans[0].product.name : `not found (${recentScans[0].barcode})`}
          </div>
        )}
      </StepCard>

      {/* ── 3. Items received (one small card each) ─────────────── */}
      <StepCard n={3} title="Items received" right={lines.length > 0 && <Pill tone="info">{lines.length} item{lines.length === 1 ? '' : 's'}</Pill>}>
        {lines.length === 0 ? (
          <EmptyBlock>No items added yet. Scan a product or search above.</EmptyBlock>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {lines.map(l => {
              const poItem = poItemFor(l.product_id);
              const lineTotal = (Number(l.quantity_received) || 0) * (Number(l.unit_cost) || 0);
              return (
                <div
                  key={l.product_id}
                  className={`rounded-xl border p-2.5 min-w-0 ${l.notOnPO ? 'border-[#E3DBB8] border-l-[3px] border-l-[#C9A227] bg-[#FFFDF4]' : 'border-[#E3DBB8] bg-white'}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-[#23382B] leading-tight truncate">{l.name}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {l.sku && <span className="text-[10.5px] text-[#8B8766] font-mono">{l.sku}</span>}
                        {l.notOnPO && <Pill tone="warn">Not on PO</Pill>}
                        {mode === 'PO' && poItem && <Pill tone="info">Ordered {poItem.quantity}</Pill>}
                        {mode === 'PO' && poItem && <Pill tone="neutral">Already got {poItem.received_quantity ?? 0}</Pill>}
                      </div>
                    </div>
                    <IconBtn title="Remove item" tone="danger" onClick={() => removeLine(l.product_id)}><Trash2 size={14} /></IconBtn>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Received" compact>
                      <input
                        type="number" min="0" inputMode="decimal" value={l.quantity_received}
                        onChange={e => updateLineField(l.product_id, 'quantity_received', parseFloat(e.target.value) || 0)}
                        className={`${inputCls} !min-h-[38px] font-semibold`}
                      />
                    </Field>
                    <Field label="Unit cost" compact>
                      <input
                        type="number" min="0" inputMode="decimal" value={l.unit_cost}
                        onChange={e => updateLineField(l.product_id, 'unit_cost', parseFloat(e.target.value) || 0)}
                        className={`${inputCls} !min-h-[38px]`}
                      />
                    </Field>
                    <Field label="Batch (optional)" compact>
                      <input
                        value={l.batch_number}
                        onChange={e => updateLineField(l.product_id, 'batch_number', e.target.value)}
                        className={`${inputCls} !min-h-[38px]`}
                      />
                    </Field>
                    <Field label="Expiry (optional)" compact>
                      <input
                        type="date" value={l.expiry_date}
                        onChange={e => updateLineField(l.product_id, 'expiry_date', e.target.value)}
                        className={`${inputCls} !min-h-[38px] px-2`}
                      />
                    </Field>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-[#F0EACF] flex items-center justify-between text-[11px] text-[#8B8766]">
                    <span>Line total</span>
                    <span className="text-[13px] font-bold text-[#23382B]">{money(lineTotal)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </StepCard>

      {/* ── 4. Payment ──────────────────────────────────────────── */}
      <StepCard n={4} title="Payment for this delivery">
        <Segmented
          value={paymentType} onChange={setPaymentType}
          options={[{ key: 'CASH', label: 'Paid in full' }, { key: 'PARTIAL', label: 'Part paid' }, { key: 'CREDIT', label: 'On credit' }]}
        />

        {paymentType === '' && (
          <div className="mt-2.5"><Notice tone="gold">Choose how this delivery is being paid for before posting.</Notice></div>
        )}

        {(paymentType === 'CASH' || paymentType === 'PARTIAL') && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Field label="Paid by">
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={inputCls}>
                <option value="CASH">Cash</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="BANK">Bank</option>
                <option value="CARD">Card</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            {paymentType === 'PARTIAL' && (
              <Field label="Amount paid now">
                <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className={inputCls} />
              </Field>
            )}
            <Field label="Reference (optional)">
              <input placeholder="e.g. M-Pesa code" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} className={inputCls} />
            </Field>
          </div>
        )}

        {paymentType === 'PARTIAL' && partialAmount > 0 && partialAmount >= grnTotal && (
          <div className="mt-2.5"><Notice tone="bad">Part payment must be less than the delivery total. Use "Paid in full" instead.</Notice></div>
        )}

        {paymentType !== '' && (
          <div className="mt-3">
            <MiniStats items={[
              { label: 'Delivery total', value: money(grnTotal) },
              { label: 'Paid now', value: money(paidNow), tone: 'good' },
              { label: 'Owed to supplier', value: money(owedToSupplier), tone: owedToSupplier > 0 ? 'bad' : undefined },
            ]} />
            {activeSupplier && (
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-[#8B8766]">
                <span>{activeSupplier.name}: currently owed {money(activeSupplier.outstanding_balance)}</span>
                <span>after this: <b className="text-[#3D4A3F]">{money(projectedBalance)}</b></span>
              </div>
            )}
          </div>
        )}

        {overCreditLimit && (
          <div className="mt-2.5"><Notice tone="gold">⚠ This would take the supplier past their credit limit ({money(activeSupplier.credit_limit)}). You can still post it.</Notice></div>
        )}
      </StepCard>

      {/* ── Post bar: always in reach ───────────────────────────── */}
      <div className="sticky bottom-0 z-10 mt-1 flex items-center gap-3 rounded-xl bg-white border border-[#E3DBB8] border-t-2 border-t-[#C9A227] p-2.5 shadow-md">
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-[#8B8766]">Delivery total</div>
          <div className="text-[17px] font-extrabold leading-tight text-[#23382B] truncate">{money(grnTotal)}</div>
        </div>
        <button
          type="button" onClick={postGRN} disabled={!canPost || posting}
          className={`${saveBtnCls} flex-1 sm:flex-none sm:w-56 sm:ml-auto px-4 text-[13.5px] font-bold inline-flex items-center justify-center gap-2`}
        >
          {posting ? <><Loader2 size={15} className="animate-spin" /> Posting…</> : <><PackageCheck size={16} /> Post delivery</>}
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
        <Sheet title="Create product & add to delivery" onClose={() => setQuickCreateBarcode(null)}>
          <form onSubmit={submitQuickCreate} className="space-y-3">
            <p className="text-[11.5px] text-[#8B8766] font-mono">Barcode: {quickCreateBarcode}</p>
            <Field label="Product name">
              <input required autoFocus placeholder="e.g. Cooking oil 1L" value={quickCreateForm.name}
                onChange={e => setQuickCreateForm({ ...quickCreateForm, name: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Selling price">
                <input required type="number" inputMode="decimal" value={quickCreateForm.selling_price}
                  onChange={e => setQuickCreateForm({ ...quickCreateForm, selling_price: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Cost price">
                <input type="number" inputMode="decimal" value={quickCreateForm.cost_price}
                  onChange={e => setQuickCreateForm({ ...quickCreateForm, cost_price: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setQuickCreateBarcode(null)} className="flex-1 min-h-[42px] rounded-lg bg-[#EEEBDD] text-[#5E6350] font-semibold">Cancel</button>
              <button type="submit" className={`${saveBtnCls} flex-1`}>Save & add</button>
            </div>
          </form>
        </Sheet>
      )}
    </FitPage>
  );
}

// ── small local building blocks ─────────────────────────────────────────

/** Numbered section card: keeps the receiving flow to four clear steps. */
function StepCard({ n, title, hint, right, dim, children }) {
  return (
    <section className={`mb-3 rounded-2xl bg-white border border-[#E3DBB8] border-t-[3px] border-t-[#C9A227] p-3 transition-opacity ${dim ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="shrink-0 w-6 h-6 rounded-full bg-[#1F6B45] text-white text-[12px] font-bold flex items-center justify-center">{n}</span>
        <h2 className="text-[14px] font-bold text-[#23382B] truncate">{title}</h2>
        {hint && <span className="text-[11px] text-[#8A6A12] truncate">· {hint}</span>}
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, compact, children }) {
  return (
    <label className="block min-w-0">
      <span className={`block font-bold uppercase tracking-wide text-[#8B8766] ${compact ? 'text-[9px] mb-0.5' : 'text-[10px] mb-1'}`}>{label}</span>
      {children}
    </label>
  );
}

/** Pill-style choice between a few options. */
function Segmented({ options, value, onChange, small }) {
  return (
    <div className="grid gap-1 p-1 rounded-xl bg-[#F4F0DC]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <button
            key={o.key} type="button" onClick={() => onChange(o.key)}
            className={`${small ? 'min-h-[32px] text-[12px]' : 'min-h-[38px] text-[12.5px]'} px-2 rounded-lg font-semibold transition-colors ${on ? 'bg-[#1F6B45] text-white shadow-sm' : 'text-[#5E6350] hover:bg-white/70'}`}
          >
            {o.label}
          </button>
        );
      })}
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
    <Sheet title={initial.name} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        {poItem && (
          <MiniStats items={[
            { label: 'Ordered', value: poItem.quantity },
            { label: 'Got', value: poItem.received_quantity || 0 },
            { label: 'Remaining', value: (poItem.quantity || 0) - (poItem.received_quantity || 0), tone: 'gold' },
          ]} />
        )}
        <Field label="Quantity received">
          <input required type="number" min="0.01" step="0.01" inputMode="decimal" autoFocus value={qty}
            onChange={e => setQty(e.target.value)} className={`${inputCls} text-lg font-semibold`} />
        </Field>
        <Field label="Unit cost">
          <input type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Batch (optional)">
            <input value={batch} onChange={e => setBatch(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Expiry (optional)">
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 min-h-[42px] rounded-lg bg-[#EEEBDD] text-[#5E6350] font-semibold">Cancel</button>
          <button type="submit" className={`${saveBtnCls} flex-1`}>Add to delivery</button>
        </div>
      </form>
    </Sheet>
  );
}
