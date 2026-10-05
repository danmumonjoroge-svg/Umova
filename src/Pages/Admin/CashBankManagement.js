import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { SectionCard, EmptyState } from "./AdminUI";
import { Field, kes } from "./AdminForm";

/**
 * Section 14 — scoped deliberately: a real transaction ledger (transfers,
 * charges, interest) plus MANUAL reconciliation (mark a ledger row
 * matched/unmatched by hand). Bank statement import + auto-matching is a
 * separate, larger product decision (file format, matching rules, per-bank
 * config) that wasn't specified — not built speculatively here.
 *
 * Also scoped to a single bank relationship, matching what's actually in
 * the Chart of Accounts today (one "CIC Bank" system account). If more
 * banks get added later, CASH/BANK below would need to become a
 * per-account selector instead of a fixed pair.
 */
const CASH_TX_TYPES = [
  { key: "TRANSFER_CASH_TO_BANK", label: "Transfer: Cash → Bank" },
  { key: "TRANSFER_BANK_TO_CASH", label: "Transfer: Bank → Cash" },
  { key: "BANK_CHARGE", label: "Bank Charge" },
  { key: "BANK_INTEREST_EARNED", label: "Bank Interest Earned" },
];

export default function CashBankManagement() {
  const { user } = useAuth();

  const [accountIds, setAccountIds] = useState(null);
  const [txType, setTxType] = useState(CASH_TX_TYPES[0].key);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const [ledgerRows, setLedgerRows] = useState([]);
  const [filter, setFilter] = useState("unreconciled"); // unreconciled | reconciled | all

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (accountIds) fetchLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIds, filter]);

  const loadAccounts = async () => {
    try {
      const [CASH, BANK, FINANCIAL_EXPENSES, OTHER_INCOME] = await Promise.all([
        getSystemAccount("CASH"),
        getSystemAccount("BANK"),
        getSystemAccount("FINANCIAL_EXPENSES"),
        getSystemAccount("OTHER_INCOME"),
      ]);
      setAccountIds({ CASH, BANK, FINANCIAL_EXPENSES, OTHER_INCOME });
    } catch (err) {
      console.error("Failed to resolve system accounts", err);
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    }
  };

  const fetchLedger = async () => {
    let query = supabase
      .from("general_ledger")
      .select("*")
      .or(
        `debit_account_id.eq.${accountIds.CASH},credit_account_id.eq.${accountIds.CASH},debit_account_id.eq.${accountIds.BANK},credit_account_id.eq.${accountIds.BANK}`
      )
      .order("date", { ascending: false })
      .limit(100);

    if (filter === "unreconciled") query = query.eq("reconciled", false);
    if (filter === "reconciled") query = query.eq("reconciled", true);

    const { data, error } = await query;
    if (error) {
      console.error("Failed to load ledger", error);
      return;
    }
    setLedgerRows(data || []);
  };

  const toggleReconciled = async (row) => {
    const next = !row.reconciled;
    const { error } = await supabase
      .from("general_ledger")
      .update({
        reconciled: next,
        reconciled_by: next ? user?.id : null,
        reconciled_at: next ? new Date().toISOString() : null,
      })
      .eq("cod", row.cod);

    if (error) {
      alert(`Failed to update reconciliation status: ${error.message}`);
      return;
    }
    fetchLedger();
  };

  const submitTransaction = async () => {
    if (!accountIds) {
      alert("Chart of Accounts mapping hasn't loaded yet — please wait a moment and try again.");
      return;
    }
    if (!amount || Number(amount) <= 0) return alert("Amount must be greater than 0");
    if (!reference) return alert("Enter a reference/voucher code");
    if (!date) return alert("Enter a transaction date");

    const amt = Number(amount);
    let lines;
    let desc = description;

    switch (txType) {
      case "TRANSFER_CASH_TO_BANK":
        lines = [
          { account_id: accountIds.BANK, debit: amt, credit: 0 },
          { account_id: accountIds.CASH, debit: 0, credit: amt },
        ];
        desc = desc || "Transfer: Cash to Bank";
        break;
      case "TRANSFER_BANK_TO_CASH":
        lines = [
          { account_id: accountIds.CASH, debit: amt, credit: 0 },
          { account_id: accountIds.BANK, debit: 0, credit: amt },
        ];
        desc = desc || "Transfer: Bank to Cash";
        break;
      case "BANK_CHARGE":
        lines = [
          { account_id: accountIds.FINANCIAL_EXPENSES, debit: amt, credit: 0 },
          { account_id: accountIds.BANK, debit: 0, credit: amt },
        ];
        desc = desc || "Bank charge";
        break;
      case "BANK_INTEREST_EARNED":
        lines = [
          { account_id: accountIds.BANK, debit: amt, credit: 0 },
          { account_id: accountIds.OTHER_INCOME, debit: 0, credit: amt },
        ];
        desc = desc || "Bank interest earned";
        break;
      default:
        return alert("Unknown transaction type");
    }

    setLoading(true);
    try {
      await postJournal({
        reference,
        date,
        description: desc,
        source_module: "cash_bank",
        lines,
      });
      alert("✅ Transaction posted");
      setAmount("");
      setReference("");
      setDescription("");
      fetchLedger();
    } catch (err) {
      alert(`Failed to post transaction: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="up-page">
      <p className="up-lead">
        Transfers, bank charges, and bank interest post through the same central
        engine as everything else. Reconciliation here is manual — mark a ledger
        row matched once you've checked it against a real bank statement.
        Statement import / auto-matching isn't built yet.
      </p>

      <SectionCard title="Post a transaction">
        <div className="ua-form cols-2">
          <Field label="Type">
            <select value={txType} onChange={(e) => setTxType(e.target.value)}>
              {CASH_TX_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Amount (KES)">
            <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reference / voucher code">
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CB-2026-000123" autoComplete="off" />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Description (optional)" span2>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="up-actions">
          <button type="button" className="ua-btn ua-btn-primary" onClick={submitTransaction} disabled={loading || !accountIds}>
            {loading ? "Posting…" : "Post Transaction"}
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Reconciliation"
        subtitle="Latest 100 cash and bank ledger rows"
        actions={
          <div className="up-toolbar">
            <Field label="Show">
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="unreconciled">Unreconciled</option>
                <option value="reconciled">Reconciled</option>
                <option value="all">All</option>
              </select>
            </Field>
          </div>
        }
      >
        {ledgerRows.length === 0 ? (
          <EmptyState title="Nothing to show" message="No transactions found for this filter." />
        ) : (
          <div className="ua-table-wrap">
            <table className="ua-table stack">
              <thead>
                <tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th><th>Reconciled</th></tr>
              </thead>
              <tbody>
                {ledgerRows.map((row) => (
                  <tr key={row.cod}>
                    <td data-label="Date">{row.date}</td>
                    <td data-label="Description">{row.description}</td>
                    <td data-label="Reference">{row.reference_no}</td>
                    <td data-label="Amount" className="num">{kes(row.amount)}</td>
                    <td data-label="Reconciled">
                      <input
                        type="checkbox"
                        className="up-check"
                        aria-label={`Reconciled: ${row.reference_no || row.description || row.cod}`}
                        checked={!!row.reconciled}
                        onChange={() => toggleReconciled(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
