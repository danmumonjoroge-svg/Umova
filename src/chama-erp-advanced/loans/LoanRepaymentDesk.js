import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { HandCoins, Loader2, ShieldAlert, X, CheckCircle, History } from "lucide-react";
import { Panel } from "../shell/ui";
import "./LoanRepaymentDesk.css";

// -----------------------------------------------------------------------------
// LoanRepaymentDesk
// Treasurer-only. Every active, disbursed loan is listed with its
// remaining balance; recording a repayment calls apply_loan_repayment(),
// which atomically inserts the chama_loan_repayments row, decrements the
// loan balance (closing it automatically once it hits zero), and writes
// the credit ledger entry — the same "no two-call writes to the ledger"
// rule every other money-moving screen in this package follows.
// -----------------------------------------------------------------------------

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function LoanRepaymentDesk({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const isTreasurer = hasRole(["treasurer", "admin"]);

  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null); // loan being paid against
  const [form, setForm] = useState({ amount: "", method: "MPESA", reference: "", account: "" });
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [historyFor, setHistoryFor] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    const { data } = await supabase
      .from("chama_loans")
      .select("*")
      .eq("chama_id", chamaId)
      .eq("disbursed", true)
      .eq("status", "active")
      .order("disbursement_date", { ascending: true });
    setLoans(data || []);
    const acc = await supabase.from("chama_bank_accounts").select("id,account_name,account_number,account_type").eq("chama_id", chamaId).eq("is_active", true);
    setAccounts((acc.data || []).filter((a) => a.account_type !== "cash"));
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const openModal = (loan) => { setModal(loan); setForm({ amount: "", method: "MPESA", reference: "", account: "" }); };

  const submitRepayment = async () => {
    if (!form.amount || Number(form.amount) <= 0) return;
    if (form.method !== "CASH" && !form.account) { setToast({ type: "error", text: "Choose the Chama account the money went into." }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("apply_loan_repayment", {
      p_loan_id: modal.id,
      p_amount: Number(form.amount),
      p_method: form.method,
      p_reference: form.reference || null,
      p_recorder: member.id,
      p_account_id: form.method === "CASH" ? null : form.account,
    });
    setBusy(false);
    if (error) { setToast({ type: "error", text: error.message }); return; }
    setToast({ type: "success", text: `${formatKES(form.amount)} recorded against ${modal.member_name}'s loan.` });
    setTimeout(() => setToast(null), 4000);
    setModal(null);
    load();
  };

  const openHistory = async (loan) => {
    setHistoryFor(loan);
    const { data } = await supabase.from("chama_loan_repayments").select("*").eq("loan_id", loan.id).order("paid_on", { ascending: false });
    setHistoryRows(data || []);
  };

  if (!isTreasurer) {
    return (
      <div className="lrp-locked">
        <ShieldAlert size={18} />
        <p>Recording repayments is restricted to the treasurer.</p>
      </div>
    );
  }

  return (
    <div className="lrp-page">
      <div className="lrp-header">
        <h2>Loan Repayments</h2>
        <p>Active loans with a balance outstanding.</p>
      </div>

      {loading ? (
        <div className="lrp-loading"><Loader2 size={20} className="spin" /></div>
      ) : loans.length === 0 ? (
        <div className="lrp-empty"><CheckCircle size={22} /><p>No active loans right now.</p></div>
      ) : (
        <Panel icon={HandCoins} title="Loans being repaid" badge={loans.length} tone="green" collapsible={false}>
        <div className="lrp-grid">
          {loans.map((loan) => (
            <div className="lrp-card" key={loan.id}>
              <div className="lrp-card-top">
                <h3>{loan.member_name}</h3>
                <span className="lrp-balance">{formatKES(loan.balance ?? loan.amount)}</span>
              </div>
              <p className="lrp-terms">
                of {formatKES(loan.amount)} · {loan.repayment_months}mo · {loan.interest_rate}%
                {loan.interest_type === "reducing_annual" ? " reducing" : " flat"}
              </p>
              <div className="lrp-actions">
                <button className="lrp-pay-btn" onClick={() => openModal(loan)}><HandCoins size={14} /> Record repayment</button>
                <button className="lrp-history-btn" onClick={() => openHistory(loan)}><History size={14} /></button>
              </div>
            </div>
          ))}
        </div>
        </Panel>
      )}

      {modal && (
        <div className="lrp-modal-overlay" onClick={() => setModal(null)}>
          <div className="lrp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lrp-modal-head">
              <h3>Repayment — {modal.member_name}</h3>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <p className="lrp-modal-balance">Balance: {formatKES(modal.balance ?? modal.amount)}</p>

            <label>Amount (KES)<input type="number" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></label>
            <label>
              Method
              <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank Transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            {form.method !== "CASH" && (
              <label>
                Chama account it went into
                <select value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.account_number ? ` (${a.account_number})` : ""}</option>)}
                </select>
              </label>
            )}
            <label>Reference (optional)<input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="M-Pesa code, receipt no." /></label>

            <div className="lrp-modal-actions">
              <button className="lrp-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="lrp-confirm" onClick={submitRepayment} disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : "Record repayment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="lrp-modal-overlay" onClick={() => setHistoryFor(null)}>
          <div className="lrp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lrp-modal-head">
              <h3><History size={16} /> History — {historyFor.member_name}</h3>
              <button onClick={() => setHistoryFor(null)}><X size={18} /></button>
            </div>
            {historyRows.length === 0 ? (
              <p className="lrp-empty-inline">No repayments recorded yet.</p>
            ) : (
              <div className="lrp-history-list">
                {historyRows.map((r) => (
                  <div className="lrp-history-row" key={r.id}>
                    <strong>{formatKES(r.amount)}</strong>
                    <span>{r.method} {r.reference ? `· ${r.reference}` : ""}</span>
                    <span>{r.paid_on}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`lrp-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
