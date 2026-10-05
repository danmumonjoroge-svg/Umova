import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { generateReceiptPDF } from "../../utils/generateReceiptPDF";
import logo from "../../asset/logo/umovalogo.png";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";
import { ConfirmDialog, StatusBadge, EmptyState, LoadingState } from "./AdminUI";
import "./Payments.css";

// Account choices come from chart_of_accounts via system_account_key (no
// hard-coded ids).
const SYSTEM_ACCOUNT_KEYS = [
  { key: "CASH", name: "Cash" },
  { key: "MEMBER_SAVINGS", name: "Savings" },
  { key: "LOAN_RECEIVABLE", name: "Loan repayment" },
  { key: "INTEREST_INCOME", name: "Interest" },
  { key: "SHARE_CAPITAL", name: "Share capital" },
];
const ALLOCATION_KEYS = SYSTEM_ACCOUNT_KEYS.filter((k) => k.key !== "CASH");
const MODES = ["M-Pesa", "Cash", "Bank"];

// money in integer cents so 0.1 + 0.2 never produces a phantom difference
const cents = (v) => (v === "" || v == null || isNaN(v) ? 0 : Math.round(Number(v) * 100));
const kes = (c) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export default function Payments() {
  const [members, setMembers] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [tab, setTab] = useState("new"); // phone only; desktop shows both
  const [memberNo, setMemberNo] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [receiptCode, setReceiptCode] = useState("");
  const [mode, setMode] = useState("M-Pesa");
  const [transactionDate, setTransactionDate] = useState(today());
  const [allocations, setAllocations] = useState([{ account: "", amount: "" }]);

  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const [accountIds, setAccountIds] = useState(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [confirm, setConfirm] = useState(null); // group being approved

  useEffect(() => {
    fetchMembers();
    fetchLedger();
    loadSystemAccounts();
  }, []);

  const loadSystemAccounts = async () => {
    setAccountsLoading(true);
    try {
      const resolved = {};
      for (const { key } of SYSTEM_ACCOUNT_KEYS) resolved[key] = await getSystemAccount(key);
      setAccountIds(resolved);
      setAllocations([{ account: resolved.MEMBER_SAVINGS, amount: "" }]);
    } catch (err) {
      console.error("Failed to resolve system accounts", err);
      setResult({ ok: false, text: `Chart of Accounts mapping failed to load: ${err.message || err}` });
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from("members").select("id, member_no, name");
    setMembers(data || []);
  };

  const fetchLedger = async () => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: false })
      .order("cod", { ascending: false })
      .limit(300);
    setLedger(data || []);
    setHistoryLoading(false);
  };

  // ---------- member picker ----------
  const selectedMember = useMemo(() => members.find((m) => m.member_no === memberNo) || null, [members, memberNo]);
  const matches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q || selectedMember) return [];
    return members
      .filter((m) => `${m.member_no} ${m.name || ""}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, memberQuery, selectedMember]);

  // ---------- allocations ----------
  const updateAllocation = (i, field, value) =>
    setAllocations((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addRow = () =>
    setAllocations((rows) => [...rows, { account: accountIds?.MEMBER_SAVINGS || "", amount: "" }]);
  const removeRow = (i) =>
    setAllocations((rows) => {
      const next = rows.filter((_, idx) => idx !== i);
      return next.length ? next : [{ account: accountIds?.MEMBER_SAVINGS || "", amount: "" }];
    });

  const totalCents = useMemo(() => allocations.reduce((s, a) => s + cents(a.amount), 0), [allocations]);

  // ---------- validation (first problem becomes the hint under the button) ----------
  const problem = useMemo(() => {
    if (!memberNo) return "Select a member";
    if (!receiptCode.trim()) return "Enter the receipt / reference";
    if (!transactionDate) return "Pick the payment date";
    if (allocations.some((a) => cents(a.amount) < 0)) return "Amounts cannot be negative";
    if (totalCents <= 0) return "Enter an amount to allocate";
    if (allocations.some((a) => cents(a.amount) > 0 && !a.account)) return "Choose an account for each amount";
    if (!accountIds) return "Loading accounts…";
    return null;
  }, [memberNo, receiptCode, transactionDate, allocations, totalCents, accountIds]);

  const duplicateCode = useMemo(() => {
    const c = receiptCode.trim();
    return !!c && ledger.some((l) => (l.reference_no || l.journal_no || l.reference) === c);
  }, [receiptCode, ledger]);

  const resetForm = () => {
    setMemberNo(""); setMemberQuery(""); setReceiptCode(""); setTransactionDate(today());
    setAllocations([{ account: accountIds?.MEMBER_SAVINGS || "", amount: "" }]);
  };

  // ---------- post ----------
  const submitPayment = async () => {
    if (problem || posting) return;
    if (duplicateCode) { setResult({ ok: false, text: `Payment not posted: reference "${receiptCode.trim()}" has already been used.` }); return; }

    setPosting(true);
    setResult(null);
    try {
      const lines = [
        { account_id: Number(accountIds.CASH), debit: totalCents / 100, credit: 0 },
        ...allocations
          .filter((a) => cents(a.amount) > 0)
          .map((a) => ({ account_id: Number(a.account), debit: 0, credit: cents(a.amount) / 100 })),
      ];
      const res = await postJournal({
        member_no: memberNo,
        reference: receiptCode.trim(),
        date: transactionDate,
        description: `Payment received (${mode})`,
        lines,
      });
      // postJournal only resolves when the server accepted the journal (and,
      // with the v2 journalAPI, after reading the rows back).
      setResult({ ok: true, text: `Payment posted · ${res?.reference || receiptCode.trim()} · KES ${kes(totalCents)}` });
      resetForm();
      fetchLedger();
    } catch (e) {
      setResult({ ok: false, text: `Payment not posted: ${e.message || e}` });
    } finally {
      setPosting(false);
    }
  };

  // ---------- history: one card per journal ----------
  const history = useMemo(() => {
    const map = new Map();
    ledger.forEach((l) => {
      const ref = l.reference_no || l.journal_no || l.reference || `row-${l.cod}`;
      let g = map.get(ref);
      if (!g) {
        g = { ref, date: l.date, member_no: null, name: null, amountC: 0, statuses: new Set(), rows: [] };
        map.set(ref, g);
      }
      g.rows.push(l);
      g.member_no = g.member_no || l.member_no;
      g.name = g.name || l.name;
      g.statuses.add(l.status || "PENDING");
      // credits side = the money that landed; two-sided rows count once
      if (l.credit_account_id != null) g.amountC += Math.round(Number(l.amount || 0) * 100);
    });
    return [...map.values()].map((g) => ({
      ...g,
      status: g.statuses.size === 1 ? [...g.statuses][0] : "MIXED",
    }));
  }, [ledger]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const list = q
      ? history.filter((h) => `${h.ref} ${h.member_no || ""} ${h.name || ""}`.toLowerCase().includes(q))
      : history;
    return list.slice(0, 100);
  }, [history, historySearch]);

  const orRef = (ref) => `journal_no.eq."${ref}",reference_no.eq."${ref}",reference.eq."${ref}"`;

  const approve = async () => {
    const g = confirm;
    setConfirm(null);
    if (!g) return;
    const { error } = await supabase.from("general_ledger").update({ status: "APPROVED" }).or(orRef(g.ref));
    setResult(error ? { ok: false, text: `Not approved: ${error.message}` } : { ok: true, text: `Approved ${g.ref}` });
    fetchLedger();
  };

  const getBase64 = async (imgPath) => {
    const res = await fetch(imgPath);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  const downloadReceipt = async (g) => {
    try {
      const { data, error } = await supabase.from("general_ledger").select("*").or(orRef(g.ref));
      if (error) throw error;
      const logoBase64 = await getBase64(logo);
      await generateReceiptPDF(data, g.ref, logoBase64);
    } catch (err) {
      setResult({ ok: false, text: `Receipt download failed: ${err.message || err}` });
    }
  };

  const statusTone = (s) => (s === "APPROVED" ? "success" : s === "POSTED" ? "neutral" : "warning");

  return (
    <div className="pay">
      <div className="pay-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>
          New payment
        </button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {result && (
        <div className={`pay-banner ${result.ok ? "ok" : "bad"}`} role="status">
          <span>{result.text}</span>
          <button type="button" onClick={() => setResult(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="pay-layout">
        {/* ============ NEW PAYMENT ============ */}
        <section className={`pay-pane pay-form-pane ${tab === "new" ? "show" : ""}`}>
          <div className="pay-card">
            <h2 className="pay-h">Receive payment</h2>

            <div className="pay-field">
              <label htmlFor="pay-member">Member</label>
              {selectedMember ? (
                <div className="pay-chip">
                  <div>
                    <strong>{selectedMember.name || selectedMember.member_no}</strong>
                    <small>{selectedMember.member_no}</small>
                  </div>
                  <button type="button" onClick={() => { setMemberNo(""); setMemberQuery(""); }}>Change</button>
                </div>
              ) : (
                <>
                  <input
                    id="pay-member" type="search" autoComplete="off" inputMode="search"
                    placeholder="Search name or member no."
                    value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)}
                  />
                  {matches.length > 0 && (
                    <ul className="pay-matches">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button type="button" onClick={() => { setMemberNo(m.member_no); setMemberQuery(""); }}>
                            <strong>{m.name || "—"}</strong><small>{m.member_no}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {memberQuery.trim() && matches.length === 0 && <small className="pay-hint">No member matches “{memberQuery}”.</small>}
                </>
              )}
            </div>

            <div className="pay-two">
              <div className="pay-field">
                <label htmlFor="pay-ref">Receipt / reference</label>
                <input id="pay-ref" value={receiptCode} onChange={(e) => setReceiptCode(e.target.value)}
                  placeholder="e.g. M-Pesa code" autoCapitalize="characters" autoComplete="off" />
                {duplicateCode && <small className="pay-hint bad">This reference was already used.</small>}
              </div>
              <div className="pay-field">
                <label htmlFor="pay-date">Date</label>
                <input id="pay-date" type="date" value={transactionDate} max={today()} onChange={(e) => setTransactionDate(e.target.value)} />
              </div>
            </div>

            <div className="pay-field">
              <label id="pay-mode-l">Payment method</label>
              <div className="pay-seg" role="radiogroup" aria-labelledby="pay-mode-l">
                {MODES.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m}
                    className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
            </div>

            <div className="pay-field">
              <label>Allocation</label>
              {accountsLoading ? (
                <LoadingState message="Loading accounts…" />
              ) : (
                allocations.map((a, i) => (
                  <div key={i} className="pay-alloc">
                    <select aria-label={`Account ${i + 1}`} value={a.account} onChange={(e) => updateAllocation(i, "account", e.target.value)}>
                      {ALLOCATION_KEYS.map((x) => (
                        <option key={x.key} value={accountIds?.[x.key] || ""}>{x.name}</option>
                      ))}
                    </select>
                    <div className="pay-amt">
                      <span>KES</span>
                      <input aria-label={`Amount ${i + 1}`} type="number" inputMode="decimal" min="0" step="0.01"
                        placeholder="0.00" value={a.amount} onChange={(e) => updateAllocation(i, "amount", e.target.value)} />
                    </div>
                    {allocations.length > 1 && (
                      <button type="button" className="pay-x" onClick={() => removeRow(i)} aria-label={`Remove allocation ${i + 1}`}>✕</button>
                    )}
                  </div>
                ))
              )}
              <button type="button" className="pay-add" onClick={addRow} disabled={accountsLoading}>+ Add another allocation</button>
            </div>
          </div>

          {/* sticky action bar: stays visible above the tab bar while the form scrolls */}
          <div className="pay-bar">
            <div className="pay-bar-total">
              <small>Total</small>
              <strong>KES {kes(totalCents)}</strong>
            </div>
            <button type="button" className="pay-post" onClick={submitPayment} disabled={!!problem || posting || duplicateCode}>
              {posting ? "Posting…" : "Post payment"}
            </button>
            {(problem || duplicateCode) && !posting && (
              <small className="pay-bar-hint">{duplicateCode ? "Use a different reference" : problem}</small>
            )}
          </div>
        </section>

        {/* ============ HISTORY ============ */}
        <section className={`pay-pane pay-history-pane ${tab === "history" ? "show" : ""}`}>
          <div className="pay-card">
            <div className="pay-hhead">
              <h2 className="pay-h">Recent transactions</h2>
              <input type="search" className="pay-search" placeholder="Search reference or member"
                value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} aria-label="Search transactions" />
            </div>

            {historyLoading ? (
              <LoadingState />
            ) : filteredHistory.length === 0 ? (
              <EmptyState title="No transactions" message="Posted payments will appear here." />
            ) : (
              <ul className="pay-list">
                {filteredHistory.map((h) => (
                  <li key={h.ref} className="pay-item">
                    <div className="pay-item-top">
                      <div className="pay-item-main">
                        <strong>{h.ref}</strong>
                        <small>{h.name || h.member_no || "—"} · {h.date}</small>
                      </div>
                      <div className="pay-item-amt">
                        <strong>KES {kes(h.amountC)}</strong>
                        <StatusBadge tone={statusTone(h.status)}>{h.status === "MIXED" ? "Part approved" : h.status}</StatusBadge>
                      </div>
                    </div>
                    <div className="pay-item-actions">
                      <button type="button" onClick={() => downloadReceipt(h)}>Receipt</button>
                      {h.status !== "APPROVED" && <button type="button" className="primary" onClick={() => setConfirm(h)}>Approve</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="Approve this payment?"
        message={confirm ? `${confirm.ref} · KES ${kes(confirm.amountC)}${confirm.name || confirm.member_no ? ` · ${confirm.name || confirm.member_no}` : ""}` : ""}
        confirmLabel="Approve"
        onConfirm={approve}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
