import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "../shell/useCachedQuery";
import useOnlineStatus from "../shell/useOnlineStatus";
import { formatKES, formatDate } from "../shell/format";
import { Spinner, StaleNote, Notice, SectionTitle, EmptyState, Pill } from "../shell/ui";
import { AlertCircle, CheckCircle, XCircle, Loader2, WifiOff } from "lucide-react";
import MoveMoneyForm, { KINDS } from "./MoveMoneyForm";
import "./funds.css";

// -----------------------------------------------------------------------------
// FundsDesk — where the Chama's money is: balance of each account, moving money
// between accounts, paying expenses, and the approval queue.
// Treasurer records; the chairperson (a different person) approves.
// -----------------------------------------------------------------------------

export default function FundsDesk({ chamaId: chamaIdProp }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const online = useOnlineStatus();
  const canRecord = hasRole(["treasurer"]);
  const canApprove = hasRole(["chairperson"]);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const overview = useCachedQuery(`funds:${chamaId}`, async () => {
    const { data, error } = await supabase.rpc("chama_funds_overview", { p_chama_id: chamaId, p_requester: member.id, p_from: null, p_to: null });
    if (error) throw new Error(error.message);
    return data;
  }, !!(chamaId && member?.id));

  const reqs = useCachedQuery(`funds:reqs:${chamaId}`, async () => {
    const { data, error } = await supabase.from("chama_fund_requests").select("*").eq("chama_id", chamaId).order("created_at", { ascending: false }).limit(40);
    if (error) throw new Error(error.message);
    return data || [];
  }, !!chamaId);

  const members = useCachedQuery(`funds:members:${chamaId}`, async () => {
    const { data, error } = await supabase.from("chama_members").select("id,name").eq("chama_id", chamaId);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data || []).map((m) => [m.id, m.name]));
  }, !!chamaId);

  const reload = () => { overview.reload(); reqs.reload(); };
  const o = overview.data;
  const accounts = o?.accounts || [];
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name || "—";
  const projName = (id) => (o?.projects || []).find((p) => p.id === id)?.name || "project";
  const who = (id) => members.data?.[id] || "—";
  const pending = (reqs.data || []).filter((r) => r.status === "PENDING");
  const done = (reqs.data || []).filter((r) => r.status !== "PENDING").slice(0, 12);

  const describe = (r) => {
    const k = KINDS[r.kind]?.label || r.kind;
    if (r.kind === "transfer") return `${nameOf(r.from_account)} → ${nameOf(r.to_account)}`;
    if (r.kind === "expense") return `${r.category || "Expense"} · from ${nameOf(r.from_account)}`;
    if (r.kind === "to_project") return `${nameOf(r.from_account)} → ${projName(r.project_id)}`;
    if (r.kind === "from_project") return `${projName(r.project_id)} → ${nameOf(r.to_account)}`;
    return `${k} · ${projName(r.project_id)}`;
  };

  const decide = async (r, approve) => {
    let note = null;
    if (!approve) { note = window.prompt("Why is this being rejected? (optional)") ; if (note === null) return; }
    setBusyId(r.id); setMsg(null);
    const { error } = await supabase.rpc("decide_fund_request", { p_request_id: r.id, p_decider: member.id, p_approve: approve, p_note: note });
    setBusyId(null);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: approve ? `Approved — ${formatKES(r.amount)} moved.` : "Rejected. Nothing moved." });
    reload();
  };

  const assign = async (entry, accountId) => {
    if (!accountId) return;
    setBusyId(entry.id); setMsg(null);
    const { error } = await supabase.rpc("assign_entry_account", { p_entry_id: entry.id, p_account_id: accountId, p_actor: member.id });
    setBusyId(null);
    if (error) return setMsg({ tone: "error", text: error.message });
    reload();
  };

  if (overview.loading && !o) return <Spinner />;
  if (!o) return <Notice tone="error" icon={AlertCircle}>Could not load the accounts{overview.error ? `: ${overview.error}` : ""}. {String(overview.error || "").includes("does not exist") ? "Run sql/010 in the database first." : ""}</Notice>;

  const total = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);

  return (
    <div className="fd">
      <StaleNote fromCache={overview.fromCache} cachedAt={overview.cachedAt} online={overview.online} />
      {!online && <Notice tone="warn" icon={WifiOff}>You're offline. Moving money needs a connection.</Notice>}
      {msg && <Notice tone={msg.tone} icon={msg.tone === "ok" ? CheckCircle : AlertCircle}>{msg.text}</Notice>}

      <div className="cm-kv">
        <div><span>All accounts together</span><strong>{formatKES(total)}</strong></div>
        <div><span>Waiting for approval</span><strong>{pending.length}</strong></div>
      </div>

      <SectionTitle>Accounts</SectionTitle>
      {accounts.length === 0 ? <EmptyState>No accounts yet. Add one under Chama accounts.</EmptyState> : (
        <div className="cm-accs">
          {accounts.map((a) => (
            <div className="cm-acc" key={a.id}>
              <div className="cm-acc-head"><span>{a.name}</span><strong>{formatKES(a.balance)}</strong></div>
              <div className="cm-acc-row">
                <div><span>Opening</span><b>{formatKES(a.opening)}</b></div>
                <div><span>Money in</span><b>{formatKES(a.in)}</b></div>
                <div><span>Money out</span><b>{formatKES(a.out)}</b></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(o.unassigned || []).length > 0 && (
        <>
          <SectionTitle>Not yet in an account ({o.unassigned.length})</SectionTitle>
          <p className="cm-hint">These were recorded without saying which account the money went into (for example loan repayments at the desk). Choose the account so the balances are right.</p>
          <ul className="cm-txns">
            {o.unassigned.map((e) => (
              <li key={e.id}>
                <div><strong>{e.direction === "credit" ? "+" : "−"}{formatKES(e.amount)}</strong><small>{String(e.kind || "").replace("_", " ")} · {formatDate(e.on)}</small></div>
                {canRecord ? (
                  <select disabled={busyId === e.id} defaultValue="" onChange={(ev) => assign(e, ev.target.value)} aria-label="Choose account">
                    <option value="">Choose account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : <Pill tone="warn">Unassigned</Pill>}
              </li>
            ))}
          </ul>
        </>
      )}

      {canRecord && (
        <>
          <SectionTitle right={<button type="button" className="cm-link" onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "Record one"}</button>}>Transfers and expenses</SectionTitle>
          {showForm && <MoveMoneyForm kinds={["transfer", "expense", "to_project"]} accounts={accounts} projects={o.projects || []} onDone={reload} />}
        </>
      )}

      <SectionTitle>Waiting for approval</SectionTitle>
      {pending.length === 0 ? <EmptyState>Nothing waiting.</EmptyState> : (
        <ul className="cm-txns">
          {pending.map((r) => (
            <li key={r.id}>
              <div><strong>{formatKES(r.amount)} · {KINDS[r.kind]?.label || r.kind}</strong><small>{describe(r)}{r.description ? ` · ${r.description}` : ""} · recorded by {who(r.requested_by)} · {formatDate(r.occurred_on)}</small></div>
              {canApprove && r.requested_by !== member.id ? (
                <span className="fd-actions">
                  <button className="cm-btn primary" disabled={busyId === r.id || !online} onClick={() => decide(r, true)}>{busyId === r.id ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />} Approve</button>
                  <button className="cm-btn" disabled={busyId === r.id || !online} onClick={() => decide(r, false)} aria-label="Reject"><XCircle size={14} /></button>
                </span>
              ) : <Pill tone="warn">{canApprove ? "Needs another official" : "Waiting for chairperson"}</Pill>}
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle>Recently decided</SectionTitle>
          <ul className="cm-txns">
            {done.map((r) => (
              <li key={r.id}>
                <div><strong>{formatKES(r.amount)} · {KINDS[r.kind]?.label || r.kind}</strong><small>{describe(r)} · {r.status === "APPROVED" ? "approved" : "rejected"} by {who(r.decided_by)}{r.decision_note ? ` — ${r.decision_note}` : ""}</small></div>
                <Pill tone={r.status === "APPROVED" ? "ok" : "error"}>{r.status === "APPROVED" ? "Approved" : "Rejected"}</Pill>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
