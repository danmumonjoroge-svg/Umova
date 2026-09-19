// src/pos-erp/services/saleService.js
//
// FULL REBUILD. The previous version had three inserts that would fail
// outright (NOT NULL violations: lb_sales.tenant_id/sale_number,
// lb_stock_movements.tenant_id/warehouse_id, lb_payments.tenant_id), plus
// a hand-rolled inventory update that duplicated (worse) what
// applyStockMovement in purchaseService.js already does correctly:
//   - .single() instead of .maybeSingle() — crashed on a product's very
//     first sale if it had never had a GRN (no existing inventory row).
//   - never recalculated stock_status, so lb_inventory.stock_status went
//     stale after every sale even though the schema/dashboard depend on
//     it being current.
//   - never checked track_inventory or allow_negative_stock.
//   - no lb_receipts row was ever created.
//
// This version calls applyStockMovement (imported from purchaseService.js)
// for both the sale and any void, so there's exactly one place that
// touches lb_inventory/lb_stock_movements in the whole app — receiving,
// returns, and now sales all go through it.
//
// FIELD MAPPING — the cart shape from POSPage.jsx uses `cost_price` (not
// `unit_cost`) and includes `selling_mode`/`weight_value` for
// weight/volume/custom items, matching real lb_sale_items columns
// directly now (POSPage.jsx updated alongside this file).
//
// KNOWN GAP (carried over from cashierService.js/reportsService.js):
// void does not reverse any lb_refunds — that schema still isn't
// confirmed. A void here is for an uncompleted/mistaken sale, not a
// post-sale return; those should go through a refund flow once
// lb_refunds is confirmed, not through voidSale.

import { posSupabase as supabase } from './posSupabaseClient';
import { applyStockMovement, getDefaultWarehouseId } from './purchaseService';
import { auditService } from './auditService';

async function generateSaleNumber() {
  // Same count-based caveat as PO/GRN/return numbering — collision-safe
  // only if RLS scopes the count per tenant. See purchaseService.js.
  const { count } = await supabase.from('lb_sales').select('*', { count: 'exact', head: true });
  return `S-${String((count || 0) + 1).padStart(6, '0')}`;
}

async function generateReceiptNumber() {
  const { count } = await supabase.from('lb_receipts').select('*', { count: 'exact', head: true });
  return `RCT-${String((count || 0) + 1).padStart(6, '0')}`;
}

