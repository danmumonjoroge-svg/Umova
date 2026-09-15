import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { CheckCircle, XCircle, Loader2, AlertTriangle, ShieldAlert, X, ScanSearch } from "lucide-react";
import "./TreasurerReconciliation.css";

// -----------------------------------------------------------------------------
// TreasurerReconciliation
// Treasurer-only, two-step per contribution:
//   1. VERIFY — treasurer types in what the account statement actually shows
//      for that payment. We show a close-check against what the member
//      claimed (exact match / close / mismatch) so nothing slips through on
//      trust alone.
//   2. APPROVE — once verified, approving calls post_contribution() which
//      atomically writes the ledger entry AND bumps the member's balance.
//      This is the only path that can move a contribution into the ledger.
// -----------------------------------------------------------------------------

function formatKES(v) { return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }

function closeCheckTone(claimed, actual) {
  if (actual == null || actual === "") return null;
  const diff = Math.abs(Number(claimed) - Number(actual));
  if (diff === 0) return "match";
  if (diff <= Number(claimed) * 0.02) return "close"; // within 2%
  return "mismatch";
}

export default function TreasurerReconciliation({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const isTreasurer = hasRole(["treasurer", "admin"]);

  const [pending, setPending] = useState([]);
  const [verified, setVerified] = useState([]);
  const [accountsById, setAccountsById] = useState({});
  const [membersById, setMembersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { row, actualAmount, notes }
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    const [pendingRes, verifiedRes, accountsRes, membersRes] = await Promise.all([
      supabase.from("chama_contribution_requests").select("*").eq("chama_id", chamaId).eq("status", "PENDING").order("created_at", { ascending: true }),
      supabase.from("chama_contribution_requests").select("*").eq("chama_id", chamaId).eq("status", "VERIFIED").order("verified_at", { ascending: true }),
      supabase.from("chama_bank_accounts").select("id,account_name").eq("chama_id", chamaId),
      supabase.from("chama_members").select("id,name,phone").eq("chama_id", chamaId),
    ]);
    setPending(pendingRes.data || []);
    setVerified(verifiedRes.data || []);
    setAccountsById(Object.fromEntries((accountsRes.data || []).map((a) => [a.id, a.account_name])));
    setMembersById(Object.fromEntries((membersRes.data || []).map((m) => [m.id, m])));
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const openVerifyModal = (row) => setModal({ row, actualAmount: row.amount, notes: "" });
  const closeModal = () => setModal(null);

  const submitVerification = async () => {
    if (!modal) return;
    setBusyId(modal.row.id);
    const { error } = await supabase.from("chama_contribution_requests").update({
      status: "VERIFIED",
      verified_by: member.id,
      verified_at: new Date().toISOString(),
      bank_statement_amount: Number(modal.actualAmount),
      verification_notes: modal.notes || null,
    }).eq("id", modal.row.id);
    setBusyId(null);
    if (error) { setToast({ type: "error", text: error.message }); return; }
    setToast({ type: "success", text: "Marked verified — ready to approve." });
    setTimeout(() => setToast(null), 3500);
    closeModal();
    load();
  };

  const approve = async (row) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("post_contribution", { p_request_id: row.id, p_approver: member.id });
    setBusyId(null);
    if (error) { setToast({ type: "error", text: error.message }); return; }
    setToast({ type: "success", text: `Posted ${formatKES(row.amount)} to ${membersById[row.member_id]?.name || "member"}'s ${row.contribution_type}.` });
    setTimeout(() => setToast(null), 3500);
    load();
  };

  const reject = async (row, reason) => {
    setBusyId(row.id);
    const { error } = await supabase.from("chama_contribution_requests").update({ status: "REJECTED", rejection_reason: reason || "Could not be confirmed against the account", approved_by: member.id, approved_at: new Date().toISOString() }).eq("id", row.id);
    setBusyId(null);
    if (error) { setToast({ type: "error", text: error.message }); return; }
    load();
  };

  if (!isTreasurer) {
    return (
      <div className="tr-locked">
        <ShieldAlert size={18} />
        <p>Contribution reconciliation is restricted to the treasurer.</p>
      </div>
    );
  }

  return (
    <div className="tr-page">
      <div className="tr-header">
        <h2>Contribution Reconciliation</h2>
        <p>Check each member's claim against the real account before it posts to the ledger.</p>
      </div>

      {loading ? (
        <div className="tr-loading"><Loader2 size={20} className="spin" /></div>
      ) : (
        <>
          <section className="tr-section">
            <h3><ScanSearch size={15} /> Awaiting verification ({pending.length})</h3>
            {pending.length === 0 ? (
              <p className="tr-empty">Nothing new to check.</p>
            ) : (
              <div className="tr-table">
                <div className="tr-table-head">
                  <span>Member</span><span>Account</span><span>Claims</span><span>Ref</span><span>Purpose</span><span></span>
                </div>
                {pending.map((row) => (
                  <div className="tr-table-row" key={row.id}>
                    <span>{membersById[row.member_id]?.name || "—"}</span>
                    <span>{accountsById[row.bank_account_id] || "—"}</span>
                    <span className="tr-amount">{formatKES(row.amount)}</span>
                    <span className="tr-ref">{row.transaction_ref || "—"}</span>
                    <span className="tr-purpose">{row.contribution_type.replace("_", " ")}</span>
                    <button className="tr-verify-btn" onClick={() => openVerifyModal(row)} disabled={busyId === row.id}>Check account</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="tr-section">
            <h3><CheckCircle size={15} /> Verified — ready to approve ({verified.length})</h3>
            {verified.length === 0 ? (
              <p className="tr-empty">Nothing verified yet.</p>
            ) : (
              <div className="tr-table">
                <div className="tr-table-head">
                  <span>Member</span><span>Claimed</span><span>On statement</span><span>Match</span><span></span><span></span>
                </div>
                {verified.map((row) => {
                  const tone = closeCheckTone(row.amount, row.bank_statement_amount);
                  return (
                    <div className="tr-table-row" key={row.id}>
                      <span>{membersById[row.member_id]?.name || "—"}</span>
                      <span className="tr-amount">{formatKES(row.amount)}</span>
                      <span>{formatKES(row.bank_statement_amount)}</span>
                      <span className={`tr-match ${tone}`}>{tone === "match" ? "Exact" : tone === "close" ? "Close" : "Mismatch"}</span>
                      <button className="tr-approve-btn" onClick={() => approve(row)} disabled={busyId === row.id}>
                        {busyId === row.id ? <Loader2 size={13} className="spin" /> : <CheckCircle size={13} />} Approve &amp; post
                      </button>
                      <button className="tr-reject-btn" onClick={() => reject(row, "Amount did not match the account statement")} disabled={busyId === row.id}>
                        <XCircle size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {modal && (
        <div className="tr-modal-overlay" onClick={closeModal}>
          <div className="tr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tr-modal-head">
              <h3>Verify against account</h3>
              <button onClick={closeModal}><X size={18} /></button>
            </div>
            <p className="tr-modal-hint">
              {membersById[modal.row.member_id]?.name} says they paid <strong>{formatKES(modal.row.amount)}</strong> into
              {" "}<strong>{accountsById[modal.row.bank_account_id]}</strong> on {modal.row.contributed_on}, ref {modal.row.transaction_ref || "n/a"}.
            </p>
            <label>
              What does the account statement actually show?
              <input type="number" min="0" value={modal.actualAmount} onChange={(e) => setModal((m) => ({ ...m, actualAmount: e.target.value }))} />
            </label>
            {closeCheckTone(modal.row.amount, modal.actualAmount) === "mismatch" && (
              <p className="tr-mismatch-warning"><AlertTriangle size={13} /> This differs meaningfully from what the member claimed — double check before verifying.</p>
            )}
            <label>
              Notes (optional)
              <input type="text" value={modal.notes} onChange={(e) => setModal((m) => ({ ...m, notes: e.target.value }))} placeholder="e.g. confirmed on CIC statement line 42" />
            </label>
            <div className="tr-modal-actions">
              <button className="tr-cancel" onClick={closeModal}>Cancel</button>
              <button className="tr-confirm" onClick={submitVerification} disabled={busyId === modal.row.id}>
                {busyId === modal.row.id ? <Loader2 size={15} className="spin" /> : "Mark verified"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`tr-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
