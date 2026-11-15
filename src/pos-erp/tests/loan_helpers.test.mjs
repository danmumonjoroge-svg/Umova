// Run: node --test tests/loan_helpers.test.mjs   (from src/pos-erp)
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, dueState, dueWords, installmentTotal, installmentCost, loanSummary, buildLoanNotifications, loanTotals, mapLoanError, validateLoanForm, money, prettyDate, needsReminder } from '../utils/loanHelpers.js';

const T = '2026-10-27';
const inst = (seq, due, over = {}) => ({ id: `i${seq}`, seq, due_date: due, principal_due: 10000, interest_due: 1200, fees_due: 0, status: 'PENDING', pre_app: false, manual_only: false, ...over });
const loan = (over = {}, insts = []) => ({ id: 'L1', lender_name: 'Equity Bank', status: 'ACTIVE', auto_pay: false, principal: 120000, record_disbursement: true, disbursed_on: '2026-10-01', installments: insts, ...over });

test('daysBetween counts calendar days, across month ends and leap day', () => {
  assert.equal(daysBetween('2026-10-27', '2026-10-27'), 0);
  assert.equal(daysBetween('2026-10-27', '2026-11-03'), 7);
  assert.equal(daysBetween('2026-10-27', '2026-10-20'), -7);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('dueState + words: 7 days before, tomorrow, today, overdue', () => {
  assert.equal(dueWords('2026-11-03', T), 'due in 7 days');
  assert.equal(dueWords('2026-10-28', T), 'due tomorrow');
  assert.equal(dueWords('2026-10-27', T), 'due today');
  assert.equal(dueWords('2026-10-26', T), 'overdue by 1 day');
  assert.equal(dueWords('2026-10-22', T), 'overdue by 5 days');
  assert.equal(dueState('2026-11-04', T).kind, 'later');
  assert.equal(dueState('2026-11-03', T).kind, 'soon');
});

test('an instalment is principal + interest + fees; only interest + fees are the cost', () => {
  const i = inst(1, T, { fees_due: 150 });
  assert.equal(installmentTotal(i), 11350);
  assert.equal(installmentCost(i), 1350);
});

test('reminders: silent until 7 days before; then daily through overdue', () => {
  const at = (due) => buildLoanNotifications([loan({}, [inst(1, due)])], T);
  assert.equal(at('2026-11-04').length, 0);                       // 8 days away: nothing
  assert.match(at('2026-11-03')[0].message, /due in 7 days \(.*\)/); // 7 days
  assert.equal(at('2026-11-03')[0].severity, 'medium');
  assert.match(at('2026-10-28')[0].message, /due tomorrow/);
  assert.match(at('2026-10-27')[0].message, /due today/);
  assert.equal(at('2026-10-27')[0].severity, 'high');
  assert.match(at('2026-10-24')[0].message, /overdue by 3 days/);
  assert.equal(at('2026-10-24')[0].severity, 'high');
  assert.equal(at('2026-10-24')[0].link, '/pos/loans');
  assert.equal(at('2026-10-24')[0].category, 'LOAN');
});

test('one line per loan: three late instalments are one alarm, naming the oldest', () => {
  const n = buildLoanNotifications([loan({}, [inst(1, '2026-08-27'), inst(2, '2026-09-27'), inst(3, '2026-10-27'), inst(4, '2026-11-27')])], T);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /overdue by 61 days.*\(\+2 more overdue\)/);
});

test('a paid instalment stops the reminder; the next one starts it when its time comes', () => {
  const l = loan({}, [inst(1, '2026-10-20', { status: 'PAID' }), inst(2, '2026-11-20')]);
  assert.equal(buildLoanNotifications([l], T).length, 0);
  assert.equal(buildLoanNotifications([l], '2026-11-13').length, 1);
});

test('auto-pay loans do not nag, unless an instalment was undone and left for the owner', () => {
  assert.equal(buildLoanNotifications([loan({ auto_pay: true }, [inst(1, '2026-10-20')])], T).length, 0);
  assert.equal(buildLoanNotifications([loan({ auto_pay: true }, [inst(1, '2026-10-20', { manual_only: true })])], T).length, 1);
  assert.equal(needsReminder(loan({ auto_pay: true }), inst(1, T)), false);
});

test('closed, cleared and cancelled loans never nag; cancelled instalments are ignored', () => {
  for (const status of ['CLEARED', 'CLOSED', 'CANCELLED']) assert.equal(buildLoanNotifications([loan({ status }, [inst(1, '2026-10-20')])], T).length, 0);
  assert.equal(buildLoanNotifications([loan({}, [inst(1, '2026-10-20', { status: 'CANCELLED' })])], T).length, 0);
});

test('summary: owed is unpaid principal only; counts; state', () => {
  const l = loan({}, [inst(1, '2026-09-27', { status: 'PAID' }), inst(2, '2026-10-20'), inst(3, '2026-11-27')]);
  const s = loanSummary(l, T);
  assert.equal(s.total, 3); assert.equal(s.paidCount, 1); assert.equal(s.pendingCount, 2);
  assert.equal(s.owed, 20000);
  assert.equal(s.remainingToPay, 22400);
  assert.equal(s.interestPaid, 1200);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.state, 'OVERDUE');
  assert.equal(s.next.seq, 2);
  assert.equal(s.principalGap, 30000 - 120000);   // only 3 instalments of 10000 in this tiny fixture
});

