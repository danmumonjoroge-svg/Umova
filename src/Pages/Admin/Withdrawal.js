import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { Page, SectionCard, Field, Tabs, MemberPicker, StatusBadge, EmptyState, LoadingState, kes, todayISO } from "./AdminUI";

/**
 * Member withdrawal: Member Savings/Share Capital DR, Cash CR — the exact
 * reverse of a Payments deposit. No approval gate (policy decision, not added
 * here on its own). Posting logic unchanged; presentation only.
 */
const SOURCE_ACCOUNT_KEYS = [
  { key: "MEMBER_SAVINGS", name: "Savings" },
  { key: "SHARE_CAPITAL", name: "Share capital" },
];

export default function Withdrawal() {
  const [members, setMembers] = useState([]);
  const [memberNo, setMemberNo] = useState("");
  const [sourceKey, setSourceKey] = useState("MEMBER_SAVINGS");
  const [amount, setAmount] = useState("");
  const [receiptCode, setReceiptCode] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayISO());
  const [reason, setReason] = useState("");

  const [accountIds, setAccountIds] = useState(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("new");

  useEffect(() => { fetchMembers(); loadSystemAccounts(); fetchHistory(); }, []);

  const loadSystemAccounts = async () => {
    setAccountsLoading(true);
    try {
      const resolved = { CASH: await getSystemAccount("CASH") };
      for (const { key } of SOURCE_ACCOUNT_KEYS) resolved[key] = await getSystemAccount(key);
      setAccountIds(resolved);
    } catch (err) {
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from("members").select("id, member_no, name");
    setMembers(data || []);
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    const { data } = await supabase.from("general_ledger").select("*")
      .eq("transaction_type", "withdrawal").order("date", { ascending: false }).limit(25);
    setHistory(data || []);
    setHistoryLoading(false);
  };

  const amountNum = Number(amount || 0);
  const problem = useMemo(() => {
    if (!memberNo) return "Select a member";
    if (!(amountNum > 0)) return "Enter an amount";
    if (!receiptCode.trim()) return "Enter a reference / voucher code";
    if (!transactionDate) return "Pick the date";
    if (!accountIds) return "Loading accounts…";
    return null;
  }, [memberNo, amountNum, receiptCode, transactionDate, accountIds]);

  const submitWithdrawal = async () => {
    if (problem) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await postJournal({
        member_no: memberNo,
        reference: receiptCode.trim(),
        date: transactionDate,
        description: reason ? `Withdrawal (${reason})` : "Member withdrawal",
        source_module: "withdrawal",
        lines: [
          { account_id: accountIds[sourceKey], debit: amountNum, credit: 0 },
          { account_id: accountIds.CASH, debit: 0, credit: amountNum },
        ],
      });
      setResult({ ok: true, text: `Withdrawal posted · ${res?.reference || receiptCode.trim()} · KES ${kes(amountNum)}` });
      setMemberNo(""); setAmount(""); setReceiptCode(""); setReason(""); setTransactionDate(todayISO());
      fetchHistory();
    } catch (err) {
      setResult({ ok: false, text: `Withdrawal not posted: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  const sourceName = SOURCE_ACCOUNT_KEYS.find((k) => k.key === sourceKey)?.name.toLowerCase();

  return (
    <Page
      intro={`Debits the member's ${sourceName} and credits Cash. There is no approval step — large withdrawals may need one (a policy decision).`}
      result={result} onCloseResult={() => setResult(null)}
    >
      <Tabs value={tab} onChange={setTab} className="ua-only-phone" items={[
        { key: "new", label: "New withdrawal" }, { key: "history", label: "Recent", count: history.length },
      ]} />

      <div className={`ua-split ${tab}`}>
        <div className="ua-split-a">
          <SectionCard title="Member withdrawal">
            <div className="ua-form cols-2">
              <div className="ua-field span-2"><MemberPicker members={members} value={memberNo} onChange={setMemberNo} id="wd-member" /></div>
              <Field label="Withdraw from" span2>
                <Tabs className="choice" value={sourceKey} onChange={setSourceKey}
                  items={SOURCE_ACCOUNT_KEYS.map((k) => ({ key: k.key, label: k.name }))} />
              </Field>
              <Field label="Amount" htmlFor="wd-amt">
                <div className="ua-amount"><span>KES</span>
                  <input id="wd-amt" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </Field>
              <Field label="Date" htmlFor="wd-date"><input id="wd-date" type="date" value={transactionDate} max={todayISO()} onChange={(e) => setTransactionDate(e.target.value)} /></Field>
              <Field label="Reference / voucher code" span2 htmlFor="wd-ref">
                <input id="wd-ref" value={receiptCode} onChange={(e) => setReceiptCode(e.target.value)} placeholder="WD-2026-000123" autoComplete="off" />
              </Field>
              <Field label="Reason (optional)" span2 htmlFor="wd-why">
                <input id="wd-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. emergency, planned exit" />
              </Field>
            </div>
            <button type="button" className="ua-btn ua-btn-primary ua-submit" onClick={submitWithdrawal} disabled={!!problem || loading || accountsLoading}>
              {loading ? "Posting…" : amountNum > 0 ? `Post withdrawal · KES ${kes(amountNum)}` : "Post withdrawal"}
            </button>
            {problem && !loading && <small className="ua-hint" style={{ display: "block", marginTop: 8 }}>{problem}</small>}
          </SectionCard>
        </div>

        <div className="ua-split-b">
          <SectionCard title="Recent withdrawals">
            {historyLoading ? <LoadingState /> : history.length === 0 ? (
              <EmptyState title="No withdrawals yet" message="Posted withdrawals will appear here." />
            ) : (
              <div className="ua-table-wrap">
                <table className="ua-table stack">
                  <thead><tr><th>Date</th><th>Member</th><th className="num">Amount</th><th>Reference</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.cod}>
                        <td data-label="Date">{row.date}</td>
                        <td data-label="Member">{row.member_no || "—"}</td>
                        <td data-label="Amount" className="num">{kes(row.amount)}</td>
                        <td data-label="Reference" className="wrap">{row.reference_no || row.journal_no}</td>
                        <td data-label="Status"><StatusBadge tone={row.status === "APPROVED" ? "success" : "neutral"}>{row.status}</StatusBadge></td>
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
