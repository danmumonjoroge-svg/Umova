import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

/**
 * The missing counterpart to Payments.jsx. Every "withdrawal" reference
 * found elsewhere in the app (Savings.js, DashboardHome.js, Members.js)
 * was read-only reporting derived from the ledger — there was no actual
 * transaction entry form for a member withdrawal anywhere. This is that
 * form.
 *
 * Section 10: Withdrawal = Member Savings/Share Capital DR, Cash/Bank CR
 * — the exact reverse of a Payments.jsx deposit.
 */
const SOURCE_ACCOUNT_KEYS = [
  { key: "MEMBER_SAVINGS", name: "Savings" },
  { key: "SHARE_CAPITAL", name: "Share Capital" },
];

export default function Withdrawal() {
  const [members, setMembers] = useState([]);
  const [memberNo, setMemberNo] = useState("");
  const [memberName, setMemberName] = useState("");

  const [sourceKey, setSourceKey] = useState("MEMBER_SAVINGS");
  const [amount, setAmount] = useState("");
  const [receiptCode, setReceiptCode] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [reason, setReason] = useState("");

  const [accountIds, setAccountIds] = useState(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetchMembers();
    loadSystemAccounts();
    fetchHistory();
  }, []);

  const loadSystemAccounts = async () => {
    setAccountsLoading(true);
    try {
      const resolved = {};
      resolved.CASH = await getSystemAccount("CASH");
      for (const { key } of SOURCE_ACCOUNT_KEYS) {
        resolved[key] = await getSystemAccount(key);
      }
      setAccountIds(resolved);
    } catch (err) {
      console.error("Failed to resolve system accounts", err);
      alert(`Failed to load Chart of Accounts mapping: ${err.message || err}`);
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from("members").select("*");
    setMembers(data || []);
  };

  // Withdrawals debit the source account, so they show up in
  // general_ledger with the source account as the debit side. Kept as a
  // simple recent-activity list here — Savings.js/DashboardHome.js already
  // own the real balance/statement views.
  const fetchHistory = async () => {
    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("transaction_type", "withdrawal")
      .order("date", { ascending: false })
      .limit(25);
    setHistory(data || []);
  };

  const selectMember = (no) => {
    setMemberNo(no);
    const m = members.find((x) => x.member_no === no);
    setMemberName(m?.name || "");
  };

  const validate = () => {
    if (!memberNo) return "Select member";
    if (!receiptCode) return "Enter a reference/voucher code";
    if (!transactionDate) return "Enter transaction date";
    if (!amount || Number(amount) <= 0) return "Amount must be greater than 0";
    return null;
  };

  const submitWithdrawal = async () => {
    const errorMsg = validate();
    if (errorMsg) return alert(errorMsg);

    if (!accountIds) {
      alert("Chart of Accounts mapping hasn't loaded yet — please wait a moment and try again.");
      return;
    }

    setLoading(true);
    try {
      await postJournal({
        member_no: memberNo,
        reference: receiptCode,
        date: transactionDate,
        description: reason ? `Withdrawal (${reason})` : "Member withdrawal",
        source_module: "withdrawal",
        lines: [
          { account_id: accountIds[sourceKey], debit: Number(amount), credit: 0 },
          { account_id: accountIds.CASH, debit: 0, credit: Number(amount) },
        ],
      });

      alert("✅ Withdrawal posted successfully");

      setMemberNo("");
      setMemberName("");
      setAmount("");
      setReceiptCode("");
      setTransactionDate("");
      setReason("");
      fetchHistory();
    } catch (err) {
      alert(`Failed to post withdrawal: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h2>Member Withdrawal</h2>
      <p style={{ color: "#666" }}>
        Debits the member's {SOURCE_ACCOUNT_KEYS.find((k) => k.key === sourceKey)?.name.toLowerCase()},
        credits Cash. This does not currently gate on an approval step —
        large withdrawals may warrant one (see Section 19 workflow states);
        that's a policy decision, not added here on its own.
      </p>

      <div style={{ display: "grid", gap: 10, margin: "16px 0", maxWidth: 420 }}>
        <label>
          Member<br />
          <select value={memberNo} onChange={(e) => selectMember(e.target.value)}>
            <option value="">-- Select member --</option>
            {members.map((m) => (
              <option key={m.member_no} value={m.member_no}>
                {m.member_no} — {m.name}
              </option>
            ))}
          </select>
        </label>

        <div>Member: <strong>{memberName || "Not selected"}</strong></div>

        <label>
          Withdraw from<br />
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            {SOURCE_ACCOUNT_KEYS.map((x) => (
              <option key={x.key} value={x.key}>{x.name}</option>
            ))}
          </select>
        </label>

        <label>
          Amount<br />
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <label>
          Reference / voucher code<br />
          <input value={receiptCode} onChange={(e) => setReceiptCode(e.target.value)} placeholder="WD-2026-000123" />
        </label>

        <label>
          Transaction date<br />
          <input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </label>

        <label>
          Reason (optional)<br />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. emergency, planned exit" />
        </label>

        <button onClick={submitWithdrawal} disabled={loading || accountsLoading}>
          {loading ? "Posting…" : "Post Withdrawal"}
        </button>
      </div>

      <h4>Recent withdrawals</h4>
      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th>Date</th><th>Member</th><th>Amount</th><th>Reference</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.cod} style={{ borderBottom: "1px solid #eee" }}>
              <td>{row.date}</td>
              <td>{row.member_no}</td>
              <td>{row.amount}</td>
              <td>{row.reference_no}</td>
              <td>{row.status}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr><td colSpan={5}>No withdrawals recorded yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