export const saleService = {
  async getAll({ status, page = 1, limit = 50 } = {}) {
    let q = supabase
      .from('lb_sales')
      .select('*, items:lb_sale_items(*, product:lb_products(id,name,sku))', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const from = (page - 1) * limit; const to = from + limit - 1; q = q.range(from, to);
    const { data, error, count } = await q; if (error) throw error; return { data, count, page, limit };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('lb_sales')
      .select('*, items:lb_sale_items(*, product:lb_products(id,name,sku)), payments:lb_payments(*), receipt:lb_receipts(*)')
      .eq('id', id)
      .single();
    if (error) throw error; return data;
  },

  /**
   * @param {object} sale - {
   *   tenant_id, business_id?, branch_id?, cashier_id, shift_id, customer_id?,
   *   items: [{ product_id, quantity, unit_price, cost_price?, discount_amount?,
   *             discount_percent?, tax_amount?, selling_mode?, weight_value?, notes? }],
   *   payments: [{ payment_method, amount, change_amount?, reference_no? }],
   *   notes?, client_reference? // phase11: offline-sync idempotency key
   * }
   * shift_id is required — without it, cashierService.closeShift()'s
   * expected_cash calculation can never find this sale, and the till
   * will always look short/long for the wrong reason. See conversation.
   */
  async create(sale) {
    if (!sale.tenant_id) throw new Error('saleService.create: tenant_id is required.');
    if (!sale.shift_id) throw new Error('saleService.create: shift_id is required (needed for shift cash reconciliation).');
    if (!sale.items?.length) throw new Error('saleService.create: at least one item is required.');

    // ── Pre-flight stock check, BEFORE writing anything ──
    // Prevents a partially-written sale if one line item would oversell
    // a product that doesn't allow negative stock. Products with
    // track_inventory = false are exempt (nothing to check).
    const warehouseId = await getDefaultWarehouseId(sale.tenant_id);
    for (const item of sale.items) {
      const { data: product, error: productError } = await supabase
        .from('lb_products')
        .select('track_inventory, allow_negative_stock')
        .eq('id', item.product_id)
        .single();
      if (productError) throw productError;
      if (!product.track_inventory || product.allow_negative_stock) continue;

      const { data: inv } = await supabase
        .from('lb_inventory')
        .select('quantity')
        .eq('product_id', item.product_id)
        .eq('warehouse_id', warehouseId)
        .maybeSingle();
      const available = inv?.quantity || 0;
      if (item.quantity > available) {
        throw new Error(`Insufficient stock for this item — available: ${available}, requested: ${item.quantity}.`);
      }
    }

    const subtotal = sale.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const discountTotal = sale.items.reduce((sum, i) => sum + (i.discount_amount || 0), 0);
    const taxTotal = sale.items.reduce((sum, i) => sum + (i.tax_amount || 0), 0);
    const totalAmount = subtotal - discountTotal + taxTotal;

    // Offline-first idempotency (phase11): if this sale carries a
    // client_reference (set when it was created offline and is now
    // syncing), a retried sync must not create a second row. Checked
    // before insert rather than relying only on the unique index, so a
    // retry returns the ALREADY-SYNCED sale cleanly instead of a raw
    // constraint-violation error the sync engine would have to parse.
    if (sale.client_reference) {
      const { data: existing } = await supabase
        .from('lb_sales')
        .select('id')
        .eq('client_reference', sale.client_reference)
        .maybeSingle();
      if (existing) return this.getById(existing.id);
    }

    const { data: headerData, error: hErr } = await supabase
      .from('lb_sales')
      .insert({
        tenant_id: sale.tenant_id,
        business_id: sale.business_id ?? null,
        branch_id: sale.branch_id ?? null,
        cashier_id: sale.cashier_id,
        shift_id: sale.shift_id,
        customer_id: sale.customer_id ?? null,
        sale_number: await generateSaleNumber(),
        status: 'COMPLETED',
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        total_amount: totalAmount,
        notes: sale.notes || null,
        completed_at: new Date().toISOString(),
        client_reference: sale.client_reference || null,
      })
      .select()
      .single();
    if (hErr) throw hErr;

    const itemRows = sale.items.map((i) => ({
      tenant_id: sale.tenant_id,
      sale_id: headerData.id,
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      cost_price: i.cost_price || 0,
      discount_amount: i.discount_amount || 0,
      discount_percent: i.discount_percent || 0,
      tax_amount: i.tax_amount || 0,
      total_price: i.quantity * i.unit_price - (i.discount_amount || 0) + (i.tax_amount || 0),
      selling_mode: i.selling_mode || 'PER_UNIT',
      weight_value: i.weight_value ?? null,
      notes: i.notes || null,
    }));
    const { error: iErr } = await supabase.from('lb_sale_items').insert(itemRows);
    if (iErr) throw iErr;

    if (sale.payments?.length) {
      const paymentRows = sale.payments.map((p) => ({
        tenant_id: sale.tenant_id,
        business_id: sale.business_id ?? null,
        sale_id: headerData.id,
        payment_method: p.payment_method,
        amount: p.amount,
        change_amount: p.change_amount || 0,
        reference_no: p.reference_no || null,
        status: 'COMPLETED',
        created_by: sale.cashier_id,
      }));
      const { error: pErr } = await supabase.from('lb_payments').insert(paymentRows);
      if (pErr) throw pErr;
    }

    // Single source of truth for inventory/stock movements — same
    // function goods receiving and supplier returns use.
    for (const item of sale.items) {
      await applyStockMovement({
        tenantId: sale.tenant_id,
        businessId: sale.business_id,
        branchId: sale.branch_id,
        warehouseId,
        productId: item.product_id,
        movementType: 'SALE',
        quantity: -item.quantity, // negative: stock out
        unitCost: item.cost_price || 0,
        referenceId: headerData.id,
        referenceType: 'SALE',
        createdBy: sale.cashier_id,
      });
    }

    // Receipt row — content snapshot (items/payments/totals) so a
    // reprint later reflects what was actually sold, even if product
    // prices change afterward. Sending/printing UI is a separate phase;
    // this just makes sure the record exists to build that on top of.
    const { error: rErr } = await supabase.from('lb_receipts').insert({
      tenant_id: sale.tenant_id,
      business_id: sale.business_id ?? null,
      branch_id: sale.branch_id ?? null,
      sale_id: headerData.id,
      receipt_number: await generateReceiptNumber(),
      receipt_type: 'THERMAL',
      receipt_data: {
        sale_number: headerData.sale_number,
        items: itemRows,
        payments: sale.payments || [],
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        total_amount: totalAmount,
        completed_at: headerData.completed_at,
      },
    });
    if (rErr) throw rErr;

    // Audit trail (brief §17/§60's "Sale → ... → Audit" chain). Caught
    // locally rather than left to propagate: by this point the sale,
    // items, payments, stock movement, and receipt are all already
    // committed — if the audit write alone failed and this threw, the
    // cashier would see "Failed to complete sale" for a sale that had
    // already gone through, risking a duplicate on retry. An audit gap
    // is a real problem to notice and fix, but it must not look like a
    // failed sale to the person at the till.
    try {
      await auditService.log({
        tenantId: sale.tenant_id,
        actorId: sale.cashier_id,
        action: 'SALE_COMPLETED',
        entityType: 'lb_sales',
        entityId: headerData.id,
        metadata: {
          sale_number: headerData.sale_number,
          total_amount: totalAmount,
          discount_total: discountTotal,
          payment_methods: (sale.payments || []).map((p) => p.payment_method),
          customer_id: sale.customer_id ?? null,
        },
      });
    } catch (auditErr) {
      console.error('[saleService.create] audit log failed (sale itself succeeded):', auditErr);
    }

    return this.getById(headerData.id);
  },

  /**
   * Voids an uncompleted/mistaken sale and reverses its stock impact.
   * NOT for post-sale customer returns — see header note re: lb_refunds.
   */
  async voidSale(id, reason, { voidedBy } = {}) {
    const { data: sale, error: saleError } = await supabase
      .from('lb_sales')
      .select('id, tenant_id, business_id, branch_id')
      .eq('id', id)
      .single();
    if (saleError) throw saleError;

    const { data, error } = await supabase
      .from('lb_sales')
      .update({ status: 'VOIDED', notes: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    const { data: items, error: itemsError } = await supabase
      .from('lb_sale_items')
      .select('product_id, quantity, cost_price')
      .eq('sale_id', id);
    if (itemsError) throw itemsError;

    const warehouseId = await getDefaultWarehouseId(sale.tenant_id);
    for (const item of items || []) {
      await applyStockMovement({
        tenantId: sale.tenant_id,
        businessId: sale.business_id,
        branchId: sale.branch_id,
        warehouseId,
        productId: item.product_id,
        movementType: 'STOCK_RETURN', // closest fit: stock coming back in from a reversed sale
        quantity: item.quantity, // positive: stock back in
        unitCost: item.cost_price || 0,
        referenceId: id,
        referenceType: 'SALE_VOID',
        notes: reason,
        createdBy: voidedBy,
      });
    }

    // Same reasoning as create() above — the void itself already
    // succeeded (status updated, stock reversed) by the time this runs,
    // so a failed audit write is logged, not surfaced as a failed void.
    try {
      await auditService.log({
        tenantId: sale.tenant_id,
        actorId: voidedBy,
        action: 'SALE_VOIDED',
        entityType: 'lb_sales',
        entityId: id,
        metadata: { reason: reason ?? null },
      });
    } catch (auditErr) {
      console.error('[saleService.voidSale] audit log failed (void itself succeeded):', auditErr);
    }

    return data;
  },
};
