/**
 * Advanced Double-Entry Financial Analytical Engine
 * Rebuilds structural balances & arrears tracking days from row-level general ledger entries
 */
export function calculateArrearsFromLedger(ledgerEntries) {
  const memberMap = {};
  const nowTs = new Date().getTime();

  // Financial system configuration benchmarks
  const PROVISION_COEFFICIENTS = { WATCH: 0.05, SUBSTANDARD: 0.25, DOUBTFUL: 0.50, LOSS: 1.00 };

  // Phase 1: Reduce sequential ledger entry logs to active accounts metrics
  ledgerEntries.forEach((entry) => {
    const memberNo = entry.member_no;
    if (!memberNo) return;

    if (!memberMap[memberNo]) {
      memberMap[memberNo] = {
        member_no: memberNo,
        principalIssued: 0,
        principalPaid: 0,
        interestAccrued: 0,
        lastPaymentDate: null,
        earliestDisbursementDate: null
      };
    }

    const accountRecord = memberMap[memberNo];
    const amt = Number(entry.amount || 0);
    const dr = String(entry.debit_account_id);
    const cr = String(entry.credit_account_id);
    const entryDate = new Date(entry.created_at);

    // Principal Disbursements (Debit Account Code 1011)
    if (dr === "1011") {
      accountRecord.principalIssued += amt;
      if (!accountRecord.earliestDisbursementDate || entryDate < accountRecord.earliestDisbursementDate) {
        accountRecord.earliestDisbursementDate = entryDate;
      }
    }
    // Principal Repayments / Collections (Credit Account Code 1011)
    if (cr === "1011") {
      accountRecord.principalPaid += amt;
      if (!accountRecord.lastPaymentDate || entryDate > accountRecord.lastPaymentDate) {
        accountRecord.lastPaymentDate = entryDate;
      }
    }
    // Revenue Stream/Interest Accrued (Credit Account Code 1020)
    if (cr === "1020") {
      accountRecord.interestAccrued += amt;
    }
  });

  // Phase 2: Convert structural states map into regulatory collections records
  const calculatedOutput = [];

  Object.values(memberMap).forEach((acc) => {
    const activeNetBalance = acc.principalIssued - acc.principalPaid;
    
    // Ignore accounts with no outstanding credit exposures
    if (activeNetBalance <= 1) return;

    // Evaluate aging parameters against the timeline anchors
    const creditTimelineAnchor = acc.lastPaymentDate || acc.earliestDisbursementDate;
    let computedOverdueDays = 0;

    if (creditTimelineAnchor) {
      const differenceMillis = Math.abs(nowTs - creditTimelineAnchor.getTime());
      computedOverdueDays = Math.floor(differenceMillis / (1000 * 60 * 60 * 24));
    }

    // Filter down to non-performing records
    if (computedOverdueDays <= 0) return;

    // Banking classification tier logic allocation
    let tier = "WATCH";
    let coefficient = PROVISION_COEFFICIENTS.WATCH;
    let UIStyles = "bg-blue-500/10 text-blue-400 border-blue-500/20";

    if (computedOverdueDays > 180) {
      tier = "LOSS";
      coefficient = PROVISION_COEFFICIENTS.LOSS;
      UIStyles = "bg-rose-500/10 text-rose-400 border-rose-500/20";
    } else if (computedOverdueDays > 90) {
      tier = "DOUBTFUL";
      coefficient = PROVISION_COEFFICIENTS.DOUBTFUL;
      UIStyles = "bg-orange-500/10 text-orange-400 border-orange-500/20";
    } else if (computedOverdueDays > 30) {
      tier = "SUBSTANDARD";
      coefficient = PROVISION_COEFFICIENTS.SUBSTANDARD;
      UIStyles = "bg-amber-500/10 text-amber-400 border-amber-500/20";
    }

    calculatedOutput.push({
      member_no: acc.member_no,
      balance: activeNetBalance,
      arrears_days: computedOverdueDays,
      penalty_accrued: acc.interestAccrued * 0.1, // Automated 10% penalty calculation benchmark rules
      riskTier: tier,
      badgeClass: UIStyles,
      lossProvision: activeNetBalance * coefficient,
      lastRepayment: acc.lastPaymentDate ? acc.lastPaymentDate.toLocaleDateString() : "No Payments Tracked"
    });
  });

  // Default sorted execution layout: severe chronological durations take precedence
  return calculatedOutput.sort((x, y) => y.arrears_days - x.arrears_days);
}