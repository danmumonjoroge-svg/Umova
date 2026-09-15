import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { CheckCircle, XCircle, Clock, Loader2, AlertCircle, X, ShieldAlert } from "lucide-react";
import "./LoanApprovalQueue.css";

// -----------------------------------------------------------------------------
// LoanApprovalQueue
// Official-only. A member can only sign off in the role they actually hold —
// there is no free-text "type your name" approver field. If the logged-in
// member's role isn't in the application's approver_roles chain, or they've
// already signed in that role, they get no action buttons at all.
// -----------------------------------------------------------------------------

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// One or more of guarantors / approvals / approver_roles may live on a
// pre-existing `text` column rather than real `jsonb` (confirmed for
// guarantors on chama_loan_applications), in which case Supabase hands
// back a raw JSON string instead of a parsed array. Handle both shapes.
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeApplication(row) {
  return {
    ...row,
    guarantors: asArray(row.guarantors),
    approvals: asArray(row.approvals),
    approver_roles: asArray(row.approver_roles),
  };
}

export default function LoanApprovalQueue({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const myRole = (member?.role || "").toLowerCase();
  const isOfficial = hasRole(["secretary", "treasurer", "chairperson", "admin"]);

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null); // { app, type: 'approve' | 'reject' }
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    const { data } = await supabase
      .from("chama_loan_applications")
      .select("*")
      .eq("chama_id", chamaId)
      .in("status", ["Pending", "Awaiting Approval"])
      .order("created_at", { ascending: true });
    setApps((data || []).map(normalizeApplication));
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const myPendingSignoff = (app) => {
    const chain = asArray(app.approver_roles);
    const approvals = asArray(app.approvals);
    if (!chain.includes(myRole)) return false;
    return !approvals.some((a) => a.role === myRole);
  };

  const openModal = (app, type) => { setModal({ app, type }); setComment(""); };
  const closeModal = () => { setModal(null); setComment(""); };

  const submitDecision = async (decision) => {
    const app = modal.app;
    setBusyId(app.id);

    const { data: existingRaw, error: fetchErr } = await supabase
      .from("chama_loan_applications")
      .select("*")
      .eq("id", app.id)
      .single();

    if (fetchErr) { setBusyId(null); setToast({ type: "error", text: fetchErr.message }); return; }
    const existing = normalizeApplication(existingRaw);

    const approvals = existing.approvals;
    if (approvals.some((a) => a.role === myRole)) {
      setBusyId(null); setToast({ type: "error", text: "You've already recorded a decision in this role." });
      closeModal();
      return;
    }

    const entry = { role: myRole, member_id: member.id, name: member.name, decision, comment: comment || null, decided_at: new Date().toISOString() };
    const newApprovals = [...approvals, entry];

    if (decision === "reject") {
      const { error } = await supabase.from("chama_loan_applications")
        .update({ approvals: JSON.stringify(newApprovals), status: "Rejected", rejected_at: new Date().toISOString(), remarks: comment || `Rejected by ${myRole}` })
        .eq("id", app.id);
      setBusyId(null);
      if (error) setToast({ type: "error", text: error.message });
      else { setToast({ type: "success", text: "Application rejected." }); closeModal(); load(); }
      return;
    }

    const chain = existing.approver_roles;
    const approvedRoles = newApprovals.filter((a) => a.decision === "approve").map((a) => a.role);
    const fullyApproved = chain.every((r) => approvedRoles.includes(r));

    const updateFields = { approvals: JSON.stringify(newApprovals), status: fullyApproved ? "Approved" : "Awaiting Approval" };
    let newLoanId = null;
    if (fullyApproved) {
      newLoanId = crypto.randomUUID();
      updateFields.loan_id = newLoanId;
      updateFields.approved_at = new Date().toISOString();
    }

    const { error } = await supabase.from("chama_loan_applications").update(updateFields).eq("id", app.id);
    if (error) { setBusyId(null); setToast({ type: "error", text: error.message }); return; }

    if (fullyApproved) {
      // Create the disbursable loan record. Disbursement itself (moving money
      // out of a chama account) happens in LoanDisbursementDesk.js, treasurer-only.
      await supabase.from("chama_loans").insert([{
        id: newLoanId,
        chama_id: chamaId,
        member_id: existing.member_id,
        member_name: existing.member_name,
        application_id: existing.id,
        amount: existing.requested_amount,
        interest_rate: existing.interest_rate,
        interest_type: existing.interest_type,
        repayment_months: existing.repayment_months,
        balance: existing.requested_amount,
        disbursed: false,
        status: "active",
      }]);
    }

    setBusyId(null);
    setToast({ type: "success", text: fullyApproved ? "Fully approved — sent to disbursement." : "Your sign-off was recorded." });
    closeModal();
    load();
  };

  if (!isOfficial) {
    return (
      <div className="laq-locked">
        <ShieldAlert size={18} />
        <p>Loan approvals are restricted to the secretary, treasurer and chairperson.</p>
      </div>
    );
  }

  return (
    <div className="laq-page">
      <div className="laq-header">
        <h2>Loan Approvals</h2>
        <p>Signed in as <strong>{member?.name}</strong> · role: <strong>{myRole || "unknown"}</strong></p>
      </div>

      {loading ? (
        <div className="laq-loading"><Loader2 size={20} className="spin" /></div>
      ) : apps.length === 0 ? (
        <div className="laq-empty"><CheckCircle size={22} /><p>No loan applications awaiting a decision.</p></div>
      ) : (
        <div className="laq-grid">
          {apps.map((app) => {
            const chain = app.approver_roles || [];
            const approvals = app.approvals || [];
            const canAct = myPendingSignoff(app);
            return (
              <div className="laq-card" key={app.id}>
                <div className="laq-card-top">
                  <h3>{app.member_name}</h3>
                  <span>{formatKES(app.requested_amount)}</span>
                </div>
                <p className="laq-purpose">{app.purpose}</p>
                <p className="laq-terms">
                  {app.repayment_months} months at {app.interest_rate}% ({app.interest_type === "reducing_annual" ? "reducing" : "flat"})
                </p>

                <div className="laq-chain">
                  {chain.map((role) => {
                    const decision = approvals.find((a) => a.role === role);
                    return (
                      <div key={role} className={`laq-chain-item ${decision ? decision.decision : "waiting"}`}>
                        {decision?.decision === "approve" ? <CheckCircle size={13} /> : decision?.decision === "reject" ? <XCircle size={13} /> : <Clock size={13} />}
                        <span>{role}</span>
                        {decision?.name && <small>{decision.name}</small>}
                      </div>
                    );
                  })}
                </div>

                {(app.guarantors || []).length > 0 && (
                  <p className="laq-guarantors">
                    Guarantors: {app.guarantors.map((g) => `${g.name} (${formatKES(g.amount)})`).join(", ")}
                  </p>
                )}

                {canAct ? (
                  <div className="laq-actions">
                    <button className="laq-approve" onClick={() => openModal(app, "approve")} disabled={busyId === app.id}>
                      <CheckCircle size={15} /> Approve as {myRole}
                    </button>
                    <button className="laq-reject" onClick={() => openModal(app, "reject")} disabled={busyId === app.id}>
                      <XCircle size={15} /> Reject
                    </button>
                  </div>
                ) : (
                  <p className="laq-waiting-note">
                    {chain.includes(myRole) ? "You've already recorded your decision." : "Awaiting sign-off from another role."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="laq-modal-overlay" onClick={closeModal}>
          <div className="laq-modal" onClick={(e) => e.stopPropagation()}>
            <div className="laq-modal-head">
              <h3>{modal.type === "approve" ? `Sign off as ${myRole}` : "Reject application"}</h3>
              <button onClick={closeModal}><X size={18} /></button>
            </div>
            <p className="laq-modal-hint">
              {modal.type === "approve"
                ? `${modal.app.member_name}'s application for ${formatKES(modal.app.requested_amount)}. This is recorded against your account and role — it can't be reassigned.`
                : `Let ${modal.app.member_name} know why this was declined.`}
            </p>
            <textarea placeholder={modal.type === "approve" ? "Comment (optional)" : "Reason for rejection"} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="laq-modal-actions">
              <button className="laq-cancel" onClick={closeModal}>Cancel</button>
              <button
                className={modal.type === "approve" ? "laq-approve" : "laq-reject"}
                onClick={() => submitDecision(modal.type === "approve" ? "approve" : "reject")}
                disabled={busyId === modal.app.id}
              >
                {busyId === modal.app.id ? <Loader2 size={15} className="spin" /> : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`laq-toast ${toast.type}`}>
          {toast.type === "error" ? <AlertCircle size={14} /> : <CheckCircle size={14} />} {toast.text}
        </div>
      )}
    </div>
  );
}
