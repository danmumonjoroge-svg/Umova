// src/pos-erp/utils/loanHelpers.js
//
// Pure helpers for My Loans (no React, no Supabase) so they can be unit-tested with `node --test`.
// The instalment SCHEDULE itself is NOT calculated here: that lives in one place, the database function
// loan_preview_schedule() (schema/phase37_loans.sql), so the screen and the books can never disagree.
// This file only adds up what the database already decided and chooses the words the owner reads.
//
// Dates are plain 'YYYY-MM-DD' strings (what the database sends). "Today" is the phone's own local date, which in Kenya is
// the date the owner means; the database uses Africa/Nairobi time for what it posts.

import { isNetworkFailure } from '../offline/netErrors.js';

export const LENDER_TYPES = { BANK: 'Bank', SACCO: 'SACCO', MPESA: 'M-Pesa / Fuliza / mobile loan', OTHER: 'Other (friend, chama, supplier…)' };
export const METHODS = { REDUCING: 'Reducing balance', FLAT: 'Flat rate', NONE: 'No interest' };
export const METHOD_HINT = {
  REDUCING: 'Interest is charged on what you still owe, so it gets smaller each time. Most banks and SACCOs do this.',
  FLAT: 'Interest is worked out once on the full amount and shared equally across every instalment.',
  NONE: 'You pay back only what you borrowed.',
};
export const PAY_FROM = { BANK: 'Bank', MOBILE_MONEY: 'M-Pesa', CASH: 'Cash', OTHER: 'Other' };
export const FREQUENCIES = { MONTHLY: 'every month', WEEKLY: 'every week' };

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const money = (n) => `KES ${round2(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The phone's own date as YYYY-MM-DD. */
export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `fromISO` to `toISO` (negative when toISO is earlier). Calendar days, so daylight saving can never skew it. */
export function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = String(fromISO).slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(toISO).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── one instalment ──────────────────────────────────────────────────────────────────────────────────────────────
/** What the lender takes for this instalment: principal + interest + fees. */
export const installmentTotal = (i) => round2(num(i.principal_due) + num(i.interest_due) + num(i.fees_due));
/** The part that goes to My Spending (the real cost). The principal never does. */
export const installmentCost = (i) => round2(num(i.interest_due) + num(i.fees_due));

/**
 * How much of one part ('principal' | 'interest' | 'fees') has been paid on this instalment.
 * New databases send paid_principal / paid_interest / paid_fees. For older data (or a database without phase 38 yet) a PAID
 * instalment counts as paid in full and anything else as nothing, which is exactly what used to be true.
 */
export function paidOf(i, part) {
  const v = i[`paid_${part}`];
  if (v !== undefined && v !== null) return num(v);
  return i.status === 'PAID' ? num(i[`${part}_due`]) : 0;
}
/** Everything paid so far against this instalment (all three parts). */
export const installmentPaid = (i) => round2(paidOf(i, 'principal') + paidOf(i, 'interest') + paidOf(i, 'fees'));
/** What is still to pay on this instalment. 0 once PAID or CANCELLED. */
export const installmentBalance = (i) => (i.status === 'PENDING' ? round2(Math.max(installmentTotal(i) - installmentPaid(i), 0)) : 0);
/** Part paid: some money is in, but not all of it. */
export const isPartPaid = (i) => i.status === 'PENDING' && installmentPaid(i) > 0;

/** { kind: 'overdue'|'today'|'soon'|'later', days } where days is how many days until (positive) or since (positive, for overdue) the date. */
export function dueState(due, todayISO = localISODate()) {
  const d = daysBetween(todayISO, due);
  if (d < 0) return { kind: 'overdue', days: -d };
  if (d === 0) return { kind: 'today', days: 0 };
  if (d <= 7) return { kind: 'soon', days: d };
  return { kind: 'later', days: d };
}

export function dueWords(due, todayISO = localISODate()) {
  const s = dueState(due, todayISO);
  if (s.kind === 'overdue') return s.days === 1 ? 'overdue by 1 day' : `overdue by ${s.days} days`;
  if (s.kind === 'today') return 'due today';
  if (s.days === 1) return 'due tomorrow';
  return `due in ${s.days} days`;
}

// ── one loan ────────────────────────────────────────────────────────────────────────────────────────────────────
const live = (loan) => (loan.installments || []).filter((i) => i.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
export const isLive = (loan) => loan.status === 'ACTIVE';

/**
 * Where the loan stands against its schedule today. Only for an ACTIVE loan (otherwise null).
 *   ARREARS      something that was due BEFORE today is still unpaid.            arrears = the unpaid part of those instalments
 *   ADVANCE      nothing is behind, and money has been paid on instalments that are not due yet.   advance = that money
 *   ON_SCHEDULE  paid exactly up to date (an instalment due today is not yet "behind").
 * Because every payment clears what is due first and only then pays ahead, ARREARS and ADVANCE can never both be true.
 */
export function loanStanding(loan, todayISO = localISODate()) {
  if (loan.status !== 'ACTIVE') return null;
  const rows = live(loan);
  if (rows.some((i) => i.accrues)) return accrualStanding(loan, rows, todayISO);
  const behind = rows.filter((i) => i.status === 'PENDING' && daysBetween(todayISO, i.due_date) < 0)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.seq - b.seq);
  const arrears = round2(behind.reduce((sum, i) => sum + installmentBalance(i), 0));
  const future = rows.filter((i) => daysBetween(todayISO, i.due_date) > 0);
  const advance = round2(future.reduce((sum, i) => sum + installmentPaid(i), 0));
  const aheadCount = future.filter((i) => i.status === 'PAID').length;
  const daysInArrears = behind.length ? daysBetween(behind[0].due_date, todayISO) : 0;
  if (arrears > 0) {
    const n = behind.length;
    return {
      kind: 'ARREARS', label: 'In arrears', arrears, advance: 0, arrearsCount: n, daysInArrears, aheadCount: 0,
      detail: `${money(arrears)} behind: ${n} instalment${n === 1 ? '' : 's'} overdue, the oldest by ${daysInArrears} day${daysInArrears === 1 ? '' : 's'}`,
    };
  }
  if (advance > 0) {
    return {
      kind: 'ADVANCE', label: 'Paid in advance', arrears: 0, advance, arrearsCount: 0, daysInArrears: 0, aheadCount,
      detail: `${money(advance)} paid ahead${aheadCount ? `, ${aheadCount} instalment${aheadCount === 1 ? '' : 's'} fully paid before the due date` : ' towards the next instalment'}`,
    };
  }
  return { kind: 'ON_SCHEDULE', label: 'On schedule', arrears: 0, advance: 0, arrearsCount: 0, daysInArrears: 0, aheadCount: 0, detail: 'Paid up to date with the schedule' };
}

/**
 * Reducing-balance loans (phase 41). The schedule is only the yardstick: the loan is "behind" when the ACTUAL balance is above the
 * SCHEDULED balance at the last instalment date before today, and "ahead" when it is below. Paying early never lowers the instalment
 * or shortens the term, so a lump sum simply keeps the loan out of arrears until the schedule catches up with the balance.
 *   scheduled balance = borrowed - principal of every instalment dated before today
 *   actual balance    = borrowed - principal actually paid
 *   arrears = (actual - scheduled, if positive) + interest and fees already charged and overdue but unpaid
 *   advance = (scheduled - actual, if positive)
 */
function accrualStanding(loan, rows, todayISO) {
  const dueBefore = rows.filter((i) => daysBetween(todayISO, i.due_date) < 0);
  const scheduled = Math.max(round2(num(loan.principal) - dueBefore.reduce((s, i) => s + num(i.principal_due), 0)), 0);
  const actual = Math.max(round2(num(loan.principal) - rows.reduce((s, i) => s + paidOf(i, 'principal'), 0)), 0);
  const costOwed = round2(dueBefore.filter((i) => i.status === 'PENDING')
    .reduce((s, i) => s + Math.max(num(i.interest_due) - paidOf(i, 'interest'), 0) + Math.max(num(i.fees_due) - paidOf(i, 'fees'), 0), 0));
  const behindPrincipal = round2(Math.max(actual - scheduled, 0));
  const arrears = round2(behindPrincipal + costOwed);
  const advance = round2(Math.max(scheduled - actual, 0));
  const oldest = dueBefore.filter((i) => i.status === 'PENDING' && (installmentBalance(i) > 0)).sort((a, b) => a.seq - b.seq)[0];
  const daysInArrears = oldest ? daysBetween(oldest.due_date, todayISO) : 0;
  const base = { scheduledBalance: scheduled, actualBalance: actual };
  if (arrears > 0) {
    return {
      ...base, kind: 'ARREARS', label: 'In arrears', arrears, advance: 0, arrearsCount: dueBefore.filter((i) => i.status === 'PENDING').length, daysInArrears, aheadCount: 0,
      detail: `${money(arrears)} behind schedule: you owe ${money(actual)} but the schedule says ${money(scheduled)}${costOwed > 0 ? `, and ${money(costOwed)} interest is unpaid` : ''}`,
    };
  }
  if (advance > 0) {
    return {
      ...base, kind: 'ADVANCE', label: 'Paid in advance', arrears: 0, advance, arrearsCount: 0, daysInArrears: 0, aheadCount: 0,
      detail: `${money(advance)} ahead: you owe ${money(actual)}, the schedule says ${money(scheduled)}. No instalment is due until the schedule catches up.`,
    };
  }
  return { ...base, kind: 'ON_SCHEDULE', label: 'On schedule', arrears: 0, advance: 0, arrearsCount: 0, daysInArrears: 0, aheadCount: 0, detail: 'Paid up to date with the schedule' };
}

/** How one recorded payment was split, in words: "KES 7,000: interest KES 3,600, loan KES 3,400". */
export function paymentSplitWords(p) {
  const cost = round2(num(p.interest_paid) + num(p.fees_paid));
  const parts = [];
  if (cost > 0) parts.push(`interest${num(p.fees_paid) > 0 ? ' & charges' : ''} ${money(cost)}`);
  if (num(p.principal_paid) > 0) parts.push(`loan ${money(p.principal_paid)}`);
  return parts.join(', ');
}

/** Everything the card and the detail sheet show, worked out from the instalments the database sent. */
export function loanSummary(loan, todayISO = localISODate()) {
  const rows = live(loan);
  const paid = rows.filter((i) => i.status === 'PAID');
  const pending = rows.filter((i) => i.status === 'PENDING').sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.seq - b.seq);
  const overdue = pending.filter((i) => dueState(i.due_date, todayISO).kind === 'overdue');
  const next = pending[0] || null;
  const active = loan.status === 'ACTIVE';
  const standing = loanStanding(loan, todayISO);
  return {
    total: rows.length,
    paidCount: paid.length,
    pendingCount: pending.length,
    partCount: pending.filter(isPartPaid).length,
    next,
    nextBalance: next ? installmentBalance(next) : 0,
    overdueCount: overdue.length,
    owed: active ? round2(pending.reduce((s, i) => s + num(i.principal_due) - paidOf(i, 'principal'), 0)) : 0, // the part still to repay (principal). Interest still to come is not "owed" yet.
    remainingToPay: active ? round2(pending.reduce((s, i) => s + installmentBalance(i), 0)) : 0,
    interestPaid: round2(rows.filter((i) => !i.pre_app).reduce((s, i) => s + paidOf(i, 'interest') + paidOf(i, 'fees'), 0)),
    // The schedule should add up to what was borrowed. An edited instalment can change that, and the owner is told, not left guessing.
    principalGap: round2(rows.reduce((s, i) => s + num(i.principal_due), 0) - num(loan.principal)),
    standing,
    state: !active ? loan.status : overdue.length ? 'OVERDUE' : standing?.kind === 'ADVANCE' ? 'AHEAD' : next && dueState(next.due_date, todayISO).kind !== 'later' ? 'DUE_SOON' : 'ON_TRACK',
  };
}

/** Does this loan nag? Auto-pay loans don't (the lender takes it), unless an instalment was undone and left for the owner to pay by hand. */
export const needsReminder = (loan, inst) => loan.status === 'ACTIVE' && inst.status === 'PENDING' && (!loan.auto_pay || inst.manual_only);

// ── the bell ───────────────────────────────────────────────────────────────────────────────────────────────────
// From 7 days before an instalment is due, through the day it is due, and every day after until it is paid.
// One line per loan (the most urgent unpaid instalment), so three late instalments do not become three alarms.
export function buildLoanNotifications(loans, todayISO = localISODate()) {
  const out = [];
  for (const loan of loans || []) {
    if (loan.status !== 'ACTIVE') continue;
    const due = (loan.installments || [])
      .filter((i) => needsReminder(loan, i))
      .filter((i) => daysBetween(todayISO, i.due_date) <= 7)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.seq - b.seq);
    if (!due.length) continue;
    const first = due[0];
    const state = dueState(first.due_date, todayISO);
    const more = due.length - 1;
    const tail = state.kind === 'overdue' && more > 0 ? ` (+${more} more overdue)` : '';
    out.push({
      id: `loan-${loan.id}`,
      category: 'LOAN',
      severity: state.kind === 'overdue' || state.kind === 'today' ? 'high' : 'medium',
      message: `${loan.lender_name}: loan instalment ${isPartPaid(first) ? 'balance ' : ''}of ${money(installmentBalance(first))} is ${dueWords(first.due_date, todayISO)}${state.kind === 'soon' || state.kind === 'later' ? ` (${prettyDate(first.due_date)})` : ''}${tail}`,
      link: '/pos/loans',
      createdAt: null,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

// ── the books ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What the balance sheet needs from loans.
 *   outstandingPrincipal  what is still owed (a liability): the unpaid part of instalments' principal on ACTIVE loans (part payments count).
 *   receivedInApp         loan money that came in after the app was used (adds to the cash estimate).
 *   principalRepaid       principal paid through the app (takes away from the cash estimate). The interest and fees are
 *                         already counted by the cash estimate because they are ordinary PAID expenses.
 * A cancelled loan counts for nothing. A loan entered as "money received before I used the app" adds no cash, but its later
 * repayments do come out of cash and its remaining principal is still owed.
 */
export function loanTotals(loans, todayISO = localISODate()) {
  let outstandingPrincipal = 0; let receivedInApp = 0; let principalRepaid = 0;
  for (const loan of loans || []) {
    if (loan.status === 'CANCELLED') continue;
    if (loan.record_disbursement && String(loan.disbursed_on) <= todayISO) receivedInApp += num(loan.principal);
    for (const i of loan.installments || []) {
      if (!i.pre_app && i.status !== 'CANCELLED') principalRepaid += paidOf(i, 'principal');   // includes the part-paid ones
      if (i.status === 'PENDING' && loan.status === 'ACTIVE') outstandingPrincipal += num(i.principal_due) - paidOf(i, 'principal');
    }
  }
  return { outstandingPrincipal: round2(outstandingPrincipal), receivedInApp: round2(receivedInApp), principalRepaid: round2(principalRepaid) };
}

// ── words for errors ────────────────────────────────────────────────────────────────────────────────────────────
export function mapLoanError(err) {
  if (isNetworkFailure(err)) return 'No internet. Nothing was changed. Try again when you are back online.';
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === '42501') return /owner/i.test(msg) ? 'Only the business owner can do that.' : 'You do not have permission to do this.';
  if (code === '22023' && msg) return msg;
  if (code === 'P0409') return 'That was already sent as a different loan. Start again.';
  if (/loan_preview_schedule|loan_create|lb_loans|lb_loan_installments|schema cache|does not exist/i.test(msg)) return 'Loans are not switched on for your business yet. Ask the person who set up the app to finish the update.';
  return 'Something went wrong. Please try again.';
}

/** Checks the add-a-loan form and returns a plain sentence for the first problem, or null. */
export function validateLoanForm(f) {
  if (!String(f.lender_name || '').trim()) return 'Who lent you the money?';
  if (!(num(f.principal) > 0)) return 'Enter the amount you borrowed.';
  const n = parseInt(f.term_count, 10);
  if (!n || n < 1 || n > 360) return 'Enter how many instalments (1 to 360).';
  if (!f.first_due) return 'Pick the date of the first instalment.';
  if (f.interest_method !== 'NONE' && !(num(f.rate) > 0)) return 'Enter the interest rate, or choose "No interest".';
  const paid = parseInt(f.paid_before_count || 0, 10) || 0;
  if (paid < 0 || paid >= n) return 'Instalments already paid must be fewer than the total.';
  if (num(f.upfront_fees) > 0 && (f.received_before_app || paid > 0)) return 'A processing fee can only be added for a loan you received after you started using this app.';
  return null;
}
