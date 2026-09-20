// src/pos-erp/services/purchaseService.js
//
// FULL REBUILD against the real schema (confirmed via information_schema
// + pg_enum queries in the conversation). The previous version was built
// against a different schema entirely: wrong table names
// (lb_goods_received -> lb_goods_received_notes, lb_goods_received_items
// -> lb_grn_items), wrong column names (quantity_received -> received_quantity
// on PO items but quantity on GRN items; quantity_ordered -> quantity;
// order_number -> po_number; batch_number -> batch_no), a
// lb_purchase_requests / lb_supplier_invoices pipeline that doesn't exist
// in this database at all, and the main `supabase` client instead of
// posSupabase.
//
// DROPPED: purchaseRequestService and the PR -> PO conversion flow —
// there is no lb_purchase_requests table, and per the conversation
// there's no requisition step anywhere in the app: Suppliers/Products go
// straight to a Purchase Order.
//
// DROPPED: supplierInvoiceService — there is no lb_supplier_invoices
// table. Supplier payment tracking already lives in supplierService.js
// against the real lb_supplier_payments table.
//
// WAREHOUSE — multi-tenant app where each tenant's shop *is* its one
// warehouse. lb_goods_received_notes, lb_inventory and
// lb_stock_movements all require warehouse_id (NOT NULL), so every
// write path here resolves the caller's default warehouse via
// lb_warehouses.is_default rather than a picker UI or a hardcoded id
// that would be wrong for other tenants.
//
// STOCK MOVEMENT SIGN CONVENTION (assumption — verify against any
// reporting code elsewhere): lb_stock_movements.quantity is signed —
// positive for stock coming in (PURCHASE_RECEIPT, STOCK_RETURN,
// STOCK_TRANSFER_IN, OPENING_STOCK), negative for stock going out
// (SUPPLIER_RETURN, SALE, STOCK_ISSUE, STOCK_TRANSFER_OUT, DAMAGED,
// EXPIRED). STOCK_ADJUSTMENT/STOCK_COUNT can be either sign depending on
// whether the count came in higher or lower. If your reporting expects
// unsigned quantity + direction implied purely by movement_type, change
// it in one place: applyStockMovement below.
//
// QUICK RECEIPT DESIGN CHOICE: lb_purchase_orders.purchase_type has a
// QUICK_PURCHASE value in the schema, which reads as the intended
// design — even a receipt with no real PO still creates a minimal PO
// row (purchase_type: QUICK_PURCHASE, status: RECEIVED) before the GRN,
// so supplier spend/PO reporting stays consistent regardless of which
// path a receipt came in through. lb_goods_received_notes.purchase_order_id
// IS nullable, so skipping PO creation entirely is also schema-legal if
// you'd rather do that — that's a small change in createQuickReceipt.

import { posSupabase as supabase } from './posSupabaseClient';
import { supplierService } from './supplierService';

const PO_TABLE = 'lb_purchase_orders';
const POI_TABLE = 'lb_purchase_order_items';
const GRN_TABLE = 'lb_goods_received_notes';
const GRI_TABLE = 'lb_grn_items';
const SR_TABLE = 'lb_supplier_returns';
const SRI_TABLE = 'lb_supplier_return_items';
const WH_TABLE = 'lb_warehouses';

// ── Warehouse resolution ───────────────────────────────────
// In-memory cache per tab session — a tenant's default warehouse
// doesn't change mid-session, and this avoids a lookup on every write.
const defaultWarehouseCache = new Map();

