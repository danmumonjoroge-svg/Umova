import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { PlusCircle, Trash2, Loader2, AlertCircle, FileText, Clock, CheckCircle, XCircle } from "lucide-react";
import "./MemberLoanApplication.css";

// -----------------------------------------------------------------------------
// MemberLoanApplication
// Member-facing only: apply for a loan, track its progress through the
// approval chain. There is NO approve/reject action anywhere in this file —
// that lives exclusively in LoanApprovalQueue.js, gated to officials.
// -----------------------------------------------------------------------------

const emptyForm = { requested_amount: "", purpose: "", repayment_months: "6" };
const emptyGuarantor = () => ({ id: `tmp_${Math.random().toString(36).slice(2)}`, memberId: "", amount: "" });

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function calculateLoan({ amount, months, rate, type }) {
  const P = Number(amount) || 0, n = Number(months) || 0, r = Number(rate) || 0;
  if (P <= 0 || n <= 0) return { monthlyInstallment: 0, totalRepayable: 0 };
  if (type === "reducing_annual") {
    const mr = r / 100 / 12;
    const inst = mr === 0 ? P / n : (P * mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
    return { monthlyInstallment: inst, totalRepayable: inst * n };
  }
  const totalInterest = P * (r / 100) * n;
  const totalRepayable = P + totalInterest;
  return { monthlyInstallment: totalRepayable / n, totalRepayable };
}

const STATUS_META = {
  Pending: { icon: Clock, tone: "pending" },
  "Awaiting Approval": { icon: Clock, tone: "pending" },
  Approved: { icon: CheckCircle, tone: "approved" },
  Disbursed: { icon: CheckCircle, tone: "approved" },
  Closed: { icon: CheckCircle, tone: "approved" },
  Rejected: { icon: XCircle, tone: "rejected" },
};

// guarantors/approvals/approver_roles may live on a pre-existing `text`
// column rather than real `jsonb` (confirmed for guarantors on
// chama_loan_applications) — Supabase then hands back a raw JSON string
// instead of a parsed array. Handle both shapes defensively.
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

export default function MemberLoanApplication({ chamaId: chamaIdProp, startOpen = false }) {
  const { chama, member } = useChama();
  const chamaId = chamaIdProp || chama?.id;

  const [rules, setRules] = useState(null);
  const [myApps, setMyApps] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(!!startOpen);
  const [form, setForm] = useState(emptyForm);
  const [guarantors, setGuarantors] = useState([emptyGuarantor()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId || !member?.id) return;
    setLoading(true);
    const [rulesRes, appsRes, membersRes] = await Promise.all([
      supabase.from("chama_loan_rules").select("*").eq("chama_id", chamaId).maybeSingle(),
      supabase.from("chama_loan_applications").select("*").eq("chama_id", chamaId).eq("member_id", member.id).order("created_at", { ascending: false }),
      supabase.from("chama_members").select("id,name,savings_balance").eq("chama_id", chamaId).eq("status", "active"),
    ]);
    setRules(rulesRes.data || {
      savings_multiplier: 3, required_approvals: 3, approver_roles: ["secretary", "treasurer", "chairperson"],
      default_interest_rate: 10, default_interest_type: "flat_monthly", requires_guarantors: true,
      min_guarantors: 1, guarantor_coverage_percent: 100, max_loan_amount: null, min_membership_months: 0,
    });
    setMyApps((appsRes.data || []).map(normalizeApplication));
    setMembers((membersRes.data || []).filter((m) => m.id !== member.id));
    setLoading(false);
  }, [chamaId, member?.id]);

  useEffect(() => { load(); }, [load]);

  const mySavings = Number(member?.savings_balance || 0);
  const maxEligible = useMemo(() => {
    if (!rules) return 0;
    const byMultiplier = mySavings * Number(rules.savings_multiplier || 0);
    return rules.max_loan_amount ? Math.min(byMultiplier, Number(rules.max_loan_amount)) : byMultiplier;
  }, [rules, mySavings]);

  const hasOpenApplication = myApps.some((a) => ["Pending", "Awaiting Approval"].includes(a.status));

  const guarantorTotal = guarantors.reduce((s, g) => s + (Number(g.amount) || 0), 0);
  const requiredCoverage = (Number(form.requested_amount) || 0) * ((rules?.guarantor_coverage_percent || 0) / 100);

  const addGuarantor = () => setGuarantors((g) => [...g, emptyGuarantor()]);
  const removeGuarantor = (id) => setGuarantors((g) => g.filter((x) => x.id !== id));
  const updateGuarantor = (id, field, value) => setGuarantors((g) => g.map((x) => (x.id === id ? { ...x, [field]: value } : x)));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const amount = Number(form.requested_amount);
    if (!amount || amount <= 0) return setError("Enter a valid amount.");
    if (maxEligible > 0 && amount > maxEligible) return setError(`You're eligible for up to ${formatKES(maxEligible)} based on your savings.`);
    if (!form.purpose.trim()) return setError("Tell us what the loan is for.");
    if (rules?.requires_guarantors) {
      const validGuarantors = guarantors.filter((g) => g.memberId && Number(g.amount) > 0);
      if (validGuarantors.length < (rules.min_guarantors || 1)) return setError(`At least ${rules.min_guarantors} guarantor(s) required.`);
      if (guarantorTotal < requiredCoverage) return setError(`Guarantors must cover at least ${formatKES(requiredCoverage)} (${rules.guarantor_coverage_percent}% of loan).`);
    }

    setSubmitting(true);
    const guarantorPayload = guarantors
      .filter((g) => g.memberId && Number(g.amount) > 0)
      .map((g) => ({ member_id: g.memberId, name: members.find((m) => m.id === g.memberId)?.name || "", amount: Number(g.amount) }));

    const { error: err } = await supabase.from("chama_loan_applications").insert([{
      chama_id: chamaId,
      member_id: member.id,
      member_name: member.name,
      requested_amount: amount,
      purpose: form.purpose,
      repayment_months: Number(form.repayment_months) || 1,
      interest_rate: rules?.default_interest_rate ?? 10,
      interest_type: rules?.default_interest_type || "flat_monthly",
      guarantors: JSON.stringify(guarantorPayload),
      status: "Pending",
      required_approvals: rules?.required_approvals || 3,
      approver_roles: JSON.stringify(rules?.approver_roles || ["secretary", "treasurer", "chairperson"]),
      approvals: JSON.stringify([]),
    }]);

    setSubmitting(false);
    if (err) return setError(err.message);

    setToast("Application submitted — awaiting sign-off from " + (rules?.approver_roles || []).join(" → "));
    setTimeout(() => setToast(null), 4000);
    setForm(emptyForm);
    setGuarantors([emptyGuarantor()]);
    setFormOpen(false);
    load();
  };

  return (
    <div className="mla-page">
      <div className="mla-header">
        <div>
          <h2>My Loans</h2>
          <p>Apply for a loan and track it through approval.</p>
        </div>
        <button className="mla-apply-btn" onClick={() => setFormOpen((v) => !v)} disabled={hasOpenApplication}>
          <PlusCircle size={16} /> {hasOpenApplication ? "Application in progress" : "Apply for a loan"}
        </button>
      </div>

      <div className="mla-eligibility">
        <span>Your savings</span>
        <strong>{formatKES(mySavings)}</strong>
        <span className="mla-divider" />
        <span>Eligible up to</span>
        <strong>{formatKES(maxEligible)}</strong>
        {rules?.min_membership_months > 0 && (
          <>
            <span className="mla-divider" />
            <span>Min. membership</span>
            <strong>{rules.min_membership_months} months</strong>
          </>
        )}
      </div>

      {formOpen && (
        <form className="mla-form" onSubmit={submit}>
          {error && <div className="mla-error"><AlertCircle size={14} /> {error}</div>}

          <div className="mla-form-grid">
            <label>
              Amount requested (KES)
              <input type="number" min="0" value={form.requested_amount}
                onChange={(e) => setForm((f) => ({ ...f, requested_amount: e.target.value }))} required />
            </label>
            <label>
              Repayment period (months)
              <input type="number" min="1" value={form.repayment_months}
                onChange={(e) => setForm((f) => ({ ...f, repayment_months: e.target.value }))} required />
            </label>
            <label className="mla-span-2">
              Purpose
              <input type="text" value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="e.g. School fees, business stock" required />
            </label>
          </div>

          {Number(form.requested_amount) > 0 && Number(form.repayment_months) > 0 && (
            <p className="mla-preview">
              Estimated: <strong>{formatKES(calculateLoan({ amount: form.requested_amount, months: form.repayment_months, rate: rules?.default_interest_rate, type: rules?.default_interest_type }).monthlyInstallment)}</strong> / month
              &nbsp;·&nbsp; total repayable <strong>{formatKES(calculateLoan({ amount: form.requested_amount, months: form.repayment_months, rate: rules?.default_interest_rate, type: rules?.default_interest_type }).totalRepayable)}</strong>
              &nbsp;at {rules?.default_interest_rate}% ({rules?.default_interest_type === "reducing_annual" ? "reducing" : "flat monthly"})
            </p>
          )}

          {rules?.requires_guarantors && (
            <div className="mla-guarantors">
              <div className="mla-guarantors-head">
                <h4>Guarantors</h4>
                <button type="button" onClick={addGuarantor}><PlusCircle size={13} /> Add</button>
              </div>
              {guarantors.map((g) => (
                <div className="mla-guarantor-row" key={g.id}>
                  <select value={g.memberId} onChange={(e) => updateGuarantor(g.id, "memberId", e.target.value)}>
                    <option value="">Select guarantor</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min="0" placeholder="Amount" value={g.amount}
                    onChange={(e) => updateGuarantor(g.id, "amount", e.target.value)} />
                  <button type="button" onClick={() => removeGuarantor(g.id)} disabled={guarantors.length === 1}><Trash2 size={13} /></button>
                </div>
              ))}
              {Number(form.requested_amount) > 0 && (
                <p className={guarantorTotal >= requiredCoverage ? "mla-coverage ok" : "mla-coverage warn"}>
                  Covering {formatKES(guarantorTotal)} of {formatKES(requiredCoverage)} required
                </p>
              )}
            </div>
          )}

          <div className="mla-form-actions">
            <button type="button" className="mla-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="mla-submit" disabled={submitting}>
              {submitting ? <Loader2 size={15} className="spin" /> : "Submit application"}
            </button>
          </div>
        </form>
      )}

      <div className="mla-list">
        {loading ? (
          <div className="mla-loading"><Loader2 size={20} className="spin" /></div>
        ) : myApps.length === 0 ? (
          <div className="mla-empty"><FileText size={22} /><p>No loan applications yet.</p></div>
        ) : (
          myApps.map((app) => {
            const meta = STATUS_META[app.status] || STATUS_META.Pending;
            const Icon = meta.icon;
            const approvals = app.approvals || [];
            const chain = app.approver_roles || [];
            return (
              <div className="mla-card" key={app.id}>
                <div className="mla-card-top">
                  <span>{formatKES(app.requested_amount)}</span>
                  <span className={`mla-status ${meta.tone}`}><Icon size={12} /> {app.status}</span>
                </div>
                <p className="mla-purpose">{app.purpose}</p>
                <div className="mla-chain">
                  {chain.map((role) => {
                    const done = approvals.some((a) => a.role === role && a.decision === "approve");
                    const rejected = approvals.some((a) => a.role === role && a.decision === "reject");
                    return (
                      <span key={role} className={`mla-chain-pill ${done ? "done" : rejected ? "rejected" : ""}`}>
                        {role}
                      </span>
                    );
                  })}
                </div>
                {app.status === "Rejected" && app.remarks && (
                  <p className="mla-remarks"><AlertCircle size={12} /> {app.remarks}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {toast && <div className="mla-toast">{toast}</div>}
    </div>
  );
}