test('summary: interest of a pre-app instalment is not counted as interest paid in the app; state ON_TRACK / DUE_SOON / CLEARED', () => {
  const l = loan({}, [inst(1, '2026-09-27', { status: 'PAID', pre_app: true }), inst(2, '2026-12-27')]);
  assert.equal(loanSummary(l, T).interestPaid, 0);
  assert.equal(loanSummary(l, T).state, 'ON_TRACK');
  assert.equal(loanSummary(loan({}, [inst(1, '2026-10-30')]), T).state, 'DUE_SOON');
  assert.equal(loanSummary(loan({ status: 'CLEARED' }, [inst(1, '2026-10-30', { status: 'PAID' })]), T).state, 'CLEARED');
});

test('balance sheet totals: owed = unpaid principal; cash + received, - principal repaid; interest is NOT in here', () => {
  const l1 = loan({ principal: 30000 }, [inst(1, '2026-10-01', { status: 'PAID' }), inst(2, '2026-11-01'), inst(3, '2026-12-01')]);
  assert.deepEqual(loanTotals([l1], T), { outstandingPrincipal: 20000, receivedInApp: 30000, principalRepaid: 10000 });
});

test('an older loan (money received before the app) adds no cash, but its later repayments take cash and its balance is still owed', () => {
  const old = loan({ principal: 60000, record_disbursement: false }, [inst(1, '2026-08-01', { status: 'PAID', pre_app: true }), inst(2, '2026-11-01'), inst(3, '2026-12-01', { status: 'PAID' })]);
  assert.deepEqual(loanTotals([old], T), { outstandingPrincipal: 10000, receivedInApp: 0, principalRepaid: 10000 });
});

test('a cancelled loan counts for nothing; a loan dated in the future is not cash yet; a closed loan owes nothing', () => {
  assert.deepEqual(loanTotals([loan({ status: 'CANCELLED' }, [inst(1, '2026-11-01')])], T), { outstandingPrincipal: 0, receivedInApp: 0, principalRepaid: 0 });
  assert.equal(loanTotals([loan({ disbursed_on: '2026-11-15' }, [])], T).receivedInApp, 0);
  assert.equal(loanTotals([loan({ status: 'CLOSED' }, [inst(1, '2026-11-01', { status: 'CANCELLED' })])], T).outstandingPrincipal, 0);
});

