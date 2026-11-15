// supabase/functions/_shared/comm/records.js
//
// ONE place that answers: "to write this message, which records do I need?" Used by the app composer and by the
// scheduler, so both fetch exactly the same facts. Returns { recipient, records } ready for engine.compose().

import * as L from './loaders.js';
import { PURPOSE_BY_KEY } from './library.js';

/**
 * @param {object} a  db, tenantId, purpose, recipient {kind,id} (customer/supplier/staff), reference {type,id}, tz, prefs, now, date
 */
export async function loadForPurpose({ db, tenantId, purpose, recipient, reference, tz, prefs, date }) {
  const meta = PURPOSE_BY_KEY[purpose];
  const records = {};
  let rec = null;
  if (recipient?.kind === 'CUSTOMER' || recipient?.kind === 'SUPPLIER') rec = await L.loadRecipient(db, { tenantId, kind: recipient.kind, id: recipient.id });
  else if (recipient?.kind === 'STAFF' || recipient?.kind === 'OWNER') rec = await L.loadStaffRecipient(db, { tenantId, staffId: recipient.id });
  if (!rec && recipient?.inline) rec = { kind: recipient.kind || 'OTHER', ...recipient.inline }; // offline/preloaded record from the screen

  const refId = reference?.id;
  switch (meta?.source) {
    case 'sale': if (refId) records.sale = await L.loadSale(db, { tenantId, saleId: refId }); break;
    case 'payment': if (refId) records.payment = await L.loadPayment(db, { tenantId, paymentId: refId }); records.receivable = rec ? await L.loadReceivable(db, { tenantId, customerId: rec.id, tz, prefs }) : undefined; break;
    case 'receivable': if (rec) records.receivable = await L.loadReceivable(db, { tenantId, customerId: rec.id, tz, prefs, withLedger: purpose === 'CUSTOMER_STATEMENT' }); break;
    case 'appointment': if (refId) records.appointment = await L.loadAppointment(db, { tenantId, appointmentId: refId }); break;
    case 'purchase_order': case 'purchase_order_approval': if (refId) records.po = await L.loadPo(db, { tenantId, poId: refId }); break;
    case 'grn': if (refId) records.grn = await L.loadGrn(db, { tenantId, grnId: refId }); break;
    case 'supplier_payment': if (refId) records.supplierPayment = await L.loadSupplierPayment(db, { tenantId, paymentId: refId }); break;
    case 'supplier': if (rec) Object.assign(records, await L.loadSupplierActivity(db, { tenantId, supplierId: rec.id })); break;
    case 'low_stock': records.lowStock = await L.loadLowStock(db, { tenantId }); break;
    case 'daily_sales': records.daily = await L.loadDailySales(db, { tenantId, date, tz }); break;
    default: break;
  }
  // A sale-based message with no explicit sale: use the customer's latest one
  if (meta?.source === 'sale' && !records.sale && rec?.kind === 'CUSTOMER' && !refId) {
    const r = await db.from('lb_sales').select('id').eq('tenant_id', tenantId).eq('customer_id', rec.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (r.data?.id) records.sale = await L.loadSale(db, { tenantId, saleId: r.data.id });
  }
  return { recipient: rec, records };
}
