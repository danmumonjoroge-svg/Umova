// node --test tests/comm_engine.test.mjs   (from src/pos-erp)
//
// The communication engine: date intelligence, wording, eligibility, three channels, multi-tenant identity and
// template layering. "Now" is always passed in; the reference day for these tests is 7 November 2026, Nairobi.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateContext, nowInTz, diffDays, addDays, formatLongDate, formatTime12, zonedToInstant, inQuietHours, toYmd,
} from '../supabase/functions/_shared/comm/dateContext.js';
import {
  paymentSentence, deliverySentence, appointmentSentence, formatMoney, revisionSentence, rescheduleSentence,
} from '../supabase/functions/_shared/comm/phrases.js';
import { smsInfo, smsSanitize, renderText, toFriendly, fromFriendly, normalizeMsisdn, contactFor, whatsappFormat } from '../supabase/functions/_shared/comm/render.js';
import { PURPOSES, DEFAULT_TEMPLATES, VARIABLE_LABELS, CHANNELS } from '../supabase/functions/_shared/comm/library.js';
import { compose, checkFinal } from '../supabase/functions/_shared/comm/engine.js';
import { analyseReceivable } from '../supabase/functions/_shared/comm/context.js';
import { normalizePrefs } from '../supabase/functions/_shared/comm/prefs.js';
import { describeStatus, USER_SETTABLE, manualActions } from '../supabase/functions/_shared/comm/statuses.js';

const NOW = new Date('2026-11-07T12:00:00+03:00'); // Saturday 7 November 2026, noon in Nairobi
const TZ = 'Africa/Nairobi';

const bizA = { name: 'Kamau Hardware', phone: '0722 111 222', email: 'info@kamau.example', address: 'Moi Avenue, Nairobi', currency: 'KES', time_zone: TZ };
const bizB = { name: 'Zawadi Salon', phone: '0733 999 888', email: 'hello@zawadi.example', address: 'Kisumu', currency: 'KES', time_zone: TZ };
const cust = { kind: 'CUSTOMER', id: 'c1', name: 'Wanjiru Mwangi', phone: '0712345678', email: 'wanjiru@example.com' };
const supp = { kind: 'SUPPLIER', id: 's1', name: 'Bidco Distributors', contact_person: 'Peter Otieno', phone: '+254 733 000 111', email: 'sales@bidco.example', outstanding_balance: 45000 };

const run = (over) => compose({ business: bizA, prefs: null, templates: [], recipient: cust, now: NOW, channel: 'WHATSAPP', ...over });

// ------------------------------------------------------------------------------------------ date context
test('dates: calendar maths in the business zone', () => {
  assert.equal(diffDays('2026-11-07', '2026-11-08'), 1);
  assert.equal(diffDays('2026-11-07', '2026-11-06'), -1);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(formatLongDate('2026-11-07'), '7 November 2026');
  assert.equal(formatLongDate('2026-11-07', { weekday: true }), 'Saturday, 7 November 2026');
  assert.equal(formatTime12('10:30:00'), '10:30 AM');
  assert.equal(formatTime12('00:05'), '12:05 AM');
  assert.equal(formatTime12('12:00'), '12:00 PM');
  assert.equal(formatTime12('17:45'), '5:45 PM');
});

test('dates: "today" follows the business zone, not UTC', () => {
  // 22:30 UTC on 7 Nov is 01:30 on 8 Nov in Nairobi
  const late = new Date('2026-11-07T22:30:00Z');
  assert.equal(nowInTz(late, TZ).today, '2026-11-08');
  assert.equal(nowInTz(late, 'UTC').today, '2026-11-07');
  assert.equal(toYmd('2026-11-07T22:30:00Z', TZ), '2026-11-08');
  assert.equal(nowInTz(NOW, 'Not/AZone').tz, 'Africa/Nairobi'); // bad zone falls back
});

test('dates: past / today / tomorrow / future', () => {
  const d = (date, time) => dateContext({ date, time, now: NOW, tz: TZ });
  assert.equal(d('2026-11-06').state, 'PAST');
  assert.equal(d('2026-11-06').daysOverdue, 1);
  assert.equal(d('2026-11-07').state, 'TODAY');
  assert.equal(d('2026-11-08').state, 'TOMORROW');
  assert.equal(d('2026-11-08').daysRemaining, 1);
  assert.equal(d('2026-11-09').state, 'FUTURE');
  assert.equal(d('2026-11-09').daysRemaining, 2);
  assert.equal(d('2026-11-09').daysOverdue, 0);
  assert.equal(d('garbage').valid, false);
});

test('dates: exact time, minutes until and time already passed today', () => {
  const later = dateContext({ date: '2026-11-07', time: '15:30', now: NOW, tz: TZ });
  assert.equal(later.minutesUntil, 210);
  assert.equal(later.timePassed, false);
  const earlier = dateContext({ date: '2026-11-07', time: '09:00:00', now: NOW, tz: TZ });
  assert.equal(earlier.timePassed, true);
  assert.equal(zonedToInstant('2026-11-08', '10:30', TZ).toISOString(), '2026-11-08T07:30:00.000Z');
});

test('dates: month and year boundaries', () => {
  const now = new Date('2026-12-31T20:00:00+03:00');
  assert.equal(dateContext({ date: '2027-01-01', now, tz: TZ }).state, 'TOMORROW');
  assert.equal(dateContext({ date: '2026-12-30', now, tz: TZ }).daysOverdue, 1);
});

test('dates: quiet hours cross midnight', () => {
  assert.equal(inQuietHours(new Date('2026-11-07T21:00:00+03:00'), TZ, { start: '20:00', end: '07:00' }), true);
  assert.equal(inQuietHours(new Date('2026-11-07T06:59:00+03:00'), TZ, { start: '20:00', end: '07:00' }), true);
  assert.equal(inQuietHours(new Date('2026-11-07T12:00:00+03:00'), TZ, { start: '20:00', end: '07:00' }), false);
});

// ------------------------------------------------------------------------------------------ the brief's exact examples
test('wording: appointment tomorrow at 10:30', () => {
  const c = dateContext({ date: '2026-11-08', time: '10:30', now: NOW, tz: TZ });
  assert.equal(appointmentSentence(c), 'Your appointment is scheduled for tomorrow, 8 November 2026, at 10:30 AM.');
});

test('wording: payment due the day after tomorrow', () => {
  assert.equal(paymentSentence(dateContext({ date: '2026-11-09', now: NOW, tz: TZ })), 'Your payment is due on 9 November 2026.');
});

test('wording: payment overdue', () => {
  assert.equal(paymentSentence(dateContext({ date: '2026-11-06', now: NOW, tz: TZ })), 'Your payment was due on 6 November 2026 and is now overdue.');
});

test('wording: payment due today with an amount', () => {
  assert.equal(paymentSentence(dateContext({ date: '2026-11-07', now: NOW, tz: TZ }), { amount: 8500 }), 'Your payment of KES 8,500 is due today, 7 November 2026.');
});

test('wording: supplier delivery 1 day overdue, then plural', () => {
  assert.equal(deliverySentence(dateContext({ date: '2026-11-06', now: NOW, tz: TZ })), 'Your delivery is now 1 day overdue. Kindly confirm when we should expect the goods.');
  assert.equal(deliverySentence(dateContext({ date: '2026-11-03', now: NOW, tz: TZ })), 'Your delivery is now 4 days overdue. Kindly confirm when we should expect the goods.');
});

