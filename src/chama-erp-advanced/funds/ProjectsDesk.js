import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { Spinner, StaleNote, Notice, SectionTitle, EmptyState, Pill } from "../shell/ui";
import { AlertCircle, Briefcase, Plus, Loader2, ArrowLeft } from "lucide-react";
import MoveMoneyForm from "./MoveMoneyForm";
import "./funds.css";

// -----------------------------------------------------------------------------
// ProjectsDesk — the Chama's investment / business projects.
// Each project holds its own money: capital the Chama put in, income earned,
// expenses paid, and money returned to the Chama. Profit = income − expenses.
// Every money movement is recorded by the treasurer and approved by the
// chairperson (see FundsDesk), so this screen only starts projects and records.
// -----------------------------------------------------------------------------

const KIND_LABEL = { capital: "Put in by the Chama", income: "Income earned", expense: "Expense", returned: "Returned to the Chama" };

export default function ProjectsDesk({ chamaId: chamaIdProp, params = {} }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const canRecord = hasRole(["treasurer"]);
  const [openId, setOpenId] = useState(params.id || null);
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState({ name: "", description: "", target: "", started: todayISO() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const overview = useCachedQuery(`proj:${chamaId}`, async () => {
    const { data, error: e } = await supabase.rpc("chama_funds_overview", { p_chama_id: chamaId, p_requester: member.id, p_from: null, p_to: null });
    if (e) throw new Error(e.message);
    return data;
  }, !!(chamaId && member?.id));

  const entries = useCachedQuery(openId ? `proj:entries:${openId}` : null, async () => {
    const { data, error: e } = await supabase.from("chama_project_entries").select("*").eq("project_id", openId).order("occurred_on", { ascending: false }).order("created_at", { ascending: false });
    if (e) throw new Error(e.message);
    return data || [];
  }, !!openId);

  const o = overview.data;
  const projects = o?.projects || [];
  const project = projects.find((p) => p.id === openId);
  const profit = (p) => Number(p.income) - Number(p.expenses);

  const create = async (e) => {
    e.preventDefault(); setError(null);
    if (!nf.name.trim()) return setError("Give the project a name.");
    setBusy(true);
    const { error: err } = await supabase.rpc("create_chama_project", { p_chama_id: chamaId, p_creator: member.id, p_name: nf.name, p_description: nf.description || null, p_target: nf.target ? Number(nf.target) : null, p_started_on: nf.started });
    setBusy(false);
    if (err) return setError(err.message);
    setNf({ name: "", description: "", target: "", started: todayISO() }); setShowNew(false); overview.reload();
  };

  if (overview.loading && !o) return <Spinner />;
  if (!o) return <Notice tone="error" icon={AlertCircle}>Could not load projects{overview.error ? `: ${overview.error}` : ""}. {String(overview.error || "").includes("does not exist") ? "Run sql/010 in the database first." : ""}</Notice>;

  // ---------- one project ----------
  if (project) {
    return (
      <div className="pj">
        <button type="button" className="cm-btn" onClick={() => setOpenId(null)}><ArrowLeft size={15} /> All projects</button>
        <div className="cm-profile-head" style={{ marginTop: 12 }}>
          <div><h3>{project.name}</h3>{project.description && <small>{project.description}</small>}<small>Started {formatDate(project.started_on)}</small></div>
          <Pill tone={project.status === "active" ? "ok" : "neutral"}>{project.status === "active" ? "Active" : "Closed"}</Pill>
        </div>
        <div className="cm-kv">
          <div><span>Money in the project now</span><strong>{formatKES(project.wallet)}</strong></div>
          <div><span>Put in by the Chama</span><strong>{formatKES(project.capital)}</strong></div>
          <div><span>Income earned</span><strong>{formatKES(project.income)}</strong></div>
          <div><span>Expenses</span><strong>{formatKES(project.expenses)}</strong></div>
          <div><span>Profit / loss</span><strong className={`pj-profit ${profit(project) >= 0 ? "pos" : "neg"}`}>{formatKES(profit(project))}</strong></div>
          <div><span>Returned to the Chama</span><strong>{formatKES(project.returned)}</strong></div>
          {project.target && <div><span>Target</span><strong>{formatKES(project.target)}</strong></div>}
        </div>

        {canRecord && project.status === "active" && (
          <>
            <SectionTitle>Record</SectionTitle>
            <MoveMoneyForm kinds={["to_project", "project_income", "project_expense", "from_project"]} accounts={o.accounts} projects={projects} fixedProjectId={project.id} onDone={() => { overview.reload(); entries.reload(); }} />
            <p className="cm-hint">Recorded items wait for the chairperson to approve under Chama accounts.</p>
          </>
        )}

        <SectionTitle>History</SectionTitle>
        {(entries.data || []).length === 0 ? <EmptyState>Nothing approved yet.</EmptyState> : (
          <ul className="cm-txns">
            {entries.data.map((x) => (
              <li key={x.id}>
                <div><strong>{KIND_LABEL[x.kind] || x.kind}{x.category ? ` · ${x.category}` : ""}</strong><small>{formatDate(x.occurred_on)}{x.description ? ` · ${x.description}` : ""}</small></div>
                <span className={x.direction === "in" ? "in" : "out"}>{x.direction === "in" ? "+" : "−"}{formatKES(x.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---------- list ----------
  return (
    <div className="pj">
      <StaleNote fromCache={overview.fromCache} cachedAt={overview.cachedAt} online={overview.online} />
      {canRecord && (
        <div className="cm-actions-row">
          <button type="button" className="cm-btn primary" onClick={() => setShowNew((s) => !s)}><Plus size={15} /> New project</button>
        </div>
      )}
      {showNew && (
        <form className="cm-form" onSubmit={create}>
          {error && <div className="mcf-error"><AlertCircle size={14} /> {error}</div>}
          <label>Project name<input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="e.g. Rental plots, Dairy farm" /></label>
          <label>What is it? (optional)<input value={nf.description} onChange={(e) => setNf({ ...nf, description: e.target.value })} /></label>
          <div className="cm-form-row">
            <label>Target amount (optional)<input type="number" min="0" value={nf.target} onChange={(e) => setNf({ ...nf, target: e.target.value })} /></label>
            <label>Started on<input type="date" max={todayISO()} value={nf.started} onChange={(e) => setNf({ ...nf, started: e.target.value })} /></label>
          </div>
          <button className="cm-btn primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Briefcase size={16} />} Start project</button>
        </form>
      )}

      <div className="cm-kv">
        <div><span>Projects</span><strong>{projects.filter((p) => p.status === "active").length}</strong></div>
        <div><span>Put in by the Chama</span><strong>{formatKES(projects.reduce((s, p) => s + Number(p.capital), 0))}</strong></div>
        <div><span>Total profit / loss</span><strong>{formatKES(projects.reduce((s, p) => s + profit(p), 0))}</strong></div>
        <div><span>Held in projects</span><strong>{formatKES(projects.reduce((s, p) => s + Number(p.wallet), 0))}</strong></div>
      </div>

      <SectionTitle>Projects</SectionTitle>
      {projects.length === 0 ? <EmptyState icon={Briefcase}>No projects yet.</EmptyState> : (
        <div className="cm-card-grid">
          {projects.map((p) => (
            <button key={p.id} type="button" className="cm-card pj-card" onClick={() => setOpenId(p.id)}>
              <span className="cm-card-icon"><Briefcase size={20} /></span>
              <span className="cm-card-body">
                <span className="cm-card-title">{p.name}{p.status !== "active" ? <em className="cm-badge">Closed</em> : null}</span>
                <span className="cm-card-value">{formatKES(p.wallet)}</span>
                <span className="cm-card-sub">Profit {formatKES(profit(p))} · put in {formatKES(p.capital)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
