/**
 * loanEngineService.js
 * ---------------------------------------------------------------------------
 * Loan Origination & Decision Engine for the Umova ERP (SACCO / MFI).
 *
 * This module holds ALL loan business logic. It is deliberately free of React
 * and free of JSX so it can be unit-tested, reused by an approval dashboard,
 * an officer portal, a batch re-appraisal job or an Edge Function.
 *
 * Layout
 *   1. Primitives      — null-safe numbers, strings, object field picking
 *   2. Date safety     — the only place dates are parsed; rejects nulls,
 *                        invalid values, epoch dates and implausible ranges
 *   3. Rule factory    — every rule returns { passed, severity, code, message }
 *   4. Data access     — schema-tolerant Supabase loaders (never throw)
 *   5. Derivations     — savings, income, tenure, arrears, classification,
 *                        credit score, limit, instalment
 *   6. Rule groups     — membership, savings, active loans, repayment history,
 *                        classification, affordability, security, documents,
 *                        fraud
 *   7. Decision        — assembles the rules into a single decision object
 *   8. Presentation    — turns a decision into an officer-readable message
 * ---------------------------------------------------------------------------
 */

import { LOAN_POLICY } from "./loanPolicy";

/* =========================================================================
 * 1. PRIMITIVES
 * ========================================================================= */

/** Coerce anything to a finite number, falling back safely. */
export const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** True for null, undefined, "" and whitespace-only strings. */
export const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === "";

/** Lower-cased, trimmed string for status comparisons. Never throws. */
export const normalizeStatus = (value) =>
  isBlank(value) ? "" : String(value).trim().toLowerCase();

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export const round2 = (n) => Math.round(toNumber(n) * 100) / 100;

/**
 * Read the first present field from an object.
 * Umova tables have evolved over time, so column names differ between
 * deployments. Rather than assuming one name, we accept a list of candidates.
 */
export const pick = (row, keys, fallback = null) => {
  if (!row) return fallback;
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined && row[key] !== "") {
      return row[key];
    }
  }
  return fallback;
};

/** Format money for messages (KES, no decimals). */
export const formatMoney = (value) =>
  `KES ${Math.round(toNumber(value)).toLocaleString("en-KE")}`;

/* =========================================================================
 * 2. DATE SAFETY
 * -------------------------------------------------------------------------
 * Every date in the engine passes through parseSafeDate(). It returns null
 * for anything it cannot trust, and all downstream day counts return null
 * rather than a number. A null day count is rendered as "not available" and
 * raises a data-quality rule — it is never printed as "20,630 days overdue".
 * ========================================================================= */

const MIN_VALID_DATE = new Date(LOAN_POLICY.dates.minValidDate).getTime();

/**
 * Parse a value into a trustworthy Date, or null.
 * Rejects: null/blank, unparseable strings, epoch/sentinel dates before
 * `policy.dates.minValidDate`, and dates further in the future than
 * `policy.dates.maxFutureDays`.
 */
export const parseSafeDate = (value, policy = LOAN_POLICY) => {
  if (isBlank(value)) return null;

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  // Epoch / sentinel guard — 1970-01-01 and friends are corrupt data.
  if (time < MIN_VALID_DATE) return null;

  const futureLimit = Date.now() + policy.dates.maxFutureDays * 86400000;
  if (time > futureLimit) return null;

  return date;
};

/** Whole days between two dates, or null if either date is untrustworthy. */
export const daysBetween = (from, to = new Date(), policy = LOAN_POLICY) => {
  const a = parseSafeDate(from, policy);
  const b = parseSafeDate(to, policy);
  if (!a || !b) return null;

  const days = Math.floor((b.getTime() - a.getTime()) / 86400000);
  // Implausible spans mean bad data, not an ancient debt.
  if (Math.abs(days) > policy.dates.maxPlausibleDays) return null;
  return days;
};

/** Days elapsed since a past date (never negative). Null when untrustworthy. */
export const daysSince = (value, policy = LOAN_POLICY) => {
  const days = daysBetween(value, new Date(), policy);
  return days === null ? null : Math.max(0, days);
};

/** Whole months between a past date and now. Null when untrustworthy. */
export const monthsSince = (value, policy = LOAN_POLICY) => {
  const date = parseSafeDate(value, policy);
  if (!date) return null;
  const now = new Date();
  const months =
    (now.getFullYear() - date.getFullYear()) * 12 +
    (now.getMonth() - date.getMonth()) -
    (now.getDate() < date.getDate() ? 1 : 0);
  return months < 0 ? 0 : months;
};

/** Age in years from a date of birth. Null when untrustworthy. */
export const yearsSince = (value, policy = LOAN_POLICY) => {
  const months = monthsSince(value, policy);
  return months === null ? null : Math.floor(months / 12);
};

/** "45 days" / "not available" — used in messages so nulls read cleanly. */
export const formatDays = (days) =>
  days === null || days === undefined
    ? "not available"
    : `${days.toLocaleString("en-KE")} day${days === 1 ? "" : "s"}`;