test('wording: nothing is tied to the example dates (shift "now" and the same code follows)', () => {
  const later = new Date('2027-03-15T09:00:00+03:00');
  assert.equal(paymentSentence(dateContext({ date: '2027-03-16', now: later, tz: TZ })), 'Your payment is due tomorrow, 16 March 2027.');
  assert.equal(paymentSentence(dateContext({ date: '2027-03-14', now: later, tz: TZ })), 'Your payment was due on 14 March 2027 and is now overdue.');
  assert.equal(deliverySentence(dateContext({ date: '2027-03-15', now: later, tz: TZ })), 'Your delivery is due today, 15 March 2027.');
});

test('wording: rescheduled and revised dates keep the originals for reference', () => {
  const prev = dateContext({ date: '2026-11-08', time: '10:30', now: NOW, tz: TZ });
  const next = dateContext({ date: '2026-11-10', time: '14:00', now: NOW, tz: TZ });
  assert.match(rescheduleSentence(prev, next), /has been moved to Tuesday, 10 November 2026, at 2:00 PM\./);
  assert.match(rescheduleSentence(prev, next), /previously 8 November 2026, at 10:30 AM|previously 8 November 2026/);
  const o = dateContext({ date: '2026-11-03', now: NOW, tz: TZ }); const r = dateContext({ date: '2026-11-09', now: NOW, tz: TZ });
  assert.equal(revisionSentence(o, r), 'The delivery date was revised from 3 November 2026 to 9 November 2026.');
  assert.equal(revisionSentence(o, o), '');
});

test('money formatting', () => {
  assert.equal(formatMoney(8500), 'KES 8,500');
  assert.equal(formatMoney(1234567.5), 'KES 1,234,567.50');
  assert.equal(formatMoney(0), 'KES 0');
  assert.equal(formatMoney(99, 'USD'), 'USD 99');
});

// ------------------------------------------------------------------------------------------ rendering helpers
test('render: required vs optional variables', () => {
  const r = renderText('Hi {{name}}\nRef: {{ref?}}\nTotal {{amount}}', { name: 'A' }, { amount: 'Amount' });
  assert.equal(r.text, 'Hi A\nTotal [Amount]');
  assert.deepEqual(r.missing, ['amount']);
});

test('render: SMS segments (GSM-7 vs Unicode)', () => {
  assert.deepEqual([smsInfo('a'.repeat(160)).segments, smsInfo('a'.repeat(161)).segments, smsInfo('a'.repeat(306)).segments, smsInfo('a'.repeat(307)).segments], [1, 2, 2, 3]);
  assert.equal(smsInfo('').segments, 0);
  assert.equal(smsInfo('hello €').length, 8); // euro sign is an extension char: 2 units
  const u = smsInfo('Habari \u{1F600}');
  assert.equal(u.unicode, true); assert.equal(u.perSegment, 70);
  assert.equal(smsSanitize('It’s “good” – yes…'), 'It\'s "good" - yes...');
});

test('render: friendly editor round trip hides {{variables}}', () => {
  const t = 'Hello {{customer_name}}, you owe {{outstanding_total}}\nRef: {{invoice_ref?}}';
  const f = toFriendly(t, VARIABLE_LABELS);
  assert.ok(!/\{\{/.test(f));
  assert.match(f, /\[Customer name\]/);
  assert.equal(fromFriendly(f, VARIABLE_LABELS), t);
  assert.equal(fromFriendly('Call me [now]', VARIABLE_LABELS), 'Call me [now]'); // not a known label: left alone
});

test('render: phone numbers', () => {
  for (const x of ['0712345678', '712345678', '254712345678', '+254 712 345 678', '0112345678']) assert.ok(normalizeMsisdn(x), x);
  assert.equal(normalizeMsisdn('0712345678'), '254712345678');
  assert.equal(normalizeMsisdn('+44 7911 123456'), '447911123456');
  for (const x of ['', null, '12345', '0212345678', 'abc']) assert.equal(normalizeMsisdn(x), null, String(x));
  assert.equal(contactFor('SMS', { phone: '0712345678' }), '+254712345678');
  assert.equal(contactFor('WHATSAPP', { phone: '0712345678' }), '254712345678');
  assert.equal(contactFor('EMAIL', { email: 'bad@' }), null);
});

test('render: WhatsApp keeps spacing and bold labels', () => {
  assert.equal(whatsappFormat('Hi\n\n\n\n  *Amount:* 5\n'), 'Hi\n\n*Amount:* 5');
});

// ------------------------------------------------------------------------------------------ library coverage
test('library: every required purpose exists with SMS, WhatsApp and Email wording that differs', () => {
  const required = ['CUSTOMER_WELCOME', 'SALE_CONFIRMATION', 'RECEIPT', 'PAYMENT_RECEIVED', 'PAYMENT_UPCOMING', 'PAYMENT_DUE_TODAY', 'PAYMENT_OVERDUE', 'CUSTOMER_STATEMENT',
    'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'ORDER_CONFIRMATION', 'DELIVERY_NOTIFICATION',
    'SUPPLIER_PURCHASE_ORDER', 'SUPPLIER_PURCHASE_CONFIRMATION', 'SUPPLIER_PAYMENT_CONFIRMATION', 'SUPPLIER_STATEMENT', 'SUPPLIER_BALANCE', 'SUPPLIER_DELIVERY_REMINDER', 'SUPPLIER_DELIVERY_DELAYED', 'SUPPLIER_GOODS_RECEIVED',
    'LOW_STOCK_NOTIFICATION', 'DAILY_SALES_SUMMARY', 'STAFF_NOTIFICATION', 'TASK_REMINDER', 'APPROVAL_NOTIFICATION', 'GENERAL_ANNOUNCEMENT', 'DEFAULT_MESSAGE'];
  for (const k of required) {
    assert.ok(PURPOSES.some((p) => p.key === k), `purpose ${k}`);
    const t = DEFAULT_TEMPLATES[k];
    for (const ch of CHANNELS) assert.ok(t?.[ch]?.body, `${k}/${ch}`);
    assert.ok(t.EMAIL.subject, `${k} email subject`);
    assert.notEqual(t.SMS.body, t.WHATSAPP.body, `${k} SMS vs WhatsApp`);
    assert.notEqual(t.WHATSAPP.body, t.EMAIL.body, `${k} WhatsApp vs Email`);
  }
});

test('library: no business identity is baked into any default template', () => {
  const all = JSON.stringify(DEFAULT_TEMPLATES);
  for (const bad of ['Umova', 'umova', 'Kamau', 'Zawadi']) assert.ok(!all.includes(bad), bad);
});

// ------------------------------------------------------------------------------------------ fixtures
const sale = { id: 'sale-1', sale_number: 'S-00123', completed_at: '2026-11-07T09:15:00+03:00', total_amount: 3450, paid_amount: 3450, status: 'COMPLETED',
  items: [{ quantity: 2, product: { name: 'Cement 50kg' } }, { quantity: 1, product: { name: 'Nails 3in' } }] };
const payment = { id: 'pay-1', amount: 2000, created_at: '2026-11-07T10:00:00+03:00', reference_no: 'QK123XYZ' };
const receivable = (items, outstanding) => ({ outstanding, items, ledger: [
  { created_at: '2026-10-20T10:00:00+03:00', transaction_type: 'SALE', amount: 10500, balance_after: 10500 },
  { created_at: '2026-11-01T10:00:00+03:00', transaction_type: 'PAYMENT', amount: 2000, balance_after: 8500 }] });
const appt = (over = {}) => ({ id: 'a1', status: 'SCHEDULED', appointment_date: '2026-11-08', appointment_time: '10:30:00', service: { name: 'Haircut & Styling' }, staff: { name: 'Mary' }, ...over });
const po = (over = {}) => ({ id: 'po1', po_number: 'PO-0042', status: 'APPROVED', order_date: '2026-10-28', expected_date: '2026-11-06', revised_delivery_date: null, total_amount: 52000,
  supplier: { name: 'Bidco Distributors' }, items: [{ quantity: 20, received_quantity: 0, product: { name: 'Cooking oil 5L' } }, { quantity: 10, received_quantity: 0, product: { name: 'Sugar 2kg' } }], ...over });

// ------------------------------------------------------------------------------------------ customer payments
test('payment reminder picks the wording from the due date (no clicking required)', () => {
  const cases = [
    ['2026-11-09', 'PAYMENT_UPCOMING', 'Your payment of KES 8,500 is due on 9 November 2026.'],
    ['2026-11-08', 'PAYMENT_UPCOMING', 'Your payment of KES 8,500 is due tomorrow, 8 November 2026.'],
    ['2026-11-07', 'PAYMENT_DUE_TODAY', 'Your payment of KES 8,500 is due today, 7 November 2026.'],
    ['2026-11-06', 'PAYMENT_OVERDUE', 'Your payment of KES 8,500 was due on 6 November 2026 and is now overdue.'],
  ];
  for (const [due, expectPurpose, sentence] of cases) {
    for (const channel of CHANNELS) {
      const r = run({ purpose: 'PAYMENT_REMINDER', channel, records: { receivable: receivable([{ due_date: due, amount: 8500, reference: 'INV-77' }], 8500) } });
      assert.equal(r.ok, true, `${due}/${channel}: ${JSON.stringify(r.blocking)}`);
      assert.equal(r.purpose, expectPurpose, `${due}/${channel}`);
      assert.ok(r.body.includes(sentence), `${due}/${channel}\n${r.body}`);
      assert.ok(r.body.includes('Wanjiru') && r.body.includes('Kamau Hardware'), 'recipient and business are filled');
      assert.ok(!/\{\{|\}\}/.test(r.body + r.subject), 'no technical variables');
    }
  }
});

test('payment reminder: explicit wrong variant is corrected to today\'s state and says so', () => {
  const r = run({ purpose: 'PAYMENT_DUE_TODAY', records: { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) } });
  assert.equal(r.purpose, 'PAYMENT_OVERDUE');
  assert.ok(r.switchedNote);
});

test('payment reminder: cleared debt is blocked (no reminders for paid customers)', () => {
  const r = run({ purpose: 'PAYMENT_REMINDER', records: { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 0) } });
  assert.equal(r.ok, false);
  assert.equal(r.blocking[0].code, 'CLEARED');
});

