// Elimu finance - JS unit tests. Run:  node --test elimu/finance/tests/   (needs `dexie` installed, as the POS app already has)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, toDecimalString, formatMoney, percentOf, fromDb, MoneyError } from '../utils/money.js';
import { planAllocation } from '../utils/allocation.js';
import { daysOverdue, bucketFor, ageInvoices } from '../utils/aging.js';
import { reportToCsv, debtorsReport, agingReport, collectionsReport } from '../reports/reportBuilders.js';
import { FINANCE_PURPOSES, FINANCE_DEFAULT_TEMPLATES, FINANCE_VARIABLES } from '../../communication/templates/financeTemplates.js';
import { composeFinanceMessage, buildVars, eventKey, prepareRecord } from '../../communication/finance/financeComm.js';
import { createDraftQueue, draftLabel, draftAcknowledgementText } from '../offline/feeOfflineQueue.js';
import { canWith, ACTION_PERMS } from '../utils/permissions.js';

test('money: exact parsing, no floats, two decimals max', () => {
  assert.equal(toCents('15,000.50'), 1500050); assert.equal(toCents(0.1 + 0.2 === 0.30000000000000004 ? '0.30' : 0), 30);
  assert.equal(toCents('KES 2,000'), 200000); assert.equal(toCents(19.99), 1999); assert.equal(toDecimalString(1500050), '15000.50'); assert.equal(toDecimalString(5), '0.05');
  for (const bad of ['', null, 'abc', '1.234', '-5', '1e3', NaN]) assert.throws(() => toCents(bad), MoneyError, String(bad));
  assert.equal(toCents('10.20'), 1020); assert.equal(toCents('10.200'), 1020);
  assert.equal(fromDb('-2000.00'), -200000); assert.equal(formatMoney(2500000), 'KES 25,000'); assert.equal(formatMoney(-150), '-KES 1.50');
  assert.equal(percentOf(1700000, 10), 170000); assert.equal(percentOf(1530000, 50), 765000); assert.equal(percentOf(333, 10), 33);
});

test('allocation preview: the brief\'s example (owes 15,000 + 20,000, pays 25,000)', () => {
  const inv = [{ id: 't2', due_date: '2026-05-20', outstanding: '20000.00' }, { id: 't1', due_date: '2026-01-20', outstanding: '15000.00' }];
  const r = planAllocation(2500000, inv);
  assert.deepEqual(r.allocations, [{ invoice_id: 't1', amount: 1500000 }, { invoice_id: 't2', amount: 1000000 }]); assert.equal(r.unallocated, 0);
});
test('allocation preview: overpayment leaves credit, manual-only allocates nothing, current-term-first reorders', () => {
  const inv = [{ id: 'old', due_date: '2026-01-20', outstanding: '100.00', period_id: 'p1' }, { id: 'cur', due_date: '2026-05-20', outstanding: '100.00', period_id: 'p2' }];
  assert.equal(planAllocation(30000, inv).unallocated, 10000);
  assert.deepEqual(planAllocation(30000, inv, { policy: 'MANUAL_ONLY' }), { allocations: [], unallocated: 30000 });
  assert.equal(planAllocation(10000, inv, { policy: 'CURRENT_TERM_FIRST', currentPeriodId: 'p2' }).allocations[0].invoice_id, 'cur');
  assert.equal(planAllocation(5000, [{ id: 'paid', due_date: '2026-01-01', outstanding: '0.00' }]).unallocated, 5000);
  assert.throws(() => planAllocation(0, inv)); assert.throws(() => planAllocation(1.5, inv));
  const total = planAllocation(12345, inv); assert.equal(total.allocations.reduce((s, a) => s + a.amount, 0) + total.unallocated, 12345);
});

test('ageing buckets match the SQL boundaries', () => {
  assert.equal(bucketFor(0), 'not_yet_due'); assert.equal(bucketFor(-5), 'not_yet_due'); assert.equal(bucketFor(1), 'days_1_30'); assert.equal(bucketFor(30), 'days_1_30');
  assert.equal(bucketFor(31), 'days_31_60'); assert.equal(bucketFor(60), 'days_31_60'); assert.equal(bucketFor(61), 'days_61_90'); assert.equal(bucketFor(90), 'days_61_90'); assert.equal(bucketFor(91), 'over_90');
  const asOf = new Date(Date.UTC(2026, 5, 30)); assert.equal(daysOverdue('2026-05-31', asOf), 30);
  const a = ageInvoices([{ due_date: '2026-05-31', outstanding: 100 }, { due_date: '2026-01-01', outstanding: 50 }, { due_date: '2026-07-01', outstanding: 25 }, { due_date: '2026-01-01', outstanding: 0 }], asOf);
  assert.deepEqual([a.days_1_30.amount, a.over_90.amount, a.not_yet_due.amount], [100, 50, 25]);
});