/** 'YYYY-MM' key used for monthly bucketing (matches Finance period format). */
export const periodKey = (value, policy = LOAN_POLICY) => {
  const date = parseSafeDate(value, policy);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

/* =========================================================================
 * 3. RULE FACTORY
 * ========================================================================= */

export const SEVERITY = { INFO: "INFO", WARNING: "WARNING", BLOCK: "BLOCK" };

/**
 * Every eligibility check returns this shape.
 * @returns {{passed:boolean, severity:"INFO"|"WARNING"|"BLOCK", code:string,
 *            message:string, group:string, detail:object|null}}
 */
export const makeRule = ({
  passed,
  severity = SEVERITY.INFO,
  code,
  message,
  group = "GENERAL",
  detail = null,
}) => ({ passed: Boolean(passed), severity, code, message, group, detail });

// Convenience builders — keep rule groups readable.
const pass = (code, message, group, detail) =>
  makeRule({ passed: true, severity: SEVERITY.INFO, code, message, group, detail });
const block = (code, message, group, detail) =>
  makeRule({ passed: false, severity: SEVERITY.BLOCK, code, message, group, detail });
const warn = (code, message, group, detail) =>
  makeRule({ passed: false, severity: SEVERITY.WARNING, code, message, group, detail });
const info = (code, message, group, detail) =>
  makeRule({ passed: false, severity: SEVERITY.INFO, code, message, group, detail });

/* =========================================================================
 * 4. DATA ACCESS (schema-tolerant, never throws)
 * ========================================================================= */

/**
 * Query the first table that actually exists, from a list of candidates.
 * Missing tables/columns are common across Umova deployments; a miss degrades
 * to `{ rows: [], available: false }` instead of crashing the application.
 */
const queryFirstAvailable = async (supabase, candidates, memberNo, columnCandidates) => {
  for (const table of candidates) {
    for (const column of columnCandidates) {
      const { data, error } = await supabase.from(table).select("*").eq(column, memberNo);
      if (!error) return { rows: data || [], table, column, available: true };
      // 42P01 = undefined_table, 42703 = undefined_column. Try the next option.
      if (!["42P01", "42703", "PGRST200", "PGRST204"].includes(error.code)) {
        return { rows: [], table, column, available: false, error };
      }
    }
  }
  return { rows: [], table: null, column: null, available: false };
};

/**
 * Load everything the engine needs for one member, in parallel.
 * Always resolves — failures are reported inside `sources` so the rule engine
 * can raise a data-quality warning instead of the UI showing a blank screen.
 */
export const loadLoanContext = async (supabase, memberNo) => {
  if (!supabase) throw new Error("Supabase client is required");
  if (isBlank(memberNo)) throw new Error("Member number is required");

  const [ledgerRes, memberRes, loansRes, repaymentsRes, docsRes] = await Promise.allSettled([
    supabase.from("general_ledger").select("*").eq("member_no", memberNo),
    queryFirstAvailable(supabase, ["members", "member", "sacco_members"], memberNo, [
      "member_no",
      "memberNo",
    ]),
    queryFirstAvailable(supabase, ["loans"], memberNo, ["member_no"]),
    queryFirstAvailable(
      supabase,
      ["loan_repayments", "repayments", "loan_payments"],
      memberNo,
      ["member_no"]
    ),
    queryFirstAvailable(supabase, ["loan_documents"], memberNo, ["member_no"]),
  ]);

  const unwrapDirect = (res) =>
    res.status === "fulfilled" && !res.value.error
      ? { rows: res.value.data || [], available: true }
      : { rows: [], available: false, error: res.reason || res.value?.error };

  const unwrap = (res) =>
    res.status === "fulfilled"
      ? res.value
      : { rows: [], available: false, error: res.reason };

  const ledger = unwrapDirect(ledgerRes);
  const memberRows = unwrap(memberRes);
  const loans = unwrap(loansRes);
  const repayments = unwrap(repaymentsRes);
  const documents = unwrap(docsRes);

  return {
    memberNo,
    memberRecord: memberRows.rows?.[0] || null,
    ledger: ledger.rows,
    loans: loans.rows,
    repayments: repayments.rows,
    documentHistory: documents.rows,
    sources: {
      ledger: ledger.available,
      member: memberRows.available && Boolean(memberRows.rows?.length),
      loans: loans.available,
      repayments: repayments.available,
      documents: documents.available,
    },
  };
};

/* =========================================================================
 * 5. DERIVATIONS
 * ========================================================================= */

/** Is this ledger row a member savings/deposit entry? */
const isSavingsEntry = (row, policy) =>
  normalizeStatus(pick(row, ["type", "entry_type", "category"])) === "savings" ||
  String(pick(row, ["account_code", "gl_account_code", "account"], "")) ===
    policy.savings.savingsAccountCode;

/** Is this ledger row money coming in (income / receipt)? */
const isIncomeEntry = (row) => {
  const type = normalizeStatus(pick(row, ["type", "entry_type", "category"]));
  if (["income", "salary", "receipt", "deposit", "contribution", "savings"].includes(type)) {
    return true;
  }
  // Fall back to double-entry direction when a type is not supplied.
  const credit = toNumber(pick(row, ["credit", "credit_amount"], 0));
  return credit > 0;
};

const entryAmount = (row) =>
  toNumber(pick(row, ["amount", "credit", "credit_amount", "value"], 0));

const entryDate = (row) =>
  pick(row, ["transaction_date", "date", "posted_at", "created_at", "period"], null);

/**
 * Summarise the general ledger once. The original component walked the same
 * array several times; this does a single pass and returns everything derived
 * from it.
 */
export const summariseLedger = (ledger = [], policy = LOAN_POLICY) => {
  const savingsMonths = new Set();
  const incomeByMonth = new Map();
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - policy.savings.consistencyWindowMonths);

  let totalSavings = 0;
  let totalLedgerValue = 0;
  let incomeInWindow = 0;
  let lastSavingsDate = null;

  for (const row of ledger) {
    const amount = entryAmount(row);
    const rawDate = entryDate(row);
    const date = parseSafeDate(rawDate, policy);
    totalLedgerValue += amount;

    if (isSavingsEntry(row, policy)) {
      totalSavings += amount;
      if (date) {
        if (date >= windowStart) savingsMonths.add(periodKey(date, policy));
        if (!lastSavingsDate || date > lastSavingsDate) lastSavingsDate = date;
      }
    }

    if (isIncomeEntry(row) && date && date >= windowStart) {
      incomeInWindow += amount;
      const key = periodKey(date, policy);
      if (key) incomeByMonth.set(key, toNumber(incomeByMonth.get(key)) + amount);
    }
  }

  const observedMonths = incomeByMonth.size;
  const monthlyIncome =
    observedMonths > 0 ? incomeInWindow / observedMonths : 0;

  return {
    totalSavings: round2(totalSavings),
    // Preserved for backwards compatibility with the previous UI figure.
    totalLedgerValue: round2(totalLedgerValue),
    monthlyIncome: round2(monthlyIncome),
    incomeObservedMonths: observedMonths,
    consistentSavingsMonths: savingsMonths.size,
    lastSavingsDate,
    entryCount: ledger.length,
  };
};

/** Bucket an arrears age using the SASRA five-bucket model. */
export const classifyArrears = (daysInArrears, policy = LOAN_POLICY) => {
  if (daysInArrears === null || daysInArrears === undefined) {
    return { code: "UNKNOWN", label: "Unclassified", riskWeight: 10, allowRefinance: false, provisionRate: 0 };
  }
  const days = Math.max(0, toNumber(daysInArrears));
  return (
    policy.classification.buckets.find((b) => days <= b.maxDays) ||
    policy.classification.buckets[policy.classification.buckets.length - 1]
  );
};

const loanStatusOf = (loan) => normalizeStatus(pick(loan, ["status", "loan_status"]));

const outstandingOf = (loan) =>
  toNumber(
    pick(loan, ["outstanding_balance", "balance", "principal_balance", "outstanding", "amount"], 0)
  );

const instalmentOf = (loan) => {
  const explicit = toNumber(
    pick(loan, ["monthly_repayment", "instalment", "installment_amount", "monthly_instalment"], 0)
  );
  if (explicit > 0) return explicit;
  const months = toNumber(pick(loan, ["months", "term_months", "tenure"], 0));
  const principal = toNumber(pick(loan, ["amount", "principal"], 0));
  return months > 0 ? principal / months : 0;
};

/**
 * Summarise a member's loan book: active/pending counts, exposure, worst
 * arrears and the resulting classification.
 */