test('form validation speaks plainly and catches the real mistakes', () => {
  const ok = { lender_name: 'Equity', principal: '1000', term_count: '6', first_due: '2026-11-01', interest_method: 'REDUCING', rate: '14', paid_before_count: '' };
  assert.equal(validateLoanForm(ok), null);
  assert.match(validateLoanForm({ ...ok, lender_name: ' ' }), /Who lent/);
  assert.match(validateLoanForm({ ...ok, principal: '0' }), /amount you borrowed/);
  assert.match(validateLoanForm({ ...ok, term_count: '0' }), /instalments/);
  assert.match(validateLoanForm({ ...ok, first_due: '' }), /first instalment/);
  assert.match(validateLoanForm({ ...ok, rate: '' }), /interest rate/);
  assert.equal(validateLoanForm({ ...ok, interest_method: 'NONE', rate: '' }), null);
  assert.match(validateLoanForm({ ...ok, paid_before_count: '6' }), /fewer than the total/);
  assert.match(validateLoanForm({ ...ok, upfront_fees: '500', received_before_app: true }), /processing fee/);
});

test('errors: offline, not-owner, and "not installed yet" get plain sentences', () => {
  assert.match(mapLoanError({ message: 'TypeError: Failed to fetch' }), /No internet/);
  assert.equal(mapLoanError({ code: '42501', message: 'Only the business owner can do that.' }), 'Only the business owner can do that.');
  assert.match(mapLoanError({ code: '42501', message: 'You do not have permission to do this.' }), /permission/);
  assert.match(mapLoanError({ code: 'PGRST202', message: 'Could not find the function public.loan_create in the schema cache' }), /not switched on/);
  assert.equal(mapLoanError({ code: '22023', message: 'The payment date cannot be in the future.' }), 'The payment date cannot be in the future.');
});

test('money and dates read like a shopkeeper would', () => {
  assert.equal(money(11200), 'KES 11,200');
  assert.equal(money(1166.67), 'KES 1,166.67');
  assert.match(prettyDate('2026-10-31'), /Sat.*31.*Oct|31.*Oct/);
});

// ── part payments, arrears and advance (phase 38) ────────────────────────────────────────────────────────────────
import { loanStanding, installmentPaid, installmentBalance, isPartPaid, paidOf, paymentSplitWords } from '../utils/loanHelpers.js';

const paidBits = (p, i, f = 0) => ({ paid_principal: p, paid_interest: i, paid_fees: f });
// instalment 1,2 overdue, 3 due today, 4,5 in the future (each 10000 loan + 1200 interest)
const sched = (over = []) => [
  inst(1, '2026-09-27', over[0]), inst(2, '2026-10-12', over[1]), inst(3, T, over[2]), inst(4, '2026-11-27', over[3]), inst(5, '2026-12-27', over[4]),
];

test('part paid: balance = what is left, and it is flagged', () => {
  const i = inst(1, T, paidBits(3400, 1200));
  assert.equal(installmentPaid(i), 4600);
  assert.equal(installmentBalance(i), 6600);
  assert.equal(isPartPaid(i), true);
  assert.equal(isPartPaid(inst(1, T)), false);
  assert.equal(installmentBalance(inst(1, T, { status: 'PAID' })), 0);
});

test('old data without paid_* columns behaves exactly as before', () => {
  assert.equal(paidOf(inst(1, T, { status: 'PAID' }), 'principal'), 10000);
  assert.equal(paidOf(inst(1, T), 'principal'), 0);
  assert.equal(installmentBalance(inst(1, T)), 11200);
});

test('standing: in arrears when something due BEFORE today is unpaid, with amount and days', () => {
  const l = loan({}, sched([paidBits(10000, 1200, 0), paidBits(0, 600)]));
  l.installments[0].status = 'PAID';
  const st = loanStanding(l, T);
  assert.equal(st.kind, 'ARREARS');
  assert.equal(st.arrears, 10600);               // instalment 2 balance only: 11200 - 600
  assert.equal(st.arrearsCount, 1);
  assert.equal(st.daysInArrears, 15);
  assert.match(st.detail, /KES 10,600 behind: 1 instalment overdue, the oldest by 15 days/);
});

test('standing: a part payment that leaves a balance is still arrears (7000 against 11200 overdue)', () => {
  const l = loan({}, [inst(1, '2026-10-12', paidBits(5800, 1200))]);
  const st = loanStanding(l, T);
  assert.equal(st.kind, 'ARREARS');
  assert.equal(st.arrears, 4200);
});

