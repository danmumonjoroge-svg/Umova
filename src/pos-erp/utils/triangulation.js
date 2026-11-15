// utils/triangulation.js
//
// Three-way match for purchases: what we ORDERED (purchase order) vs what ARRIVED (goods received / delivery note)
// vs what the supplier BILLED (supplier invoice number + amount, recorded on the goods received note).
// Pure functions: data in, plain-language findings out. Nothing here writes anything or blocks anything;
// the screens use it to warn and to ask for a reason before paying.

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const money = (n) => `KES ${round2(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const qty = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 3 });

/**
 * @param {{po:object, grns:object[], tolerancePct?:number}} d
 *   po.items: [{id, quantity, unit_cost, product:{name}}]; grns[].items: [{purchase_order_item_id, product_id, quantity, unit_cost}]
 *   grns[]: {grn_number, invoice_no, supplier_invoice_amount, status}
 * @returns {{status:'NO_DELIVERY'|'NO_INVOICE'|'MATCHED'|'NEEDS_REVIEW', issues:string[], lines:object[], totals:object}}
 */
export function matchPurchase({ po, grns = [], tolerancePct = 0.5 }) {
  const live = grns.filter((g) => !['CANCELLED', 'VOID', 'VOIDED', 'REVERSED'].includes(String(g.status || '').toUpperCase()));
  const lines = (po?.items || []).map((it) => {
    let got = 0, value = 0;
    for (const g of live) for (const gi of g.items || []) {
      if (gi.purchase_order_item_id === it.id || (!gi.purchase_order_item_id && gi.product_id && gi.product_id === it.product_id)) { got += num(gi.quantity); value += num(gi.quantity) * num(gi.unit_cost); }
    }
    const name = it.product?.name || it.name || 'Item';
    const ordered = num(it.quantity); const poPrice = num(it.unit_cost); const gotPrice = got ? value / got : null;
    const flags = [];
    if (got === 0) flags.push('NOT_RECEIVED'); else if (got < ordered) flags.push('SHORT'); else if (got > ordered) flags.push('OVER');
    if (gotPrice != null && Math.abs(gotPrice - poPrice) > Math.max(0.01, poPrice * tolerancePct / 100)) flags.push('PRICE_DIFF');
    return { id: it.id, name, ordered, received: got, poPrice, receivedPrice: gotPrice, flags };
  });

  const poTotal = num(po?.total_amount) || round2(lines.reduce((a, l) => a + l.ordered * l.poPrice, 0));
  const receivedValue = round2(live.reduce((a, g) => a + (g.items || []).reduce((b, gi) => b + num(gi.quantity) * num(gi.unit_cost), 0), 0));
  const withInvoice = live.filter((g) => g.supplier_invoice_amount != null);
  const invoiceTotal = round2(withInvoice.reduce((a, g) => a + num(g.supplier_invoice_amount), 0));
  const invoiceNos = [...new Set(live.map((g) => g.invoice_no).filter(Boolean))];
  const totals = { poTotal, receivedValue, invoiceTotal, invoiceNos, deliveries: live.length };

  const issues = [];
  if (live.length === 0) return { status: 'NO_DELIVERY', issues: ['Nothing has been received against this order yet.'], lines, totals };

  for (const l of lines) {
    if (l.flags.includes('SHORT')) issues.push(`${l.name}: ordered ${qty(l.ordered)}, received ${qty(l.received)} (${qty(l.ordered - l.received)} short).`);
    if (l.flags.includes('OVER')) issues.push(`${l.name}: ordered ${qty(l.ordered)}, received ${qty(l.received)} (${qty(l.received - l.ordered)} extra).`);
    if (l.flags.includes('NOT_RECEIVED')) issues.push(`${l.name}: ordered ${qty(l.ordered)}, none received.`);
    if (l.flags.includes('PRICE_DIFF')) issues.push(`${l.name}: ordered at ${money(l.poPrice)}, received at ${money(l.receivedPrice)}.`);
  }
  const hasInvoice = withInvoice.length > 0;
  if (!hasInvoice && invoiceNos.length === 0) {
    issues.push('The supplier invoice has not been recorded yet.');
  } else if (!hasInvoice) {
    issues.push(`Invoice ${invoiceNos.join(', ')} is recorded without its amount, so it cannot be compared.`);
  } else {
    const tol = Math.max(1, receivedValue * tolerancePct / 100);
    if (Math.abs(invoiceTotal - receivedValue) > tol) issues.push(`Supplier invoiced ${money(invoiceTotal)} but the goods received are worth ${money(receivedValue)} (difference ${money(Math.abs(invoiceTotal - receivedValue))}).`);
  }
  if (!hasInvoice && invoiceNos.length === 0) return { status: lines.some((l) => l.flags.length) ? 'NEEDS_REVIEW' : 'NO_INVOICE', issues, lines, totals };
  return { status: issues.length ? 'NEEDS_REVIEW' : 'MATCHED', issues, lines, totals };
}

export const MATCH_LABEL = { NO_DELIVERY: 'Not delivered yet', NO_INVOICE: 'Awaiting supplier invoice', MATCHED: 'All three agree', NEEDS_REVIEW: 'Needs review' };