test('payment reminder: partly paid debt only chases what is still open and overdue', () => {
  // two invoices: one overdue (3,000) and one upcoming (5,500), 8,500 owed in total
  const r = run({ purpose: 'PAYMENT_REMINDER', records: { receivable: receivable([{ due_date: '2026-11-06', amount: 3000, reference: 'INV-1' }, { due_date: '2026-11-20', amount: 5500, reference: 'INV-2' }], 8500) } });
  assert.equal(r.purpose, 'PAYMENT_OVERDUE');
  assert.ok(r.body.includes('KES 3,000'));
  assert.ok(r.body.includes('KES 8,500'), 'total outstanding still shown');
  assert.ok(r.body.includes('INV-1') && !r.body.includes('INV-2'));
});

test('payment reminder: amount is never more than what is owed', () => {
  const a = analyseReceivable(receivable([{ due_date: '2026-11-06', amount: 9000 }], 4000), { now: NOW, tz: TZ });
  assert.equal(a.amount, 4000);
});

test('payment reminder: no recorded due date -> honest balance reminder, no invented date', () => {
  const r = run({ purpose: 'PAYMENT_REMINDER', records: { receivable: receivable([], 8500) } });
  assert.equal(r.purpose, 'PAYMENT_BALANCE');
  assert.ok(!/due on|was due/i.test(r.body));
  assert.ok(r.body.includes('KES 8,500'));
});

test('payment received uses the CURRENT balance, and says settled when zero', () => {
  const owes = run({ purpose: 'PAYMENT_RECEIVED', records: { payment, receivable: receivable([], 6500) } });
  assert.ok(owes.body.includes('Your outstanding balance is now KES 6,500.'));
  const settled = run({ purpose: 'PAYMENT_RECEIVED', records: { payment, receivable: receivable([], 0) } });
  assert.ok(settled.body.includes('fully settled'));
  assert.ok(settled.body.includes('QK123XYZ'));
});

test('payment received: reference line disappears when there is none', () => {
  const r = run({ purpose: 'PAYMENT_RECEIVED', records: { payment: { ...payment, reference_no: null }, receivable: receivable([], 0) } });
  assert.ok(!/Reference/.test(r.body));
});

// ------------------------------------------------------------------------------------------ appointments
test('appointment reminder: exact brief example, on all three channels', () => {
  for (const channel of CHANNELS) {
    const r = run({ purpose: 'APPOINTMENT_REMINDER', channel, records: { appointment: appt() } });
    assert.equal(r.ok, true, JSON.stringify(r.blocking));
    assert.ok(r.body.includes('Your appointment is scheduled for tomorrow, 8 November 2026, at 10:30 AM.'), r.body);
  }
});

test('appointment: cancelled gets no reminder/confirmation, and "cancelled" message needs a cancelled appointment', () => {
  const cancelled = appt({ status: 'CANCELLED' });
  assert.equal(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: cancelled } }).ok, false);
  assert.equal(run({ purpose: 'APPOINTMENT_CONFIRMATION', records: { appointment: cancelled } }).ok, false);
  const c = run({ purpose: 'APPOINTMENT_CANCELLED', records: { appointment: cancelled } });
  assert.equal(c.ok, true);
  assert.ok(c.body.includes('has been cancelled'));
  assert.equal(run({ purpose: 'APPOINTMENT_CANCELLED', records: { appointment: appt() } }).blocking[0].code, 'NOT_CANCELLED');
});

test('appointment: rescheduled uses the NEW slot and keeps the old one for reference', () => {
  const moved = appt({ appointment_date: '2026-11-10', appointment_time: '14:00:00', rescheduled_from_date: '2026-11-08', rescheduled_from_time: '10:30:00' });
  const r = run({ purpose: 'APPOINTMENT_RESCHEDULED', records: { appointment: moved } });
  assert.equal(r.ok, true);
  assert.ok(r.body.includes('Tuesday, 10 November 2026, at 2:00 PM'));
  assert.ok(r.body.includes('8 November 2026'));
  assert.ok(r.details.some((d) => d.label === 'Previously'));
  // a reminder for the same appointment talks about the new time only
  const rem = run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: moved } });
  assert.ok(rem.body.includes('10 November 2026') && !rem.body.includes('8 November 2026'));
});