test('templates: every purpose has SMS/WhatsApp/Email, every variable is declared, no penalties language', () => {
  for (const p of FINANCE_PURPOSES) for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
    const t = FINANCE_DEFAULT_TEMPLATES[p.key]?.[ch]; assert.ok(t, `${p.key} ${ch}`);
    const body = typeof t === 'string' ? t : t.body;
    for (const m of body.matchAll(/\{\{\s*(\w+)\??\s*\}\}/g)) assert.ok(FINANCE_VARIABLES.includes(m[1]) && (p.variables.includes(m[1]) || m[1] === 'school_name'), `${p.key}/${ch} uses undeclared ${m[1]}`);
    assert.ok(!/penalt|late fee|interest|blacklist|expel|default(er)?\b/i.test(body), `${p.key} ${ch} must not threaten`);
  }
  for (const v of ['guardian_name', 'student_name', 'admission_number', 'class_name', 'term', 'academic_year', 'amount', 'balance', 'due_date', 'receipt_number', 'payment_method', 'transaction_reference', 'school_name']) assert.ok(FINANCE_VARIABLES.includes(v), v);
});
test('compose: the brief\'s example message, missing-variable reporting, contact validation', () => {
  const vars = buildVars({ school: { name: 'Elimu Academy' }, student: { name: 'Amina Otieno', admission_no: 'A001' }, guardian: { name: 'Mary' }, payment: { amount: '25000.00', receipt_no: 'SFR-2026-0001', method: 'CASH' }, balanceCents: 1000000 });
  const m = composeFinanceMessage({ purpose: 'ELIMU_PAYMENT_CONFIRMED', channel: 'SMS', vars, contact: { phone: '0722123456' } });
  assert.equal(m.body, 'Dear Mary, payment of KES 25,000 has been received for Amina Otieno (A001). Your outstanding school fee balance is KES 10,000. Thank you. Elimu Academy.');
  assert.deepEqual(m.missing, []); assert.deepEqual(m.problems, []); assert.ok(m.to && m.sms.segments >= 1);
  const bad = composeFinanceMessage({ purpose: 'ELIMU_PAYMENT_REVERSED', channel: 'SMS', vars: { ...vars }, contact: { phone: 'nope' } });
  assert.ok(bad.missing.includes('reason') && bad.problems.length === 2 && bad.body.includes('[Reason]'), 'missing vars are shown, never invented');
  assert.throws(() => composeFinanceMessage({ purpose: 'NOPE', channel: 'SMS', vars }));
  const none = composeFinanceMessage({ purpose: 'ELIMU_BALANCE_REMINDER', channel: 'EMAIL', vars, contact: {} }); assert.ok(none.problems[0].includes('email'));
});
test('notifications: dedupe key, duplicate does not create a second log row, nothing is "sent"', async () => {
  assert.equal(eventKey({ purpose: 'P', referenceId: 'r1', channel: 'SMS', recipient: '+254 722' }), 'P|r1|SMS|+254722');
  assert.notEqual(eventKey({ purpose: 'P', referenceId: 'r1', channel: 'SMS', recipient: '1' }), eventKey({ purpose: 'P', referenceId: 'r1', channel: 'SMS', recipient: '1', resend: 1 }));
  const seen = new Set(); const logs = [];
  const supabase = {
    rpc: async (fn, a) => { if (fn === 'elimu_fin_register_notification') { const dup = seen.has(a.p_event_key); seen.add(a.p_event_key); return { data: { ok: true, duplicate: dup, notification_id: 'n1' }, error: null }; } return { data: null, error: null }; },
    from: () => ({ insert: (row) => ({ select: () => ({ single: async () => { logs.push(row); return { data: { id: 'log1', ...row }, error: null }; } }) }) }),
  };
  const composed = { purpose: 'ELIMU_PAYMENT_CONFIRMED', channel: 'SMS', body: 'hello', subject: null, source: 'DEFAULT', problems: [] };
  const args = { supabase, comm: {}, tenantId: 't', businessId: 'b', userId: 'u', studentId: 's', composed, final: { body: 'hello (edited)', to: '+254722123456' }, reference: { type: 'ELIMU_PAYMENT', id: 'pay1' } };
  const a = await prepareRecord(args); const b = await prepareRecord(args);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'QUEUED', 'a prepared message is QUEUED, never SENT/DELIVERED'); assert.equal(logs[0].was_edited, true); assert.equal(logs[0].message_type, 'OTHER');
  await assert.rejects(prepareRecord({ ...args, composed: { ...composed, problems: ['No valid phone number for the guardian.'] }, final: { body: 'x', to: null } }), /phone/);
});

