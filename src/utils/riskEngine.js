/* ======================================================
   UMOVA SACCO RISK ENGINE (UPGRADED - ARREARS + 1011 LOGIC)
   FILE:
   src/utils/riskEngine.js
====================================================== */

/* ======================================================
   HELPERS
====================================================== */

const clamp = (n, min, max) =>
  Math.max(min, Math.min(max, n));

const getDaysBetween = (date1, date2) => {
  if (!date1 || !date2) return 0;

  const d1 = new Date(date1);
  const d2 = new Date(date2);

  const diff = d2 - d1;

  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

/* ======================================================
   RISK LABEL
====================================================== */

export const getRiskLabel = (score) => {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Very Good";
  if (score >= 65) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 35) return "Poor";
  return "Very Poor";
};

/* ======================================================
   PAR CATEGORY
====================================================== */

export const getParCategory = (days) => {
  if (days <= 0) return "Performing";
  if (days <= 30) return "PAR 30";
  if (days <= 60) return "PAR 60";
  if (days <= 90) return "PAR 90";
  return "Default";
};

/* ======================================================
   1. REPAYMENT DISCIPLINE (UPGRADED)
====================================================== */

export const calculateRepaymentScore = ({
  loanDisbursementDate,
  lastPaymentDate,
  lastInterestPaymentDate,
  systemDate = new Date(),

  repaymentRatio = 0,
  missedPayments = 0,
  refinanceCount = 0,
}) => {
  const lastRelevantPayment =
    [lastPaymentDate, lastInterestPaymentDate]
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];

  let arrearsDays = 0;

  if (lastRelevantPayment) {
    arrearsDays = getDaysBetween(
      lastRelevantPayment,
      systemDate
    );
  } else if (loanDisbursementDate) {
    arrearsDays = getDaysBetween(
      loanDisbursementDate,
      systemDate
    );
  }

  if (refinanceCount > 0 && arrearsDays < 30) {
    arrearsDays = Math.max(0, arrearsDays - 15);
  }

  let base = 100;

  if (arrearsDays <= 0) base = 100;
  else if (arrearsDays <= 7) base = 90;
  else if (arrearsDays <= 15) base = 80;
  else if (arrearsDays <= 30) base = 65;
  else if (arrearsDays <= 60) base = 45;
  else if (arrearsDays <= 90) base = 30;
  else base = 10;

  base += repaymentRatio * 10;
  base -= missedPayments * 4;
  base -= refinanceCount * 3;

  const score = clamp(base, 0, 100);

  return {
    score,
    arrearsDays,
    lastRelevantPayment,
  };
};

/* ======================================================
   2. SAVINGS CONSISTENCY
====================================================== */

export const calculateSavingsScore = ({
  monthlySavings = 0,
  savingsFrequency = 0,
  dormantMonths = 0,
  savingsTrend = "stable",
}) => {
  let score = 50;

  if (savingsFrequency >= 12) score += 35;
  else if (savingsFrequency >= 9) score += 25;
  else if (savingsFrequency >= 6) score += 15;
  else if (savingsFrequency >= 3) score += 5;
  else score -= 10;

  if (monthlySavings >= 50000) score += 15;
  else if (monthlySavings >= 20000) score += 10;
  else if (monthlySavings >= 5000) score += 5;

  score -= dormantMonths * 5;

  if (savingsTrend === "improving") score += 10;
  if (savingsTrend === "declining") score -= 10;

  return clamp(score, 0, 100);
};

/* ======================================================
   3. LOAN UTILIZATION
====================================================== */

export const calculateUtilizationScore = ({
  loanBalance = 0,
  totalSavings = 0,
  activeLoans = 1,
  refinanceCount = 0,
}) => {
  const ratio =
    totalSavings > 0 ? loanBalance / totalSavings : 999;

  let score;

  if (ratio <= 1) score = 100;
  else if (ratio <= 2) score = 85;
  else if (ratio <= 3) score = 70;
  else if (ratio <= 4) score = 50;
  else score = 25;

  score -= Math.max(0, activeLoans - 1) * 5;
  score -= refinanceCount * 5;

  return clamp(score, 0, 100);
};

/* ======================================================
   4. MEMBER TENURE
====================================================== */

