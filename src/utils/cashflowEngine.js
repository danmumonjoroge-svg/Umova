export const analyzeCashflow = (transactions) => {
  let inflow = 0;
  let outflow = 0;

  let monthlyBuckets = {};

  transactions.forEach((t) => {
    const amount = Number(t.amount || 0);
    const month = new Date(t.date).getMonth();

    // INCOME (money received)
    if (t.type === "CREDIT") {
      inflow += amount;
    }

    // EXPENSE (money spent)
    if (t.type === "DEBIT") {
      outflow += amount;
    }

    // monthly grouping (for stability check)
    if (!monthlyBuckets[month]) {
      monthlyBuckets[month] = { inflow: 0, outflow: 0 };
    }

    if (t.type === "CREDIT") {
      monthlyBuckets[month].inflow += amount;
    } else {
      monthlyBuckets[month].outflow += amount;
    }
  });

  const net = inflow - outflow;

  return {
    inflow,
    outflow,
    net,
    monthlyBuckets,
  };
};

// STABILITY SCORE (important for loans)
export const calculateCashflowScore = (cashflow) => {
  const { inflow, outflow, monthlyBuckets } = cashflow;

  let score = 50;

  // income strength
  if (inflow > 50000) score += 20;
  else if (inflow > 20000) score += 10;

  // stability (consistent months)
  const months = Object.values(monthlyBuckets);
  const stableMonths = months.filter(
    (m) => m.inflow > 10000
  ).length;

  if (stableMonths >= 3) score += 20;

  // spending discipline
  if (outflow < inflow) score += 10;

  return Math.min(score, 100);
};

// RULE 7 (UPDATED USING CASHFLOW)
export const checkAffordability = (inflow, repayment) => {
  const limit = inflow * 0.3;

  return {
    allowed: repayment <= limit,
    limit,
  };
};