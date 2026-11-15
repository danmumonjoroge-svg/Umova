// services/documentsService.js
//
// Loads the records behind a business document, builds it, and prints it. Read-only: generating or printing a document
// never changes a sale, order, stock or balance. The business name/contacts come from the signed-in business.
import { posSupabase as supabase } from './posSupabaseClient';
import { printDocument } from '../utils/printDocument';
import { loaders } from '../utils/comm';
import { matchPurchase } from '../utils/triangulation';
import { DOC_STYLE, purchaseOrderHtml, goodsReceivedHtml, salesInvoiceHtml, salesDeliveryNoteHtml, salesReceiptHtml } from '../utils/businessDocuments';

const PO_SELECT = '*, supplier:lb_suppliers(id, name, phone, email, address), items:lb_purchase_order_items(*, product:lb_products(id, name, sku))';
const GRN_SELECT = '*, supplier:lb_suppliers(id, name, phone, email, address), purchase_order:lb_purchase_orders(id, po_number), items:lb_grn_items(*, product:lb_products(id, name, sku))';
const one = (r) => { if (r.error) throw r.error; return r.data; };

export const documentsService = {
  async business({ tenantId, businessId }) { return loaders.loadBusiness(supabase, { tenantId, businessId }); },

  /** PO + every delivery against it + the three-way match. */
  async purchaseTrail({ tenantId, businessId, poId }) {
    const [business, po, grns] = await Promise.all([
      this.business({ tenantId, businessId }),
      supabase.from('lb_purchase_orders').select(PO_SELECT).eq('id', poId).single().then(one),
      supabase.from('lb_goods_received_notes').select(GRN_SELECT).eq('purchase_order_id', poId).order('received_date', { ascending: true }).then(one),
    ]);
    return { business, po, grns: grns || [], match: matchPurchase({ po, grns: grns || [] }) };
  },

  /** Purchase orders for one supplier that currently disagree with what arrived / was invoiced. Used to warn before paying. */
  async supplierMismatches({ supplierId }) {
    const [pos, grns] = await Promise.all([
      supabase.from('lb_purchase_orders').select(PO_SELECT).eq('supplier_id', supplierId).in('status', ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED']).order('order_date', { ascending: false }).limit(60).then(one),
      supabase.from('lb_goods_received_notes').select(GRN_SELECT).eq('supplier_id', supplierId).not('purchase_order_id', 'is', null).limit(300).then(one),
    ]);
    const out = [];
    for (const po of pos || []) {
      const m = matchPurchase({ po, grns: (grns || []).filter((g) => g.purchase_order_id === po.id) });
      if (m.status === 'NEEDS_REVIEW') out.push({ po, match: m });
    }
    return out;
  },

  async grnDocument({ tenantId, businessId, grnId }) {
    const [business, grn] = await Promise.all([this.business({ tenantId, businessId }), supabase.from('lb_goods_received_notes').select(GRN_SELECT).eq('id', grnId).single().then(one)]);
    let po = null;
    if (grn.purchase_order_id) po = await supabase.from('lb_purchase_orders').select(PO_SELECT).eq('id', grn.purchase_order_id).single().then(one).catch(() => null);
    return { business, grn, po };
  },

  async saleDocument({ tenantId, businessId, saleId }) {
    const [business, sale] = await Promise.all([
      this.business({ tenantId, businessId }),
      supabase.from('lb_sales').select('*, items:lb_sale_items(*, product:lb_products(id, name, sku)), payments:lb_payments(*), receipt:lb_receipts(*)').eq('id', saleId).single().then(one),
    ]);
    let customer = null;
    if (sale.customer_id) customer = await supabase.from('lb_customers').select('id, name, phone, email').eq('id', sale.customer_id).maybeSingle().then((r) => r.data).catch(() => null);
    return { business, sale, customer };
  },

  /** kind: PURCHASE_ORDER | GOODS_RECEIVED | INVOICE | DELIVERY_NOTE | RECEIPT. `id` is the PO, GRN or sale id as appropriate. */
  async print(kind, { tenantId, businessId, id }) {
    if (kind === 'PURCHASE_ORDER') { const t = await this.purchaseTrail({ tenantId, businessId, poId: id }); return printDocument(`Purchase order ${t.po.po_number}`, purchaseOrderHtml({ business: t.business, po: t.po, supplier: t.po.supplier, grns: t.grns }), DOC_STYLE); }
    if (kind === 'GOODS_RECEIVED') { const d = await this.grnDocument({ tenantId, businessId, grnId: id }); return printDocument(`Goods received ${d.grn.grn_number}`, goodsReceivedHtml(d), DOC_STYLE); }
    const d = await this.saleDocument({ tenantId, businessId, saleId: id });
    if (kind === 'INVOICE') return printDocument(`Invoice ${d.sale.sale_number}`, salesInvoiceHtml(d), DOC_STYLE);
    if (kind === 'DELIVERY_NOTE') return printDocument(`Delivery note ${d.sale.sale_number}`, salesDeliveryNoteHtml(d), DOC_STYLE);
    if (kind === 'RECEIPT') return printDocument(`Receipt ${d.sale.sale_number}`, salesReceiptHtml(d), DOC_STYLE);
    throw new Error(`Unknown document: ${kind}`);
  },
};