export const summariseLoans = (loans = [], policy = LOAN_POLICY) => {
  const { activeStatuses, pendingStatuses, restructuredStatuses } = policy.activeLoans;

  const active = [];
  const pending = [];
  const restructured = [];

  let outstandingTotal = 0;
  let existingInstalments = 0;
  let worstArrearsDays = null;
  let hasUnknownArrears = false;
  let lastApplicationDate = null;
  let applicationsThisMonth = 0;
  const thisMonth = periodKey(new Date(), policy);

  for (const loan of loans) {
    const status = loanStatusOf(loan);
    const createdAt = pick(loan, ["created_at", "application_date", "applied_at"], null);
    const createdDate = parseSafeDate(createdAt, policy);

    if (createdDate) {
      if (!lastApplicationDate || createdDate > lastApplicationDate) lastApplicationDate = createdDate;
      if (periodKey(createdDate, policy) === thisMonth) applicationsThisMonth += 1;
    }

    if (restructuredStatuses.includes(status)) restructured.push(loan);
    if (pendingStatuses.includes(status)) pending.push(loan);
    if (!activeStatuses.includes(status)) continue;

    active.push(loan);
    outstandingTotal += outstandingOf(loan);
    existingInstalments += instalmentOf(loan);

    // Arrears age: prefer a stored figure, else derive from the due date.
    const storedDays = pick(loan, ["days_in_arrears", "arrears_days"], null);
    let days = storedDays === null ? null : toNumber(storedDays, null);
    if (days === null) {
      const dueDate = pick(loan, ["next_due_date", "due_date", "last_due_date"], null);
      days = daysSince(dueDate, policy);
      // A future due date means the account is current, not in arrears.
      if (days === null && !isBlank(dueDate)) hasUnknownArrears = true;
    }
    if (days !== null && (worstArrearsDays === null || days > worstArrearsDays)) {
      worstArrearsDays = days;
    }
  }

  const classification = classifyArrears(
    worstArrearsDays === null && active.length === 0 ? 0 : worstArrearsDays,
    policy
  );

  // Repaid ratio across the active book — used for refinancing eligibility.
  const principalTotal = active.reduce(
    (sum, l) => sum + toNumber(pick(l, ["amount", "principal"], 0)),
    0
  );
  const repaidRatio =
    principalTotal > 0 ? clamp(1 - outstandingTotal / principalTotal, 0, 1) : 0;

  return {
    activeLoans: active,
    pendingLoans: pending,
    restructuredLoans: restructured,
    activeCount: active.length,
    pendingCount: pending.length,
    outstandingTotal: round2(outstandingTotal),
    existingInstalments: round2(existingInstalments),
    worstArrearsDays,
    hasUnknownArrears,
    classification,
    repaidRatio,
    lastApplicationDate,
    applicationsThisMonth,
    lastRestructureDate: restructured.reduce((latest, l) => {
      const d = parseSafeDate(
        pick(l, ["restructured_at", "updated_at", "created_at"], null),
        policy
      );
      return d && (!latest || d > latest) ? d : latest;
    }, null),
  };
};

/** Summarise repayment behaviour: recency, misses and consistency. */
export const summariseRepayments = (repayments = [], loanSummary = {}, policy = LOAN_POLICY) => {
  let lastRepaymentDate = null;
  let paidCount = 0;
  const paidMonths = new Set();

  for (const row of repayments) {
    const amount = toNumber(pick(row, ["amount", "amount_paid", "paid_amount"], 0));
    if (amount <= 0) continue;
    paidCount += 1;
    const date = parseSafeDate(
      pick(row, ["paid_at", "payment_date", "transaction_date", "date", "created_at"], null),
      policy
    );
    if (!date) continue;
    if (!lastRepaymentDate || date > lastRepaymentDate) lastRepaymentDate = date;
    const key = periodKey(date, policy);
    if (key) paidMonths.add(key);
  }

  // Expected instalments = months elapsed since the oldest active disbursement.
  const oldestDisbursement = (loanSummary.activeLoans || []).reduce((oldest, loan) => {
    const d = parseSafeDate(
      pick(loan, ["disbursed_at", "disbursement_date", "created_at"], null),
      policy
    );
    return d && (!oldest || d < oldest) ? d : oldest;
  }, null);

  const expectedInstalments = oldestDisbursement ? monthsSince(oldestDisbursement, policy) : null;

  const consistencyRatio =
    expectedInstalments && expectedInstalments > 0
      ? clamp(paidMonths.size / expectedInstalments, 0, 1)
      : null;

  const missedInstalments =
    expectedInstalments === null ? null : Math.max(0, expectedInstalments - paidMonths.size);

  return {
    lastRepaymentDate,
    daysSinceLastRepayment: lastRepaymentDate ? daysSince(lastRepaymentDate, policy) : null,
    repaymentCount: paidCount,
    monthsWithRepayment: paidMonths.size,
    expectedInstalments,
    missedInstalments,
    consistencyRatio,
    hasHistory: paidCount > 0,
  };
};

/** Credit score (0–100, higher is better). Extends the original heuristic. */
export const computeCreditScore = (facts, policy = LOAN_POLICY) => {
  const cfg = policy.creditScore;
  let score = cfg.base;

  if (facts.totalSavings > cfg.savingsBonusThreshold) score += cfg.savingsBonus;
  if (facts.monthlyIncome > cfg.incomeBonusThreshold) score += cfg.incomeBonus;
  if ((facts.membershipMonths ?? 0) >= cfg.tenureBonusMonths) score += cfg.tenureBonus;

  if (facts.hasRepaymentHistory && (facts.worstArrearsDays ?? 0) === 0) {
    score += cfg.cleanHistoryBonus;
  }
  if ((facts.worstArrearsDays ?? 0) > policy.repayment.warnDaysInArrears) {
    score -= cfg.arrearsPenalty;
  }
  score -= toNumber(cfg.classificationPenalty[facts.classificationCode], 0);

  return clamp(Math.round(score), 0, 100);
};

/** Savings multiplier for a score, from the policy bands. */
export const multiplierForScore = (score, policy = LOAN_POLICY) => {
  const band = policy.savings.multiplierBands.find((b) => score >= b.minScore);
  return Math.min(band ? band.multiplier : 1, policy.savings.absoluteMaxMultiplier);
};

/** Loan limit = savings × score-based multiplier, less existing exposure. */
export const computeLoanLimit = (totalSavings, score, outstandingTotal = 0, policy = LOAN_POLICY) => {
  const gross = toNumber(totalSavings) * multiplierForScore(score, policy);
  return Math.max(0, round2(gross - toNumber(outstandingTotal)));
};

