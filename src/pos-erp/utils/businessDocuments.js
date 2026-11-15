// utils/businessDocuments.js
//
// Printable business documents, built from the records (never retyped): Purchase Order, Goods Received / Delivery Note,
// Sales Invoice, Sales Delivery Note, Sales Receipt. Each carries cross-references to its sibling documents so the trail
// PO -> delivery -> invoice -> receipt can be followed on paper. The business identity comes from the signed-in business.
// Output is HTML for utils/printDocument (browser print / Save as PDF), the same route receipts and statements already use.
import { escapeHtml as e } from './printDocument';

const money = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 3 });
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export const DOC_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1d2b24; padding: 24px; }
  .doc h1 { font-size: 22px; margin: 0; color: #1F6B45; letter-spacing: .5px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #C9A227; padding-bottom: 10px; margin-bottom: 14px; }
  .biz { font-weight: 700; font-size: 16px; } .small { font-size: 11px; color: #5b6b62; }
  .meta td { padding: 1px 0 1px 14px; font-size: 11px; } .meta td:first-child { color: #5b6b62; text-align: right; }
  .box { border: 1px solid #ddd5b0; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
  .lab { font-size: 10px; font-weight: 700; color: #5b6b62; text-transform: uppercase; letter-spacing: .6px; }
  table.items { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  table.items th { background: #f4efd6; text-align: left; padding: 6px; font-size: 11px; border-bottom: 1px solid #ddd5b0; }
  table.items td { padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .r { text-align: right; } .tot td { padding: 3px 6px; } .tot .grand td { font-weight: 700; font-size: 14px; border-top: 2px solid #1F6B45; }
  .sig { display: flex; gap: 30px; margin-top: 46px; } .sig div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; }
  .refs { margin-top: 14px; font-size: 11px; color: #5b6b62; border-top: 1px dashed #bbb; padding-top: 6px; }
  .stamp { display: inline-block; border: 2px solid; padding: 2px 10px; font-weight: 700; border-radius: 4px; transform: rotate(-4deg); }
  .paid { color: #1F6B45; } .unpaid { color: #A3352A; } .part { color: #9a6b00; }
`;

/** Document numbers are derived from the transaction they belong to, so a document can always be regenerated identically. */
export const docNumber = (kind, ref) => ({ INVOICE: `INV-${ref}`, DELIVERY_NOTE: `DN-${ref}` }[kind] || String(ref));

function header(business, title, rows) {
  return `<div class="head"><div><div class="biz">${e(business?.name || '')}</div>
    <div class="small">${[business?.address, [business?.phone, business?.email].filter(Boolean).join(' · ')].filter(Boolean).map(e).join('<br/>')}</div></div>
    <div style="text-align:right"><h1>${e(title)}</h1><table class="meta" style="margin-left:auto">${rows.filter((r) => r[1]).map(([k, v]) => `<tr><td>${e(k)}</td><td><b>${e(v)}</b></td></tr>`).join('')}</table></div></div>`;
}
const party = (label, p) => `<div class="box"><div class="lab">${e(label)}</div><div><b>${e(p?.name || '—')}</b></div><div class="small">${[p?.phone, p?.email, p?.address].filter(Boolean).map(e).join(' · ')}</div></div>`;
const refs = (list) => { const l = list.filter(Boolean); return l.length ? `<div class="refs"><b>Related documents:</b> ${l.map(e).join(' · ')}</div>` : ''; };
const sign = (a, b) => `<div class="sig"><div>${e(a)}<br/><span class="small">Name · Signature · Date</span></div><div>${e(b)}<br/><span class="small">Name · Signature · Date</span></div></div>`;
const itemName = (i) => i.product?.name || i.name || i.product_name || 'Item';

export function purchaseOrderHtml({ business, po, supplier, grns = [] }) {
  const due = po.revised_delivery_date || po.expected_date;
  const rows = (po.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${e(itemName(i))}${i.product?.sku ? `<div class="small">${e(i.product.sku)}</div>` : ''}</td><td class="r">${qty(i.quantity)}</td><td class="r">${money(i.unit_cost)}</td><td class="r">${money(i.total_cost ?? i.quantity * i.unit_cost)}</td></tr>`).join('');
  return `<div class="doc">${header(business, 'PURCHASE ORDER', [['PO number', po.po_number], ['Order date', day(po.order_date)], ['Delivery expected', due ? day(due) : ''], ['Originally', po.revised_delivery_date && po.expected_date ? day(po.expected_date) : '']])}
  ${party('Supplier', supplier || po.supplier)}
  <table class="items"><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot" style="margin-left:auto;width:260px"><tr><td>Subtotal</td><td class="r">${money(po.subtotal)}</td></tr>${Number(po.tax_total || po.tax_amount) ? `<tr><td>Tax</td><td class="r">${money(po.tax_total || po.tax_amount)}</td></tr>` : ''}<tr class="grand"><td>Total</td><td class="r">KES ${money(po.total_amount)}</td></tr></table>
  ${po.notes ? `<div class="box"><div class="lab">Notes</div>${e(po.notes)}</div>` : ''}
  <p class="small">Please quote <b>${e(po.po_number)}</b> on your delivery note and invoice. Goods are accepted only against this order.</p>
  ${sign('Authorised by', 'Supplier acknowledgement')}
  ${refs(grns.map((g) => g.grn_number && `Delivery ${g.grn_number}${g.invoice_no ? ` (supplier invoice ${g.invoice_no})` : ''}`))}</div>`;
}

export function goodsReceivedHtml({ business, grn, supplier, po }) {
  const ordered = Object.fromEntries((po?.items || []).map((i) => [i.id, i.quantity]));
  const rows = (grn.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${e(itemName(i))}${i.batch_no ? `<div class="small">Batch ${e(i.batch_no)}${i.expiry_date ? ` · exp ${e(day(i.expiry_date))}` : ''}</div>` : ''}</td><td class="r">${ordered[i.purchase_order_item_id] != null ? qty(ordered[i.purchase_order_item_id]) : '—'}</td><td class="r">${qty(i.quantity)}</td><td class="r">${money(i.unit_cost)}</td><td class="r">${money(i.quantity * i.unit_cost)}</td></tr>`).join('');
  return `<div class="doc">${header(business, 'GOODS RECEIVED NOTE', [['GRN number', grn.grn_number], ['Date received', day(grn.received_date)], ['Purchase order', po?.po_number || grn.purchase_order?.po_number], ['Supplier invoice', grn.invoice_no], ['Invoice amount', grn.supplier_invoice_amount != null ? `KES ${money(grn.supplier_invoice_amount)}` : '']])}
  ${party('Received from', supplier || grn.supplier)}
  <table class="items"><thead><tr><th>#</th><th>Item</th><th class="r">Ordered</th><th class="r">Received</th><th class="r">Unit cost</th><th class="r">Value</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot" style="margin-left:auto;width:260px"><tr class="grand"><td>Value received</td><td class="r">KES ${money(grn.total_amount)}</td></tr></table>
  ${grn.notes ? `<div class="box"><div class="lab">Notes</div>${e(grn.notes)}</div>` : ''}
  ${sign('Delivered by (supplier)', 'Received and checked by')}
  ${refs([po?.po_number && `Purchase order ${po.po_number}`, grn.invoice_no && `Supplier invoice ${grn.invoice_no}`])}</div>`;
}

function saleView(sale) {
  const items = (sale.items || []).map((i) => ({ name: itemName(i), qty: i.quantity, price: i.unit_price, total: i.total_price ?? i.line_total ?? ((i.quantity * i.unit_price) - Number(i.discount_amount || 0) + Number(i.tax_amount || 0)) }));
  const paid = (sale.payments || []).reduce((a, p) => a + Number(p.amount || 0) - Number(p.change_amount || 0), 0);
  const total = Number(sale.total_amount ?? sale.receipt?.receipt_data?.total_amount ?? 0);
  return { items, paid, total, balance: Math.max(0, total - paid), no: sale.sale_number || sale.receipt?.receipt_data?.sale_number, date: sale.completed_at || sale.created_at };
}

export function salesInvoiceHtml({ business, sale, customer }) {
  const v = saleView(sale); const st = v.balance <= 0.005 ? ['PAID', 'paid'] : v.paid > 0 ? ['PART PAID', 'part'] : ['UNPAID', 'unpaid'];
  const rows = v.items.map((i, n) => `<tr><td>${n + 1}</td><td>${e(i.name)}</td><td class="r">${qty(i.qty)}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.total)}</td></tr>`).join('');
  return `<div class="doc">${header(business, 'INVOICE', [['Invoice no.', docNumber('INVOICE', v.no)], ['Date', day(v.date)], ['Sale ref', v.no]])}
  ${party('Bill to', customer || { name: 'Walk-in customer' })}
  <table class="items"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot" style="margin-left:auto;width:260px">${Number(sale.discount_total) ? `<tr><td>Discount</td><td class="r">-${money(sale.discount_total)}</td></tr>` : ''}${Number(sale.tax_total) ? `<tr><td>Tax</td><td class="r">${money(sale.tax_total)}</td></tr>` : ''}<tr class="grand"><td>Total</td><td class="r">KES ${money(v.total)}</td></tr><tr><td>Paid</td><td class="r">${money(v.paid)}</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>${money(v.balance)}</b></td></tr></table>
  <div class="stamp ${st[1]}">${st[0]}</div>
  ${refs([`Delivery note ${docNumber('DELIVERY_NOTE', v.no)}`, sale.receipt?.receipt_number && `Receipt ${sale.receipt.receipt_number}`])}</div>`;
}

export function salesDeliveryNoteHtml({ business, sale, customer }) {
  const v = saleView(sale);
  const rows = v.items.map((i, n) => `<tr><td>${n + 1}</td><td>${e(i.name)}</td><td class="r">${qty(i.qty)}</td></tr>`).join('');
  return `<div class="doc">${header(business, 'DELIVERY NOTE', [['Delivery note', docNumber('DELIVERY_NOTE', v.no)], ['Date', day(v.date)], ['Sale ref', v.no]])}
  ${party('Deliver to', customer || { name: 'Walk-in customer' })}
  <table class="items"><thead><tr><th>#</th><th>Description</th><th class="r">Qty delivered</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="small">Goods received in good order and condition. Any shortage or damage must be reported on delivery.</p>
  ${sign('Delivered by', 'Received by (customer)')}
  ${refs([`Invoice ${docNumber('INVOICE', v.no)}`, sale.receipt?.receipt_number && `Receipt ${sale.receipt.receipt_number}`])}</div>`;
}

export function salesReceiptHtml({ business, sale, customer }) {
  const v = saleView(sale);
  const pays = (sale.payments || []).map((p) => `<tr><td>${e(String(p.payment_method || '').replace(/_/g, ' '))}${p.reference_no ? ` · ${e(p.reference_no)}` : ''}</td><td class="r">${money(Number(p.amount) - Number(p.change_amount || 0))}</td></tr>`).join('');
  return `<div class="doc">${header(business, 'RECEIPT', [['Receipt no.', sale.receipt?.receipt_number || v.no], ['Date', day(v.date)], ['Sale ref', v.no]])}
  ${party('Received from', customer || { name: 'Walk-in customer' })}
  <table class="items"><thead><tr><th>Payment</th><th class="r">Amount (KES)</th></tr></thead><tbody>${pays || '<tr><td colspan="2" class="small">No payment recorded.</td></tr>'}</tbody></table>
  <table class="tot" style="margin-left:auto;width:260px"><tr class="grand"><td>Total paid</td><td class="r">KES ${money(v.paid)}</td></tr>${v.balance > 0.005 ? `<tr><td>Balance outstanding</td><td class="r">${money(v.balance)}</td></tr>` : ''}</table>
  <p class="small">Thank you for your payment.</p>
  ${refs([`Invoice ${docNumber('INVOICE', v.no)}`, `Delivery note ${docNumber('DELIVERY_NOTE', v.no)}`])}</div>`;
}
