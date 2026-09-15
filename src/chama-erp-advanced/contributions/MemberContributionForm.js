import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Send, Clock, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import "./MemberContributionForm.css";

// -----------------------------------------------------------------------------
// MemberContributionForm
// "I sent KES 5,000 to the CIC chama account on 12 Jul, ref XYZ, for savings."
// This is purely a declaration — nothing is posted to the ledger or the
// member's balance until a treasurer verifies it against the real account
// and approves in TreasurerReconciliation.js.
// -----------------------------------------------------------------------------

const TYPES = [
  { value: "savings", label: "Savings" },
  { value: "loan_repayment", label: "Loan Repayment" },
  { value: "welfare", label: "Welfare" },
  { value: "shares", label: "Shares" },
  { value: "fine", label: "Fine" },
];

const STATUS_META = {
  PENDING: { icon: Clock, label: "Pending review", tone: "pending" },
  VERIFIED: { icon: Clock, label: "Verified, posting", tone: "pending" },
  APPROVED: { icon: CheckCircle, label: "Approved & posted", tone: "approved" },
  REJECTED: { icon: XCircle, label: "Rejected", tone: "rejected" },
};

const emptyForm = { bank_account_id: "", amount: "", contribution_type: "savings", contributed_on: new Date().toISOString().slice(0, 10), payment_method: "MPESA", transaction_ref: "", member_notes: "" };

function formatKES(v) { return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }

export default function MemberContributionForm({ chamaId: chamaIdProp }) {
  const { chama, member } = useChama();
  const chamaId = chamaIdProp || chama?.id;

  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId || !member?.id) return;
    setLoading(true);
    const [accRes, histRes] = await Promise.all([
      supabase.from("chama_bank_accounts").select("*").eq("chama_id", chamaId).eq("is_active", true),
      supabase.from("chama_contribution_requests").select("*").eq("chama_id", chamaId).eq("member_id", member.id).order("created_at", { ascending: false }).limit(25),
    ]);
    setAccounts(accRes.data || []);
    setHistory(histRes.data || []);
    setLoading(false);
  }, [chamaId, member?.id]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.bank_account_id) return setError("Select which chama account you paid into.");
    if (!form.amount || Number(form.amount) <= 0) return setError("Enter a valid amount.");
    if (form.payment_method !== "CASH" && !form.transaction_ref.trim()) return setError("Enter the transaction reference.");

    setSubmitting(true);
    const { error: err } = await supabase.from("chama_contribution_requests").insert([{
      chama_id: chamaId,
      member_id: member.id,
      bank_account_id: form.bank_account_id,
      amount: Number(form.amount),
      contribution_type: form.contribution_type,
      contributed_on: form.contributed_on,
      payment_method: form.payment_method,
      transaction_ref: form.transaction_ref || null,
      member_notes: form.member_notes || null,
      status: "PENDING",
    }]);
    setSubmitting(false);
    if (err) return setError(err.message);

    setToast("Contribution submitted — the treasurer will verify it against the account.");
    setTimeout(() => setToast(null), 4000);
    setForm(emptyForm);
    load();
  };

  return (
    <div className="mcf-page">
      <div className="mcf-header">
        <span className="mcf-icon"><Send size={16} /></span>
        <div>
          <h2>Declare a Contribution</h2>
          <p>Tell us what you sent, where, and when — your treasurer checks it against the account before it counts.</p>
        </div>
      </div>

      <form className="mcf-form" onSubmit={submit}>
        {error && <div className="mcf-error"><AlertCircle size={14} /> {error}</div>}

        <div className="mcf-grid">
          <label>
            Chama account you paid into
            <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} required>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.account_number ? ` (${a.account_number})` : ""}</option>)}
            </select>
          </label>

          <label>
            Amount (KES)
            <input type="number" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
          </label>

          <label>
            Purpose
            <select value={form.contribution_type} onChange={(e) => setForm((f) => ({ ...f, contribution_type: e.target.value }))}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label>
            Date paid
            <input type="date" value={form.contributed_on} onChange={(e) => setForm((f) => ({ ...f, contributed_on: e.target.value }))} required />
          </label>

          <label>
            Payment method
            <select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank Transfer</option>
              <option value="CASH">Cash</option>
            </select>
          </label>

          <label>
            {form.payment_method === "MPESA" ? "M-Pesa code" : form.payment_method === "BANK" ? "Bank reference" : "Reference (optional)"}
            <input type="text" value={form.transaction_ref} onChange={(e) => setForm((f) => ({ ...f, transaction_ref: e.target.value }))} placeholder="e.g. QFT7X8YABC" />
          </label>

          <label className="mcf-span-2">
            Notes (optional)
            <input type="text" value={form.member_notes} onChange={(e) => setForm((f) => ({ ...f, member_notes: e.target.value }))} placeholder="Anything the treasurer should know" />
          </label>
        </div>

        <button type="submit" className="mcf-submit" disabled={submitting}>
          {submitting ? <Loader2 size={16} className="spin" /> : <Send size={16} />} {submitting ? "Submitting..." : "Submit contribution"}
        </button>
      </form>

      <h3 className="mcf-history-title">Your recent submissions</h3>
      {loading ? (
        <div className="mcf-loading"><Loader2 size={18} className="spin" /></div>
      ) : history.length === 0 ? (
        <p className="mcf-empty">No contributions submitted yet.</p>
      ) : (
        <div className="mcf-history">
          {history.map((h) => {
            const meta = STATUS_META[h.status] || STATUS_META.PENDING;
            const Icon = meta.icon;
            return (
              <div className="mcf-row" key={h.id}>
                <div>
                  <strong>{formatKES(h.amount)}</strong>
                  <span className="mcf-row-sub">{h.contribution_type.replace("_", " ")} · {h.contributed_on}</span>
                </div>
                <span className={`mcf-badge ${meta.tone}`}><Icon size={12} /> {meta.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="mcf-toast">{toast}</div>}
    </div>
  );
}
