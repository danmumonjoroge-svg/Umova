import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useOnlineStatus from "../shell/useOnlineStatus";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { Spinner, Notice, EmptyState, Pill, Panel } from "../shell/ui";
import { ArrowLeftRight, Receipt, Briefcase, Loader2, AlertCircle, CheckCircle, WifiOff, Check, X, Wallet, Clock, PlusCircle, History } from "lucide-react";
import "./FundMovements.css";

// -----------------------------------------------------------------------------
// FundMovements — move money between accounts, pay an expense, or put money
// into a project.
//   Treasurer RECORDS it  -> record_fund_request()  (nothing moves yet)
//   Chairperson APPROVES  -> decide_fund_request()  (ledger written, balances change)
// The person who recorded a request can never approve it. The database checks
// the roles and that the source account really holds the money.
// -----------------------------------------------------------------------------

const KINDS = [
  { key: "transfer", label: "Between accounts", icon: ArrowLeftRight },
  { key: "expense", label: "Expense", icon: Receipt },
  { key: "project_funding", label: "To a project", icon: Briefcase },
];
const KIND_LABEL = { transfer: "Transfer", expense: "Expense", project_funding: "Project" };
const CATEGORIES = ["Meeting costs", "Bank & M-Pesa charges", "Transport", "Stationery & printing", "Professional fees", "Welfare support", "Licences & subscriptions", "Other"];
const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "error", cancelled: "neutral" };

const blank = () => ({ kind: "transfer", from: "", to: "", project: "", category: CATEGORIES[0], amount: "", date: todayISO(), description: "", ref: "" });
const roleOf = (m) => String(m?.role || "").toLowerCase();

