import React, { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "../shell/useCachedQuery";
import useOnlineStatus from "../shell/useOnlineStatus";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { Spinner, Notice, EmptyState, Panel, SubCard, SubCardList } from "../shell/ui";
import { UserCheck, Loader2, AlertCircle, CheckCircle, WifiOff, Share2, Search, History } from "lucide-react";
import "./MemberContributionForm.css";
import "./TreasurerRecordContribution.css";

// -----------------------------------------------------------------------------
// TreasurerRecordContribution
// For members who have no smartphone: the treasurer records what the member
// paid (cash handed over, or an M-Pesa / bank payment the treasurer can see).
//
// It does NOT add a second way of moving money. The database function
// record_member_contribution() creates the same contribution request a member
// would declare, marks it verified by the treasurer, and posts it through the
// existing post_contribution(). The treasurer is the one who actually received or
// saw the money, so the statement-check step is done as part of recording.
//
// Needs a connection on purpose: a payment is only called "recorded" once the
// server has it. Nothing is saved on the phone for later.
// -----------------------------------------------------------------------------

const TYPES = [
  { value: "savings", label: "Savings" },
  { value: "shares", label: "Shares" },
  { value: "welfare", label: "Welfare" },
  { value: "fine", label: "Fine" },
  { value: "loan_repayment", label: "Loan repayment" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

const blank = () => ({ member_id: "", amount: "", type: "savings", date: todayISO(), method: "CASH", account: "", ref: "", loan_id: "", notes: "" });

export default function TreasurerRecordContribution({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const allowed = hasRole(["treasurer"]);
  const online = useOnlineStatus();

  const [form, setForm] = useState(blank());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const membersQ = useCachedQuery(`rec:members:${chamaId}`, async () => {
    const { data, error: e } = await supabase.from("chama_members").select("id,name,phone,status,savings_balance,shares_balance,welfare_balance").eq("chama_id", chamaId).order("name");
    if (e) throw e;
    return (data || []).filter((m) => (m.status || "active") === "active");
  }, !!chamaId && allowed);

  const accountsQ = useCachedQuery(`rec:accounts:${chamaId}`, async () => {
    const { data, error: e } = await supabase.from("chama_bank_accounts").select("id,account_name,account_number,account_type").eq("chama_id", chamaId).eq("is_active", true);
    if (e) throw e;
    return (data || []).filter((a) => a.account_type !== "cash");   // cash is chosen as the method, not as an account
  }, !!chamaId && allowed);

  const loansQ = useCachedQuery(form.member_id ? `rec:loans:${chamaId}:${form.member_id}` : null, async () => {
    const { data, error: e } = await supabase.from("chama_loans").select("id,amount,balance").eq("chama_id", chamaId).eq("member_id", form.member_id).eq("disbursed", true).eq("status", "active");
    if (e) throw e;
    return data || [];
  }, !!(chamaId && form.member_id && allowed));

  const recentQ = useCachedQuery(`rec:recent:${chamaId}`, async () => {
    const { data, error: e } = await supabase.from("chama_contribution_requests").select("id,member_id,amount,contribution_type,payment_method,contributed_on,created_at,transaction_ref").eq("chama_id", chamaId).eq("recorded_by_treasurer", true).order("created_at", { ascending: false }).limit(15);
    if (e) throw e;
    return data || [];
  }, !!chamaId && allowed);

  const members = membersQ.data || [];
  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const chosen = byId[form.member_id];
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members.slice(0, 40);
    return members.filter((m) => `${m.name || ""} ${m.phone || ""}`.toLowerCase().includes(q)).slice(0, 40);
  }, [members, search]);
  const myLoans = loansQ.data || [];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!online) return setError("You need a connection to record a payment.");
    if (!form.member_id) return setError("Choose the member who paid.");
    if (!form.amount || Number(form.amount) <= 0) return setError("Enter the amount paid.");
    if (form.method !== "CASH" && !form.account) return setError("Choose the Chama account the money went into.");
    if (form.method !== "CASH" && !form.ref.trim()) return setError(form.method === "MPESA" ? "Enter the M-Pesa code." : "Enter the bank reference.");
    if (form.type === "loan_repayment" && !form.loan_id) return setError(myLoans.length ? "Choose which loan is being repaid." : "This member has no active loan.");

    setBusy(true);
    const { error: err } = await supabase.rpc("record_member_contribution", {
      p_chama_id: chamaId,
      p_recorder: member.id,
      p_member_id: form.member_id,
      p_amount: Number(form.amount),
      p_type: form.type,
      p_contributed_on: form.date,
      p_method: form.method,
      p_bank_account_id: form.method === "CASH" ? null : form.account,
      p_reference: form.ref.trim() || null,
      p_loan_id: form.type === "loan_repayment" ? form.loan_id : null,
      p_notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);

    setReceipt({ memberName: chosen?.name, amount: Number(form.amount), type: form.type, date: form.date, method: form.method, ref: form.ref.trim() });
    // keep date and method for the next member — a meeting day is a run of entries
    setForm((f) => ({ ...blank(), date: f.date, method: f.method, account: f.account }));
    setSearch("");
    recentQ.reload();
    membersQ.reload();
  };

  const receiptText = (r) =>
    `${chama?.name || "Chama"} — receipt\n${r.memberName}: ${formatKES(r.amount)} received for ${TYPE_LABEL[r.type].toLowerCase()} on ${formatDate(r.date)}` +
    `${r.method === "CASH" ? " (cash)" : r.ref ? ` (${r.method === "MPESA" ? "M-Pesa" : "bank"} ${r.ref})` : ""}.\nRecorded by ${member?.name} (treasurer).`;

  const shareReceipt = async () => {
    const text = receiptText(receipt);
    if (navigator.share) { try { await navigator.share({ title: "Contribution receipt", text }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  if (!allowed) return <Notice tone="error" icon={AlertCircle}>Recording contributions for members is for the treasurer.</Notice>;
  if (membersQ.loading && !membersQ.data) return <Spinner />;

  return (
    <div className="trc-page">
      <p className="cm-hint">For members who pay in cash or cannot use the app. It is posted to their account straight away, the same as a checked contribution.</p>

      {!online && <Notice tone="warn" icon={WifiOff}>You're offline. Connect to record a payment — nothing is saved for later, so it can't be mistaken for recorded.</Notice>}

      {receipt && (
        <Notice tone="ok" icon={CheckCircle}>
          <strong>Recorded: {receipt.memberName} — {formatKES(receipt.amount)} ({TYPE_LABEL[receipt.type]})</strong>
          <div className="trc-receipt-actions">
            <button type="button" className="cm-btn" onClick={shareReceipt}><Share2 size={15} /> Send receipt</button>
            <button type="button" className="cm-link" onClick={() => setReceipt(null)}>Dismiss</button>
          </div>
        </Notice>
      )}

      <Panel icon={UserCheck} title="Record a payment" subtitle="For members paying cash or without a phone" tone="green" collapsible={false}>
      <form className="cm-form" onSubmit={submit}>
        {error && <div className="mcf-error"><AlertCircle size={14} /> {error}</div>}

        <label>
          Member
          <span className="trc-search"><Search size={15} /><input type="search" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></span>
          <select value={form.member_id} onChange={(e) => { set("member_id", e.target.value); set("loan_id", ""); }} size={form.member_id ? 1 : Math.min(6, Math.max(2, matches.length + 1))} required>
            <option value="">{matches.length ? "Choose member" : "No member matches"}</option>
            {matches.map((m) => <option key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ""}</option>)}
            {chosen && !matches.some((m) => m.id === chosen.id) && <option value={chosen.id}>{chosen.name}</option>}
          </select>
        </label>

        {chosen && (
          <div className="trc-balances">
            <span>Savings <b>{formatKES(chosen.savings_balance)}</b></span>
            <span>Shares <b>{formatKES(chosen.shares_balance)}</b></span>
            <span>Welfare <b>{formatKES(chosen.welfare_balance)}</b></span>
          </div>
        )}

        <div className="cm-form-row">
          <label>Amount paid (KES)<input type="number" inputMode="decimal" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} required /></label>
          <label>Paid for
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        </div>

        {form.type === "loan_repayment" && (
          <label>Which loan?
            <select value={form.loan_id} onChange={(e) => set("loan_id", e.target.value)} required>
              <option value="">{!form.member_id ? "Choose the member first" : myLoans.length ? "Select loan" : "No active loan"}</option>
              {myLoans.map((l) => <option key={l.id} value={l.id}>{formatKES(l.amount)} loan — {formatKES(l.balance ?? l.amount)} still owed</option>)}
            </select>
          </label>
        )}

        <div className="cm-form-row">
          <label>Date paid<input type="date" max={todayISO()} value={form.date} onChange={(e) => set("date", e.target.value)} required /></label>
          <label>How was it paid?
            <select value={form.method} onChange={(e) => set("method", e.target.value)}>
              <option value="CASH">Cash given to treasurer</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank transfer</option>
            </select>
          </label>
        </div>

        {form.method !== "CASH" && (
          <div className="cm-form-row">
            <label>Chama account
              <select value={form.account} onChange={(e) => set("account", e.target.value)} required>
                <option value="">Select account</option>
                {(accountsQ.data || []).map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.account_number ? ` (${a.account_number})` : ""}</option>)}
              </select>
            </label>
            <label>{form.method === "MPESA" ? "M-Pesa code" : "Bank reference"}
              <input type="text" value={form.ref} onChange={(e) => set("ref", e.target.value.toUpperCase())} placeholder="e.g. QFT7X8YABC" />
            </label>
          </div>
        )}

        <label>Note (optional)<input type="text" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering" /></label>

        <button type="submit" className="cm-btn primary" disabled={busy || !online}>
          {busy ? <Loader2 size={16} className="spin" /> : <UserCheck size={16} />} {busy ? "Recording…" : "Record payment"}
        </button>
      </form>
      </Panel>

      <Panel icon={History} title="Recorded by you recently" badge={(recentQ.data || []).length || ""} defaultOpen={(recentQ.data || []).length > 0}>
      {(recentQ.data || []).length === 0 ? <EmptyState>Nothing recorded yet.</EmptyState> : (
        <SubCardList>
          {recentQ.data.map((r) => (
            <SubCard key={r.id} title={byId[r.member_id]?.name || "Member"} sub={`${TYPE_LABEL[r.contribution_type] || r.contribution_type} · ${r.payment_method === "CASH" ? "Cash" : r.payment_method === "MPESA" ? "M-Pesa" : "Bank"} · ${formatDate(r.contributed_on)}`} value={<span className="in">+{formatKES(r.amount)}</span>} />
          ))}
        </SubCardList>
      )}
      </Panel>
    </div>
  );
}