test('standing: an instalment due TODAY and unpaid is not yet arrears', () => {
  assert.equal(loanStanding(loan({}, sched([{ status: 'PAID' }, { status: 'PAID' }])), T).kind, 'ON_SCHEDULE');
});

test('standing: advance when money is paid on instalments not yet due', () => {
  const l = loan({}, sched([{ status: 'PAID' }, { status: 'PAID' }, { status: 'PAID' }, { status: 'PAID' }, paidBits(0, 1200)]));
  const st = loanStanding(l, T);
  assert.equal(st.kind, 'ADVANCE');
  assert.equal(st.advance, 12400);               // instalment 4 paid in full (11200) + 1200 interest on 5
  assert.equal(st.aheadCount, 1);
  assert.equal(st.arrears, 0);
  assert.match(st.detail, /KES 12,400 paid ahead, 1 instalment fully paid before the due date/);
});

test('standing: only a part paid ahead is "towards the next instalment"', () => {
  const st = loanStanding(loan({}, sched([{ status: 'PAID' }, { status: 'PAID' }, { status: 'PAID' }, paidBits(0, 1200)])), T);
  assert.equal(st.kind, 'ADVANCE');
  assert.match(st.detail, /towards the next instalment/);
});

test('standing: on schedule when exactly up to date; null for a loan that is not active', () => {
  assert.equal(loanStanding(loan({}, sched([{ status: 'PAID' }, { status: 'PAID' }, { status: 'PAID' }])), T).kind, 'ON_SCHEDULE');
  assert.equal(loanStanding(loan({ status: 'CLOSED' }, sched()), T), null);
});

test('summary: owed, remaining and interest paid count part payments; state follows standing', () => {
  const l = loan({}, sched([paidBits(3400, 1200), paidBits(0, 1200), paidBits(0, 1200)]));
  const s = loanSummary(l, T);
  assert.equal(s.partCount, 3);
  assert.equal(s.owed, 50000 - 3400);
  assert.equal(s.remainingToPay, 5 * 11200 - (4600 + 1200 + 1200));
  assert.equal(s.interestPaid, 3600);
  assert.equal(s.nextBalance, 6600);
  assert.equal(s.state, 'OVERDUE');
  assert.equal(s.standing.kind, 'ARREARS');
  const ahead = loanSummary(loan({}, sched([{ status: 'PAID' }, { status: 'PAID' }, { status: 'PAID' }, paidBits(0, 1200)])), T);
  assert.equal(ahead.state, 'AHEAD');
});

test('totals: principal repaid includes the part-paid principal; outstanding is only what is left', () => {
  const l = loan({}, [inst(1, T, { status: 'PAID', ...paidBits(10000, 1200) }), inst(2, '2026-11-27', paidBits(3400, 1200)), inst(3, '2026-12-27')]);
  const t = loanTotals([l], T);
  assert.equal(t.principalRepaid, 13400);
  assert.equal(t.outstandingPrincipal, 16600);
  // a pre-app instalment is paid but never takes cash out through the app
  const old = loan({}, [inst(1, T, { status: 'PAID', pre_app: true, ...paidBits(10000, 1200) }), inst(2, '2026-11-27')]);
  assert.equal(loanTotals([old], T).principalRepaid, 0);
});

test('the bell shows the BALANCE of a part-paid instalment, and says so', () => {
  const l = loan({}, [inst(1, '2026-10-25', paidBits(3400, 1200))]);
  const [n] = buildLoanNotifications([l], T);
  assert.match(n.message, /loan instalment balance of KES 6,600 is overdue by 2 days/);
});

test('payment history words: interest first, then the loan', () => {
  assert.equal(paymentSplitWords({ interest_paid: 3600, fees_paid: 0, principal_paid: 3400 }), 'interest KES 3,600, loan KES 3,400');
  assert.equal(paymentSplitWords({ interest_paid: 1000, fees_paid: 200, principal_paid: 0 }), 'interest & charges KES 1,200');
  assert.equal(paymentSplitWords({ interest_paid: 0, fees_paid: 0, principal_paid: 6600 }), 'loan KES 6,600');
});


