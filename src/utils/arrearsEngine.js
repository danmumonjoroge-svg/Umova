/**
 * Production-Grade Financial Analytical Engine & Credit Scoring Matrix
 * Fully synced with core institutional loan architecture schemas (1011 / 1020).
 */

const LOAN_ACCOUNT = "1011";
const LOAN_INTEREST_ACCOUNT = "1020";
const INSTALLMENT_DAYS = 30;

// Institutional Regulatory Loss Weightings Configurations
const PAR_TIERS = {
  PERFORMING:  { label: "Performing",  weight: 0.01, badge: "par-performing",  variant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  WATCH:       { label: "PAR 30",       weight: 0.10, badge: "par-30",          variant: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  SUBSTANDARD: { label: "PAR 60",       weight: 0.25, badge: "par-60",          variant: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  DOUBTFUL:    { label: "PAR 90",       weight: 0.50, badge: "par-90",          variant: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  LOSS:        { label: "Default",      weight: 1.00, badge: "par-default",     variant: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  OVERPAYMENT: { label: "Overpayment",  weight: 0.00, badge: "par-overpayment",  variant: "bg-teal-500/10 text-teal-400 border-teal-500/20" }
};

/**
 * Parses pipe-delimited database date records (YYYY|MM|DD) into standard JavaScript dates.
 */
function parsePipeDelimitedDate(dateStr) {
  if (!dateStr) return null;
  const cleanStr = String(dateStr).trim();
  
  if (/^\d{4}\|\d{2}\|\d{2}$/.test(cleanStr)) {
    const [year, month, day] = cleanStr.split("|").map(Number);
    return new Date(year, month - 1, day);
  }
  const standardFallback = Date.parse(cleanStr);
  return !isNaN(standardFallback) ? new Date(standardFallback) : null;
}

export function getParCategory(days) {
  if (days <= 0) return PAR_TIERS.PERFORMING.label;
  if (days <= 30) return PAR_TIERS.WATCH.label;
  if (days <= 60) return PAR_TIERS.SUBSTANDARD.label;
  if (days <= 90) return PAR_TIERS.DOUBTFUL.label;
  return PAR_TIERS.LOSS.label;
}

export function getParWeight(days) {
  if (days <= 0) return PAR_TIERS.PERFORMING.weight;
  if (days <= 30) return PAR_TIERS.WATCH.weight;
  if (days <= 60) return PAR_TIERS.SUBSTANDARD.weight;
  if (days <= 90) return PAR_TIERS.DOUBTFUL.weight;
  return PAR_TIERS.LOSS.weight;
}

export function getParClassMeta(category) {
  const match = Object.values(PAR_TIERS).find(t => t.label === category);
  return match ? { badgeClass: match.badge, tailwindClass: match.variant } : { badgeClass: "par-default", tailwindClass: "bg-slate-500/10 text-slate-400" };
}

/**
 * Main Engine Pipeline Processor
 * Compiles raw database row streams into actionable risk structures.
 */
export function calculateArrearsFromLedger(generalLedgerRows) {
  if (!Array.isArray(generalLedgerRows) || generalLedgerRows.length === 0) return [];

  const map = {};
  const now = new Date();
  const currentTimestamp = now.getTime();

  // Phase 1: Aggregate double-entry ledger mappings sequentially
  generalLedgerRows.forEach((row) => {
    const member = row.member_no || "UNKNOWN";
    const name = row.name || "";
    const debit = String(row.debit_account_id || "").trim();
    const credit = String(row.credit_account_id || "").trim();
    const amount = Number(row.amount || 0);

    const txDate = parsePipeDelimitedDate(row.date) || new Date(row.created_at);
    if (!txDate) return;

    if (!map[member]) {
      map[member] = {
        member_no: member,
        name,
        loan: 0,              // Debits to 1011 (Disbursements)
        repaid: 0,            // Credits to 1011 (Principal Repayments)
        interestCharged: 0,   // Debits to 1020 (Accruals)
        interestPaid: 0,      // Credits to 1020 (Interest Repayments)
        lastLoanIncreaseDate: null,
        lastPaymentDate: null
      };
    }

    const record = map[member];

    // Principal Disbursement / Increase Event
    if (debit === LOAN_ACCOUNT) {
      record.loan += amount;
      if (!record.lastLoanIncreaseDate || txDate > record.lastLoanIncreaseDate) {
        record.lastLoanIncreaseDate = txDate;
      }
    }

    // Principal Repayment Event
    if (credit === LOAN_ACCOUNT) {
      record.repaid += amount;
      if (!record.lastPaymentDate || txDate > record.lastPaymentDate) {
        record.lastPaymentDate = txDate;
      }
    }

    // Interest Accrued Event
    if (debit === LOAN_INTEREST_ACCOUNT) {
      record.interestCharged += amount;
    }

    // Interest Repayment Event (Servicing activity resets arrears clock anchor)
    if (credit === LOAN_INTEREST_ACCOUNT) {
      record.interestPaid += amount;
      if (!record.lastPaymentDate || txDate > record.lastPaymentDate) {
        record.lastPaymentDate = txDate;
      }
    }
  });

  // Phase 2: Apply conditional scoring parameters & transform portfolios
  const processedProfiles = Object.values(map).map((m) => {
    const balance = m.loan - m.repaid;
    const interestBalance = m.interestCharged - m.interestPaid;
    const totalOutstanding = balance + interestBalance;
    const ratio = m.loan ? m.repaid / m.loan : 0;

    let arrearsDays = 0;
    let isInArrears = false;
    let parCategory = PAR_TIERS.PERFORMING.label;
    let weight = PAR_TIERS.PERFORMING.weight;

    // --- OVERPAYMENT SAFETY ANCHOR PIPELINE ---
    if (totalOutstanding < -1.00) {
      parCategory = PAR_TIERS.OVERPAYMENT.label;
      const meta = getParClassMeta(parCategory);

      return {
        ...m,
        balance: Number(balance.toFixed(2)),
        interestBalance: Number(interestBalance.toFixed(2)),
        totalOutstanding: Number(totalOutstanding.toFixed(2)),
        ratio,
        arrearsDays: 0,
        isInArrears: false,
        score: 100.00,
        riskBand: "Excellent",
        parCategory,
        parExposure: 0,
        badgeClass: meta.badgeClass,
        tailwindClass: meta.tailwindClass,
        nextDueDate: "Fully Settled"
      };
    }

    // Determine runtime milestone date reference points
    let refDate = null;
    if (m.lastPaymentDate && m.lastLoanIncreaseDate) {
      refDate = m.lastPaymentDate > m.lastLoanIncreaseDate ? m.lastPaymentDate : m.lastLoanIncreaseDate;
    } else {
      refDate = m.lastPaymentDate || m.lastLoanIncreaseDate;
    }

    // --- EVALUATE DAYS IN ARREARS (DPD) ---
    let nextDueDisplay = "N/A";
    if (totalOutstanding > 0 && refDate) {
      const nextDue = new Date(refDate.getTime());
      nextDue.setDate(nextDue.getDate() + INSTALLMENT_DAYS);
      nextDueDisplay = nextDue.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      if (currentTimestamp > nextDue.getTime()) {
        const dpd = Math.floor((currentTimestamp - nextDue.getTime()) / (1000 * 60 * 60 * 24));
        if (dpd > 0) {
          arrearsDays = Math.min(dpd, 120); // Cap metric at 120 per system design
          isInArrears = true;
        }
      }
    }

    parCategory = getParCategory(arrearsDays);
    weight = getParWeight(arrearsDays);
    const parExposure = totalOutstanding * weight;

    // --- CALCULATE SYSTEM REPAYMENT SCORE CRITERIA ---
    let score = 0;
    score += ratio * 40; // Repayment behavior weight allocation

    if (arrearsDays <= 0) score += 40;
    else if (arrearsDays <= 30) score += 25;
    else if (arrearsDays <= 60) score += 15;
    else if (arrearsDays <= 90) score += 5;

    if (balance <= 0) score += 20; // Completion bonus validation parameter
    score = Math.min(100, Math.max(0, score));

    let riskBand = "High Risk";
    if (score >= 85) riskBand = "Excellent";
    else if (score >= 70) riskBand = "Good";
    else if (score >= 50) riskBand = "Fair";

    const classMeta = getParClassMeta(parCategory);

    return {
      ...m,
      balance: Number(balance.toFixed(2)),
      interestBalance: Number(interestBalance.toFixed(2)),
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      ratio,
      arrearsDays,
      isInArrears,
      score: Number(score.toFixed(2)),
      riskBand,
      parCategory,
      parExposure: Number(parExposure.toFixed(2)),
      badgeClass: classMeta.badgeClass,
      tailwindClass: classMeta.tailwindClass,
      nextDueDate: isInArrears ? `PAST DUE (${nextDueDisplay})` : nextDueDisplay
    };
  });

  // Sort logically: Aligns exactly with Member Sequence parameters
  return processedProfiles.sort((x, y) => {
    const numX = Number(String(x.member_no).replace(/\D/g, ""));
    const numY = Number(String(y.member_no).replace(/\D/g, ""));
    return numX - numY;
  });
}