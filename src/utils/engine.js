// utils/engine.js

export const ACC = {
  SAVINGS: 1018,
  LOANS: 1011,
  SHARES: 1012,
};

export const processLedger = (ledger = []) => {
  let savings = 0;
  let loans = 0;
  let shares = 0;

  const savingsTx = [];
  const loanTx = [];
  const shareTx = [];

  ledger.forEach((t) => {
    const amt = Number(t.amount || 0);

    // ================= SAVINGS =================
    if (t.credit_account_id === ACC.SAVINGS) savings += amt;
    if (t.debit_account_id === ACC.SAVINGS) savings -= amt;

    if (
      t.credit_account_id === ACC.SAVINGS ||
      t.debit_account_id === ACC.SAVINGS
    ) {
      savingsTx.push({ ...t, balance: savings });
    }

    // ================= LOANS (FIXED HERE) =================
    if (
      t.debit_account_id === ACC.LOANS ||
      t.credit_account_id === ACC.LOANS
    ) {
      // loan issued
      if (t.debit_account_id === ACC.LOANS) loans += amt;

      // repayment
      if (t.credit_account_id === ACC.LOANS) loans -= amt;

      loanTx.push({ ...t, balance: loans });
    }

    // ================= SHARES =================
    if (t.credit_account_id === ACC.SHARES) shares += amt;
    if (t.debit_account_id === ACC.SHARES) shares -= amt;

    if (
      t.credit_account_id === ACC.SHARES ||
      t.debit_account_id === ACC.SHARES
    ) {
      shareTx.push({ ...t, balance: shares });
    }
  });

  return {
    savings,
    loans,
    shares,
    savingsTx,
    loanTx,
    shareTx,
  };
};