// ── phase 41: reducing balance, standing = actual balance against the scheduled balance ──
test('reducing loan: user example - 60,000 paid in month 1 (2,000 interest + 58,000 principal) is not arrears until the schedule catches up', () => {
  // borrowed 100,000 over 8 instalments of 12,500 principal. Paid ahead: 58,000 principal = 12,500 x 4 + 8,000 on the 5th. Interest 2,000 paid.
  const paidP = [12500, 12500, 12500, 12500, 8000, 0, 0, 0];
  const rows = paidP.map((pp, k) => ({ id: `x${k + 1}`, seq: k + 1, due_date: `2026-0${k + 1}-01`, principal_due: 12500, interest_due: k === 0 ? 2000 : 0, fees_due: 0,
    status: k < 4 ? 'PAID' : 'PENDING', accrues: true, interest_accrued: k === 0, paid_principal: pp, paid_interest: k === 0 ? 2000 : 0, paid_fees: 0, pre_app: false }));
  rows[0].status = 'PAID';
  const l = loan({ principal: 100000 }, rows);
  const at = (d) => loanStanding(l, d);
  // 15 March: 3 instalments dated before -> scheduled balance 62,500; actual 42,000 -> ahead
  assert.equal(at('2026-03-15').kind, 'ADVANCE'); assert.equal(at('2026-03-15').actualBalance, 42000); assert.equal(at('2026-03-15').scheduledBalance, 62500); assert.equal(at('2026-03-15').advance, 20500);
  // 15 April: 4 dated before -> scheduled 50,000 still above 42,000: still ahead (no instalment is "late" even though the loan is not cleared)
  assert.equal(at('2026-04-15').kind, 'ADVANCE'); assert.equal(at('2026-04-15').advance, 8000);
  // 15 May: 5 dated before -> scheduled 37,500 is now BELOW the actual 42,000: only now is the loan behind, by 4,500
  assert.equal(at('2026-05-15').kind, 'ARREARS'); assert.equal(at('2026-05-15').arrears, 4500);
  // exactly equal is on schedule
  const eq = loan({ principal: 100000 }, rows.map((r, k) => (k === 4 ? { ...r, paid_principal: 12500 } : r)));
  assert.equal(loanStanding(eq, '2026-05-15').kind, 'ON_SCHEDULE');
});

test('reducing loan: charged interest that is overdue and unpaid counts as arrears even when the balance is on schedule', () => {
  const rows = [
    { id: 'y1', seq: 1, due_date: '2026-09-01', principal_due: 10000, interest_due: 500, fees_due: 0, status: 'PENDING', accrues: true, interest_accrued: true, paid_principal: 10000, paid_interest: 0, paid_fees: 0, pre_app: false },
    { id: 'y2', seq: 2, due_date: '2026-12-01', principal_due: 10000, interest_due: 0, fees_due: 0, status: 'PENDING', accrues: true, interest_accrued: false, paid_principal: 0, paid_interest: 0, paid_fees: 0, pre_app: false },
  ];
  const st = loanStanding(loan({ principal: 20000 }, rows), '2026-10-15');
  assert.equal(st.kind, 'ARREARS'); assert.equal(st.arrears, 500);
});

test('reducing loan: exactly on the scheduled balance is ON_SCHEDULE; flat loans still use the old rule', () => {
  const rows = [{ id: 'z1', seq: 1, due_date: '2026-09-01', principal_due: 10000, interest_due: 500, fees_due: 0, status: 'PAID', accrues: true, interest_accrued: true, paid_principal: 10000, paid_interest: 500, paid_fees: 0, pre_app: false },
    { id: 'z2', seq: 2, due_date: '2026-12-01', principal_due: 10000, interest_due: 0, fees_due: 0, status: 'PENDING', accrues: true, interest_accrued: false, paid_principal: 0, paid_interest: 0, paid_fees: 0, pre_app: false }];
  assert.equal(loanStanding(loan({ principal: 20000 }, rows), '2026-10-15').kind, 'ON_SCHEDULE');
  const flat = [inst(1, '2026-09-01'), inst(2, '2026-12-01')];
  assert.equal(loanStanding(loan({}, flat), '2026-10-15').kind, 'ARREARS');
});