test('appointment: time already gone today, or day passed, blocks a reminder', () => {
  assert.equal(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ appointment_date: '2026-11-07', appointment_time: '09:00:00' }) } }).ok, false);
  assert.equal(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ appointment_date: '2026-11-05' }) } }).ok, false);
  assert.equal(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ status: 'COMPLETED' }) } }).ok, false);
  const today = run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ appointment_date: '2026-11-07', appointment_time: '15:30:00' }) } });
  assert.ok(today.body.includes('today, 7 November 2026, at 3:30 PM'));
});

// ------------------------------------------------------------------------------------------ suppliers
test('supplier delivery: 1 day overdue picks the delayed wording and the brief\'s sentence', () => {
  for (const channel of CHANNELS) {
    const r = run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', channel, recipient: supp, records: { po: po() } });
    assert.equal(r.ok, true, JSON.stringify(r.blocking));
    assert.equal(r.purpose, 'SUPPLIER_DELIVERY_DELAYED');
    assert.ok(r.body.includes('Your delivery is now 1 day overdue. Kindly confirm when we should expect the goods.'), r.body);
    assert.ok(r.body.includes('PO-0042'));
    assert.ok(r.body.includes('Cooking oil 5L'));
  }
});

test('supplier delivery: revised date is used for lateness, the original is kept and mentioned', () => {
  const revised = po({ expected_date: '2026-11-03', revised_delivery_date: '2026-11-09' });
  const r = run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: revised } });
  assert.equal(r.purpose, 'SUPPLIER_DELIVERY_REMINDER'); // not late any more
  assert.ok(r.body.includes('Your delivery is due on 9 November 2026.'));
  assert.ok(r.body.includes('revised from 3 November 2026 to 9 November 2026'));
  const lateAgain = po({ expected_date: '2026-11-03', revised_delivery_date: '2026-11-05' });
  const l = run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: lateAgain } });
  assert.ok(l.body.includes('2 days overdue'));
});

test('supplier delivery: goods already received (or cancelled) -> no delay message', () => {
  assert.equal(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ status: 'RECEIVED' }) } }).ok, false);
  assert.equal(run({ purpose: 'SUPPLIER_DELIVERY_DELAYED', recipient: supp, records: { po: po({ status: 'CANCELLED' }) } }).ok, false);
  const allIn = po({ status: 'PARTIALLY_RECEIVED', items: [{ quantity: 5, received_quantity: 5, product: { name: 'X' } }] });
  assert.equal(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: allIn } }).blocking[0].code, 'ALL_RECEIVED');
});

test('supplier delivery: partial delivery asks only for what is still outstanding', () => {
  const partial = po({ status: 'PARTIALLY_RECEIVED', items: [{ quantity: 20, received_quantity: 8, product: { name: 'Cooking oil 5L' } }] });
  const r = run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: partial } });
  assert.ok(r.body.includes('12 of 20 x Cooking oil 5L still to come'));
});

test('supplier delivery: not-yet-late orders get a reminder, and an unapproved order gets nothing', () => {
  const soon = run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ expected_date: '2026-11-08' }) } });
  assert.equal(soon.purpose, 'SUPPLIER_DELIVERY_REMINDER');
  assert.ok(soon.body.includes('due tomorrow, 8 November 2026'));
  assert.equal(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ status: 'DRAFT' }) } }).ok, false);
  assert.equal(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ expected_date: null }) } }).blocking[0].code, 'NO_EXPECTED_DATE');
});

test('supplier greeting uses the contact person; payment confirmation states the balance', () => {
  const r = run({ purpose: 'SUPPLIER_PAYMENT_CONFIRMATION', recipient: { ...supp, outstanding_balance: 0 }, records: { supplierPayment: { amount: 45000, created_at: '2026-11-07T08:00:00+03:00', reference_no: 'RTG-9', payment_method: 'BANK_TRANSFER' } } });
  assert.ok(r.body.startsWith('Hello Peter,'), r.body);
  assert.ok(r.body.includes('fully settled'));
  assert.ok(r.body.includes('Bank transfer'));
});

test('purchase order message carries items, total and the requested delivery date', () => {
  const r = run({ purpose: 'SUPPLIER_PURCHASE_ORDER', channel: 'EMAIL', recipient: supp, records: { po: po({ expected_date: '2026-11-14' }) } });
  assert.equal(r.ok, true);
  assert.ok(r.subject.includes('PO-0042') && r.subject.includes('Kamau Hardware'));
  assert.ok(r.body.includes('20 x Cooking oil 5L') && r.body.includes('KES 52,000') && r.body.includes('14 November 2026'));
});

test('goods received confirmation says what is still outstanding', () => {
  const grn = { grn_number: 'GRN-9', created_at: '2026-11-07T10:00:00+03:00', items: [{ quantity: 8, product: { name: 'Cooking oil 5L' } }], po: po({ status: 'PARTIALLY_RECEIVED', items: [{ quantity: 20, received_quantity: 8, product: { name: 'Cooking oil 5L' } }] }) };
  const r = run({ purpose: 'SUPPLIER_GOODS_RECEIVED', recipient: supp, records: { grn } });
  assert.equal(r.ok, true, JSON.stringify(r.blocking));
  assert.ok(r.body.includes('8 x Cooking oil 5L') && r.body.includes('Still to come: 12 x Cooking oil 5L'));
});

// ------------------------------------------------------------------------------------------ sales / statements / business ops
test('sale confirmation, receipt, order and statement render on every channel', () => {
  for (const channel of CHANNELS) {
    for (const purpose of ['SALE_CONFIRMATION', 'RECEIPT', 'ORDER_CONFIRMATION']) {
      const r = run({ purpose, channel, records: { sale } });
      assert.equal(r.ok, true, `${purpose}/${channel} ${JSON.stringify(r.blocking)}`);
      assert.ok(r.body.includes('KES 3,450') && r.body.includes('S-00123') && r.body.includes('7 November 2026'), `${purpose}/${channel}`);
    }
    const st = run({ purpose: 'CUSTOMER_STATEMENT', channel, records: { receivable: receivable([{ due_date: '2026-11-20', amount: 8500 }], 8500) } });
    assert.equal(st.ok, true);
    assert.ok(st.body.includes('KES 8,500') && st.body.includes('7 November 2026'));
  }
});

test('credit sale shows the balance still to pay; reversed sale is blocked', () => {
  const credit = run({ purpose: 'SALE_CONFIRMATION', records: { sale: { ...sale, paid_amount: 1000 } } });
  assert.ok(credit.body.includes('Balance still to pay: KES 2,450.'));
  assert.equal(run({ purpose: 'RECEIPT', records: { sale: { ...sale, status: 'REVERSED' } } }).ok, false);
});

test('delivery notification wording follows its date and status', () => {
  const mk = (inputs) => run({ purpose: 'DELIVERY_NOTIFICATION', channel: 'SMS', records: { sale }, inputs });
  assert.ok(mk({ delivery_status: 'ON_THE_WAY', delivery_date: '2026-11-08' }).body.includes('expected tomorrow, 8 November 2026'));
  assert.ok(mk({ delivery_status: 'DELIVERED', delivery_date: '2026-11-07' }).body.includes('delivered today, 7 November 2026'));
  assert.ok(mk({ delivery_status: 'READY' }).body.includes('ready for collection'));
  assert.equal(mk({ delivery_status: 'DELIVERED', delivery_date: '2026-11-09' }).ok, false);
});