export const calculateTenureScore = ({
  membershipMonths = 0,
  activityConsistency = 0,
}) => {
  let score = 40;

  if (membershipMonths >= 60) score += 50;
  else if (membershipMonths >= 36) score += 40;
  else if (membershipMonths >= 24) score += 30;
  else if (membershipMonths >= 12) score += 20;
  else if (membershipMonths >= 6) score += 10;

  score += activityConsistency * 0.2;

  return clamp(score, 0, 100);
};

/* ======================================================
   5. CAPACITY SCORE
====================================================== */

export const calculateCapacityScore = ({
  monthlyIncome = 0,
  monthlyInstallment = 0,
  existingDeductions = 0,
}) => {
  if (monthlyIncome <= 0) return 20;

  const burden =
    (monthlyInstallment + existingDeductions) / monthlyIncome;

  if (burden <= 0.2) return 100;
  if (burden <= 0.3) return 85;
  if (burden <= 0.4) return 70;
  if (burden <= 0.5) return 50;
  if (burden <= 0.6) return 35;

  return 15;
};

/* ======================================================
   6. BEHAVIOR SCORE
====================================================== */

export const calculateBehaviorScore = ({
  withdrawalFrequency = 0,
  suspiciousActivity = false,
  rapidWithdrawals = false,
}) => {
  let score = 100;

  if (withdrawalFrequency > 20) score -= 20;
  else if (withdrawalFrequency > 10) score -= 10;

  if (suspiciousActivity) score -= 35;
  if (rapidWithdrawals) score -= 15;

  return clamp(score, 0, 100);
};

/* ======================================================
   FINAL RISK ENGINE
====================================================== */

export const calculateFinalRisk = ({
  repayment = 0,
  savings = 0,
  utilization = 0,
  tenure = 0,
  capacity = 0,
  behavior = 0,
}) => {
  const finalScore =
    repayment * 0.35 +
    savings * 0.2 +
    utilization * 0.15 +
    tenure * 0.1 +
    capacity * 0.1 +
    behavior * 0.1;

  const normalized = Number(finalScore.toFixed(2));

  return {
    score: normalized,
    riskLabel: getRiskLabel(normalized),
  };
};

/* ======================================================
   MASTER ENGINE
====================================================== */

export const runRiskEngine = (data) => {
  const repaymentResult = calculateRepaymentScore({
    loanDisbursementDate: data.loanDisbursementDate,
    lastPaymentDate: data.lastPaymentDate,
    lastInterestPaymentDate: data.lastInterestPaymentDate,
    systemDate: data.systemDate,

    repaymentRatio: data.repaymentRatio,
    missedPayments: data.missedPayments,
    refinanceCount: data.refinanceCount,
  });

  const savings = calculateSavingsScore({
    monthlySavings: data.monthlySavings,
    savingsFrequency: data.savingsFrequency,
    dormantMonths: data.dormantMonths,
    savingsTrend: data.savingsTrend,
  });

  const utilization = calculateUtilizationScore({
    loanBalance: data.loanBalance,
    totalSavings: data.totalSavings,
    activeLoans: data.activeLoans,
    refinanceCount: data.refinanceCount,
  });

  const tenure = calculateTenureScore({
    membershipMonths: data.membershipMonths,
    activityConsistency: data.activityConsistency,
  });

  const capacity = calculateCapacityScore({
    monthlyIncome: data.monthlyIncome,
    monthlyInstallment: data.monthlyInstallment,
    existingDeductions: data.existingDeductions,
  });

  const behavior = calculateBehaviorScore({
    withdrawalFrequency: data.withdrawalFrequency,
    suspiciousActivity: data.suspiciousActivity,
    rapidWithdrawals: data.rapidWithdrawals,
  });

  const final = calculateFinalRisk({
    repayment: repaymentResult.score,
    savings,
    utilization,
    tenure,
    capacity,
    behavior,
  });

  return {
    score: final.score,
    riskLabel: final.riskLabel,

    parCategory: getParCategory(repaymentResult.arrearsDays),

    arrearsDays: repaymentResult.arrearsDays,
    lastRelevantPayment: repaymentResult.lastRelevantPayment,

    breakdown: {
      repayment: repaymentResult.score,
      savings,
      utilization,
      tenure,
      capacity,
      behavior,
    },
  };
};