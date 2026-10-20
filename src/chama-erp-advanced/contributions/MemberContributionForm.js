import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "../shell/useCachedQuery";
import useOnlineStatus from "../shell/useOnlineStatus";
import {
  useContributionOutbox, enqueueContribution, newClientRequestId, isNetworkError,
} from "../shell/contributionOutbox";
import { Send, Clock, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import "./MemberContributionForm.css";

// -----------------------------------------------------------------------------
// MemberContributionForm
// "I sent KES 5,000 to the CIC chama account on 12 Jul, ref XYZ, for savings."
// This is purely a declaration — nothing is posted to the ledger or the
// member's balance until a treasurer verifies it against the real account
// and approves in TreasurerReconciliation.js.
//
// OFFLINE: if the phone has no connection (or the send fails because of the network), the declaration is saved on the
// phone and sent automatically when the connection returns (shell/contributionOutbox.js). While it waits it is shown as
// "Saved on this phone — not sent yet": it is never called sent, pending review or confirmed until the server has it.
// Each declaration carries a random client_request_id so a retry can never create it twice.
// The account and loan lists are kept on the phone (useCachedQuery) so the form still works offline once it was opened online.
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

export default function MemberContributionForm({ chamaId: chamaIdProp, initialType }) {
  const { chama, member } = useChama();
  const chamaId = chamaIdProp || chama?.id;

  const online = useOnlineStatus();
  const enabled = !!chamaId && !!member?.id;
  // Each list is kept on the phone, so the form still opens offline (shown from the last time it was loaded online).
  // The fetchers THROW on failure so a failed refresh never overwrites a good saved copy.
  const accountsQ = useCachedQuery(`contrib:accounts:${chamaId}`, async () => {
    const { data, error: e } = await supabase.from("chama_bank_accounts").select("*").eq("chama_id", chamaId).eq("is_active", true);
    if (e) throw e;
    return data || [];
  }, enabled);
  const historyQ = useCachedQuery(`contrib:history:${chamaId}:${member?.id}`, async () => {
    const { data, error: e } = await supabase.from("chama_contribution_requests").select("*").eq("chama_id", chamaId).eq("member_id", member.id).order("created_at", { ascending: false }).limit(25);
    if (e) throw e;
    return data || [];
  }, enabled);
  const loansQ = useCachedQuery(`contrib:loans:${chamaId}:${member?.id}`, async () => {
    const { data, error: e } = await supabase.from("chama_loans").select("id,amount,balance").eq("chama_id", chamaId).eq("member_id", member.id).eq("disbursed", true).eq("status", "active");
    if (e) throw e;
    return data || [];
  }, enabled);
  const accounts = accountsQ.data || [];
  const history = historyQ.data || [];
  const myLoans = loansQ.data || []; // loans this member can repay (needed for loan_repayment)
  const loading = historyQ.loading && !historyQ.data;

  // Declarations saved while offline: shown first, sent automatically, history refreshed once they reach the server.
  const outbox = useContributionOutbox({ supabase, memberId: member?.id, onSent: () => { historyQ.reload(); } });

  const startForm = { ...emptyForm, contribution_type: TYPES.some((t) => t.value === initialType) ? initialType : emptyForm.contribution_type };
  const [form, setForm] = useState(startForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.bank_account_id) return setError("Select which chama account you paid into.");
    if (!form.amount || Number(form.amount) <= 0) return setError("Enter a valid amount.");
    if (form.payment_method !== "CASH" && !form.transaction_ref.trim()) return setError("Enter the transaction reference.");
    // A loan repayment must say WHICH loan (sql/006 refuses to post one without it).
    if (form.contribution_type === "loan_repayment" && !form.loan_id) return setError(myLoans.length ? "Choose which loan you are repaying." : "You have no active loan to repay.");

    // One random id per declaration: if the connection drops mid-send and it is retried, the database refuses the repeat.
    const clientRequestId = newClientRequestId();
    const row = {
      chama_id: chamaId,
      member_id: member.id,
      bank_account_id: form.bank_account_id,
      amount: Number(form.amount),
      contribution_type: form.contribution_type,
      contributed_on: form.contributed_on,
      payment_method: form.payment_method,
      transaction_ref: form.transaction_ref || null,
      member_notes: form.member_notes || null,
      loan_id: form.contribution_type === "loan_repayment" ? form.loan_id : null,
      status: "PENDING",
    };

    // No connection (or the send failed because of the network): keep it on the phone and say so plainly. It is NOT sent yet.
    const saveOnPhone = () => {
      const saved = enqueueContribution({ clientRequestId, memberId: member.id, chamaId, row });
      if (!saved.ok) return setError("Couldn't save this on your phone (its storage may be full). Free some space, or connect and try again.");
      setToast("Saved on this phone, NOT sent yet. It will be sent automatically when you are back online.");
      setTimeout(() => setToast(null), 7000);
      setForm(startForm);
    };

    if (!online) return saveOnPhone();

    setSubmitting(true);
    let err = null;
    try {
      ({ error: err } = await supabase.from("chama_contribution_requests").insert([{ ...row, client_request_id: clientRequestId }]));
    } catch (ex) {
      err = ex;
    }
    setSubmitting(false);
    if (err) return isNetworkError(err) ? saveOnPhone() : setError(err.message);

    setToast("Contribution submitted — the treasurer will verify it against the account.");
    setTimeout(() => setToast(null), 4000);
    setForm(startForm);
    historyQ.reload();
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
        {!online && (
          <div className="mcf-error" role="status"><AlertCircle size={14} /> You're offline. You can still fill this in: it will be saved on this phone and sent automatically when you're back online.</div>
        )}

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

          {form.contribution_type === "loan_repayment" && (
            <label className="mcf-span-2">
              Which loan are you repaying?
              <select value={form.loan_id || ""} onChange={(e) => setForm((f) => ({ ...f, loan_id: e.target.value }))} required>
                <option value="">{myLoans.length ? "Select loan" : "No active loan"}</option>
                {myLoans.map((l) => <option key={l.id} value={l.id}>{formatKES(l.amount)} loan — {formatKES(l.balance ?? l.amount)} still owed</option>)}
              </select>
            </label>
          )}

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

      {outbox.items.length > 0 && (
        <>
          <h3 className="mcf-history-title">Waiting to send</h3>
          <div className="mcf-history">
            {outbox.items.map((it) => (
              <div className="mcf-row" key={it.clientRequestId}>
                <div>
                  <strong>{formatKES(it.row.amount)}</strong>
                  <span className="mcf-row-sub">{String(it.row.contribution_type || "").replace("_", " ")} · {it.row.contributed_on}</span>
                  {it.status === "failed" && <span className="mcf-row-sub">The server did not accept it: {it.reason}</span>}
                </div>
                {it.status === "failed" ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mcf-badge rejected"><XCircle size={12} /> Not accepted</span>
                    <button type="button" onClick={() => outbox.discard(it.clientRequestId)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer" }}>Remove</button>
                  </span>
                ) : (
                  <span className="mcf-badge pending"><Clock size={12} /> {outbox.syncing ? "Sending…" : "Saved on this phone — not sent yet"}</span>
                )}
              </div>
            ))}
          </div>
          {online && outbox.hasWaiting && !outbox.syncing && (
            <p className="mcf-empty"><button type="button" onClick={outbox.sync} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer" }}>Try sending now</button></p>
          )}
        </>
      )}

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