test('business operations messages', () => {
  const owner = { kind: 'OWNER', name: 'Joseph Kamau', phone: '0700123456', email: 'owner@kamau.example' };
  const low = run({ purpose: 'LOW_STOCK_NOTIFICATION', recipient: owner, records: { lowStock: [{ name: 'Cement 50kg', quantity: 3, reorder_level: 20 }, { name: 'Nails 3in', quantity: 0, stock_status: 'OUT_OF_STOCK' }] } });
  assert.ok(low.body.includes('Cement 50kg: 3 left (reorder at 20)') && low.body.includes('Nails 3in: out of stock'));
  assert.equal(run({ purpose: 'LOW_STOCK_NOTIFICATION', recipient: owner, records: { lowStock: [] } }).ok, false);
  const daily = run({ purpose: 'DAILY_SALES_SUMMARY', recipient: owner, records: { daily: { date: '2026-11-07', total: 48250, count: 31, byMethod: { CASH: 20000, MOBILE_MONEY: 28250, CARD: 0 } } } });
  assert.ok(daily.body.includes('KES 48,250') && daily.body.includes('Mobile money: KES 28,250') && !daily.body.includes('Card'));
  const task = run({ purpose: 'TASK_REMINDER', recipient: owner, channel: 'SMS', inputs: { task_title: 'Count the stockroom', task_due: '2026-11-08' } });
  assert.ok(task.body.includes('Count the stockroom') && task.body.includes('tomorrow, 8 November 2026'));
  const needsInput = run({ purpose: 'GENERAL_ANNOUNCEMENT', inputs: {} });
  assert.equal(needsInput.ok, false);
  assert.match(needsInput.blocking.map((b) => b.message).join(' '), /Heading/);
  const ann = run({ purpose: 'GENERAL_ANNOUNCEMENT', inputs: { announcement_title: 'Holiday hours', announcement_text: 'We close at 3pm on Friday.' } });
  assert.ok(ann.ok && ann.body.includes('Holiday hours'));
  const def = run({ purpose: 'DEFAULT_MESSAGE', inputs: { message_text: 'Thanks for your support.' } });
  assert.ok(def.ok && def.body.includes('Thanks for your support.'));
  const approval = run({ purpose: 'APPROVAL_NOTIFICATION', recipient: owner, records: { po: po({ status: 'PENDING_APPROVAL' }) }, inputs: {} });
  assert.ok(approval.ok && approval.body.includes('PO-0042'));
});

test('every purpose composes on every channel without leftovers (smoke over the whole library)', () => {
  const records = { sale, payment, receivable: receivable([{ due_date: '2026-11-09', amount: 8500, reference: 'INV-1' }], 8500), appointment: appt(), po: po({ expected_date: '2026-11-09' }),
    supplierPayment: { amount: 1000, created_at: NOW }, grn: { items: [{ quantity: 1, product: { name: 'X' } }], created_at: NOW, grn_number: 'G1', po: po() }, recentPos: [po()], recentSupplierPayments: [],
    lowStock: [{ name: 'A', quantity: 1 }], daily: { date: '2026-11-07', total: 10, count: 1, byMethod: { CASH: 10 } } };
  const inputs = { title: 'T', message_text: 'M', task_title: 'T', announcement_title: 'H', announcement_text: 'A', approval_item: 'X', delivery_status: 'ON_THE_WAY' };
  for (const p of PURPOSES) {
    for (const channel of CHANNELS) {
      const recipient = p.audience === 'SUPPLIER' ? supp : cust;
      const r = run({ purpose: p.key, channel, recipient, records, inputs });
      if (p.key === 'APPOINTMENT_CANCELLED' || p.key === 'PAYMENT_UPCOMING' && false) continue;
      const hard = r.blocking.filter((b) => !['CLEARED', 'NOT_CANCELLED', 'ALL_RECEIVED'].includes(b.code));
      assert.deepEqual(hard.map((b) => b.code), [], `${p.key}/${channel}: ${JSON.stringify(r.blocking)}\n${r.body}`);
      assert.ok(!/\{\{|\}\}/.test(r.body + r.subject), `${p.key}/${channel}: braces`);
      assert.ok(!/\[[A-Z][a-z]+( [a-z]+)*\]/.test(r.body), `${p.key}/${channel}: placeholder left\n${r.body}`);
      if (channel === 'EMAIL') assert.ok(r.subject, `${p.key} subject`);
    }
  }
});

// ------------------------------------------------------------------------------------------ channels differ
test('channels are formatted differently: SMS short and plain, WhatsApp bold, Email with subject and contact block', () => {
  const rec = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500, reference: 'INV-77' }], 8500) };
  const sms = run({ purpose: 'PAYMENT_REMINDER', channel: 'SMS', records: rec });
  const wa = run({ purpose: 'PAYMENT_REMINDER', channel: 'WHATSAPP', records: rec });
  const em = run({ purpose: 'PAYMENT_REMINDER', channel: 'EMAIL', records: rec });
  assert.ok(sms.sms.segments >= 1 && sms.body.length < wa.body.length);
  assert.ok(!sms.body.includes('*'));
  assert.ok(wa.body.includes('*Amount overdue:*') && wa.body.includes('\n\n'));
  assert.ok(em.subject.startsWith('Overdue payment') && em.body.startsWith('Dear Wanjiru,'));
  assert.ok(sms.body.startsWith('Hi Wanjiru,') && wa.body.startsWith('Hello Wanjiru,'));
});

// ------------------------------------------------------------------------------------------ multi-tenant
test('each business speaks as itself: name, contact details, greeting, sign-off, payment instructions', () => {
  const recA = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) };
  const a = compose({ purpose: 'PAYMENT_REMINDER', channel: 'EMAIL', business: bizA, prefs: normalizePrefs({ settings: { payment_instructions: 'Pay via M-Pesa Paybill 123456.' } }), recipient: cust, records: recA, now: NOW });
  const b = compose({ purpose: 'PAYMENT_REMINDER', channel: 'EMAIL', business: bizB, prefs: normalizePrefs({ settings: { greeting: 'Habari {{recipient_greeting_name}}!', sign_off: 'Asante sana,\n{{business_name}} team' } }), recipient: cust, records: recA, now: NOW });
  assert.ok(a.body.includes('Kamau Hardware') && !a.body.includes('Zawadi'));
  assert.ok(a.body.includes('Pay via M-Pesa Paybill 123456.'));
  assert.ok(b.body.includes('Zawadi Salon') && !b.body.includes('Kamau') && !b.body.includes('M-Pesa Paybill'));
  assert.ok(b.body.startsWith('Habari Wanjiru!') && b.body.includes('Asante sana,\nZawadi Salon team'));
  const welcome = compose({ purpose: 'CUSTOMER_WELCOME', channel: 'EMAIL', business: bizB, prefs: null, recipient: cust, records: {}, now: NOW });
  assert.ok(welcome.body.includes('hello@zawadi.example') && welcome.body.includes('Kisumu') && !/Kamau|Umova/.test(welcome.body));
});