/** Projected monthly instalment, honouring the policy interest method. */
export const estimateMonthlyRepayment = (amount, months, policy = LOAN_POLICY) => {
  const principal = toNumber(amount);
  const term = toNumber(months);
  if (principal <= 0 || term <= 0) return 0;

  const annual = toNumber(policy.affordability.annualInterestRate, 0);
  if (annual <= 0) return round2(principal / term); // matches legacy behaviour

  const monthlyRate = annual / 12;
  if (policy.affordability.interestMethod === "flat") {
    return round2(principal / term + principal * monthlyRate);
  }
  // Reducing balance (standard SACCO amortisation).
  const factor = Math.pow(1 + monthlyRate, term);
  return round2((principal * monthlyRate * factor) / (factor - 1));
};

/** Largest principal affordable under the DSR ceiling, for the given term. */
export const maxAffordablePrincipal = (monthlyIncome, existingInstalments, months, policy = LOAN_POLICY) => {
  const capacity =
    toNumber(monthlyIncome) * policy.affordability.maxDebtServiceRatio -
    toNumber(existingInstalments);
  if (capacity <= 0 || toNumber(months) <= 0) return 0;

  const annual = toNumber(policy.affordability.annualInterestRate, 0);
  if (annual <= 0) return round2(capacity * months);

  const monthlyRate = annual / 12;
  if (policy.affordability.interestMethod === "flat") {
    return round2(capacity / (1 / months + monthlyRate));
  }
  const factor = Math.pow(1 + monthlyRate, months);
  return round2((capacity * (factor - 1)) / (monthlyRate * factor));
};

/* =========================================================================
 * 6. RULE GROUPS
 * -------------------------------------------------------------------------
 * Each group is a pure function of the evaluation context and returns an
 * array of rules. Groups never read from the network or the DOM.
 * ========================================================================= */

/* ------------------------------------------------------------ MEMBERSHIP */
export const checkMembership = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "MEMBERSHIP";
  const { memberRecord, membershipMonths, memberAgeYears } = ctx;

  if (!memberRecord) {
    rules.push(
      warn("MEM_RECORD_MISSING", "Member master record could not be read. Verify member details manually.", g)
    );
  }

  // --- Active / suspended / closed --------------------------------------
  const status = normalizeStatus(
    pick(memberRecord, ["status", "member_status", "account_status"], "active")
  );
  if (policy.membership.closedStatuses.includes(status)) {
    rules.push(block("MEM_CLOSED", "Membership is closed. The account cannot borrow.", g, { status }));
  } else if (policy.membership.suspendedStatuses.includes(status)) {
    rules.push(block("MEM_SUSPENDED", "Membership is suspended or dormant. Reactivate the account before lending.", g, { status }));
  } else if (policy.membership.activeStatuses.includes(status)) {
    rules.push(pass("MEM_ACTIVE", "Membership is active.", g));
  } else {
    rules.push(warn("MEM_STATUS_UNKNOWN", `Membership status "${status || "unset"}" is not recognised. Confirm the account is in good standing.`, g, { status }));
  }

  // --- Age ---------------------------------------------------------------
  if (memberAgeYears === null) {
    rules.push(warn("MEM_AGE_UNKNOWN", "Date of birth is missing or invalid. Age could not be verified.", g));
  } else if (memberAgeYears < policy.membership.minAgeYears) {
    rules.push(block("MEM_UNDERAGE", `Member is ${memberAgeYears} years old; the minimum borrowing age is ${policy.membership.minAgeYears}.`, g));
  } else if (memberAgeYears > policy.membership.maxAgeYears) {
    rules.push(warn("MEM_OVER_AGE", `Member is ${memberAgeYears} years old, above the ${policy.membership.maxAgeYears}-year lending ceiling. Board approval is required.`, g));
  } else {
    rules.push(pass("MEM_AGE_OK", `Member age (${memberAgeYears}) is within policy.`, g));
  }

  // --- Membership period -------------------------------------------------
  const minMonths = policy.membership.minMembershipMonths;
  if (membershipMonths === null) {
    rules.push(warn("MEM_TENURE_UNKNOWN", "Join date is missing or invalid. Membership period could not be verified.", g));
  } else if (membershipMonths < minMonths) {
    rules.push(block("MEM_TENURE_SHORT", `Membership period is ${membershipMonths} month(s); the minimum is ${minMonths} months.`, g, { membershipMonths }));
  } else {
    rules.push(pass("MEM_TENURE_OK", `Membership period is ${membershipMonths} months.`, g));
  }

  return rules;
};

/* --------------------------------------------------------------- SAVINGS */
export const checkSavings = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "SAVINGS";
  const { totalSavings, consistentSavingsMonths, amount, creditScore, loanLimit } = ctx;

  if (totalSavings < policy.savings.minimumSavings) {
    rules.push(block("SAV_BELOW_MIN", `Total savings of ${formatMoney(totalSavings)} are below the minimum of ${formatMoney(policy.savings.minimumSavings)}.`, g));
  } else {
    rules.push(pass("SAV_MIN_OK", `Total savings: ${formatMoney(totalSavings)}.`, g));
  }

  const needed = policy.savings.minConsistentMonths;
  const window = policy.savings.consistencyWindowMonths;
  if (consistentSavingsMonths < needed) {
    rules.push(warn("SAV_INCONSISTENT", `Savings were recorded in only ${consistentSavingsMonths} of the last ${window} months; policy expects at least ${needed}.`, g));
  } else {
    rules.push(pass("SAV_CONSISTENT", `Savings recorded in ${consistentSavingsMonths} of the last ${window} months.`, g));
  }

  const multiplier = multiplierForScore(creditScore, policy);
  if (amount > loanLimit) {
    rules.push(block("SAV_MULTIPLIER_EXCEEDED", `Requested ${formatMoney(amount)} exceeds the available limit of ${formatMoney(loanLimit)} (${multiplier}× savings, net of existing loans).`, g, { multiplier, loanLimit }));
  } else {
    rules.push(pass("SAV_MULTIPLIER_OK", `Request is within the ${multiplier}× savings multiplier.`, g));
  }

  return rules;
};

