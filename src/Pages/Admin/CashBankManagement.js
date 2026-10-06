import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { Page, SectionCard, Field, Tabs, EmptyState, StatusBadge, kes, todayISO } from "./AdminUI";

/**
 * Transfers, bank charges and bank interest through the central posting
 * engine, plus MANUAL reconciliation (tick a ledger row once checked against
 * the bank statement). Statement import / auto-matching isn't built. Scoped
 * to a single bank relationship (one BANK system account). Logic unchanged.
 */
const CASH_TX_TYPES = [
  { key: "TRANSFER_CASH_TO_BANK", label: "Transfer: Cash → Bank" },
  { key: "TRANSFER_BANK_TO_CASH", label: "Transfer: Bank → Cash" },
  { key: "BANK_CHARGE", label: "Bank charge" },
  { key: "BANK_INTEREST_EARNED", label: "Bank interest earned" },
];

export default function CashBankManagement() {
  const { user } = useAuth();
  const [tab, setTab] = useState("post");
  const [accountIds, setAccountIds] = useState(null);
  const [txType, setTxType] = useState(CASH_TX_TYPES[0].key);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [ledgerRows, setLedgerRows] = useState([]);
  const [filter, setFilter] = useState("unreconciled");

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { if (accountIds) fetchLedger(); /* eslint-disable-next-line */ }, [accountIds, filter]);

  const loadAccounts = async () => {
    try {
      const [CASH, BANK, FINANCIAL_EXPENSES, OTHER_INCOME] = await Promise.all([
        getSystemAccount("CASH"), getSystemAccount("BANK"),
        getSystemAccount("FINANCIAL_EXPENSES"), getSystemAccount("OTHER_INCOME"),
      ]);
      setAccountIds({ CASH, BANK, FINANCIAL_EXPENSES, OTHER_INCOME });
    } catch (err) {
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    }
  };

  const fetchLedger = async () => {
    let query = supabase.from("general_ledger").select("*")
      .or(`debit_account_id.eq.${accountIds.CASH},credit_account_id.eq.${accountIds.CASH},debit_account_id.eq.${accountIds.BANK},credit_account_id.eq.${accountIds.BANK}`)
      .order("date", { ascending: false }).limit(100);
    if (filter === "unreconciled") query = query.eq("reconciled", false);
    if (filter === "reconciled") query = query.eq("reconciled", true);
    const { data, error } = await query;
    if (error) { setResult({ ok: false, text: `Could not load the ledger: ${error.message}` }); return; }
    setLedgerRows(data || []);
  };

  const toggleReconciled = async (row) => {
    const next = !row.reconciled;
    const { error } = await supabase.from("general_ledger")
      .update({ reconciled: next, reconciled_by: next ? user?.id : null, reconciled_at: next ? new Date().toISOString() : null })
      .eq("cod", row.cod);
    if (error) { setResult({ ok: false, text: `Reconciliation not saved: ${error.message}` }); return; }
    fetchLedger();
  };

  const amt = Number(amount || 0);
  const problem = useMemo(() => {
    if (!accountIds) return "Loading accounts…";
    if (!(amt > 0)) return "Enter an amount";
    if (!reference.trim()) return "Enter a reference / voucher code";
    if (!date) return "Pick the date";
    return null;
  }, [accountIds, amt, reference, date]);

  const submitTransaction = async () => {
    if (problem) return;
    let lines, desc = description;
    switch (txType) {
      case "TRANSFER_CASH_TO_BANK":
        lines = [{ account_id: accountIds.BANK, debit: amt, credit: 0 }, { account_id: accountIds.CASH, debit: 0, credit: amt }];
        desc = desc || "Transfer: Cash to Bank"; break;
      case "TRANSFER_BANK_TO_CASH":
        lines = [{ account_id: accountIds.CASH, debit: amt, credit: 0 }, { account_id: accountIds.BANK, debit: 0, credit: amt }];
        desc = desc || "Transfer: Bank to Cash"; break;
      case "BANK_CHARGE":
        lines = [{ account_id: accountIds.FINANCIAL_EXPENSES, debit: amt, credit: 0 }, { account_id: accountIds.BANK, debit: 0, credit: amt }];
        desc = desc || "Bank charge"; break;
      case "BANK_INTEREST_EARNED":
        lines = [{ account_id: accountIds.BANK, debit: amt, credit: 0 }, { account_id: accountIds.OTHER_INCOME, debit: 0, credit: amt }];
        desc = desc || "Bank interest earned"; break;
      default:
        return setResult({ ok: false, text: "Unknown transaction type" });
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await postJournal({ reference: reference.trim(), date, description: desc, source_module: "cash_bank", lines });
      setResult({ ok: true, text: `Transaction posted · ${res?.reference || reference.trim()} · KES ${kes(amt)}` });
      setAmount(""); setReference(""); setDescription("");
      fetchLedger();
    } catch (err) {
      setResult({ ok: false, text: `Transaction not posted: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page
      intro="Transfers, bank charges and interest post through the same journal engine as everything else. Reconciliation is manual: tick a row once you've matched it to your bank statement."
      result={result} onCloseResult={() => setResult(null)}
    >
      <Tabs value={tab} onChange={setTab} className="ua-only-phone" items={[
        { key: "post", label: "Post transaction" }, { key: "reconcile", label: "Reconciliation" },
      ]} />

      <div className={`ua-split ${tab === "post" ? "new" : "history"}`}>
        <div className="ua-split-a">
          <SectionCard title="Post a transaction">
            <div className="ua-form">
              <Field label="Type" htmlFor="cb-type">
                <select id="cb-type" value={txType} onChange={(e) => setTxType(e.target.value)}>
                  {CASH_TX_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Amount" htmlFor="cb-amt">
                <div className="ua-amount"><span>KES</span>
                  <input id="cb-amt" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </Field>
              <Field label="Reference / voucher code" htmlFor="cb-ref">
                <input id="cb-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CB-2026-000123" autoComplete="off" />
              </Field>
              <Field label="Date" htmlFor="cb-date"><input id="cb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Description (optional)" htmlFor="cb-desc"><input id="cb-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </div>
            <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitTransaction} disabled={!!problem || loading}>
              {loading ? "Posting…" : "Post transaction"}
            </button>
            {problem && !loading && <small className="ua-hint" style={{ display: "block", marginTop: 8 }}>{problem}</small>}
          </SectionCard>
        </div>

        <div className="ua-split-b">
          <SectionCard title="Reconciliation">
            <Tabs className="choice" value={filter} onChange={setFilter} items={[
              { key: "unreconciled", label: "Unreconciled" }, { key: "reconciled", label: "Reconciled" }, { key: "all", label: "All" },
            ]} />
            {ledgerRows.length === 0 ? (
              <EmptyState title="Nothing to show" message="No transactions for this filter." />
            ) : (
              <div className="ua-table-wrap">
                <table className="ua-table stack">
                  <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th><th>Reconciled</th></tr></thead>
                  <tbody>
                    {ledgerRows.map((row) => (
                      <tr key={row.cod}>
                        <td data-label="Date">{row.date}</td>
                        <td data-label="Description" className="wrap">{row.description}</td>
                        <td data-label="Reference" className="wrap">{row.reference_no || row.journal_no}</td>
                        <td data-label="Amount" className="num">{kes(row.amount)}</td>
                        <td data-label="Reconciled">
                          <label className="ua-check">
                            <input type="checkbox" checked={!!row.reconciled} onChange={() => toggleReconciled(row)} />
                            <StatusBadge tone={row.reconciled ? "success" : "warning"}>{row.reconciled ? "Matched" : "Open"}</StatusBadge>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </Page>
  );
}