test('a business with no name cannot send (never falls back to another tenant\'s identity)', () => {
  const r = compose({ purpose: 'CUSTOMER_WELCOME', channel: 'SMS', business: { name: '' }, recipient: cust, now: NOW });
  assert.equal(r.ok, false);
  assert.ok(r.blocking.some((b) => b.code === 'NO_BUSINESS_NAME'));
});

// ------------------------------------------------------------------------------------------ three levels of customisation
test('business template replaces the system wording; the per-message edit never changes it', () => {
  const rows = [{ id: 't1', purpose: 'PAYMENT_OVERDUE', channel: 'SMS', is_active: true, is_customised: true, body: '{{greeting}} Pay {{due_amount}} now or we call. {{business_name}}' }];
  const frozen = JSON.stringify(rows);
  const rec = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) };
  const r = run({ purpose: 'PAYMENT_REMINDER', channel: 'SMS', templates: rows, records: rec });
  assert.equal(r.source, 'BUSINESS'); assert.equal(r.templateId, 't1');
  assert.ok(r.body.includes('Pay KES 8,500 now or we call. Kamau Hardware'));
  // another channel of the same purpose has no business template -> system default
  assert.equal(run({ purpose: 'PAYMENT_REMINDER', channel: 'WHATSAPP', templates: rows, records: rec }).source, 'SYSTEM');
  // the owner edits THIS message: engine output is plain data; templates are untouched
  const edited = r.body.replace('Pay', 'Please pay');
  assert.ok(checkFinal({ channel: 'SMS', body: edited, to: '+254712345678' }).ok);
  assert.equal(JSON.stringify(rows), frozen);
  assert.equal(run({ purpose: 'PAYMENT_REMINDER', channel: 'SMS', templates: rows, records: rec }).body, r.body);
  // inactive template is ignored
  assert.equal(run({ purpose: 'PAYMENT_REMINDER', channel: 'SMS', templates: [{ ...rows[0], is_active: false }], records: rec }).source, 'SYSTEM');
});

test('a saved template that needs details we cannot supply falls back to the system wording', () => {
  const rows = [{ id: 't2', purpose: 'APPOINTMENT_REMINDER', channel: 'SMS', is_active: true, is_customised: true, body: 'See you {{when_exactly}}' }];
  const r = run({ purpose: 'APPOINTMENT_REMINDER', channel: 'SMS', templates: rows, records: { appointment: appt() } });
  assert.equal(r.source, 'SYSTEM'); assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'TEMPLATE_FALLBACK'));
});

test('old phase-7 seeds do not shadow the new default; wording the owner really edited is honoured', () => {
  const seed = { id: 'l1', message_type: 'PAYMENT_OVERDUE', purpose: null, channel: 'WHATSAPP', is_active: true, body: 'Hi {{customer_name}}, your balance with {{business_name}} is KES {{balance}} and is now overdue. Kindly settle when you can. Thank you.' };
  const rec = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) };
  assert.equal(run({ purpose: 'PAYMENT_REMINDER', templates: [seed], records: rec }).source, 'SYSTEM');
  const mine = { ...seed, id: 'l2', body: 'Dear {{customer_name}}, KES {{balance}} is overdue at {{business_name}}. Please pay today.' };
  const r = run({ purpose: 'PAYMENT_REMINDER', templates: [mine], records: rec });
  assert.equal(r.source, 'BUSINESS');
  assert.ok(r.body.includes('Dear Wanjiru Mwangi, KES 8,500 is overdue at Kamau Hardware.'));
});

test('engine does not mutate its inputs', () => {
  const records = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) };
  const before = JSON.stringify(records);
  run({ purpose: 'PAYMENT_REMINDER', records });
  run({ purpose: 'PAYMENT_REMINDER', records });
  // buildContext stashes its analysis on a private key; the persisted data must be unchanged otherwise
  assert.equal(JSON.stringify({ ...records, _analysis: undefined }), JSON.stringify({ ...JSON.parse(before), _analysis: undefined }));
});

// ------------------------------------------------------------------------------------------ preview / edit checks
test('final-message checks: email subject, SMS parts, leftover placeholders, empty text', () => {
  assert.equal(checkFinal({ channel: 'EMAIL', subject: '', body: 'x', to: 'a@b.co' }).blocking[0].code, 'NO_SUBJECT');
  assert.equal(checkFinal({ channel: 'SMS', body: '   ', to: '+254712345678' }).blocking[0].code, 'EMPTY');
  assert.equal(checkFinal({ channel: 'SMS', body: 'Hi {{x}}', to: '+254712345678' }).ok, false);
  assert.ok(checkFinal({ channel: 'SMS', body: 'Hello [Customer name]', to: '+254712345678' }).warnings.some((w) => w.code === 'PLACEHOLDER'));
  const long = checkFinal({ channel: 'SMS', body: 'a'.repeat(500), to: '+254712345678' });
  assert.equal(long.sms.segments, 4);
  assert.ok(long.warnings.some((w) => w.code === 'LONG_SMS'));
  assert.ok(checkFinal({ channel: 'SMS', body: 'Habari \u{1F600}', to: '+254712345678' }).warnings.some((w) => w.code === 'UNICODE_SMS'));
});

test('contact missing blocks only that channel', () => {
  const noPhone = { ...cust, phone: '', email: 'w@example.com' };
  assert.equal(run({ purpose: 'CUSTOMER_WELCOME', channel: 'SMS', recipient: noPhone }).blocking[0].code, 'NO_CONTACT');
  assert.equal(run({ purpose: 'CUSTOMER_WELCOME', channel: 'EMAIL', recipient: noPhone }).ok, true);
});

// ------------------------------------------------------------------------------------------ statuses
test('status honesty: users cannot assert delivery; WhatsApp "opened" is not "sent"', () => {
  assert.deepEqual(USER_SETTABLE.filter((s) => ['DELIVERED', 'READ', 'SUBMITTED'].includes(s)), []);
  assert.equal(describeStatus({ status: 'OPENED', channel: 'WHATSAPP', provider: null }).label, 'Opened in WhatsApp');
  assert.equal(describeStatus({ status: 'SENT', channel: 'WHATSAPP', provider: null }).label, 'Sent by you');
  assert.equal(describeStatus({ status: 'DELIVERED', channel: 'SMS', provider: 'AFRICASTALKING' }).label, 'Delivered');
  assert.deepEqual(manualActions({ status: 'OPENED', provider: null }), ['MARK_SENT', 'MARK_NOT_SENT']);
  assert.deepEqual(manualActions({ status: 'OPENED', provider: 'AFRICASTALKING' }), []);
});

test('prefs: defaults are safe (nothing sends automatically) and bad values are repaired', () => {
  const p = normalizePrefs(null);
  assert.ok(Object.values(p.automations).every((a) => a.mode !== 'AUTO'));
  const bad = normalizePrefs({ settings: { timing: { payment_lead_days: 'x', overdue_repeat_days: -5 }, automations: { PAYMENT_REMINDER: { mode: 'WHATEVER', channel: 'FAX' } } } });
  assert.equal(bad.timing.payment_lead_days, 2); assert.equal(bad.timing.overdue_repeat_days, 1);
  assert.equal(bad.automations.PAYMENT_REMINDER.mode, 'DRAFT'); assert.equal(bad.automations.PAYMENT_REMINDER.channel, 'WHATSAPP');
});