/* ---------------------------------------------------------- ACTIVE LOANS */
export const checkActiveLoans = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "ACTIVE_LOANS";
  const { loanSummary, totalSavings, amount, isRefinance } = ctx;
  const cfg = policy.activeLoans;

  if (loanSummary.activeCount === 0) {
    rules.push(pass("LOAN_NONE_ACTIVE", "No active loans on the account.", g));
  } else {
    rules.push(info("LOAN_ACTIVE_PRESENT", `${loanSummary.activeCount} active loan(s) with an outstanding balance of ${formatMoney(loanSummary.outstandingTotal)}.`, g));
  }

  if (loanSummary.activeCount >= cfg.maxConcurrentLoans) {
    rules.push(block("LOAN_MAX_CONCURRENT", `Member already holds ${loanSummary.activeCount} active loan(s); the maximum allowed is ${cfg.maxConcurrentLoans}.`, g));
  }

  // Total exposure against deposits.
  const projectedExposure = loanSummary.outstandingTotal + toNumber(amount);
  const exposureCap = totalSavings * cfg.maxOutstandingToSavingsRatio;
  if (totalSavings > 0 && projectedExposure > exposureCap) {
    rules.push(block("LOAN_EXPOSURE_EXCEEDED", `Total exposure of ${formatMoney(projectedExposure)} would exceed ${cfg.maxOutstandingToSavingsRatio}× deposits (${formatMoney(exposureCap)}).`, g));
  }

  // Restructuring cooling-off.
  if (loanSummary.restructuredLoans.length > 0) {
    const monthsSinceRestructure = loanSummary.lastRestructureDate
      ? monthsSince(loanSummary.lastRestructureDate, policy)
      : null;
    if (monthsSinceRestructure === null) {
      rules.push(warn("LOAN_RESTRUCTURED", "Account holds a restructured facility; the restructure date could not be verified.", g));
    } else if (monthsSinceRestructure < cfg.restructureCoolingOffMonths) {
      rules.push(block("LOAN_RESTRUCTURE_COOLING", `Facility was restructured ${monthsSinceRestructure} month(s) ago; the cooling-off period is ${cfg.restructureCoolingOffMonths} months.`, g));
    } else {
      rules.push(pass("LOAN_RESTRUCTURE_CLEARED", "Restructuring cooling-off period has been served.", g));
    }
  }

  // Refinancing / top-up eligibility.
  if (isRefinance) {
    const repaidPct = Math.round(loanSummary.repaidRatio * 100);
    const requiredPct = Math.round(cfg.minRepaidRatioForRefinance * 100);
    if (loanSummary.repaidRatio < cfg.minRepaidRatioForRefinance) {
      rules.push(block("LOAN_REFINANCE_TOO_EARLY", `Only ${repaidPct}% of the existing loan has been repaid; refinancing requires at least ${requiredPct}%.`, g));
    } else {
      rules.push(pass("LOAN_REFINANCE_OK", `${repaidPct}% of the existing loan has been repaid.`, g));
    }
  }

  return rules;
};

/* ----------------------------------------------------- REPAYMENT HISTORY */
export const checkRepaymentHistory = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "REPAYMENT";
  const { loanSummary, repaymentSummary } = ctx;
  const cfg = policy.repayment;

  // Nothing to assess for a first-time borrower.
  if (loanSummary.activeCount === 0 && !repaymentSummary.hasHistory) {
    rules.push(info("REP_NO_HISTORY", "No prior borrowing history — first-time borrower.", g));
    return rules;
  }

  // --- Days in arrears (null-safe; never prints an epoch-derived figure) --
  const arrears = loanSummary.worstArrearsDays;
  if (arrears === null) {
    rules.push(warn("REP_ARREARS_UNKNOWN", "Arrears position could not be verified because a due date is missing or invalid. Confirm the account status before approval.", g));
  } else if (arrears > cfg.maxDaysInArrears) {
    rules.push(block("REP_ARREARS_BREACH", `Account is ${formatDays(arrears)} in arrears, beyond the ${cfg.maxDaysInArrears}-day policy limit.`, g, { arrears }));
  } else if (arrears > cfg.warnDaysInArrears) {
    rules.push(warn("REP_ARREARS_WARN", `Account is ${formatDays(arrears)} in arrears.`, g, { arrears }));
  } else {
    rules.push(pass("REP_ARREARS_OK", "Account has no material arrears.", g));
  }

  // --- Last repayment ----------------------------------------------------
  const sinceLast = repaymentSummary.daysSinceLastRepayment;
  if (loanSummary.activeCount > 0) {
    if (sinceLast === null) {
      rules.push(warn("REP_LAST_UNKNOWN", "Last repayment date is missing or invalid. Repayment recency could not be confirmed.", g));
    } else if (sinceLast > cfg.maxDaysSinceLastRepayment) {
      rules.push(block("REP_LAST_STALE", `Last repayment was ${formatDays(sinceLast)} ago, outside the ${cfg.maxDaysSinceLastRepayment}-day refinancing policy.`, g));
    } else if (sinceLast > cfg.warnDaysSinceLastRepayment) {
      rules.push(warn("REP_LAST_AGEING", `Last repayment was ${formatDays(sinceLast)} ago.`, g));
    } else {
      rules.push(pass("REP_LAST_OK", `Last repayment was ${formatDays(sinceLast)} ago.`, g));
    }
  }

  // --- Missed instalments ------------------------------------------------
  const missed = repaymentSummary.missedInstalments;
  if (missed === null) {
    rules.push(info("REP_MISSED_UNKNOWN", "Instalment schedule is unavailable; missed instalments were not counted.", g));
  } else if (missed > cfg.maxMissedInstalments) {
    rules.push(block("REP_MISSED_BREACH", `${missed} instalment(s) missed; the policy limit is ${cfg.maxMissedInstalments}.`, g));
  } else if (missed > cfg.warnMissedInstalments) {
    rules.push(warn("REP_MISSED_WARN", `${missed} instalment(s) missed.`, g));
  } else {
    rules.push(pass("REP_MISSED_OK", "Instalments have been met.", g));
  }

  // --- Consistency -------------------------------------------------------
  const ratio = repaymentSummary.consistencyRatio;
  if (ratio === null) {
    rules.push(info("REP_CONSISTENCY_UNKNOWN", "Repayment consistency could not be computed.", g));
  } else if (ratio < cfg.minConsistencyRatio) {
    rules.push(warn("REP_CONSISTENCY_LOW", `Repayment consistency is ${Math.round(ratio * 100)}%, below the ${Math.round(cfg.minConsistencyRatio * 100)}% policy expectation.`, g));
  } else if (ratio < cfg.warnConsistencyRatio) {
    rules.push(info("REP_CONSISTENCY_FAIR", `Repayment consistency is ${Math.round(ratio * 100)}%.`, g));
  } else {
    rules.push(pass("REP_CONSISTENCY_OK", `Repayment consistency is ${Math.round(ratio * 100)}%.`, g));
  }

  return rules;
};

