import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { Spinner, Notice, EmptyState, Pill, Panel, SubCard, SubCardList, StatGrid, Stat } from "../shell/ui";
import { Briefcase, PlusCircle, Loader2, AlertCircle } from "lucide-react";
import "./FundMovements.css";

// -----------------------------------------------------------------------------
// ChamaProjects — the Chama's investments and businesses.
// "Invested" is the total of APPROVED payments into the project, taken from
// the ledger — so it only counts money the chairperson has approved.
// Making a project moves no money, so it needs no approval.
// -----------------------------------------------------------------------------

const KIND = { investment: "Investment", business: "Business" };
const STATUS = { active: "Active", on_hold: "On hold", closed: "Closed" };
const STATUS_TONE = { active: "ok", on_hold: "warn", closed: "neutral" };
const blank = () => ({ name: "", kind: "investment", description: "", target: "", start: todayISO() });

export default function ChamaProjects({ chamaId: chamaIdProp, go }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const canManage = hasRole(["treasurer", "chairperson", "admin"]);

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId || !member?.id) return;
    const { data, error: e } = await supabase.rpc("chama_project_summary", { p_chama_id: chamaId, p_requester: member.id });
    if (e) setLoadError(e.message); else { setProjects(data || []); setLoadError(null); }
    setLoading(false);
  }, [chamaId, member?.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Give the project a name.");
    setBusy(true);
    const { error: err } = await supabase.from("chama_projects").insert([{
      chama_id: chamaId, name: form.name.trim(), kind: form.kind, description: form.description.trim() || null,
      target_amount: form.target ? Number(form.target) : null, start_date: form.start || null, status: "active", created_by: member.id,
    }]);
    setBusy(false);
    if (err) return setError(err.message);
    setForm(blank()); setOpen(false); load();
  };

  const setStatus = async (p, status) => {
    const { error: err } = await supabase.from("chama_projects").update({ status }).eq("id", p.id);
    if (err) setError(err.message); else load();
  };

  if (!canManage) return <Notice tone="error" icon={AlertCircle}>Projects are managed by the treasurer and chairperson.</Notice>;
  if (loading) return <Spinner />;
  if (loadError) return <Notice tone="error" icon={AlertCircle}>{loadError}</Notice>;

  const totalInvested = projects.reduce((s, p) => s + Number(p.invested || 0), 0);

  return (
    <div className="fm-page">
      <p className="cm-hint">Chama investments and businesses. To put money into one, use Move money → To a project.</p>
      {error && <Notice tone="error" icon={AlertCircle}>{error}</Notice>}

      <Panel icon={Briefcase} title="Projects" subtitle={`${formatKES(totalInvested)} invested`} badge={projects.length || ""} tone="green" collapsible={false} right={<button className="cm-btn" onClick={() => setOpen((v) => !v)}><PlusCircle size={15} /> New project</button>}>

      {open && (
        <form className="cm-form" onSubmit={save}>
          <div className="cm-form-row">
            <label>Name<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Rental plot, Poultry unit" required /></label>
            <label>Type
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="investment">Investment</option><option value="business">Business</option>
              </select>
            </label>
          </div>
          <div className="cm-form-row">
            <label>Target amount (optional)<input type="number" min="0" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} /></label>
            <label>Start date<input type="date" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></label>
          </div>
          <label>Description (optional)<input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
          <button type="submit" className="cm-btn primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : null} Save project</button>
        </form>
      )}

      {projects.length === 0 ? <EmptyState icon={Briefcase}>No projects yet.</EmptyState> : (
        <SubCardList>
          {projects.map((p) => {
            const pct = p.target_amount ? Math.min(100, Math.round((Number(p.invested) / Number(p.target_amount)) * 100)) : null;
            return (
              <SubCard key={p.id} tone="gold" icon={Briefcase} title={p.name} value={formatKES(p.invested)}
                sub={`${KIND[p.kind] || p.kind}${p.start_date ? ` · since ${formatDate(p.start_date)}` : ""}${p.description ? ` · ${p.description}` : ""}`}>
                <StatGrid cols={3}>
                  <Stat label="Payments" value={p.payments} />
                  <Stat label="Target" value={p.target_amount ? `${formatKES(p.target_amount)} (${pct}%)` : "—"} />
                  <Stat label="Waiting" value={Number(p.pending) > 0 ? formatKES(p.pending) : "—"} tone={Number(p.pending) > 0 ? "warn" : ""} />
                </StatGrid>
                <span className="cm-sub-actions">
                  <Pill tone={STATUS_TONE[p.status]}>{STATUS[p.status] || p.status}</Pill>
                  <select value={p.status} onChange={(e) => setStatus(p, e.target.value)} aria-label="Project status">
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </span>
              </SubCard>
            );
          })}
        </SubCardList>
      )}
      </Panel>
      {go && <button className="cm-btn block" onClick={() => go("money/move")}>Move money</button>}
    </div>
  );
}