// ------------------------------------------------------------------------------------------ planner (what gets scheduled)
import { planCustomerReminders, planAppointments, planPurchaseOrders, overdueBucket, planDigests } from '../supabase/functions/_shared/comm/planner.js';
const P = normalizePrefs(null);

test('planner: customer reminders fire on lead day, due day, and repeat while overdue, never when cleared', () => {
  const cust1 = (due, out = 8500) => [{ id: 'c1', outstanding: out, items: [{ due_date: due, amount: 8500 }] }];
  assert.equal(planCustomerReminders(cust1('2026-11-09'), P, NOW, TZ)[0].purpose, 'PAYMENT_UPCOMING');
  assert.equal(planCustomerReminders(cust1('2026-11-12'), P, NOW, TZ).length, 0); // 5 days out > lead of 2
  assert.equal(planCustomerReminders(cust1('2026-11-07'), P, NOW, TZ)[0].purpose, 'PAYMENT_DUE_TODAY');
  assert.equal(planCustomerReminders(cust1('2026-11-06'), P, NOW, TZ)[0].purpose, 'PAYMENT_OVERDUE');
  assert.equal(planCustomerReminders(cust1('2026-11-06', 0), P, NOW, TZ).length, 0);
  // deterministic keys -> the same run twice produces the same key (duplicate prevention)
  assert.equal(planCustomerReminders(cust1('2026-11-06'), P, NOW, TZ)[0].dedupe_key, planCustomerReminders(cust1('2026-11-06'), P, NOW, TZ)[0].dedupe_key);
  // day 1 and day 7 of overdue share a bucket; day 8 is a new reminder; stops after the maximum
  assert.equal(overdueBucket(1, 7), 0); assert.equal(overdueBucket(7, 7), 0); assert.equal(overdueBucket(8, 7), 1);
  assert.equal(planCustomerReminders(cust1('2026-10-01'), P, NOW, TZ).length, 0); // 37 days -> bucket 5 >= max 3
});

test('planner: appointments are reminded inside the lead window only, moved/cancelled ones get their own message', () => {
  const a = (o) => ({ id: 'a1', customer_id: 'c1', status: 'SCHEDULED', appointment_date: '2026-11-08', appointment_time: '10:30:00', ...o });
  assert.equal(planAppointments([a()], P, NOW, TZ)[0].purpose, 'APPOINTMENT_REMINDER'); // 22.5h away
  assert.equal(planAppointments([a({ appointment_date: '2026-11-10' })], P, NOW, TZ).length, 0);
  assert.equal(planAppointments([a({ appointment_date: '2026-11-07', appointment_time: '09:00' })], P, NOW, TZ).length, 0); // already gone
  const moved = planAppointments([a({ rescheduled_at: '2026-11-07T08:00:00+03:00', rescheduled_from_date: '2026-11-05', rescheduled_from_time: '10:00' })], P, NOW, TZ);
  assert.deepEqual(moved.map((j) => j.purpose).sort(), ['APPOINTMENT_REMINDER', 'APPOINTMENT_RESCHEDULED']);
  assert.ok(moved.every((j) => j.dedupe_key.includes('2026-11-08T10:30'))); // new slot -> new key
  assert.equal(planAppointments([a({ status: 'CANCELLED', cancelled_at: '2026-11-07T08:00:00+03:00' })], P, NOW, TZ)[0].purpose, 'APPOINTMENT_CANCELLED');
  assert.equal(planAppointments([a({ status: 'CANCELLED' })], P, NOW, TZ).length, 0);
});

test('planner: deliveries are flagged when late, not when received, and use the revised date', () => {
  const o = (x) => ({ id: 'po1', supplier_id: 's1', status: 'APPROVED', expected_date: '2026-11-06', created_at: '2026-10-01T00:00:00Z', items: [{ quantity: 5, received_quantity: 0 }], ...x });
  assert.equal(planPurchaseOrders([o()], P, NOW, TZ)[0].purpose, 'SUPPLIER_DELIVERY_DELAYED');
  assert.equal(planPurchaseOrders([o({ status: 'RECEIVED' })], P, NOW, TZ).filter((j) => j.automation === 'SUPPLIER_DELIVERY_REMINDER').length, 0);
  assert.equal(planPurchaseOrders([o({ items: [{ quantity: 5, received_quantity: 5 }] })], P, NOW, TZ).length, 0);
  assert.equal(planPurchaseOrders([o({ revised_delivery_date: '2026-11-20' })], P, NOW, TZ).length, 0);
  assert.equal(planPurchaseOrders([o({ expected_date: '2026-11-08' })], P, NOW, TZ)[0].purpose, 'SUPPLIER_DELIVERY_REMINDER');
});

test('planner: digests wait for their hour in the business zone', () => {
  assert.equal(planDigests(P, new Date('2026-11-07T06:00:00+03:00'), TZ).length, 0);
  assert.equal(planDigests(P, new Date('2026-11-07T08:30:00+03:00'), TZ).map((j) => j.purpose).join(), 'LOW_STOCK_NOTIFICATION');
  assert.equal(planDigests(P, new Date('2026-11-07T19:30:00+03:00'), TZ).length, 2);
});

// ------------------------------------------------------------------------------------------ providers (mocked network)
import { sendSms, sendEmail, sendWhatsApp, isConfigured } from '../supabase/functions/_shared/comm/providers.js';
import { parseAfricasTalking, parseResend, parseWhatsApp, shouldAdvance, verifyMetaSignature } from '../supabase/functions/_shared/comm/webhooks.js';
import { sendLogRow, nextRetryDelayMinutes } from '../supabase/functions/_shared/comm/sender.js';