/* -------------------------------------------------------- CLASSIFICATION */
export const checkClassification = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "CLASSIFICATION";
  const { loanSummary, isRefinance } = ctx;
  const cls = loanSummary.classification;

  if (loanSummary.activeCount === 0) {
    rules.push(pass("CLS_NONE", "No classified facilities on the account.", g));
    return rules;
  }

  if (cls.code === "UNKNOWN") {
    rules.push(warn("CLS_UNKNOWN", "Loan classification could not be determined from the available data.", g));
    return rules;
  }

  rules.push(info("CLS_CURRENT", `Existing facility is classified as ${cls.label}.`, g, { code: cls.code }));

  if (policy.classification.blockingBuckets.includes(cls.code)) {
    rules.push(block("CLS_NON_PERFORMING", `Outstanding loan is classified as ${cls.label}. New lending is not permitted on non-performing accounts.`, g, { code: cls.code }));
  }

  if (isRefinance && policy.classification.refinanceBlockingBuckets.includes(cls.code)) {
    rules.push(block("CLS_REFINANCE_BLOCKED", `Refinancing is blocked for accounts classified as ${cls.label}.`, g, { code: cls.code }));
  }

  if (cls.code === "WATCH" && !isRefinance) {
    rules.push(warn("CLS_WATCH", "Existing facility is on the Watch list. Credit committee sign-off is required.", g));
  }

  return rules;
};

/* --------------------------------------------------------- AFFORDABILITY */
export const checkAffordability = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "AFFORDABILITY";
  const cfg = policy.affordability;
  const {
    amount,
    months,
    monthlyIncome,
    incomeVerified,
    monthlyRepayment,
    loanSummary,
  } = ctx;

  // --- Basic term / amount sanity ---------------------------------------
  if (!(amount > 0)) {
    rules.push(block("AFF_AMOUNT_INVALID", "Enter a valid loan amount.", g));
  } else if (amount < cfg.minAmount) {
    rules.push(block("AFF_AMOUNT_MIN", `The minimum loan amount is ${formatMoney(cfg.minAmount)}.`, g));
  }
  if (!(months >= cfg.minMonths && months <= cfg.maxMonths)) {
    rules.push(block("AFF_TERM_INVALID", `Repayment period must be between ${cfg.minMonths} and ${cfg.maxMonths} months.`, g));
  }

  // --- Income verification ----------------------------------------------
  if (monthlyIncome <= 0) {
    rules.push(block("AFF_NO_INCOME", "No verifiable income was found on the member's ledger. Attach proof of income.", g));
    return rules; // Ratios below are meaningless without income.
  }
  if (cfg.requireIncomeVerification && !incomeVerified) {
    rules.push(warn("AFF_INCOME_UNVERIFIED", "Monthly income is estimated from fewer months than the policy window. Verify income documents.", g));
  }

  // --- Debt service ratio -------------------------------------------------
  const totalDebtService = monthlyRepayment + loanSummary.existingInstalments;
  const dsr = totalDebtService / monthlyIncome;
  const dsrPct = Math.round(dsr * 100);

  if (loanSummary.existingInstalments > 0) {
    rules.push(info("AFF_EXISTING_DEBT", `Existing loan repayments total ${formatMoney(loanSummary.existingInstalments)} per month.`, g));
  }

  if (dsr > cfg.maxDebtServiceRatio) {
    rules.push(block("AFF_DSR_BREACH", `Total monthly repayment of ${formatMoney(totalDebtService)} is ${dsrPct}% of income, above the ${Math.round(cfg.maxDebtServiceRatio * 100)}% debt service ceiling.`, g, { dsr }));
  } else if (dsr > cfg.warnDebtServiceRatio) {
    rules.push(warn("AFF_DSR_WARN", `Debt service ratio is ${dsrPct}%, close to the ${Math.round(cfg.maxDebtServiceRatio * 100)}% ceiling.`, g, { dsr }));
  } else {
    rules.push(pass("AFF_DSR_OK", `Debt service ratio is ${dsrPct}%.`, g, { dsr }));
  }

  // --- Disposable income --------------------------------------------------
  const disposable = monthlyIncome - totalDebtService;
  if (disposable < cfg.minDisposableIncome) {
    rules.push(block("AFF_DISPOSABLE_LOW", `Disposable income after repayment would be ${formatMoney(disposable)}, below the minimum of ${formatMoney(cfg.minDisposableIncome)}.`, g));
  } else {
    rules.push(pass("AFF_DISPOSABLE_OK", `Disposable income after repayment: ${formatMoney(disposable)}.`, g));
  }

  return rules;
};

/* -------------------------------------------------------------- SECURITY */
export const checkSecurity = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "SECURITY";
  const cfg = policy.security;
  const { security, amount, totalSavings, guarantors, loanSummary } = ctx;

  if (isBlank(security)) {
    rules.push(block("SEC_NOT_SELECTED", "Select the security offered for this loan.", g));
    return rules;
  }

  const requiredCover = amount * toNumber(cfg.coverageRatio[security], 1);

  switch (security) {
    case "own_deposit": {
      // Deposits already pledged against running loans are not available.
      const freeDeposits = Math.max(0, totalSavings - loanSummary.outstandingTotal);
      if (freeDeposits < requiredCover) {
        rules.push(block("SEC_DEPOSIT_INSUFFICIENT", `Free deposits of ${formatMoney(freeDeposits)} do not cover the required security of ${formatMoney(requiredCover)}.`, g));
      } else {
        rules.push(pass("SEC_DEPOSIT_OK", `Deposits of ${formatMoney(freeDeposits)} are pledged as security.`, g));
      }
      break;
    }
    case "guarantor": {
      const count = Array.isArray(guarantors) ? guarantors.length : toNumber(guarantors, 0);
      if (count < cfg.minGuarantors) {
        rules.push(block("SEC_GUARANTORS_SHORT", `${cfg.minGuarantors} guarantors are required; ${count} provided.`, g));
      } else {
        rules.push(pass("SEC_GUARANTORS_OK", `${count} guarantors provided.`, g));
      }
      // Guarantor deposit cover is confirmed at appraisal, not at capture.
      rules.push(info("SEC_GUARANTOR_VERIFY", "Guarantor deposits and existing guarantee exposure must be confirmed before disbursement.", g));
      break;
    }
    case "logbook":
    case "chattel":
    case "others": {
      rules.push(info("SEC_VALUATION_REQUIRED", `${security === "logbook" ? "Logbook" : security === "chattel" ? "Chattel" : "Collateral"} security requires a valuation covering at least ${formatMoney(requiredCover)} and a registered charge before disbursement.`, g));
      break;
    }
    default:
      rules.push(warn("SEC_UNRECOGNISED", `Security type "${security}" is not recognised by the current policy.`, g));
  }

  if (amount > cfg.unsecuredCeiling && security === "own_deposit" && totalSavings < amount) {
    rules.push(warn("SEC_ABOVE_UNSECURED_CAP", `Loans above ${formatMoney(cfg.unsecuredCeiling)} require security beyond member deposits.`, g));
  }

  return rules;
};