export async function getDefaultWarehouseId(tenantId) {
  if (!tenantId) throw new Error('getDefaultWarehouseId: tenantId is required.');
  if (defaultWarehouseCache.has(tenantId)) return defaultWarehouseCache.get(tenantId);

  const { data, error } = await supabase
    .from(WH_TABLE)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No default warehouse (is_default = true) found for tenant ${tenantId}.`);

  defaultWarehouseCache.set(tenantId, data.id);
  return data.id;
}

// ── Purchase Orders ────────────────────────────────────────
export const purchaseOrderService = {
  async getAll({ status, supplierId, page = 1, limit = 50 } = {}) {
    let query = supabase
      .from(PO_TABLE)
      .select(`*, supplier:lb_suppliers(id, name, phone), items:${POI_TABLE}(*, product:lb_products(id, name, sku))`, { count: 'exact' })
      .order('order_date', { ascending: false });

    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from(PO_TABLE)
      .select(`*, supplier:lb_suppliers(id, name, phone), items:${POI_TABLE}(*, product:lb_products(id, name, sku, unit_id, cost_price))`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * @param {object} po - { tenant_id, business_id?, branch_id?, warehouse_id?,
   *   supplier_id, purchase_type?, status?, items: [{product_id, quantity, unit_cost, tax_amount?}] }
   *   warehouse_id resolves automatically to the tenant's default if omitted.
   */
  async create(po) {
    if (!po.tenant_id) throw new Error('purchaseOrderService.create: tenant_id is required.');
    const { items = [], ...header } = po;
    const warehouse_id = header.warehouse_id || await getDefaultWarehouseId(header.tenant_id);
    const poNumber = header.po_number || await generatePONumber();

    const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
    const taxTotal = items.reduce((sum, i) => sum + (i.tax_amount || 0), 0);

    const { data: headerData, error: headerError } = await supabase
      .from(PO_TABLE)
      .insert({
        ...header,
        warehouse_id,
        po_number: poNumber,
        status: header.status || 'DRAFT',
        purchase_type: header.purchase_type || 'PURCHASE_ORDER',
        subtotal,
        tax_total: taxTotal,
        total_amount: subtotal + taxTotal,
      })
      .select()
      .single();
    if (headerError) throw headerError;

    if (items.length) {
      const itemRows = items.map((i) => ({
        tenant_id: header.tenant_id,
        purchase_order_id: headerData.id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        tax_amount: i.tax_amount || 0,
        total_cost: i.quantity * i.unit_cost + (i.tax_amount || 0),
        notes: i.notes || null,
      }));
      const { error: itemsError } = await supabase.from(POI_TABLE).insert(itemRows);
      if (itemsError) throw itemsError;
    }

    return this.getById(headerData.id);
  },

  async updateStatus(id, status) {
    const { data, error } = await supabase
      .from(PO_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ── Goods Received Notes ───────────────────────────────────
export const goodsReceivedService = {
  async getAll({ status, supplierId, page = 1, limit = 50 } = {}) {
    let query = supabase
      .from(GRN_TABLE)
      .select(`*, supplier:lb_suppliers(id, name), purchase_order:lb_purchase_orders(id, po_number), items:${GRI_TABLE}(*, product:lb_products(id, name, sku))`, { count: 'exact' })
      .order('received_date', { ascending: false });

    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from(GRN_TABLE)
      .select(`*, supplier:lb_suppliers(id, name, phone), purchase_order:lb_purchase_orders(id, po_number), items:${GRI_TABLE}(*, product:lb_products(id, name, sku, unit_id))`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Receive against an existing PO.
   * @param {string} poId
   * @param {object} grn - { tenant_id, business_id?, invoice_no?, notes?, received_by,
   *   payment?: { type: 'CASH'|'CREDIT'|'PARTIAL', amount_paid?, method?, reference_no? },
   *   items: [{ product_id, purchase_order_item_id, quantity, unit_cost, batch_no?, expiry_date?, notes? }] }
   *   `payment` decides how the purchase hits the supplier's balance — see _finishReceipt.
   */
  async createFromPO(poId, grn) {
    if (!grn.tenant_id) throw new Error('goodsReceivedService.createFromPO: tenant_id is required.');
    const po = await purchaseOrderService.getById(poId);
    if (!po) throw new Error('Purchase order not found');

    const warehouse_id = po.warehouse_id || await getDefaultWarehouseId(grn.tenant_id);
    const grnNumber = await generateGRNNumber();
    const subtotal = grn.items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    const { data: grnData, error: grnError } = await supabase
      .from(GRN_TABLE)
      .insert({
        tenant_id: grn.tenant_id,
        business_id: grn.business_id ?? po.business_id ?? null,
        branch_id: po.branch_id ?? null,
        warehouse_id,
        supplier_id: po.supplier_id,
        purchase_order_id: poId,
        grn_number: grnNumber,
        status: 'COMPLETED',
        invoice_no: grn.invoice_no || null,
        received_by: grn.received_by,
        subtotal,
        tax_total: 0,
        total_amount: subtotal,
        notes: grn.notes || null,
      })
      .select()
      .single();
    if (grnError) throw grnError;

    await this._receiveItems(grnData, grn.items, warehouse_id);
    await this._rollupPOReceipt(poId, grn.items);

    return this._finishReceipt(grnData.id, grn);
  },

  /**
   * Quick receipt with no pre-existing PO — creates a minimal PO first
   * (see header note above for why).
   * @param {object} grn - { tenant_id, business_id?, supplier_id, invoice_no?, notes?, received_by,
   *   payment?: { type: 'CASH'|'CREDIT'|'PARTIAL', amount_paid?, method?, reference_no? },
   *   items: [{ product_id, quantity, unit_cost, batch_no?, expiry_date?, notes? }] }
   */
  async createQuickReceipt(grn) {
    if (!grn.tenant_id) throw new Error('goodsReceivedService.createQuickReceipt: tenant_id is required.');
    if (!grn.supplier_id) throw new Error('goodsReceivedService.createQuickReceipt: supplier_id is required.');

    const warehouse_id = await getDefaultWarehouseId(grn.tenant_id);

    const po = await purchaseOrderService.create({
      tenant_id: grn.tenant_id,
      business_id: grn.business_id,
      warehouse_id,
      supplier_id: grn.supplier_id,
      purchase_type: 'QUICK_PURCHASE',
      status: 'RECEIVED',
      items: grn.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost })),
    });

    const grnNumber = await generateGRNNumber();
    const subtotal = grn.items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    const { data: grnData, error: grnError } = await supabase
      .from(GRN_TABLE)
      .insert({
        tenant_id: grn.tenant_id,
        business_id: grn.business_id ?? null,
        warehouse_id,
        supplier_id: grn.supplier_id,
        purchase_order_id: po.id,
        grn_number: grnNumber,
        status: 'COMPLETED',
        invoice_no: grn.invoice_no || null,
        received_by: grn.received_by,
        subtotal,
        tax_total: 0,
        total_amount: subtotal,
        notes: grn.notes || null,
      })
      .select()
      .single();
    if (grnError) throw grnError;

    // Link grn_items back to the purchase_order_items create() just made,
    // matched by product_id, so PO rollup below has something to update.
    const itemsWithPOI = grn.items.map((i) => ({
      ...i,
      purchase_order_item_id: po.items.find((poi) => poi.product_id === i.product_id)?.id || null,
    }));

    await this._receiveItems(grnData, itemsWithPOI, warehouse_id);
    await this._rollupPOReceipt(po.id, itemsWithPOI);

    return this._finishReceipt(grnData.id, grn);
  },

  // ---- internal: shared by both receipt paths ----

  /**
   * Final step of both receipt paths: load the finished GRN and, if the
   * caller said how it was paid, apply it to the supplier's account.
   *
   *   1. post_grn_to_supplier_balance()  -> outstanding_balance += total
   *   2. supplierService.recordPayment() -> outstanding_balance -= paid
   *      (existing RPC; writes the lb_supplier_payments row linked to
   *      this GRN, which is what the supplier statement reads)
   *
   * The stock is ALREADY received by the time this runs, so a failure
   * here must NOT throw — the caller would think the GRN failed and the
   * cashier could post it twice. Instead the outcome is returned on
   * `payment_result` and the page shows a clear warning.
   */
  async _finishReceipt(grnId, input) {
    const grn = await this.getById(grnId);
    if (!input.payment) return grn; // legacy callers: behaviour unchanged

    const total = Number(grn.total_amount || 0);
    const type = input.payment.type;
    let paid = 0;
    if (type === 'CASH') paid = total;
    else if (type === 'PARTIAL') paid = Math.min(Math.max(Number(input.payment.amount_paid) || 0, 0), total);

    const result = { total, paid, owed: total - paid, error: null };

    try {
      const { error } = await supabase.rpc('post_grn_to_supplier_balance', { p_grn_id: grnId });
      if (error) throw error;
    } catch (err) {
      result.error = `Goods were received, but the supplier's balance was NOT updated: ${err.message}. Nothing was paid or recorded — fix this before re-posting so the goods aren't received twice.`;
      return { ...grn, payment_result: result };
    }

    if (paid > 0) {
      try {
        await supplierService.recordPayment({
          businessId: grn.business_id,
          supplierId: grn.supplier_id,
          grnId,
          amount: paid,
          paymentMethod: input.payment.method || 'CASH',
          referenceNo: input.payment.reference_no || null,
          notes: `Payment on ${grn.grn_number}`,
          createdBy: input.received_by,
        });
      } catch (err) {
        result.error = `Goods were received and the supplier was charged ${total.toLocaleString()}, but the payment of ${paid.toLocaleString()} could not be recorded: ${err.message}. Record it from the supplier's page (Record Payment).`;
        result.owed = total;
        result.paid = 0;
      }
    }
    return { ...grn, payment_result: result };
  },

  async _receiveItems(grnData, items, warehouse_id) {
    const itemRows = items.map((i) => ({
      tenant_id: grnData.tenant_id,
      grn_id: grnData.id,
      purchase_order_item_id: i.purchase_order_item_id || null,
      product_id: i.product_id,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
      tax_amount: i.tax_amount || 0,
      total_cost: i.quantity * i.unit_cost + (i.tax_amount || 0),
      batch_no: i.batch_no || null,
      expiry_date: i.expiry_date || null,
      notes: i.notes || null,
    }));
    const { error: itemsError } = await supabase.from(GRI_TABLE).insert(itemRows);
    if (itemsError) throw itemsError;

    for (const item of items) {
      await applyStockMovement({
        tenantId: grnData.tenant_id,
        businessId: grnData.business_id,
        branchId: grnData.branch_id,
        warehouseId: warehouse_id,
        productId: item.product_id,
        movementType: 'PURCHASE_RECEIPT',
        quantity: item.quantity, // positive: stock in
        unitCost: item.unit_cost,
        batchNo: item.batch_no || null,
        expiryDate: item.expiry_date || null,
        referenceId: grnData.id,
        referenceType: 'GRN',
        createdBy: grnData.received_by,
      });

      // Keep the product's cost_price current — same behaviour as the
      // previous implementation, just against the real client.
      await supabase
        .from('lb_products')
        .update({ cost_price: item.unit_cost })
        .eq('id', item.product_id);
    }
  },

  async _rollupPOReceipt(poId, items) {
    for (const item of items) {
      if (!item.purchase_order_item_id) continue;
      const { data: poi, error } = await supabase
        .from(POI_TABLE)
        .select('received_quantity')
        .eq('id', item.purchase_order_item_id)
        .single();
      if (error) continue; // off-PO item (not_on_po) — nothing to roll up
      await supabase
        .from(POI_TABLE)
        .update({ received_quantity: (poi.received_quantity || 0) + item.quantity })
        .eq('id', item.purchase_order_item_id);
    }

    const { data: poItems, error: poItemsError } = await supabase
      .from(POI_TABLE)
      .select('quantity, received_quantity')
      .eq('purchase_order_id', poId);
    if (poItemsError || !poItems?.length) return;

    const allReceived = poItems.every((i) => (i.received_quantity || 0) >= i.quantity);
    const anyReceived = poItems.some((i) => (i.received_quantity || 0) > 0);
    const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED';
    await purchaseOrderService.updateStatus(poId, newStatus);
  },
};

