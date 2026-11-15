import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { TrendingUp, TrendingDown, Award, AlertTriangle, Loader2, Lock, CalendarDays, AlertCircle } from "lucide-react";
import { formatKES } from "./welfareFormat";
import { Panel, SubCard, SubCardList, StatGrid, Stat } from "../shell/ui";
import "./WelfareInsightsReport.css";

// -----------------------------------------------------------------------------
// WelfareInsightsReport
// Official-facing. Ranks welfare cases/events by total raised (high vs low
// participation) and members by total welfare generosity (high vs low),
// so the committee can see where engagement is strong and where it's
// falling off. Restricted to officials — this is exactly the kind of
// comparison that would be uncomfortable if broadly visible to members.
// -----------------------------------------------------------------------------

export default function WelfareInsightsReport({ chamaId: chamaIdProp }) {
  const { chama, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const canView = hasRole(["welfare_officer", "chairperson", "treasurer", "secretary", "admin"]);

  const [cases, setCases] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    setError(null);
    const [casesRes, contribRes, eventsRes, membersRes] = await Promise.all([
      supabase.from("welfare_cases").select("*").eq("chama_id", chamaId),
      supabase.from("welfare_contributions").select("*").eq("chama_id", chamaId).eq("status", "Approved"),
      supabase.from("welfare_events").select("*").eq("chama_id", chamaId),
      // Only active members are counted so ex-members don't skew "non-contributors".
      supabase.from("chama_members").select("id,name").eq("chama_id", chamaId).eq("status", "active"),
    ]);
    const firstError = casesRes.error || contribRes.error || eventsRes.error || membersRes.error;
    if (firstError) setError(firstError.message);
    setCases(casesRes.data || []);
    setContributions(contribRes.data || []);
    setEvents(eventsRes.data || []);
    setMembers(membersRes.data || []);
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const memberName = (id) => members.find((m) => m.id === id)?.name || "Unknown member";

  const caseStats = useMemo(() => {
    return cases.map((c) => {
      const rows = contributions.filter((ct) => ct.case_id === c.id);
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      return { ...c, total, contributorCount: new Set(rows.map((r) => r.member_id)).size };
    }).sort((a, b) => b.total - a.total);
  }, [cases, contributions]);

  const highCases = caseStats.slice(0, 5);
  // Previously this excluded open cases with zero contributions, which hid the
  // most useful signal (a stalled, unfunded case) from the "lowest" panel.
  // Now every case is eligible; stalled cases naturally sort to the top.
  const lowCases = [...caseStats].sort((a, b) => a.total - b.total).slice(0, 5);

  const memberStats = useMemo(() => {
    const byMember = {};
    contributions.forEach((c) => {
      byMember[c.member_id] = (byMember[c.member_id] || 0) + Number(c.amount);
    });
    return Object.entries(byMember)
      .map(([memberId, total]) => ({ memberId, name: memberName(memberId), total }))
      .sort((a, b) => b.total - a.total);
  }, [contributions, members]);

  const highMembers = memberStats.slice(0, 5);
  const lowMembers = [...memberStats].sort((a, b) => a.total - b.total).slice(0, 5);
  const nonContributors = members.filter((m) => !memberStats.some((s) => s.memberId === m.id));

  const eventsSummary = useMemo(() => {
    const byStatus = {};
    events.forEach((e) => { byStatus[e.status] = (byStatus[e.status] || 0) + 1; });
    return byStatus;
  }, [events]);

  if (!canView) {
    return (
      <div className="wir-locked">
        <Lock size={18} />
        <p>Welfare insights are visible to the welfare officer and chama officials only.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="wir-loading"><Loader2 size={22} className="spin" /></div>;
  }

  return (
    <div className="wir-page">
      <div className="wir-header">
        <h2>Welfare Insights</h2>
        <p>Participation patterns across cases and members.</p>
      </div>

      {error && (
        <div className="wir-error"><AlertCircle size={14} /> Couldn't load some data: {error}</div>
      )}

      <Panel icon={TrendingUp} title="Welfare at a glance" tone="green" collapsible={false}>
        <StatGrid>
          <Stat label="Total raised" value={formatKES(contributions.reduce((s, c) => s + Number(c.amount), 0))} tone="gold" />
          <Stat label="Open cases" value={cases.filter((c) => c.status === "open").length} />
          <Stat label="Closed cases" value={cases.filter((c) => c.status === "closed").length} />
          <Stat label="Events planned" value={events.length} />
        </StatGrid>
      </Panel>

      <div className="cm-panels-2">
        <Panel icon={TrendingUp} title="Highest-raising cases" badge={highCases.length || ""} tone="green">
          {highCases.length === 0 ? <p className="wir-empty">No data yet.</p> : (
            <SubCardList>
              {highCases.map((c) => <SubCard key={c.id} title={c.title} sub={`${c.contributorCount} contributor${c.contributorCount === 1 ? "" : "s"}`} value={formatKES(c.total)} />)}
            </SubCardList>
          )}
        </Panel>

        <Panel icon={TrendingDown} title="Lowest-raising cases" badge={lowCases.length || ""} defaultOpen={false}>
          {lowCases.length === 0 ? <p className="wir-empty">No data yet.</p> : (
            <SubCardList>
              {lowCases.map((c) => <SubCard key={c.id} tone="gold" title={c.title} sub={`${c.contributorCount} contributor${c.contributorCount === 1 ? "" : "s"}`} value={formatKES(c.total)} />)}
            </SubCardList>
          )}
        </Panel>

        <Panel icon={Award} title="Most generous members" badge={highMembers.length || ""} tone="green" defaultOpen={false}>
          {highMembers.length === 0 ? <p className="wir-empty">No data yet.</p> : (
            <SubCardList>
              {highMembers.map((m) => <SubCard key={m.memberId} title={m.name} value={formatKES(m.total)} />)}
            </SubCardList>
          )}
        </Panel>

        <Panel icon={AlertTriangle} title="Lowest / non-contributors" defaultOpen={false}>
          <SubCardList>
            {lowMembers.map((m) => <SubCard key={m.memberId} tone="gold" title={m.name} value={formatKES(m.total)} />)}
            {nonContributors.slice(0, Math.max(0, 5 - lowMembers.length)).map((m) => <SubCard key={m.id} tone="warn" title={m.name} value="KES 0" />)}
          </SubCardList>
        </Panel>
      </div>

      <Panel icon={CalendarDays} title="Events by status" tone="green">
        <StatGrid>
          {["planned", "ongoing", "completed", "cancelled"].map((s) => (
            <Stat key={s} label={s[0].toUpperCase() + s.slice(1)} value={eventsSummary[s] || 0} />
          ))}
        </StatGrid>
      </Panel>
    </div>
  );
}