const memKv = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const mkQueue = () => { let n = 0; return createDraftQueue({ kv: memKv(), idFn: async () => `LOCAL-FEE-${++n}`, tx: (fn) => fn() }); };
const base = { tenantId: 't1', businessId: 'b1', staffId: 'u', studentId: 's1', studentLabel: 'Amina A001', method: 'CASH', amountCents: 500000 };
test('offline drafts: a draft is never a payment; submit is idempotent; offline failure stays a draft', async () => {
  const q = mkQueue(); const d = await q.saveDraft(base);
  assert.equal(d.state, 'DRAFT'); assert.equal(draftLabel(d).recorded, false); assert.match(draftLabel(d).text, /not yet recorded/i);
  assert.match(draftAcknowledgementText(d, 'Elimu'), /NOT A RECEIPT/);
  const calls = []; const netErr = Object.assign(new TypeError('Failed to fetch'), {});
  const offline = { recordPayment: async () => { throw netErr; } };
  const r1 = await q.submit(d.id, offline); assert.equal(r1.state, 'DRAFT'); assert.match(r1.error, /No connection/);
  const online = { recordPayment: async (b, s, p) => { calls.push(p.clientReference); return { status: 'CONFIRMED', receipt_no: 'SFR-2026-0009', payment_id: 'pay9' }; } };
  const r2 = await q.submit(d.id, online); assert.equal(r2.state, 'SUBMITTED'); assert.equal(draftLabel(r2).recorded, true); assert.match(draftLabel(r2).text, /SFR-2026-0009/);
  const r3 = await q.submit(d.id, online); assert.equal(calls.length, 1, 'a submitted draft is not sent twice'); assert.equal(r3.receiptNo, 'SFR-2026-0009'); assert.equal(calls[0], d.id, 'draft id is the idempotency key');
  await assert.rejects(q.discard(d.id), /cannot be discarded/);
});
test('offline drafts: refused payment becomes FAILED (not retried); pending stays "not yet received"; tenant isolation; validation', async () => {
  const q = mkQueue(); const d = await q.saveDraft({ ...base, method: 'MPESA', transactionRef: 'QGH7K2L9MN' });
  const r = await q.submit(d.id, { recordPayment: async () => { throw new Error('M-Pesa code QGH7K2L9MN has already been recorded here.'); } });
  assert.equal(r.state, 'FAILED'); assert.equal(draftLabel(r).recorded, false); await q.discard(d.id); assert.equal((await q.list('t1')).length, 0);
  const p = await q.saveDraft({ ...base, method: 'MPESA', transactionRef: 'ZZZ1234567' });
  const pr = await q.submit(p.id, { recordPayment: async () => ({ status: 'PENDING', receipt_no: null, payment_id: 'x' }) });
  assert.match(draftLabel(pr).text, /awaiting confirmation \(not yet received\)/);
  await q.saveDraft({ ...base, tenantId: 't2' }); assert.equal((await q.list('t1')).length, 1); assert.equal((await q.list('t2')).length, 1);
  await assert.rejects(q.saveDraft({ ...base, amountCents: 0 }), /above zero/); await assert.rejects(q.saveDraft({ ...base, amountCents: 10.5 }), /above zero/);
  await assert.rejects(q.saveDraft({ ...base, method: 'BITCOIN' }), /how the money/); await assert.rejects(q.saveDraft({ ...base, studentId: null }), /student/);
  assert.deepEqual(await q.counts('t1'), { DRAFT: 0, SUBMITTING: 0, SUBMITTED: 1, FAILED: 0 });
});

test('reports: shapes the POS PDF engine expects, CSV escaping, collections exclude reversed from net', () => {
  const d = debtorsReport([{ admission_no: 'A1', student_name: 'Amina, "Mimi"', class_name: 'C5', total_billed: '17000.00', total_paid: '5000.00', outstanding: '12000.00', days_overdue: 40, last_payment_date: '2026-02-01' }]);
  assert.equal(d.sections[0].rows[0].owed, 'KES 12,000'); assert.ok(d.footnote.includes('not an accusation'));
  const csv = reportToCsv(d); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"Amina, ""Mimi"""'));
  const ag = agingReport({ as_of: '2026-06-30', not_yet_due: { amount: 0, students: 0 }, days_1_30: { amount: 100, students: 1 }, days_31_60: { amount: 0, students: 0 }, days_61_90: { amount: 0, students: 0 }, over_90: { amount: 50, students: 1 }, total: { amount: 150, students: 2 } });
  assert.equal(ag.sections[0].rows.at(-1).a, 'KES 150');
  const c = collectionsReport([{ bucket: 'CASH', payments: 2, collected: '3000.00', reversed: '500.00', net: '3000.00' }], { from: '2026-01-01', to: '2026-01-31', group: 'METHOD' });
  assert.equal(c.sections[0].rows.at(-1).c, 'KES 3,000'); assert.equal(c.summary[0].value, 'KES 3,000');
});
test('permission mapping mirrors the database function', () => {
  const has = (...ps) => (p) => ps.includes(p);
  assert.equal(canWith(has('finance.collect'), 'collect'), true); assert.equal(canWith(has('finance.collect'), 'bill'), false); assert.equal(canWith(has('finance.collect'), 'configure'), false);
  assert.equal(canWith(has('finance.view'), 'collect'), false, 'auditor-like staff cannot collect'); assert.equal(canWith(has('finance.view'), 'view'), true);
  assert.equal(canWith(has('finance.reconcile'), 'reconcile'), true); assert.equal(canWith(has('payments.record'), 'collect'), false, 'a POS key grants nothing in Elimu'); assert.equal(canWith(has(), 'bill', true), true);
  assert.deepEqual(Object.keys(ACTION_PERMS).sort(), ['approve', 'audit', 'bill', 'collect', 'configure', 'expense', 'reconcile', 'report', 'view']);
});