// ── Supplier Returns ───────────────────────────────────────
export const supplierReturnService = {
  async getAll({ status, supplierId, page = 1, limit = 50 } = {}) {
    let query = supabase
      .from(SR_TABLE)
      .select(`*, supplier:lb_suppliers(id, name), items:${SRI_TABLE}(*, product:lb_products(id, name, sku))`, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count, page, limit };
  },

  /**
   * @param {object} sr - { tenant_id, business_id?, branch_id?, warehouse_id?,
   *   supplier_id, grn_id?, reason?, created_by, items: [{ product_id, quantity, unit_cost }] }
   */
  async create(sr) {
    if (!sr.tenant_id) throw new Error('supplierReturnService.create: tenant_id is required.');
    const { items = [], ...header } = sr;
    const warehouse_id = header.warehouse_id || await getDefaultWarehouseId(header.tenant_id);
    const returnNumber = await generateReturnNumber();
    const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    const { data: srData, error: srError } = await supabase
      .from(SR_TABLE)
      .insert({
        ...header,
        warehouse_id,
        return_number: returnNumber,
        status: 'COMPLETED',
        total_amount: totalAmount,
      })
      .select()
      .single();
    if (srError) throw srError;

    if (items.length) {
      const itemRows = items.map((i) => ({
        tenant_id: header.tenant_id,
        supplier_return_id: srData.id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        total_cost: i.quantity * i.unit_cost,
        notes: i.notes || null,
      }));
      const { error: itemsError } = await supabase.from(SRI_TABLE).insert(itemRows);
      if (itemsError) throw itemsError;

      for (const item of items) {
        await applyStockMovement({
          tenantId: header.tenant_id,
          businessId: header.business_id,
          branchId: header.branch_id,
          warehouseId: warehouse_id,
          productId: item.product_id,
          movementType: 'SUPPLIER_RETURN',
          quantity: -item.quantity, // negative: stock out
          unitCost: item.unit_cost,
          referenceId: srData.id,
          referenceType: 'SUPPLIER_RETURN',
          notes: header.reason || null,
          createdBy: header.created_by,
        });
      }
    }

    return srData;
  },

  async updateStatus(id, status) {
    const { data, error } = await supabase
      .from(SR_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ── Number Generators ──────────────────────────────────────
// NOTE (kept from the original): count-based numbering is only
// collision-safe under RLS that scopes the count per tenant — otherwise
// two tenants could land on the same PO/GRN number. Worth confirming; a
// Postgres sequence or per-tenant counter table is the more robust fix
// if collisions ever show up in practice.
async function generatePONumber() {
  const { count } = await supabase.from(PO_TABLE).select('*', { count: 'exact', head: true });
  return `PO-${String((count || 0) + 1).padStart(6, '0')}`;
}

async function generateGRNNumber() {
  const { count } = await supabase.from(GRN_TABLE).select('*', { count: 'exact', head: true });
  return `GRN-${String((count || 0) + 1).padStart(6, '0')}`;
}

async function generateReturnNumber() {
  const { count } = await supabase.from(SR_TABLE).select('*', { count: 'exact', head: true });
  return `SR-${String((count || 0) + 1).padStart(6, '0')}`;
}

// ── Inventory + Stock Movement sync (the actual point of this file) ──
//
// Single entry point used by every write path above (GRN receipt,
// supplier return) — and the one to call from sales/refunds/transfers
// too, so lb_inventory and lb_stock_movements never drift apart.
export async function applyStockMovement({
  tenantId, businessId = null, branchId = null, warehouseId, productId, movementType,
  quantity, unitCost = 0, batchNo = null, expiryDate = null,
  referenceId = null, referenceType = null, notes = null, createdBy = null,
}) {
  if (!tenantId) throw new Error('applyStockMovement: tenantId is required.');
  if (!warehouseId) throw new Error('applyStockMovement: warehouseId is required.');
  if (!productId) throw new Error('applyStockMovement: productId is required.');

  // track_inventory/reorder_level confirmed on lb_products. Products with
  // track_inventory = false (services, made-to-order items, etc.) never
  // get an lb_inventory row or a stock movement record — there's nothing
  // to track, and writing a fake zero-quantity row would just make them
  // show up as OUT_OF_STOCK everywhere for no reason.
  const { data: product, error: productError } = await supabase
    .from('lb_products')
    .select('track_inventory, reorder_level')
    .eq('id', productId)
    .single();
  if (productError) throw productError;
  if (!product.track_inventory) {
    return { skipped: true, reason: 'PRODUCT_NOT_TRACKED' };
  }
  const reorderLevel = product.reorder_level || 0;

  const { data: existing, error: fetchError } = await supabase
    .from('lb_inventory')
    .select('*')
    .eq('product_id', productId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const isReceipt = quantity > 0 && unitCost > 0;
  let newQuantity, newAverageCost;

  if (existing) {
    newQuantity = existing.quantity + quantity;
    // Cost basis only moves on receipts — sales/returns/adjustments out
    // don't change the average cost of what's still on the shelf.
    newAverageCost = isReceipt
      ? ((existing.quantity * existing.average_cost) + (quantity * unitCost)) / (newQuantity || 1)
      : existing.average_cost;
    await supabase
      .from('lb_inventory')
      .update({
        quantity: newQuantity,
        average_cost: newAverageCost,
        last_movement_at: new Date().toISOString(),
        stock_status: resolveStockStatus(newQuantity, reorderLevel),
      })
      .eq('id', existing.id);
  } else {
    newQuantity = quantity;
    newAverageCost = unitCost;
    await supabase.from('lb_inventory').insert({
      tenant_id: tenantId,
      business_id: businessId,
      branch_id: branchId,
      warehouse_id: warehouseId,
      product_id: productId,
      quantity: newQuantity,
      average_cost: newAverageCost,
      last_movement_at: new Date().toISOString(),
      stock_status: resolveStockStatus(newQuantity, reorderLevel),
    });
  }

  const { error: movementError } = await supabase.from('lb_stock_movements').insert({
    tenant_id: tenantId,
    business_id: businessId,
    branch_id: branchId,
    warehouse_id: warehouseId,
    product_id: productId,
    movement_type: movementType,
    reference_type: referenceType,
    reference_id: referenceId,
    quantity,
    unit_cost: unitCost,
    total_cost: Math.abs(quantity) * unitCost,
    batch_no: batchNo,
    expiry_date: expiryDate,
    notes,
    created_by: createdBy,
  });
  if (movementError) throw movementError;

  return { quantity: newQuantity, average_cost: newAverageCost };
}

// Mirrors lb_inventory.stock_status's real enum values (NORMAL /
// LOW_STOCK / OUT_OF_STOCK). reorderLevel comes from the product's own
// lb_products.reorder_level — confirmed to exist, so this is no longer
// a guessed flat threshold.
export function resolveStockStatus(quantity, reorderLevel = 0) {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (quantity <= reorderLevel) return 'LOW_STOCK';
  return 'NORMAL';
}