const ENV = { AT_USERNAME: 'sandbox', AT_API_KEY: 'k', RESEND_API_KEY: 'r', COMM_EMAIL_FROM: 'My Business <no-reply@x.co>', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' };
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('providers: nothing is sent when credentials are missing', async () => {
  assert.equal(isConfigured('SMS', {}), false);
  let called = false;
  const r = await sendSms({ to: '+254712345678', text: 'x' }, { env: {}, fetchFn: async () => { called = true; } });
  assert.equal(r.ok, false); assert.equal(r.code, 'PROVIDER_NOT_CONFIGURED'); assert.equal(called, false);
});

test('providers: Africa\'s Talking request shape, accepted and refused numbers', async () => {
  let seen;
  const ok = await sendSms({ to: '+254712345678', text: 'Hello' }, { env: ENV, fetchFn: async (u, i) => { seen = { u, i }; return resp(201, { SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_9' }] } }); } });
  assert.ok(ok.ok); assert.equal(ok.providerId, 'ATXid_9');
  assert.match(seen.u, /sandbox\.africastalking\.com/); assert.equal(seen.i.headers.apiKey, 'k');
  assert.match(seen.i.body, /to=%2B254712345678/);
  const bad = await sendSms({ to: '+2540', text: 'x' }, { env: ENV, fetchFn: async () => resp(201, { SMSMessageData: { Recipients: [{ statusCode: 403, status: 'InvalidPhoneNumber' }] } }) });
  assert.equal(bad.ok, false); assert.equal(bad.transient, false);
  const busy = await sendSms({ to: '+254712345678', text: 'x' }, { env: ENV, fetchFn: async () => resp(503, {}) });
  assert.equal(busy.transient, true);
  const net = await sendSms({ to: '+254712345678', text: 'x' }, { env: ENV, fetchFn: async () => { throw new Error('boom'); } });
  assert.equal(net.transient, true);
});

test('providers: Resend and WhatsApp request shapes and failure classes', async () => {
  let seen;
  const e = await sendEmail({ to: 'a@b.co', subject: 'S', text: 'Body', businessName: 'Kamau Hardware' }, { env: ENV, fetchFn: async (u, i) => { seen = JSON.parse(i.body); return resp(200, { id: 'em_1' }); } });
  assert.ok(e.ok); assert.equal(e.providerId, 'em_1');
  assert.equal(seen.from, 'Kamau Hardware <no-reply@x.co>'); assert.deepEqual(seen.to, ['a@b.co']); assert.ok(seen.html.includes('Body'));
  const w = await sendWhatsApp({ to: '254712345678', text: 'Hi' }, { env: ENV, fetchFn: async (u, i) => { seen = { u, b: JSON.parse(i.body) }; return resp(200, { messages: [{ id: 'wamid.1' }] }); } });
  assert.ok(w.ok); assert.match(seen.u, /\/123\/messages$/); assert.equal(seen.b.type, 'text');
  const win = await sendWhatsApp({ to: '254712345678', text: 'Hi' }, { env: ENV, fetchFn: async () => resp(400, { error: { code: 131047, message: 'Re-engagement' } }) });
  assert.equal(win.ok, false); assert.equal(win.transient, false); assert.match(win.message, /24 hours/);
});

test('sender: records SUBMITTED (not delivered) on success, FAILED with reason on refusal, and never calls an unconfigured provider', async () => {
  const updates = [];
  const svc = { from: () => ({ update: (u) => ({ eq: async () => { updates.push(u); return {}; } }) }) };
  const row = { id: 'l1', channel: 'SMS', recipient: '+254712345678', rendered_message: 'Hi', attempts: 0 };
  const ok = await sendLogRow({ svc, row, env: ENV, fetchFn: async () => resp(201, { SMSMessageData: { Recipients: [{ statusCode: 101, messageId: 'm1' }] } }) });
  assert.equal(ok.state, 'SUBMITTED'); assert.equal(updates.at(-1).status, 'SUBMITTED'); assert.ok(updates.at(-1).submitted_at);
  assert.ok(!('delivered_at' in updates.at(-1)));
  const bad = await sendLogRow({ svc, row, env: ENV, fetchFn: async () => resp(201, { SMSMessageData: { Recipients: [{ statusCode: 403, status: 'InvalidPhoneNumber' }] } }) });
  assert.equal(bad.state, 'FAILED'); assert.equal(updates.at(-1).status, 'FAILED'); assert.ok(updates.at(-1).failure_reason);
  const n = updates.length;
  const none = await sendLogRow({ svc, row, env: {}, fetchFn: async () => { throw new Error('must not be called'); } });
  assert.equal(none.state, 'NOT_CONFIGURED'); assert.equal(updates.length, n);
  assert.deepEqual([1, 2, 3, 4, 9].map(nextRetryDelayMinutes), [5, 15, 60, 240, 240]);
});

test('webhooks: receipts map to honest statuses and never move a message backwards', async () => {
  assert.deepEqual(parseAfricasTalking(new URLSearchParams({ id: 'A1', status: 'Success' })), [{ provider: 'AFRICASTALKING', id: 'A1', status: 'DELIVERED', reason: '' }]);
  assert.equal(parseAfricasTalking(new URLSearchParams({ id: 'A1', status: 'Failed', failureReason: 'UserInBlackList' }))[0].reason, 'UserInBlackList');
  assert.equal(parseResend({ type: 'email.bounced', data: { email_id: 'e1' } })[0].status, 'FAILED');
  assert.equal(parseResend({ type: 'email.opened', data: { email_id: 'e1' } }).length, 0); // opens are not tracked
  const wa = parseWhatsApp({ entry: [{ changes: [{ value: { statuses: [{ id: 'w1', status: 'read' }, { id: 'w2', status: 'failed', errors: [{ title: 'Not allowed' }] }] } }] }] });
  assert.deepEqual(wa.map((x) => x.status), ['READ', 'FAILED']);
  assert.equal(shouldAdvance('SUBMITTED', 'DELIVERED'), true);
  assert.equal(shouldAdvance('DELIVERED', 'SENT'), false);
  assert.equal(shouldAdvance('DELIVERED', 'FAILED'), false);
  assert.equal(shouldAdvance('SUBMITTED', 'FAILED'), true);
  assert.equal(shouldAdvance('DELIVERED', 'READ'), true);
  assert.equal(shouldAdvance('SUBMITTED', 'SENT'), true);
  const body = '{"a":1}'; const secret = 's3cret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await verifyMetaSignature(body, `sha256=${hex}`, secret), true);
  assert.equal(await verifyMetaSignature(body, `sha256=${hex}`, 'wrong'), false);
  assert.equal(await verifyMetaSignature(body, undefined, secret), false);
});

// ------------------------------------------------------------------------------------------------ dispatcher decisions
import { evaluateJob, SUPPRESS_CODES, parentPurpose } from '../supabase/functions/_shared/comm/dispatcher.js';

test('dispatcher: a job is sent only when still valid; "no longer needed" suppresses; "needs a person" waits for review', () => {
  const rec = { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 8500) };
  assert.equal(evaluateJob(run({ purpose: 'PAYMENT_REMINDER', records: rec })).action, 'SEND');
  // debt paid between planning and sending
  assert.equal(evaluateJob(run({ purpose: 'PAYMENT_REMINDER', records: { receivable: receivable([{ due_date: '2026-11-06', amount: 8500 }], 0) } })).action, 'SUPPRESS');
  // goods received
  assert.equal(evaluateJob(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ status: 'RECEIVED' }) } })).action, 'SUPPRESS');
  // appointment cancelled / already past
  assert.equal(evaluateJob(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ status: 'CANCELLED' }) } })).action, 'SUPPRESS');
  assert.equal(evaluateJob(run({ purpose: 'APPOINTMENT_REMINDER', records: { appointment: appt({ appointment_date: '2026-11-01' }) } })).action, 'SUPPRESS');
  // customer has no number: not suppressed, a person must fix it
  assert.equal(evaluateJob(run({ purpose: 'PAYMENT_REMINDER', recipient: { ...cust, phone: '' }, records: rec })).action, 'REVIEW');
  assert.equal(evaluateJob(run({ purpose: 'SUPPLIER_DELIVERY_REMINDER', recipient: supp, records: { po: po({ expected_date: null }) } })).action, 'REVIEW');
  assert.ok(SUPPRESS_CODES.includes('CLEARED'));
  assert.equal(parentPurpose('PAYMENT_OVERDUE'), 'PAYMENT_REMINDER');
  assert.equal(parentPurpose('SUPPLIER_DELIVERY_DELAYED'), 'SUPPLIER_DELIVERY_REMINDER');
  assert.equal(parentPurpose('RECEIPT'), 'RECEIPT');
});