export default function FundMovements({ chamaId: chamaIdProp }) {
  const { chama, member } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const online = useOnlineStatus();
  const canRecord = ["treasurer", "admin"].includes(roleOf(member));
  const canDecide = ["chairperson", "chairman", "admin"].includes(roleOf(member));

  const [accounts, setAccounts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [requests, setRequests] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [rejecting, setRejecting] = useState(null); // { id, note }

  const load = useCallback(async () => {
    if (!chamaId || !member?.id) return;
    setLoadError(null);
    try {
      const [bal, proj, reqs, mem] = await Promise.all([
        supabase.rpc("chama_account_balances", { p_chama_id: chamaId, p_requester: member.id }),
        supabase.from("chama_projects").select("id,name,status").eq("chama_id", chamaId).eq("status", "active").order("name"),
        supabase.from("chama_fund_requests").select("*").eq("chama_id", chamaId).order("recorded_at", { ascending: false }).limit(60),
        supabase.from("chama_members").select("id,name").eq("chama_id", chamaId),
      ]);
      const failed = bal.error || proj.error || reqs.error || mem.error;
      if (failed) throw new Error(failed.message);
      setAccounts((bal.data?.accounts || []).filter((a) => a.active));
      setProjects(proj.data || []);
      setRequests(reqs.data || []);
      setNames(Object.fromEntries((mem.data || []).map((m) => [m.id, m.name])));
    } catch (e) {
      setLoadError(e.message || "Could not load");
    } finally {
      setLoading(false);
    }
  }, [chamaId, member?.id]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const accById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const projById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const from = accById[form.from];
  const available = from ? Number(from.balance) - Number(from.pending_out || 0) : null;
  const amount = Number(form.amount) || 0;
  const overdrawn = from && amount > 0 && amount > Number(from.balance);
  const overCommitted = from && amount > 0 && !overdrawn && amount > available;

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setDone(null);
    if (!form.from) return setError("Choose the account the money comes from.");
    if (form.kind === "transfer" && !form.to) return setError("Choose the account the money goes to.");
    if (form.kind === "transfer" && form.to === form.from) return setError("The two accounts must be different.");
    if (form.kind === "project_funding" && !form.project) return setError("Choose the project.");
    if (!(amount > 0)) return setError("Enter an amount.");
    if (!form.description.trim()) return setError("Say what this is for.");
    setBusy(true);
    const { error: err } = await supabase.rpc("record_fund_request", {
      p_chama_id: chamaId, p_recorder: member.id, p_kind: form.kind, p_from_account: form.from, p_amount: amount,
      p_description: form.description, p_to_account: form.kind === "transfer" ? form.to : null,
      p_project_id: form.kind === "project_funding" ? form.project : null,
      p_category: form.kind === "expense" ? form.category : null,
      p_reference: form.ref || null, p_date: form.date || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(`${KIND_LABEL[form.kind]} of ${formatKES(amount)} recorded. It moves once the chairperson approves.`);
    setForm((f) => ({ ...blank(), kind: f.kind, from: f.from }));
    load();
  };

  const decide = async (id, approve, note) => {
    setBusy(true); setError(null); setDone(null);
    const { error: err } = await supabase.rpc("decide_fund_request", { p_request_id: id, p_decider: member.id, p_approve: approve, p_note: note || null });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setRejecting(null);
    setDone(approve ? "Approved. The money has moved." : "Rejected.");
    load();
  };

  const withdraw = async (id) => {
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("cancel_fund_request", { p_request_id: id, p_actor: member.id });
    setBusy(false);
    if (err) return setError(err.message);
    load();
  };

  if (loading) return <Spinner />;
  if (loadError) return <Notice tone="error" icon={AlertCircle}>{loadError}</Notice>;

  const pending = requests.filter((r) => r.status === "pending");
  const where = (r) => {
    const a = (id) => accById[id]?.name || "an account";
    if (r.kind === "transfer") return `${a(r.from_account_id)} → ${a(r.to_account_id)}`;
    if (r.kind === "expense") return `${r.expense_category || "Expense"} · from ${a(r.from_account_id)}`;
    return `${projById[r.project_id]?.name || "Project"} · from ${a(r.from_account_id)}`;
  };

  const RequestRow = ({ r, actions }) => (
    <li className="fm-row">
      <div>
        <strong>{KIND_LABEL[r.kind]} · {formatKES(r.amount)}</strong>
        <small>{where(r)}</small>
        <small>{r.description}{r.reference ? ` · ref ${r.reference}` : ""}</small>
        <small>Recorded by {names[r.recorded_by] || "treasurer"} · {formatDate(r.request_date)}
          {r.decided_by ? ` · ${r.status} by ${names[r.decided_by] || "chairperson"}` : ""}{r.decision_note ? ` — “${r.decision_note}”` : ""}</small>
      </div>
      <div className="fm-side"><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>{actions}</div>
    </li>
  );

  return (
    <div className="fm-page">
      {!online && <Notice tone="warn" icon={WifiOff}>You're offline. Connect to record or approve money movements — nothing is saved for later.</Notice>}
      {error && <Notice tone="error" icon={AlertCircle}>{error}</Notice>}
      {done && <Notice tone="ok" icon={CheckCircle}>{done}</Notice>}

      <Panel icon={Wallet} title="Account balances" badge={accounts.length || ""} tone="green">
      <div className="fm-balances">
        {accounts.map((a) => (
          <div className="fm-bal" key={a.id}>
            <span>{a.name}</span><b>{formatKES(a.balance)}</b>
            {Number(a.pending_out) > 0 && <small>{formatKES(a.pending_out)} waiting for approval</small>}
          </div>
        ))}
      </div>
      </Panel>

      {canDecide && (
        <Panel icon={Clock} title="Waiting for your approval" badge={pending.length || ""} tone="warn">
          {pending.length === 0 ? <EmptyState icon={CheckCircle}>Nothing waiting.</EmptyState> : (
            <ul className="fm-list">
              {pending.map((r) => (
                <RequestRow key={r.id} r={r} actions={
                  r.recorded_by === member.id ? <small>You recorded this — someone else must approve.</small> :
                  rejecting?.id === r.id ? (
                    <div className="fm-reject">
                      <input placeholder="Why are you rejecting it?" value={rejecting.note} onChange={(e) => setRejecting({ id: r.id, note: e.target.value })} />
                      <button className="cm-btn danger" disabled={busy || !rejecting.note.trim()} onClick={() => decide(r.id, false, rejecting.note)}>Reject</button>
                      <button className="cm-link" onClick={() => setRejecting(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="fm-actions">
                      <button className="cm-btn primary" disabled={busy || !online} onClick={() => decide(r.id, true)}>{busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button>
                      <button className="cm-btn danger" disabled={busy} onClick={() => setRejecting({ id: r.id, note: "" })}><X size={14} /> Reject</button>
                    </div>
                  )
                } />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {canRecord && (
        <Panel icon={PlusCircle} title="Record a movement" subtitle="Nothing moves until the chairperson approves it" defaultOpen={!canDecide}>
          <div className="cm-chips">
            {KINDS.map((k) => <button type="button" key={k.key} className={`cm-chip ${form.kind === k.key ? "on" : ""}`} onClick={() => set("kind", k.key)}><k.icon size={13} /> {k.label}</button>)}
          </div>
          <form className="cm-form" onSubmit={submit}>
            <div className="cm-form-row">
              <label>{form.kind === "transfer" ? "From account" : "Paid from"}
                <select value={form.from} onChange={(e) => set("from", e.target.value)} required>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatKES(a.balance)}</option>)}
                </select>
              </label>
              {form.kind === "transfer" && (
                <label>To account
                  <select value={form.to} onChange={(e) => set("to", e.target.value)} required>
                    <option value="">Select account</option>
                    {accounts.filter((a) => a.id !== form.from).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              )}
              {form.kind === "expense" && (
                <label>Category
                  <select value={form.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                </label>
              )}
              {form.kind === "project_funding" && (
                <label>Project
                  <select value={form.project} onChange={(e) => set("project", e.target.value)} required>
                    <option value="">{projects.length ? "Select project" : "No active project — create one first"}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="cm-form-row">
              <label>Amount (KES)<input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} required /></label>
              <label>Date<input type="date" max={todayISO()} value={form.date} onChange={(e) => set("date", e.target.value)} required /></label>
            </div>
            {overdrawn && <div className="fm-warn"><AlertCircle size={14} /> {from.name} only holds {formatKES(from.balance)}. The chairperson will not be able to approve this.</div>}
            {overCommitted && <div className="fm-warn"><AlertCircle size={14} /> {formatKES(from.pending_out)} from this account is already waiting for approval; only {formatKES(available)} is left after that.</div>}
            <label>What is it for?<input type="text" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={form.kind === "expense" ? "e.g. Venue hire for AGM" : form.kind === "transfer" ? "e.g. Bank cash deposit" : "e.g. Second instalment for stock"} required /></label>
            <label>Reference (optional)<input type="text" value={form.ref} onChange={(e) => set("ref", e.target.value.toUpperCase())} placeholder="M-Pesa code, receipt or cheque no." /></label>
            <button type="submit" className="cm-btn primary" disabled={busy || !online}>{busy ? <Loader2 size={16} className="spin" /> : null} {busy ? "Recording…" : "Record for approval"}</button>
          </form>
        </Panel>
      )}

      <Panel icon={History} title={canDecide && !canRecord ? "Recent decisions" : "Recent movements"} defaultOpen={!canRecord || canDecide}>
      {requests.filter((r) => r.status !== "pending" || !canDecide).length === 0 ? <EmptyState>Nothing recorded yet.</EmptyState> : (
        <ul className="fm-list">
          {requests.filter((r) => r.status !== "pending" || !canDecide).map((r) => (
            <RequestRow key={r.id} r={r} actions={r.status === "pending" && r.recorded_by === member.id ? <button className="cm-link" disabled={busy} onClick={() => withdraw(r.id)}>Withdraw</button> : null} />
          ))}
        </ul>
      )}
      </Panel>
    </div>
  );
}
