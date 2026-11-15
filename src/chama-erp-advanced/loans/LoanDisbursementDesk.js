import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Wallet, Loader2, CheckCircle, ShieldAlert, X, AlertCircle } from "lucide-react";
import { Panel } from "../shell/ui";
import "./LoanDisbursementDesk.css";

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// -----------------------------------------------------------------------------
// LoanDisbursementDesk
// Treasurer-only. Only loans that made it through the full 3-role approval
// chain (chama_loans row exists, disbursed = false) show up here. Uses the
// disburse_loan() Postgres function so the "mark disbursed" + "ledger debit"
// pair can never happen as two separate, half-failed client calls.
// -----------------------------------------------------------------------------

export default function LoanDisbursementDesk({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const isTreasurer = hasRole(["treasurer", "admin"]);

  const [loans, setLoans] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [sourceAccount, setSourceAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    const [loansRes, accountsRes] = await Promise.all([
      supabase.from("chama_loans").select("*").eq("chama_id", chamaId).eq("disbursed", false),
      supabase.from("chama_bank_accounts").select("*").eq("chama_id", chamaId).eq("is_active", true),
    ]);
    setLoans(loansRes.data || []);
    setAccounts(accountsRes.data || []);
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const openModal = (loan) => {
    setModal(loan);
    setSourceAccount(accounts[0]?.id || "");
  };

  const confirmDisburse = async () => {
    if (!sourceAccount) return;
    setBusy(true);
    const { error } = await supabase.rpc("disburse_loan", {
      p_loan_id: modal.id,
      p_source_account: sourceAccount,
      p_disburser: member.id,
    });
    setBusy(false);
    if (error) {
      setToast({ type: "error", text: error.message });
    } else {
      setToast({ type: "success", text: `${formatKES(modal.amount)} disbursed to ${modal.member_name}.` });
      setModal(null);
      load();
    }
    setTimeout(() => setToast(null), 4000);
  };

  if (!isTreasurer) {
    return (
      <div className="ldd-locked">
        <ShieldAlert size={18} />
        <p>Disbursement is restricted to the treasurer.</p>
      </div>
    );
  }

  return (
    <div className="ldd-page">
      <div className="ldd-header">
        <h2>Disbursement Desk</h2>
        <p>Loans that have cleared all required sign-offs, awaiting payout.</p>
      </div>

      {accounts.length === 0 && (
        <div className="ldd-warning"><AlertCircle size={14} /> No chama accounts configured yet — add one under Treasury settings before disbursing.</div>
      )}

      {loading ? (
        <div className="ldd-loading"><Loader2 size={20} className="spin" /></div>
      ) : loans.length === 0 ? (
        <div className="ldd-empty"><CheckCircle size={22} /><p>Nothing waiting on disbursement.</p></div>
      ) : (
        <Panel icon={Wallet} title="Ready to pay out" badge={loans.length} tone="warn" collapsible={false}>
        <div className="ldd-grid">
          {loans.map((loan) => (
            <div className="ldd-card" key={loan.id}>
              <div className="ldd-card-top">
                <h3>{loan.member_name}</h3>
                <span>{formatKES(loan.amount)}</span>
              </div>
              <p className="ldd-terms">{loan.repayment_months} months · {loan.interest_rate}% {loan.interest_type === "reducing_annual" ? "reducing" : "flat"}</p>
              <button className="ldd-btn" onClick={() => openModal(loan)}>
                <Wallet size={15} /> Disburse
              </button>
            </div>
          ))}
        </div>
        </Panel>
      )}

      {modal && (
        <div className="ldd-modal-overlay" onClick={() => setModal(null)}>
          <div className="ldd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ldd-modal-head">
              <h3>Disburse to {modal.member_name}</h3>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <p className="ldd-modal-amount">{formatKES(modal.amount)}</p>
            <label>
              Pay from
              <select value={sourceAccount} onChange={(e) => setSourceAccount(e.target.value)}>
                <option value="">Select chama account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
              </select>
            </label>
            <div className="ldd-modal-actions">
              <button className="ldd-cancel" onClick={() => setModal(null)}>Cancel</button>
              <button className="ldd-confirm" onClick={confirmDisburse} disabled={busy || !sourceAccount}>
                {busy ? <Loader2 size={15} className="spin" /> : "Confirm disbursement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`ldd-toast ${toast.type}`}>{toast.text}</div>
      )}
    </div>
  );
}
