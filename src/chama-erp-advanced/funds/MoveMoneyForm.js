import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { formatKES, todayISO } from "../shell/format";
import { Loader2, Send, AlertCircle } from "lucide-react";

// -----------------------------------------------------------------------------
// MoveMoneyForm — the treasurer RECORDS a transfer / expense / project movement.
// Nothing moves yet: the request waits for the chairperson (a different official)
// to approve it, and only then does the database change any balance.
// -----------------------------------------------------------------------------

export const KINDS = {
  transfer:        { label: "Move between accounts", needs: ["from", "to"] },
  expense:         { label: "Pay an expense", needs: ["from", "category", "what"] },
  to_project:      { label: "Put money into a project", needs: ["from", "project"] },
  from_project:    { label: "Take money out of a project", needs: ["project", "to"] },
  project_expense: { label: "Project expense", needs: ["project", "category", "what"] },
  project_income:  { label: "Project income", needs: ["project"] },
};
export const CATEGORIES = ["Meeting costs", "Transport", "Stationery & printing", "Bank & M-Pesa charges", "Allowances", "Professional fees", "Repairs & maintenance", "Licences & fees", "Welfare support", "Other"];

export default function MoveMoneyForm({ kinds, accounts = [], projects = [], fixedProjectId, onDone }) {
  const { chama, member } = useChama();
  const [kind, setKind] = useState(kinds[0]);
  const [f, setF] = useState({ amount: "", from: "", to: "", project: fixedProjectId || "", category: "", what: "", ref: "", date: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const needs = KINDS[kind].needs;
  const fromBal = accounts.find((a) => a.id === f.from)?.balance;
  const activeProjects = projects.filter((p) => p.status === "active");

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setOk(null);
    if (!f.amount || Number(f.amount) <= 0) return setError("Enter the amount.");
    if (needs.includes("from") && !f.from) return setError("Choose the account the money comes from.");
    if (needs.includes("to") && !f.to) return setError("Choose the account the money goes to.");
    if (needs.includes("project") && !f.project) return setError("Choose the project.");
    if (needs.includes("category") && !f.category) return setError("Choose what kind of expense this is.");
    if (needs.includes("what") && !f.what.trim()) return setError("Say what the money was spent on.");
    setBusy(true);
    const { error: err } = await supabase.rpc("request_fund_movement", {
      p_chama_id: chama.id, p_requester: member.id, p_kind: kind, p_amount: Number(f.amount),
      p_from_account: needs.includes("from") ? f.from : null,
      p_to_account: needs.includes("to") ? f.to : null,
      p_project_id: needs.includes("project") ? f.project : null,
      p_category: needs.includes("category") ? f.category : null,
      p_description: f.what.trim() || null, p_reference: f.ref.trim() || null, p_occurred_on: f.date,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setOk(`Recorded ${formatKES(f.amount)} — waiting for the chairperson to approve. No balance has changed yet.`);
    setF((x) => ({ ...x, amount: "", what: "", ref: "", category: "" }));
    onDone && onDone();
  };

  const accountSelect = (label, key) => (
    <label>{label}
      <select value={f[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">Select account</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatKES(a.balance)}</option>)}
      </select>
    </label>
  );

  return (
    <form className="cm-form" onSubmit={submit}>
      {kinds.length > 1 && (
        <div className="cm-chips">{kinds.map((k) => <button type="button" key={k} className={`cm-chip ${kind === k ? "on" : ""}`} onClick={() => { setKind(k); setError(null); setOk(null); }}>{KINDS[k].label}</button>)}</div>
      )}
      {error && <div className="mcf-error"><AlertCircle size={14} /> {error}</div>}
      {ok && <div className="cm-notice ok"><div>{ok}</div></div>}

      <div className="cm-form-row">
        <label>Amount (KES)<input type="number" inputMode="decimal" min="0" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></label>
        <label>Date<input type="date" max={todayISO()} value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
      </div>
      {needs.includes("from") && accountSelect("From account", "from")}
      {needs.includes("from") && f.from && fromBal != null && Number(f.amount) > Number(fromBal) && <p className="cm-hint">That account only has {formatKES(fromBal)} right now.</p>}
      {needs.includes("to") && accountSelect(kind === "from_project" ? "Into account" : "To account", "to")}
      {needs.includes("project") && !fixedProjectId && (
        <label>Project
          <select value={f.project} onChange={(e) => set("project", e.target.value)}>
            <option value="">{activeProjects.length ? "Select project" : "No active project"}</option>
            {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {needs.includes("category") && (
        <label>Kind of expense
          <select value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">Select</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      <label>{needs.includes("what") ? "What was it for?" : "Note (optional)"}
        <input type="text" value={f.what} onChange={(e) => set("what", e.target.value)} placeholder={needs.includes("what") ? "e.g. Hall hire for the AGM" : "Anything worth remembering"} />
      </label>
      <label>Receipt or reference (optional)<input type="text" value={f.ref} onChange={(e) => set("ref", e.target.value)} /></label>
      <button type="submit" className="cm-btn primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} {busy ? "Recording…" : "Record for approval"}</button>
    </form>
  );
}
