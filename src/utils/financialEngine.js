/* =====================================================
   SACCO FINANCIAL INTELLIGENCE ENGINE
===================================================== */

const ACC = {
  CASH: "1007",
  SAVINGS: "1018",
  LOANS: "1011",
  SHARES: "1012",
  INTEREST: "1020",
  EXPENSES: "5000",
};

const n = (v) => (isNaN(Number(v)) ? 0 : Number(v));
const id = (v) => String(v ?? "");

/* =====================================================
   BUILD FINANCIAL STATE
===================================================== */

export const buildFinancialState = (ledger) => {
  const s = {
    cash: 0,
    savings: 0,
    loans: 0,
    shares: 0,
    income: 0,
    expenses: 0,
    loanMovements: [],
  };

  for (const t of ledger || []) {
    const amt = n(t.amount);

    const dr = id(t.debit_account_id);
    const cr = id(t.credit_account_id);

    /* ================= CASH ================= */

    if (dr === ACC.CASH) s.cash += amt;
    if (cr === ACC.CASH) s.cash -= amt;

    /* ================= SAVINGS ================= */

    if (cr === ACC.SAVINGS) s.savings += amt;
    if (dr === ACC.SAVINGS) s.savings -= amt;

    /* ================= LOANS ================= */

    if (dr === ACC.LOANS) s.loans += amt;
    if (cr === ACC.LOANS) s.loans -= amt;

    /* ================= SHARES ================= */

    if (cr === ACC.SHARES) s.shares += amt;
    if (dr === ACC.SHARES) s.shares -= amt;

    /* ================= INTEREST / INCOME ================= */

    if (cr === ACC.INTEREST) s.income += amt;

    /* ================= EXPENSES ================= */

    if (dr === ACC.EXPENSES) s.expenses += amt;

    /* ================= LOAN MOVEMENTS ================= */

    if (dr === ACC.LOANS || cr === ACC.LOANS) {
      s.loanMovements.push(t);
    }
  }

  s.profit = s.income - s.expenses;

  return s;
};

/* =====================================================
   PAR ENGINE
===================================================== */

export const calculatePAR = (loanMovements) => {
  const now = new Date();

  const members = {};

  for (const t of loanMovements || []) {
    const memberId = t.member_id || "UNKNOWN";
    const amt = n(t.amount);

    if (!members[memberId]) {
      members[memberId] = {
        exposure: 0,
        lastActivity: null,
      };
    }

    const dr = id(t.debit_account_id);
    const cr = id(t.credit_account_id);

    if (dr === ACC.LOANS) {
      members[memberId].exposure += amt;
    }

    if (cr === ACC.LOANS) {
      members[memberId].exposure -= amt;
    }

    const txDate = new Date(t.transaction_date);

    if (!isNaN(txDate)) {
      if (
        !members[memberId].lastActivity ||
        txDate > members[memberId].lastActivity
      ) {
        members[memberId].lastActivity = txDate;
      }
    }
  }

  let totalExposure = 0;
  let weightedRisk = 0;

  const breakdown = [];

  Object.entries(members).forEach(([memberId, m]) => {
    if (m.exposure <= 0) return;

    totalExposure += m.exposure;

    const days =
      (now - (m.lastActivity || now)) /
      (1000 * 60 * 60 * 24);

    let weight = 0.01;

    if (days <= 30) weight = 0.01;
    else if (days <= 45) weight = 0.05;
    else if (days <= 60) weight = 0.25;
    else if (days <= 90) weight = 0.5;
    else weight = 1;

    const risk = m.exposure * weight;

    weightedRisk += risk;

    breakdown.push({
      memberId,
      exposure: Number(m.exposure.toFixed(2)),
      days: Number(days.toFixed(1)),
      weight,
      risk: Number(risk.toFixed(2)),
    });
  });

  const par =
    totalExposure > 0
      ? (weightedRisk / totalExposure) * 100
      : 0;

  return {
    par,
    totalExposure,
    weightedRisk,
    breakdown,
  };
};

/* =====================================================
   RATIOS ENGINE
===================================================== */

export const calculateRatios = (s) => {
  const assets = s.cash + s.loans;
  const liabilities = s.savings;

  return {
    liquidityRatio:
      liabilities > 0
        ? assets / liabilities
        : 0,

    loanToSavings:
      s.savings > 0
        ? s.loans / s.savings
        : 0,

    savingsCoverage:
      s.loans > 0
        ? s.savings / s.loans
        : 0,

    cashRatio:
      assets > 0
        ? s.cash / assets
        : 0,

    equityRatio:
      assets > 0
        ? (s.shares + s.savings) / assets
        : 0,

    profitability:
      assets > 0
        ? s.profit / assets
        : 0,

    operatingMargin:
      s.income > 0
        ? s.profit / s.income
        : 0,
  };
};

/* =====================================================
   FORECAST ENGINE
===================================================== */

export const forecast = (s) => {
  const monthlySavings = s.savings / 6 || 0;
  const monthlyLoans = s.loans / 6 || 0;
  const monthlyIncome = s.income / 6 || 0;

  return {
    savings12m: monthlySavings * 12,
    loans12m: monthlyLoans * 12,
    income12m: monthlyIncome * 12,

    netForecast:
      (monthlySavings + monthlyIncome - monthlyLoans) *
      12,
  };
};

/* =====================================================
   RISK ENGINE
===================================================== */

export const riskEngine = (par, ratios) => {
  let score = 100;

  score -= par;
  score -= ratios.loanToSavings * 10;

  if (ratios.liquidityRatio < 1) score -= 15;
  if (ratios.cashRatio < 0.1) score -= 10;

  score = Math.max(0, Math.min(100, score));

  return {
    score,

    grade:
      score > 80
        ? "A - Strong"
        : score > 60
        ? "B - Stable"
        : score > 40
        ? "C - Warning"
        : score > 20
        ? "D - Risk"
        : "E - Critical",
  };
};

/* =====================================================
   INSIGHTS ENGINE
===================================================== */

export const insights = (par, ratios, s) => {
  const i = [];

  if (par > 25)
    i.push("⚠️ High PAR indicates loan stress.");

  if (par > 50)
    i.push("🚨 Critical credit deterioration.");

  if (ratios.loanToSavings > 2)
    i.push("⚠️ Loan book heavily exposed.");

  if (ratios.liquidityRatio < 1)
    i.push("🚨 Liquidity risk detected.");

  if (s.cash < 0)
    i.push("🚨 Negative cash position.");

  if (ratios.profitability > 0.2)
    i.push("✅ Strong profitability.");

  if (par < 10)
    i.push("✅ Healthy loan portfolio.");

  return i;
};

/* =====================================================
   MASTER DASHBOARD ENGINE
===================================================== */

export const buildFinancialDashboard = (ledger) => {
  const state = buildFinancialState(ledger);

  const parData = calculatePAR(
    state.loanMovements
  );

  const ratios = calculateRatios(state);

  const forecastData = forecast(state);

  const risk = riskEngine(
    parData.par,
    ratios
  );

  const notes = insights(
    parData.par,
    ratios,
    state
  );

  return {
    ...state,

    assets: state.cash + state.loans,

    liabilities: state.savings,

    equity: state.shares,

    par: parData.par,

    parBreakdown: parData.breakdown,

    ratios,

    forecast: forecastData,

    risk,

    insights: notes,
  };
};