/* ------------------------------------------------------------- DOCUMENTS */
export const checkDocuments = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "DOCUMENTS";
  const cfg = policy.documents;
  const { documents = [], loanType } = ctx;

  const required =
    cfg.requiredByLoanType[loanType] || cfg.defaultRequired;

  if (documents.length === 0) {
    rules.push(block("DOC_NONE", `Attach the required documents: ${required.join(", ")}.`, g, { required }));
    return rules;
  }

  if (documents.length > cfg.maxFiles) {
    rules.push(block("DOC_TOO_MANY", `A maximum of ${cfg.maxFiles} documents may be attached; ${documents.length} selected.`, g));
  }

  // PDF validation.
  const nonPdf = documents.filter((f) => !cfg.allowedMimeTypes.includes(f.type));
  if (nonPdf.length > 0) {
    rules.push(block("DOC_INVALID_TYPE", `Only PDF files are accepted. Remove: ${nonPdf.map((f) => f.name).join(", ")}.`, g));
  }

  // Size validation.
  const oversize = documents.filter((f) => toNumber(f.size) > cfg.maxFileSizeMb * 1024 * 1024);
  if (oversize.length > 0) {
    rules.push(block("DOC_TOO_LARGE", `Each document must be under ${cfg.maxFileSizeMb} MB. Too large: ${oversize.map((f) => f.name).join(", ")}.`, g));
  }

  // Duplicate detection — same name and size is a re-selected file.
  const seen = new Set();
  const duplicates = [];
  for (const file of documents) {
    const key = `${String(file.name).toLowerCase()}::${toNumber(file.size)}`;
    if (seen.has(key)) duplicates.push(file.name);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    rules.push(block("DOC_DUPLICATE", `The same document was attached more than once: ${[...new Set(duplicates)].join(", ")}.`, g));
  }

  // Count against the checklist — contents are verified by the loans officer.
  if (documents.length < required.length) {
    rules.push(warn("DOC_CHECKLIST_SHORT", `${required.length} document(s) are required for this loan type (${required.join(", ")}); ${documents.length} attached.`, g, { required }));
  } else {
    rules.push(pass("DOC_COUNT_OK", `${documents.length} document(s) attached.`, g));
  }

  rules.push(info("DOC_CHECKLIST", `Checklist for this loan type: ${required.join(", ")}.`, g, { required }));

  return rules;
};

/* ----------------------------------------------------------------- FRAUD */
export const checkFraud = (ctx, policy = LOAN_POLICY) => {
  const rules = [];
  const g = "FRAUD";
  const cfg = policy.fraud;
  const { loanSummary, memberNo, memberRecord, amount, allLoans = [] } = ctx;

  // --- Member identity ---------------------------------------------------
  const missingFields = cfg.requiredMemberFields.filter((field) => {
    const value = field === "member_no" ? memberNo : pick(memberRecord, [field]);
    return isBlank(value);
  });
  if (missingFields.length > 0) {
    rules.push(block("FRD_MEMBER_INVALID", `Member information is incomplete (${missingFields.join(", ")}). The application cannot be processed.`, g));
  }

  // --- Multiple pending applications -------------------------------------
  if (loanSummary.pendingCount > cfg.maxPendingApplications - 1) {
    rules.push(block("FRD_PENDING_EXISTS", `${loanSummary.pendingCount} application(s) are already awaiting a decision. Complete the review before applying again.`, g));
  }

  // --- Duplicate application (same amount, recent window) ----------------
  const windowMs = cfg.duplicateWindowHours * 3600000;
  const duplicate = allLoans.find((loan) => {
    const created = parseSafeDate(pick(loan, ["created_at", "application_date"], null), policy);
    if (!created) return false;
    if (Date.now() - created.getTime() > windowMs) return false;
    const prior = toNumber(pick(loan, ["amount", "principal"], 0));
    if (prior <= 0 || !(amount > 0)) return false;
    return Math.abs(prior - amount) / amount <= cfg.duplicateAmountTolerance;
  });
  if (duplicate) {
    rules.push(block("FRD_DUPLICATE_APPLICATION", `An application for a similar amount was submitted in the last ${cfg.duplicateWindowHours} hours.`, g));
  }

  // --- Repeated applications ---------------------------------------------
  if (loanSummary.applicationsThisMonth >= cfg.maxApplicationsPerMonth) {
    rules.push(warn("FRD_FREQUENT_APPLICATIONS", `${loanSummary.applicationsThisMonth} applications have been made this month. Review the pattern before proceeding.`, g));
  }

  if (rules.length === 0) {
    rules.push(pass("FRD_CLEAR", "No fraud indicators detected.", g));
  }

  return rules;
};

/* =========================================================================
 * 7. DECISION
 * ========================================================================= */

/**
 * Build the full evaluation context from loaded data plus the form input.
 * Everything derived is computed exactly once here.
 */
export const buildEvaluationContext = (loadedData, application, policy = LOAN_POLICY) => {
  const { memberNo, memberRecord, ledger, loans, repayments, sources } = loadedData;

  const ledgerSummary = summariseLedger(ledger, policy);
  const loanSummary = summariseLoans(loans, policy);
  const repaymentSummary = summariseRepayments(repayments, loanSummary, policy);

  const membershipMonths = monthsSince(
    pick(memberRecord, ["join_date", "joined_at", "membership_date", "created_at"], null),
    policy
  );
  const memberAgeYears = yearsSince(
    pick(memberRecord, ["date_of_birth", "dob", "birth_date"], null),
    policy
  );

  const creditScore = computeCreditScore(
    {
      totalSavings: ledgerSummary.totalSavings,
      monthlyIncome: ledgerSummary.monthlyIncome,
      membershipMonths,
      worstArrearsDays: loanSummary.worstArrearsDays,
      classificationCode: loanSummary.classification.code,
      hasRepaymentHistory: repaymentSummary.hasHistory,
    },
    policy
  );

  const loanLimit = computeLoanLimit(
    ledgerSummary.totalSavings,
    creditScore,
    loanSummary.outstandingTotal,
    policy
  );

  const amount = toNumber(application.amount);
  const months = toNumber(application.months);
  const monthlyRepayment = estimateMonthlyRepayment(amount, months, policy);

  return {
    // identity
    memberNo,
    memberRecord,
    sources,
    // ledger
    totalSavings: ledgerSummary.totalSavings,
    totalLedgerValue: ledgerSummary.totalLedgerValue,
    monthlyIncome: ledgerSummary.monthlyIncome,
    incomeVerified:
      ledgerSummary.incomeObservedMonths >= policy.affordability.incomeWindowMonths,
    consistentSavingsMonths: ledgerSummary.consistentSavingsMonths,
    // membership
    membershipMonths,
    memberAgeYears,
    // loans
    allLoans: loans,
    loanSummary,
    repaymentSummary,
    // scoring
    creditScore,
    loanLimit,
    // application
    amount,
    months,
    monthlyRepayment,
    loanType: application.loanType,
    purpose: application.purpose,
    security: application.security,
    guarantors: application.guarantors,
    documents: application.documents || [],
    isRefinance: Boolean(application.isRefinance) || loanSummary.activeCount > 0,
    ledgerSummary,
  };
};

