import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { getSystemAccount } from "../services/chartOfAccountsAPI";

/**
 * One source of truth for "what does this member's ledger say".
 *
 * Savings.js, ShareCapital.js, Loans.js, Statements.js and DashboardHome.js
 * each independently queried general_ledger and re-implemented the same
 * debit/credit parsing, between them hardcoding account ids (1018, 1011,
 * 1012, 1020) in 28 places. That meant five chances to drift apart, and
 * five things to fix whenever the Chart of Accounts changed.
 *
 * Returns per-account transaction lists with a RUNNING BALANCE on each row
 * (what a passbook shows), plus closing balances.
 *
 * Sign conventions follow each account's normal balance:
 *   savings (liability to member) — credit increases what the SACCO owes them
 *   shares  (equity)              — credit increases their stake
 *   loans   (asset to SACCO)      — debit increases what they owe
 */
export function useMemberLedger(memberNo) {
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!memberNo) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [savings, shares, loans, interest] = await Promise.all([
        getSystemAccount("MEMBER_SAVINGS"),
        getSystemAccount("SHARE_CAPITAL"),
        getSystemAccount("LOAN_RECEIVABLE"),
        getSystemAccount("INTEREST_INCOME"),
      ]);
      setAccounts({ savings, shares, loans, interest });

      const { data, error: qErr } = await supabase
        .from("general_ledger")
        .select("*")
        .eq("member_no", memberNo)
        // Only finalized rows, matching the accounting reports. Without
        // this a member sees draft/pending activity as if it were real.
        .in("status", ["POSTED", "APPROVED"])
        .order("date", { ascending: true });

      if (qErr) throw qErr;
      setRows(data || []);
    } catch (err) {
      console.error("useMemberLedger:", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [memberNo]);

  useEffect(() => {
    load();
  }, [load]);

  const ledger = useMemo(() => {
    const empty = {
      savings: { transactions: [], balance: 0 },
      shares: { transactions: [], balance: 0 },
      loans: { transactions: [], balance: 0 },
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalRepayments: 0,
      netPosition: 0,
    };

    if (!accounts || rows.length === 0) return empty;

    const result = {
      savings: { transactions: [], balance: 0 },
      shares: { transactions: [], balance: 0 },
      loans: { transactions: [], balance: 0 },
    };

    let savingsBal = 0, sharesBal = 0, loansBal = 0;
    let totalDeposits = 0, totalWithdrawals = 0, totalRepayments = 0;

    for (const tx of rows) {
      const amount = Number(tx.amount || 0);
      const debit = Number(tx.debit_account_id);
      const credit = Number(tx.credit_account_id);

      if (credit === accounts.savings || debit === accounts.savings) {
        if (credit === accounts.savings) { savingsBal += amount; totalDeposits += amount; }
        if (debit === accounts.savings) { savingsBal -= amount; totalWithdrawals += amount; }
        result.savings.transactions.push({ ...tx, direction: credit === accounts.savings ? "in" : "out", runningBalance: savingsBal });
      }

      if (credit === accounts.shares || debit === accounts.shares) {
        if (credit === accounts.shares) sharesBal += amount;
        if (debit === accounts.shares) sharesBal -= amount;
        result.shares.transactions.push({ ...tx, direction: credit === accounts.shares ? "in" : "out", runningBalance: sharesBal });
      }

      // Interest charged on a loan increases what the member owes, so it
      // belongs on the loan statement even though it hits an income account.
      if (credit === accounts.loans || debit === accounts.loans || debit === accounts.interest) {
        if (debit === accounts.loans) loansBal += amount;
        if (credit === accounts.loans) { loansBal -= amount; totalRepayments += amount; }
        if (debit === accounts.interest) loansBal += amount;
        result.loans.transactions.push({ ...tx, direction: credit === accounts.loans ? "in" : "out", runningBalance: loansBal });
      }
    }

    result.savings.balance = savingsBal;
    result.shares.balance = sharesBal;
    result.loans.balance = loansBal;

    return {
      ...result,
      totalDeposits,
      totalWithdrawals,
      totalRepayments,
      // What the member would walk away with today: their savings and
      // shares, less what they still owe.
      netPosition: savingsBal + sharesBal - loansBal,
    };
  }, [rows, accounts]);

  return { ledger, rows, loading, error, reload: load };
}

export default useMemberLedger;
