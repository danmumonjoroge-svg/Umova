// supabase/functions/_shared/comm/context.js
//
// Turns REAL records (customer, receivable, appointment, purchase order, ...) into the variables a message needs,
// and decides whether the message should be sent AT ALL right now ("eligibility"):
//   * a cleared debt gets no reminder
//   * goods already received get no delay message
//   * a cancelled appointment gets no reminder, a rescheduled one uses its NEW time
//   * the wording is chosen from today's date, not from whatever the owner clicked
//
// No database access and no clock in here: records and `now` are passed in, so the same code runs in the app
// (when the owner opens a message) and in the scheduler (when nobody is logged in).

import { dateContext, formatLongDate, formatTime12, toYmd, daysLabel, addDays } from './dateContext.js';
import {
  formatMoney, paymentSentence, paymentTag, appointmentSentence, appointmentWhen, deliverySentence,
  revisionSentence, rescheduleSentence,
} from './phrases.js';
import { firstName } from './render.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = (s) => (s == null ? '' : String(s).trim());
const titleCase = (s) => clean(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const OPEN_APPT = ['SCHEDULED', 'CONFIRMED'];
const PO_CLOSED = ['RECEIVED', 'CANCELLED', 'REJECTED', 'CLOSED'];
const PO_NOT_ORDERED = ['DRAFT', 'PENDING_APPROVAL'];

const err = (code, message) => ({ code, message });

// ------------------------------------------------------------------------------------------------------------
// small formatters
// ------------------------------------------------------------------------------------------------------------
const MAX_LINES = 8;

function bullet(lines, more = 0) {
  const shown = lines.slice(0, MAX_LINES);
  const extra = lines.length - shown.length + more;
  return [...shown.map((l) => `- ${l}`), ...(extra > 0 ? [`- and ${extra} more`] : [])].join('\n');
}

const qty = (n) => (Number.isInteger(num(n)) ? String(num(n)) : String(Math.round(num(n) * 100) / 100));

export function itemsFromSale(items = []) {
  return items.map((i) => ({ name: clean(i.product?.name || i.name || i.product_name) || 'Item', quantity: num(i.quantity), total: i.total_price != null ? num(i.total_price) : null }));
}

function itemsBlocks(items, heading) {
  if (!items.length) return { summary: '', block: '' };
  const lines = items.map((i) => `${qty(i.quantity)} x ${i.name}`);
  const summary = lines.slice(0, 4).join(', ') + (lines.length > 4 ? ` and ${lines.length - 4} more` : '');
  return { summary, block: `${heading}\n${bullet(lines)}` };
}

// ------------------------------------------------------------------------------------------------------------
// receivables: which part of the customer's debt is due when
// ------------------------------------------------------------------------------------------------------------
/**
 * receivable = { outstanding, items: [{ due_date, amount, reference }], ledger: [...] }
 * `items` are the still-OPEN parts of the debt (after payments), each with its REAL due date.
 */
export function analyseReceivable(receivable, { now, tz }) {
  const outstanding = Math.max(0, num(receivable?.outstanding));
  const items = (receivable?.items || [])
    .filter((i) => i && i.due_date && num(i.amount) > 0)
    .map((i) => ({ ...i, amount: num(i.amount), ctx: dateContext({ date: i.due_date, now, tz }) }))
    .filter((i) => i.ctx.valid)
    .sort((a, b) => (a.ctx.date < b.ctx.date ? -1 : a.ctx.date > b.ctx.date ? 1 : 0));

  const overdue = items.filter((i) => i.ctx.state === 'PAST');
  const today = items.filter((i) => i.ctx.state === 'TODAY');
  const upcoming = items.filter((i) => i.ctx.isFuture);
  const sum = (a) => a.reduce((s, i) => s + i.amount, 0);
  const cap = (n) => (outstanding > 0 ? Math.min(n, outstanding) : n);

  let state = 'NO_DATE'; let focus = null; let amount = outstanding; let refItems = [];
  if (outstanding <= 0) state = 'CLEARED';
  else if (overdue.length) { state = 'OVERDUE'; focus = overdue[0].ctx; amount = cap(sum(overdue)); refItems = overdue; }
  else if (today.length) { state = 'DUE_TODAY'; focus = today[0].ctx; amount = cap(sum(today)); refItems = today; }
  else if (upcoming.length) {
    state = 'UPCOMING'; focus = upcoming[0].ctx;
    refItems = upcoming.filter((i) => i.ctx.date === upcoming[0].ctx.date); amount = cap(sum(refItems));
  }
  const refs = [...new Set(refItems.map((i) => clean(i.reference)).filter(Boolean))];
  const reference = refs.length === 1 ? refs[0] : refs.length > 1 ? `${refs.length} invoices` : '';
  return { outstanding, items, state, focus, amount, reference };
}

const RECEIVABLE_VARIANT = { OVERDUE: 'PAYMENT_OVERDUE', DUE_TODAY: 'PAYMENT_DUE_TODAY', UPCOMING: 'PAYMENT_UPCOMING', NO_DATE: 'PAYMENT_BALANCE' };

// ------------------------------------------------------------------------------------------------------------
// main entry
// ------------------------------------------------------------------------------------------------------------
/**
 * @param {object} a
 *   purpose, channel, business {name, phone, email, address, currency, time_zone}, recipient {kind, name, phone, email, contact_person},
 *   records {...}, inputs {...}, now
 * @returns {{ purpose, requestedPurpose, switchedNote, vars, details, blocking, warnings, tz, currency }}
 */
export function buildContext({ purpose, channel, business = {}, recipient = {}, records = {}, inputs = {}, now = new Date() }) {
  const tz = business.time_zone;
  const currency = business.currency || 'KES';
  const money = (n) => formatMoney(n, currency);
  const blocking = []; const warnings = []; const details = [];
  const vars = {};
  let resolved = purpose; let switchedNote = '';

  // ---- common variables
  vars.business_name = clean(business.name);
  vars.business_phone = clean(business.phone);
  vars.business_email = clean(business.email);
  vars.business_address = clean(business.address);
  vars.contact_block = [
    business.phone ? `Phone: ${clean(business.phone)}` : '',
    business.email ? `Email: ${clean(business.email)}` : '',
    business.address ? `Address: ${clean(business.address)}` : '',
  ].filter(Boolean).join('\n');
  vars.recipient_name = clean(recipient.name);
  const isCompany = recipient.kind === 'SUPPLIER';
  vars.recipient_greeting_name = isCompany ? (firstName(recipient.contact_person) || clean(recipient.name)) : (firstName(recipient.name) || clean(recipient.name));
  if (recipient.kind === 'CUSTOMER') vars.customer_name = clean(recipient.name);
  if (recipient.kind === 'SUPPLIER') vars.supplier_name = clean(recipient.name);
  if (!vars.business_name) blocking.push(err('NO_BUSINESS_NAME', 'The business name is missing. Set it in Settings.'));
  if (!vars.recipient_greeting_name) warnings.push(err('NO_RECIPIENT_NAME', 'No recipient name is on file, so the greeting will be generic.'));
  if (!vars.recipient_greeting_name) vars.recipient_greeting_name = recipient.kind === 'SUPPLIER' ? 'team' : 'there';

  const fail = (code, message) => blocking.push(err(code, message));
  const warn = (code, message) => warnings.push(err(code, message));
  const detail = (label, value) => { if (value !== undefined && value !== null && String(value) !== '') details.push({ label, value: String(value) }); };

  // inputs the user must supply (only where the database cannot know them)
  const missingInputs = [];
  const need = (key, label) => { if (!clean(inputs[key])) missingInputs.push(label); return clean(inputs[key]); };

  const c = (date, time) => dateContext({ date, time, now, tz });
  const today = c(toYmd(now, tz));

  switch (purpose) {
    // ====================================================== CUSTOMERS
    case 'CUSTOMER_WELCOME': {
      detail('Customer', recipient.name);
      break;
    }

    case 'SALE_CONFIRMATION': case 'RECEIPT': case 'ORDER_CONFIRMATION': case 'DELIVERY_NOTIFICATION': {
      const sale = records.sale;
      if (!sale) { fail('NO_SALE', 'Pick the sale this message is about.'); break; }
      if (['CANCELLED', 'VOIDED', 'VOID', 'REVERSED'].includes(String(sale.status || '').toUpperCase())) {
        fail('SALE_VOIDED', 'This sale was cancelled or reversed, so no confirmation will be sent for it.');
      }
      const saleDate = c(toYmd(sale.completed_at || sale.created_at, tz));
      const items = itemsFromSale(sale.items || records.saleItems || []);
      const blocks = itemsBlocks(items, 'Items:');
      const total = num(sale.total_amount);
      const paid = sale.paid_amount != null ? num(sale.paid_amount) : null;
      const owing = paid != null ? Math.max(0, total - paid) : null;
      vars.sale_number = clean(sale.sale_number || sale.id?.slice(0, 8));
      vars.receipt_number = clean(sale.receipt_number || sale.sale_number || sale.id?.slice(0, 8));
      vars.order_number = vars.sale_number;
      vars.sale_date = saleDate.dateLong;
      vars.total_amount = money(total);
      vars.items_summary = blocks.summary;
      vars.items_block = blocks.block;
      vars.payment_status_line = owing == null ? '' : owing > 0 ? `Balance still to pay: ${money(owing)}.` : 'Paid in full. Thank you!';
      detail('Sale', vars.sale_number); detail('Date', saleDate.dateLong); detail('Total', vars.total_amount);
      if (items.length) detail('Items', blocks.summary);
      if (purpose === 'DELIVERY_NOTIFICATION') {
        const status = inputs.delivery_status || 'ON_THE_WAY';
        const d = inputs.delivery_date ? c(inputs.delivery_date) : null;
        if (inputs.delivery_date && !d.valid) fail('BAD_DATE', 'The delivery date is not a valid date.');
        let s;
        if (status === 'DELIVERED') {
          if (d?.valid && d.isFuture) fail('DELIVERY_FUTURE', 'A delivery cannot be marked delivered on a future date.');
          s = d?.valid ? `Your order was delivered ${d.isToday ? 'today, ' : 'on '}${d.dateLong}.` : 'Your order has been delivered.';
        } else if (status === 'READY') {
          s = d?.valid ? `Your order is ready for collection${d.isToday ? ' today' : d.state === 'TOMORROW' ? ' from tomorrow' : ` from ${d.dateLong}`}.` : 'Your order is ready for collection.';
        } else if (d?.valid) {
          if (d.isPast) warn('DELIVERY_PAST', 'The expected delivery date has already passed.');
          s = `Your order is on its way and is expected ${d.state === 'TODAY' ? `today, ${d.dateLong}` : d.state === 'TOMORROW' ? `tomorrow, ${d.dateLong}` : d.state === 'PAST' ? `on ${d.dateLong}` : `on ${d.dateLong}`}.`;
        } else s = 'Your order is on its way.';
        vars.delivery_sentence = s;
        vars.delivery_note = clean(inputs.delivery_note);
        detail('Status', titleCase(status));
      }
      break;
    }

    case 'PAYMENT_RECEIVED': {
      const p = records.payment;
      if (!p) { fail('NO_PAYMENT', 'Pick the payment this message is about.'); break; }
      const pd = c(toYmd(p.payment_date || p.created_at, tz));
      vars.payment_amount = money(p.amount);
      vars.payment_date = pd.dateLong;
      vars.payment_reference = clean(p.reference_no || p.reference);
      const bal = num(records.receivable?.outstanding ?? recipient.outstanding_balance);
      vars.balance_sentence = bal > 0 ? `Your outstanding balance is now ${money(bal)}.` : 'Your account is now fully settled. Thank you!';
      detail('Payment', vars.payment_amount); detail('Date', pd.dateLong); detail('Reference', vars.payment_reference);
      detail('Balance now', money(Math.max(0, bal)));
      break;
    }

    case 'PAYMENT_REMINDER': case 'PAYMENT_UPCOMING': case 'PAYMENT_DUE_TODAY': case 'PAYMENT_OVERDUE': case 'PAYMENT_BALANCE': {
      const a = analyseReceivable(records.receivable, { now, tz });
      if (a.state === 'CLEARED') { fail('CLEARED', `${recipient.name || 'This customer'} has nothing outstanding, so no reminder is needed.`); break; }
      const want = RECEIVABLE_VARIANT[a.state];
      if (purpose !== 'PAYMENT_REMINDER' && purpose !== want) {
        switchedNote = a.state === 'NO_DATE'
          ? 'No due date is recorded for this balance, so a general balance reminder was prepared.'
          : `Based on today's date the wording was changed to "${titleOfVariant(want)}".`;
      }
      resolved = want;
      vars.outstanding_total = money(a.outstanding);
      vars.due_amount = money(a.amount);
      vars.invoice_ref = a.reference;
      if (a.focus) {
        vars.timing_sentence = paymentSentence(a.focus, { amount: a.amount, currency });
        vars.due_date = a.focus.dateLong;
        vars.overdue_by = a.focus.state === 'PAST' ? daysLabel(a.focus.daysOverdue) : '';
        vars.days_remaining = a.focus.state === 'PAST' ? '' : String(a.focus.daysRemaining);
        detail('Amount due', vars.due_amount); detail('Due date', `${a.focus.dateLong} (${paymentTag(a.focus)})`);
      }
      detail('Total outstanding', vars.outstanding_total); detail('Reference', a.reference);
      records._analysis = a;
      break;
    }

    case 'CUSTOMER_STATEMENT': {
      const a = analyseReceivable(records.receivable, { now, tz });
      vars.balance = money(a.outstanding);
      vars.statement_date = today.dateLong;
      vars.next_due_line = a.focus ? `Next payment: ${money(a.amount)} ${a.focus.state === 'PAST' ? `was due on ${a.focus.dateLong} (${paymentTag(a.focus)})` : a.focus.state === 'TODAY' ? `is due today, ${a.focus.dateLong}` : `is due on ${a.focus.dateLong}`}.` : '';
      const ledger = (records.receivable?.ledger || []).slice(-MAX_LINES);
      let prev = null;
      const lines = ledger.map((l, idx) => {
        const bal = num(l.balance_after);
        const before = idx === 0 ? (l.amount != null ? bal - num(l.signed_delta ?? 0) : null) : num(ledger[idx - 1].balance_after);
        const delta = l.signed_delta != null ? num(l.signed_delta) : before == null ? null : bal - before;
        prev = bal;
        const label = delta == null ? titleCase(l.transaction_type) : delta >= 0 ? 'On credit' : 'Payment';
        return `${formatLongDate(toYmd(l.created_at, tz))}: ${label} ${money(Math.abs(delta ?? num(l.amount)))}, balance ${money(bal)}`;
      });
      vars.statement_lines = lines.length ? `Recent activity:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
      void prev;
      detail('Balance', vars.balance); detail('As at', vars.statement_date);
      if (a.state === 'CLEARED') warn('ZERO_BALANCE', 'This customer owes nothing right now. The statement will show a zero balance.');
      break;
    }

    case 'APPOINTMENT_CONFIRMATION': case 'APPOINTMENT_REMINDER': case 'APPOINTMENT_RESCHEDULED': case 'APPOINTMENT_CANCELLED': {
      const ap = records.appointment;
      if (!ap) { fail('NO_APPOINTMENT', 'Pick the appointment this message is about.'); break; }
      const status = String(ap.status || '').toUpperCase();
      const cur = c(ap.appointment_date, ap.appointment_time);
      const prev = ap.rescheduled_from_date ? c(ap.rescheduled_from_date, ap.rescheduled_from_time) : null;
      vars.service_name = clean(ap.service?.name || ap.service_name) || 'your appointment';
      vars.staff_name = clean(ap.staff?.name || ap.staff_name);
      vars.appointment_date = cur.dateLong; vars.appointment_time = cur.timeLabel;
      vars.appointment_sentence = appointmentSentence(cur);
      detail('Service', vars.service_name); detail('When', `${cur.dateLongWithWeekday}${cur.timeLabel ? `, ${cur.timeLabel}` : ''}`); detail('Status', titleCase(status));
      if (purpose === 'APPOINTMENT_CANCELLED') {
        if (status !== 'CANCELLED') fail('NOT_CANCELLED', 'This appointment is not cancelled. Cancel it first, then tell the customer.');
        vars.cancelled_sentence = `Your appointment scheduled for ${appointmentWhen(cur)} has been cancelled.`;
        break;
      }
      if (status === 'CANCELLED') { fail('APPT_CANCELLED', 'This appointment was cancelled, so no confirmation or reminder will be sent. Use "Appointment cancelled" instead.'); break; }
      if (!OPEN_APPT.includes(status)) { fail('APPT_CLOSED', `This appointment is ${titleCase(status).toLowerCase()}, so there is nothing to remind the customer about.`); break; }
      if (purpose === 'APPOINTMENT_REMINDER' && (cur.isPast || cur.timePassed)) fail('APPT_PASSED', 'This appointment time has already passed.');
      if (purpose === 'APPOINTMENT_CONFIRMATION' && (cur.isPast || cur.timePassed)) warn('APPT_PASSED', 'This appointment time has already passed.');
      if (purpose === 'APPOINTMENT_RESCHEDULED') {
        vars.reschedule_sentence = rescheduleSentence(prev, cur);
        if (!prev) warn('NOT_RESCHEDULED', 'This appointment has not been moved, so the message simply states the current time.');
        if (prev) detail('Previously', `${prev.dateLong}${prev.timeLabel ? `, ${prev.timeLabel}` : ''}`);
        if (cur.isPast || cur.timePassed) fail('APPT_PASSED', 'The new appointment time has already passed.');
      }
      break;
    }

    // ====================================================== SUPPLIERS
    case 'SUPPLIER_PURCHASE_ORDER': case 'SUPPLIER_PURCHASE_CONFIRMATION': case 'SUPPLIER_DELIVERY_REMINDER': case 'SUPPLIER_DELIVERY_DELAYED': {
      const po = records.po;
      if (!po) { fail('NO_PO', 'Pick the purchase order this message is about.'); break; }
      const status = String(po.status || '').toUpperCase();
      const items = (po.items || []).map((i) => ({
        name: clean(i.product?.name || i.name) || 'Item', ordered: num(i.quantity), received: num(i.received_quantity),
        outstanding: Math.max(0, num(i.quantity) - num(i.received_quantity)),
      }));
      const outstandingQty = items.reduce((s, i) => s + i.outstanding, 0);
      const origCtx = po.expected_date ? c(po.expected_date) : null;
      const revCtx = po.revised_delivery_date ? c(po.revised_delivery_date) : null;
      const eff = revCtx?.valid ? revCtx : origCtx?.valid ? origCtx : null;
      vars.po_number = clean(po.po_number);
      vars.po_date = po.order_date ? c(toYmd(po.order_date, tz)).dateLong : '';
      vars.po_total = money(po.total_amount);
      const listLines = items.map((i) => (i.received > 0 ? `${qty(i.outstanding)} of ${qty(i.ordered)} x ${i.name} still to come` : `${qty(i.ordered)} x ${i.name}`));
      vars.po_summary = items.slice(0, 4).map((i) => `${qty(i.received > 0 ? i.outstanding : i.ordered)} x ${i.name}`).join(', ') + (items.length > 4 ? ` and ${items.length - 4} more` : '');
      vars.po_items = items.length ? `Goods:\n${bullet(listLines)}` : '';
      vars.quantity_outstanding = qty(outstandingQty);
      vars.original_date = origCtx?.valid ? origCtx.dateLong : '';
      vars.expected_date = eff?.valid ? eff.dateLong : '';
      detail('Order', vars.po_number); detail('Supplier', recipient.name);
      detail('Goods', vars.po_summary); detail('Total', vars.po_total);
      if (origCtx?.valid) detail('Original delivery date', origCtx.dateLong);
      if (revCtx?.valid && revCtx.date !== origCtx?.date) detail('Revised delivery date', revCtx.dateLong);

      if (purpose === 'SUPPLIER_PURCHASE_ORDER' || purpose === 'SUPPLIER_PURCHASE_CONFIRMATION') {
        if (status === 'CANCELLED') { fail('PO_CANCELLED', 'This order was cancelled, so it will not be sent to the supplier.'); break; }
        if (eff?.valid) {
          if (eff.isPast) warn('EXPECTED_PAST', 'The expected delivery date is already in the past.');
          else vars.delivery_request_sentence = `We would like delivery by ${eff.state === 'TODAY' ? 'today, ' : eff.state === 'TOMORROW' ? 'tomorrow, ' : ''}${eff.dateLong}.`;
        }
        vars.revision_sentence = revisionSentence(origCtx, revCtx);
        break;
      }

      // delivery reminder / delay
      if (PO_CLOSED.includes(status)) { fail('PO_CLOSED', status === 'CANCELLED' ? 'This order was cancelled, so there is no delivery to chase.' : 'The goods for this order have already been received, so no delivery message is needed.'); break; }
      if (PO_NOT_ORDERED.includes(status)) { fail('PO_NOT_APPROVED', 'This order has not been approved yet, so the supplier is not expecting a delivery.'); break; }
      if (items.length && outstandingQty <= 0) { fail('ALL_RECEIVED', 'All the goods on this order have been received, so no delivery message is needed.'); break; }
      if (!eff?.valid) { fail('NO_EXPECTED_DATE', 'No expected delivery date is recorded on this order. Add one on the order first.'); break; }
      const want = eff.state === 'PAST' ? 'SUPPLIER_DELIVERY_DELAYED' : 'SUPPLIER_DELIVERY_REMINDER';
      if (purpose !== want && purpose !== 'SUPPLIER_DELIVERY_REMINDER') {
        switchedNote = want === 'SUPPLIER_DELIVERY_REMINDER' ? 'The delivery is not late yet, so a delivery reminder was prepared.' : '';
      }
      if (purpose === 'SUPPLIER_DELIVERY_DELAYED' && want !== purpose) { switchedNote = 'The delivery is not late yet, so a delivery reminder was prepared.'; }
      resolved = want;
      vars.delivery_sentence = deliverySentence(eff);
      vars.revision_sentence = revisionSentence(origCtx, revCtx);
      vars.days_delayed = eff.state === 'PAST' ? daysLabel(eff.daysOverdue) : '';
      if (eff.state === 'PAST') detail('Days delayed', daysLabel(eff.daysOverdue));
      if (eff.state !== 'PAST') detail('Due', `${eff.dateLong}${eff.state === 'TODAY' ? ' (today)' : eff.state === 'TOMORROW' ? ' (tomorrow)' : ` (in ${daysLabel(eff.daysRemaining)})`}`);
      detail('Still to receive', vars.quantity_outstanding);
      break;
    }

    case 'SUPPLIER_PAYMENT_CONFIRMATION': {
      const p = records.supplierPayment;
      if (!p) { fail('NO_PAYMENT', 'Pick the payment this message is about.'); break; }
      const pd = c(toYmd(p.payment_date || p.created_at, tz));
      vars.payment_amount = money(p.amount); vars.payment_date = pd.dateLong;
      vars.payment_reference = clean(p.reference_no || p.reference);
      vars.payment_method = p.payment_method ? titleCase(p.payment_method) : '';
      const bal = num(recipient.outstanding_balance);
      vars.balance_sentence = bal > 0 ? `Our balance with you is now ${money(bal)}.` : 'Your account with us is now fully settled.';
      detail('Payment', vars.payment_amount); detail('Date', pd.dateLong); detail('Reference', vars.payment_reference);
      break;
    }

    case 'SUPPLIER_STATEMENT': case 'SUPPLIER_BALANCE': {
      const bal = num(recipient.outstanding_balance);
      vars.supplier_balance = money(bal);
      vars.statement_date = today.dateLong;
      const lines = [];
      for (const po of (records.recentPos || []).slice(0, 5)) lines.push(`${formatLongDate(toYmd(po.order_date, tz))}: Order ${clean(po.po_number)}, ${money(po.total_amount)}`);
      for (const p of (records.recentSupplierPayments || []).slice(0, 5)) lines.push(`${formatLongDate(toYmd(p.payment_date || p.created_at, tz))}: Payment ${money(p.amount)}`);
      vars.supplier_statement_lines = lines.length ? `Recent activity:\n${bullet(lines.sort().reverse())}` : '';
      detail('Balance owed', vars.supplier_balance);
      if (bal <= 0) fail('NO_BALANCE', `We do not owe ${recipient.name || 'this supplier'} anything right now, so a balance message is not needed.`);
      break;
    }

    case 'SUPPLIER_GOODS_RECEIVED': {
      const g = records.grn;
      if (!g) { fail('NO_GRN', 'Pick the goods received note this message is about.'); break; }
      const items = (g.items || []).map((i) => ({ name: clean(i.product?.name || i.name) || 'Item', quantity: num(i.quantity ?? i.received_quantity) }));
      const lines = items.map((i) => `${qty(i.quantity)} x ${i.name}`);
      vars.received_date = c(toYmd(g.received_date || g.created_at, tz)).dateLong;
      vars.grn_number = clean(g.grn_number);
      vars.po_number = clean(g.po?.po_number);
      vars.received_items = lines.length ? `Received:\n${bullet(lines)}` : '';
      vars.received_summary = lines.slice(0, 4).join(', ') + (lines.length > 4 ? ` and ${lines.length - 4} more` : '');
      if (!vars.received_summary) fail('NO_GOODS', 'No goods are listed on this receipt.');
      const rest = (g.po?.items || []).map((i) => ({ name: clean(i.product?.name || i.name), out: Math.max(0, num(i.quantity) - num(i.received_quantity)) })).filter((i) => i.out > 0);
      vars.outstanding_line = g.po ? (rest.length ? `Still to come: ${rest.slice(0, 4).map((i) => `${qty(i.out)} x ${i.name}`).join(', ')}.` : 'This completes the order.') : '';
      detail('Received', vars.received_date); detail('Goods', vars.received_summary);
      break;
    }

    // ====================================================== BUSINESS
    case 'LOW_STOCK_NOTIFICATION': {
      const list = records.lowStock || [];
      if (!list.length) { fail('NO_LOW_STOCK', 'No products are low on stock right now.'); break; }
      const lines = list.map((p) => (String(p.stock_status).toUpperCase() === 'OUT_OF_STOCK' || num(p.quantity) <= 0 ? `${p.name}: out of stock` : `${p.name}: ${qty(p.quantity)} left${p.reorder_level ? ` (reorder at ${qty(p.reorder_level)})` : ''}`));
      vars.low_stock_count = String(list.length); vars.low_stock_lines = bullet(lines);
      detail('Products low', String(list.length));
      break;
    }

    case 'DAILY_SALES_SUMMARY': {
      const d = records.daily;
      if (!d) { fail('NO_SALES_DATA', 'Sales figures could not be loaded.'); break; }
      vars.summary_date = c(d.date || toYmd(now, tz)).dateLong;
      vars.sales_total = money(d.total); vars.sales_count = String(num(d.count));
      const lines = Object.entries(d.byMethod || {}).filter(([, v]) => num(v) > 0).map(([k, v]) => `${titleCase(k)}: ${money(v)}`);
      vars.sales_breakdown = lines.length ? `By payment type:\n${bullet(lines)}` : '';
      detail('Date', vars.summary_date); detail('Total', vars.sales_total); detail('Sales', vars.sales_count);
      break;
    }

    case 'STAFF_NOTIFICATION': {
      vars.title = clean(inputs.title); vars.message_text = need('message_text', 'Message');
      break;
    }
    case 'TASK_REMINDER': {
      vars.task_title = need('task_title', 'Task');
      vars.task_details = clean(inputs.task_details);
      if (inputs.task_due) {
        const d = c(inputs.task_due);
        vars.task_due = d.valid ? (d.state === 'PAST' ? `overdue since ${d.dateLong}` : d.state === 'TODAY' ? `today, ${d.dateLong}` : d.state === 'TOMORROW' ? `tomorrow, ${d.dateLong}` : `on ${d.dateLong}`) : '';
      }
      break;
    }
    case 'APPROVAL_NOTIFICATION': {
      const po = records.po;
      vars.approval_item = clean(inputs.approval_item) || (po ? `Purchase order ${clean(po.po_number)}${po.supplier?.name ? ` from ${po.supplier.name}` : ''}, ${money(po.total_amount)}` : '');
      if (!vars.approval_item) missingInputs.push('What needs approval');
      vars.approval_detail = clean(inputs.approval_detail);
      vars.requested_by = clean(inputs.requested_by);
      if (po && PO_CLOSED.includes(String(po.status).toUpperCase())) fail('NOTHING_TO_APPROVE', 'This order is already closed, so there is nothing to approve.');
      break;
    }
    case 'GENERAL_ANNOUNCEMENT': {
      vars.announcement_title = need('announcement_title', 'Heading'); vars.announcement_text = need('announcement_text', 'Announcement');
      break;
    }
    case 'DEFAULT_MESSAGE': {
      vars.message_text = need('message_text', 'Message');
      break;
    }
    default:
      fail('UNKNOWN_PURPOSE', 'This kind of message is not available.');
  }

  if (missingInputs.length) fail('MISSING_INPUT', `Please fill in: ${missingInputs.join(', ')}.`);
  return { purpose: resolved, requestedPurpose: purpose, switchedNote, vars, details, blocking, warnings, tz: tz || undefined, currency, analysis: records._analysis };
}

const VARIANT_TITLE = { PAYMENT_OVERDUE: 'Overdue payment', PAYMENT_DUE_TODAY: 'Payment due today', PAYMENT_UPCOMING: 'Upcoming payment reminder', PAYMENT_BALANCE: 'Balance reminder' };
function titleOfVariant(k) { return VARIANT_TITLE[k] || k; }

export { OPEN_APPT, PO_CLOSED, addDays, formatTime12 };
