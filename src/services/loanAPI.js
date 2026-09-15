/**
 * Standard reducing-balance (annuity) amortization. Pure calculation, no
 * backend dependency — the old version fetched a "generate-loan-schedule"
 * edge function that isn't deployed anywhere in the reviewed functions
 * bundle, but this math doesn't need a server round-trip in the first
 * place.
 *
 * NOTE: this is a standalone calculator, not linked to any real loan_id /
 * loan_application record — that's a limitation of the page that calls it
 * (Pages/Admin/LoanSchedule.js), not of this function.
 */
export const generateLoanSchedule = async ({ principal, term_months, annual_rate }) => {
  const P = Number(principal);
  const n = Number(term_months);
  const monthlyRate = Number(annual_rate) / 12;

  if (!P || P <= 0) throw new Error("Principal must be a positive number.");
  if (!n || n <= 0) throw new Error("Term (months) must be a positive number.");
  if (annual_rate === undefined || annual_rate === null || isNaN(Number(annual_rate)) || Number(annual_rate) < 0) {
    throw new Error("Annual interest rate must be a non-negative number.");
  }

  const emi =
    monthlyRate === 0
      ? P / n
      : (P * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));

  let balance = P;
  const schedule = [];

  for (let i = 1; i <= n; i++) {
    const interest = balance * monthlyRate;
    // Last installment absorbs any rounding remainder so balance hits
    // exactly zero instead of drifting a few cents.
    const principalPortion = i === n ? balance : emi - interest;
    balance = Math.max(0, balance - principalPortion);

    schedule.push({
      installment: i,
      emi: Number((principalPortion + interest).toFixed(2)),
      principal: Number(principalPortion.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      balance: Number(balance.toFixed(2)),
    });
  }

  return { schedule };
};