/** Group order used when presenting reasons to the officer. */
const RULE_GROUPS = [
  checkMembership,
  checkSavings,
  checkActiveLoans,
  checkRepaymentHistory,
  checkClassification,
  checkAffordability,
  checkSecurity,
  checkDocuments,
  checkFraud,
];

/**
 * Run every rule group and assemble the decision.
 *
 * @returns {{
 *   eligible: boolean,
 *   decision: "APPROVED"|"REFER"|"DECLINED",
 *   riskScore: number,
 *   creditScore: number,
 *   recommendedLimit: number,
 *   recommendedAmount: number,
 *   classification: object,
 *   monthlyRepayment: number,
 *   debtServiceRatio: number,
 *   reasons: string[],
 *   warnings: string[],
 *   conditions: string[],
 *   rules: object[],
 *   passedRules: object[]
 * }}
 */
export const evaluateLoanApplication = (context, policy = LOAN_POLICY) => {
  const rules = RULE_GROUPS.flatMap((group) => {
    try {
      return group(context, policy) || [];
    } catch (err) {
      // A defective rule must never take down the application screen.
      return [
        warn("RULE_ERROR", `A rule group could not be evaluated (${err.message}). Manual review required.`, "SYSTEM"),
      ];
    }
  });

  // Data-quality guard: flag any source that failed to load.
  Object.entries(context.sources || {}).forEach(([name, ok]) => {
    if (!ok) {
      rules.push(
        warn("DATA_SOURCE_UNAVAILABLE", `${name} data could not be read; the assessment is based on partial information.`, "SYSTEM")
      );
    }
  });

  const failed = rules.filter((r) => !r.passed);
  const blocks = failed.filter((r) => r.severity === SEVERITY.BLOCK);
  const warnings = failed.filter((r) => r.severity === SEVERITY.WARNING);
  const conditions = failed.filter((r) => r.severity === SEVERITY.INFO);

  // --- Risk score: 0 (safest) to 100 (riskiest) --------------------------
  const weights = policy.decision.severityWeight;
  const ruleRisk =
    blocks.length * weights.BLOCK +
    warnings.length * weights.WARNING +
    conditions.length * weights.INFO;
  const creditRisk = (100 - context.creditScore) * policy.decision.creditScoreWeight;
  const classRisk = toNumber(context.loanSummary?.classification?.riskWeight, 0);
  const riskScore = clamp(Math.round(ruleRisk + creditRisk + classRisk), 0, 100);

  // --- Recommended amount -------------------------------------------------
  const affordableCap = maxAffordablePrincipal(
    context.monthlyIncome,
    context.loanSummary.existingInstalments,
    context.months || policy.affordability.minMonths,
    policy
  );
  const recommendedLimit = Math.max(0, Math.floor(Math.min(context.loanLimit, affordableCap)));
  const recommendedAmount = Math.max(
    0,
    Math.floor(Math.min(context.amount || recommendedLimit, recommendedLimit))
  );

  // --- Decision ------------------------------------------------------------
  let decision = "APPROVED";
  if (blocks.length > 0 || riskScore >= policy.decision.declineThreshold) {
    decision = "DECLINED";
  } else if (warnings.length > 0 || riskScore >= policy.decision.referThreshold) {
    decision = "REFER";
  }

  const totalDebtService =
    context.monthlyRepayment + toNumber(context.loanSummary.existingInstalments);
  const debtServiceRatio =
    context.monthlyIncome > 0 ? round2(totalDebtService / context.monthlyIncome) : null;

  return {
    eligible: blocks.length === 0,
    decision,
    riskScore,
    creditScore: context.creditScore,
    recommendedLimit,
    recommendedAmount,
    classification: context.loanSummary.classification,
    monthlyRepayment: context.monthlyRepayment,
    debtServiceRatio,
    reasons: blocks.map((r) => r.message),
    warnings: warnings.map((r) => r.message),
    conditions: conditions.map((r) => r.message),
    rules,
    passedRules: rules.filter((r) => r.passed),
  };
};

/* =========================================================================
 * 8. PRESENTATION
 * ========================================================================= */

const bulletList = (items) => items.map((item) => `• ${item}`).join("\n");

/**
 * Officer-readable summary of a decision.
 * Replaces one-liners such as "Exceeds loan limit" with the full reasoning.
 */
export const formatDecisionMessage = (decision) => {
  if (!decision) return "";

  const lines = [];

  if (decision.decision === "DECLINED") {
    lines.push("❌ Loan declined.");
    if (decision.reasons.length) {
      lines.push("Reason:");
      lines.push(bulletList(decision.reasons));
    }
  } else if (decision.decision === "REFER") {
    lines.push("⚠️ Loan eligible, but referred for credit committee review.");
  } else {
    lines.push("✅ Loan eligible for submission.");
  }

  if (decision.warnings.length) {
    lines.push("Review points:");
    lines.push(bulletList(decision.warnings));
  }

  if (decision.conditions.length) {
    lines.push("Conditions before disbursement:");
    lines.push(bulletList(decision.conditions));
  }

  if (decision.decision !== "DECLINED" && decision.recommendedAmount > 0) {
    lines.push(
      `Recommended amount: ${formatMoney(decision.recommendedAmount)} · Monthly repayment: ${formatMoney(decision.monthlyRepayment)}`
    );
  }

  if (decision.decision === "DECLINED" && decision.recommendedAmount > 0) {
    lines.push(`The member currently qualifies for up to ${formatMoney(decision.recommendedAmount)}.`);
  }

  return lines.join("\n");
};

/* =========================================================================
 * 9. PERSISTENCE HELPERS
 * ========================================================================= */

const MISSING_COLUMN_CODES = ["42703", "PGRST204"];

/**
 * Insert a loan with the full appraisal payload, falling back to the legacy
 * column set if the deployment has not yet been migrated. This keeps the
 * component compatible with the current Umova schema.
 */
export const insertLoanApplication = async (supabase, basePayload, extendedPayload) => {
  let { data, error } = await supabase
    .from("loans")
    .insert([{ ...basePayload, ...extendedPayload }])
    .select()
    .single();

  if (error && MISSING_COLUMN_CODES.includes(error.code)) {
    // Extended appraisal columns are not present — save the core record.
    ({ data, error } = await supabase
      .from("loans")
      .insert([basePayload])
      .select()
      .single());
    return { data, error, degraded: !error };
  }

  return { data, error, degraded: false };
};

export default {
  LOAN_POLICY,
  loadLoanContext,
  buildEvaluationContext,
  evaluateLoanApplication,
  formatDecisionMessage,
  insertLoanApplication,
};