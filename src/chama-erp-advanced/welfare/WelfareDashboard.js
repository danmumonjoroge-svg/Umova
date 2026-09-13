import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import {
  HeartHandshake, Loader2, Lock, AlertCircle, Clock3, CalendarDays,
  Wallet, Users, ArrowRight, CheckCircle2, TrendingUp,
} from "lucide-react";
import { formatKES, outstandingAmount, daysUntil } from "./welfareFormat";
import "./WelfareDashboard.css";

// -----------------------------------------------------------------------------
// WelfareDashboard
//
// This file did not exist in the delivered package even though the
// module's own README and AUDIT_AND_ROADMAP.md both describe it as built
// ("WelfareDashboard.js / .css | Create — the missing operational
// dashboard...") and list it as a Modified/Create row in the file table.
// It never actually shipped. See AUDIT_REPORT.md, Finding P1-2.
//
// This is the KPI strip, alerts, pending-action list, and upcoming-event
// progress view that was promised — built from the same tables the other
// three welfare screens already read, no schema change required. Read-only:
// every action here hands off to WelfareCaseDesk / WelfareEventPlanner via
// onNavigate(view, filter) rather than duplicating their write paths.
//
// Wire it in like this (see ChamaDashboardAdvanced.js):
//   <WelfareDashboard chamaId={chama?.id} onNavigate={(view, filter) => ...} />
// -----------------------------------------------------------------------------

const UPCOMING_WINDOW_DAYS = 14;
const STALE_CASE_DAYS = 14; // an open case with zero contributions after this long gets flagged

export default function WelfareDashboard({ chamaId: chamaIdProp, onNavigate }) {
  const { chama, member, hasRole } = useChama();
  const chamaId = chamaIdProp || chama?.id;
  const canView = hasRole(["welfare_officer", "chairperson", "treasurer", "secretary", "admin"]);

  const [cases, setCases] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [budgetLines, setBudgetLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoading(true);
    setError(null);
    const [casesRes, contribRes, eventsRes] = await Promise.all([
      supabase.from("welfare_cases").select("*").eq("chama_id", chamaId),
      supabase.from("welfare_contributions").select("*").eq("chama_id", chamaId),
      supabase.from("welfare_events").select("*").eq("chama_id", chamaId).order("event_date", { ascending: true }),
    ]);
    const firstError = casesRes.error || contribRes.error || eventsRes.error;
    if (firstError) setError(firstError.message);

    const eventRows = eventsRes.data || [];
    setCases(casesRes.data || []);
    setContributions(contribRes.data || []);
    setEvents(eventRows);

    const eventIds = eventRows.map((e) => e.id);
    if (eventIds.length > 0) {
      const [tasksRes, budgetRes] = await Promise.all([
        supabase.from("welfare_event_tasks").select("*").in("event_id", eventIds),
        // welfare_event_budget_lines only exists once welfare/migrations.sql
        // has been applied — degrade quietly (empty state) if it hasn't, so
        // this dashboard doesn't hard-fail on a chama that skipped that
        // migration.
        supabase.from("welfare_event_budget_lines").select("*").in("event_id", eventIds),
      ]);
      setTasks(tasksRes.data || []);
      setBudgetLines(budgetRes.error ? [] : (budgetRes.data || []));
    } else {
      setTasks([]);
      setBudgetLines([]);
    }
    setLoading(false);
  }, [chamaId]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const openCases = cases.filter((c) => c.status === "open");
    const pendingContribs = contributions.filter((c) => c.status === "Pending");
    const outstandingPledges = contributions.reduce((s, c) => s + outstandingAmount(c), 0);
    const raisedThisMonth = contributions
      .filter((c) => c.status === "Approved" && c.created_at && new Date(c.created_at).getMonth() === new Date().getMonth() && new Date(c.created_at).getFullYear() === new Date().getFullYear())
      .reduce((s, c) => s + Number(c.amount_received ?? c.amount ?? 0), 0);
    const upcomingEvents = events.filter((e) => {
      const d = daysUntil(e.event_date);
      return d !== null && d >= 0 && d <= UPCOMING_WINDOW_DAYS && e.status !== "cancelled" && e.status !== "completed";
    });
    return {
      openCaseCount: openCases.length,
      pendingContribCount: pendingContribs.length,
      outstandingPledges,
      raisedThisMonth,
      upcomingEventCount: upcomingEvents.length,
    };
  }, [cases, contributions, events]);

  const alerts = useMemo(() => {
    const list = [];

    // Stalled cases: open, older than STALE_CASE_DAYS, zero contributions.
    cases.forEach((c) => {
      if (c.status !== "open") return;
      const ageDays = c.opened_at ? -daysUntil(c.opened_at.slice(0, 10)) : 0;
      const hasAnyContribution = contributions.some((ct) => ct.case_id === c.id);
      if (ageDays >= STALE_CASE_DAYS && !hasAnyContribution) {
        list.push({
          tone: "warn", key: `stall-${c.id}`,
          text: `"${c.title}" has been open ${ageDays} days with no contributions yet.`,
          action: () => onNavigate?.("welfare-cases", { caseId: c.id }),
        });
      }
    });

    // Overdue pledges.
    contributions.forEach((c) => {
      const outstanding = outstandingAmount(c);
      if (outstanding > 0 && c.expected_payment_date) {
        const d = daysUntil(c.expected_payment_date);
        if (d !== null && d < 0) {
          list.push({
            tone: "bad", key: `pledge-${c.id}`,
            text: `A pledge of ${formatKES(outstanding)} is ${Math.abs(d)} day(s) overdue.`,
            action: () => onNavigate?.("welfare-cases", { caseId: c.case_id }),
          });
        }
      }
    });

    // Events approaching with incomplete tasks.
    events.forEach((e) => {
      const d = daysUntil(e.event_date);
      if (d === null || d < 0 || d > 5 || e.status === "completed" || e.status === "cancelled") return;
      const eventTasks = tasks.filter((t) => t.event_id === e.id);
      const incomplete = eventTasks.filter((t) => t.status !== "done");
      if (incomplete.length > 0) {
        list.push({
          tone: "warn", key: `event-${e.id}`,
          text: `"${e.title}" is in ${d} day(s) with ${incomplete.length} task(s) still open.`,
          action: () => onNavigate?.("welfare-events", { eventId: e.id }),
        });
      }
    });

    // Events over budget.
    events.forEach((e) => {
      const lines = budgetLines.filter((l) => l.event_id === e.id);
      const planned = lines.length > 0 ? lines.reduce((s, l) => s + Number(l.budget_amount || 0), 0) : Number(e.budget || 0);
      const actual = lines.length > 0 ? lines.reduce((s, l) => s + Number(l.actual_amount || 0), 0) : Number(e.actual_cost || 0);
      if (planned > 0 && actual > planned) {
        list.push({
          tone: "bad", key: `budget-${e.id}`,
          text: `"${e.title}" is over budget: ${formatKES(actual)} spent of ${formatKES(planned)} planned.`,
          action: () => onNavigate?.("welfare-events", { eventId: e.id }),
        });
      }
    });

    return list;
  }, [cases, contributions, events, tasks, budgetLines, onNavigate]);

  const pendingActions = useMemo(() => {
    const items = [];
    const pendingContribs = contributions.filter((c) => c.status === "Pending");
    if (pendingContribs.length > 0) {
      items.push({
        key: "pending-contribs",
        icon: Wallet,
        text: `${pendingContribs.length} contribution(s) awaiting approve/reject`,
        action: () => onNavigate?.("welfare-cases", { filter: "pending-contributions" }),
      });
    }
    const myOpenTasks = tasks.filter((t) => t.assignee_member_id === member?.id && t.status !== "done");
    if (myOpenTasks.length > 0) {
      items.push({
        key: "my-tasks",
        icon: CheckCircle2,
        text: `${myOpenTasks.length} task(s) assigned to you not yet done`,
        action: () => onNavigate?.("welfare-events", { filter: "my-tasks" }),
      });
    }
    const closingCases = cases.filter((c) => c.campaign_status === "closing");
    if (closingCases.length > 0) {
      items.push({
        key: "closing-cases",
        icon: Clock3,
        text: `${closingCases.length} case(s) in "closing" — confirm outstanding pledges before final close`,
        action: () => onNavigate?.("welfare-cases", { filter: "closing" }),
      });
    }
    return items;
  }, [contributions, tasks, cases, member?.id, onNavigate]);

  const upcomingEvents = useMemo(() => {
    return events
      .map((e) => {
        const d = daysUntil(e.event_date);
        const eventTasks = tasks.filter((t) => t.event_id === e.id);
        const completionRate = eventTasks.length ? Math.round((eventTasks.filter((t) => t.status === "done").length / eventTasks.length) * 100) : null;
        const lines = budgetLines.filter((l) => l.event_id === e.id);
        const planned = lines.length > 0 ? lines.reduce((s, l) => s + Number(l.budget_amount || 0), 0) : Number(e.budget || 0);
        const actual = lines.length > 0 ? lines.reduce((s, l) => s + Number(l.actual_amount || 0), 0) : Number(e.actual_cost || 0);
        const budgetRate = planned > 0 ? Math.round((actual / planned) * 100) : null;
        return { ...e, daysAway: d, completionRate, budgetRate };
      })
      .filter((e) => e.daysAway !== null && e.daysAway >= 0 && e.status !== "cancelled" && e.status !== "completed")
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 6);
  }, [events, tasks, budgetLines]);

  if (!canView) {
    return (
      <div className="wfd-locked">
        <Lock size={18} />
        <p>The welfare dashboard is visible to the welfare officer and chama officials only.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="wfd-loading"><Loader2 size={22} className="spin" /></div>;
  }

  const cards = [
    { label: "Open cases", value: kpis.openCaseCount, icon: HeartHandshake, tone: "brand" },
    { label: "Awaiting approval", value: kpis.pendingContribCount, icon: Wallet, tone: kpis.pendingContribCount > 0 ? "warn" : "brand" },
    { label: "Outstanding pledges", value: formatKES(kpis.outstandingPledges), icon: Clock3, tone: kpis.outstandingPledges > 0 ? "gold" : "brand" },
    { label: "Raised this month", value: formatKES(kpis.raisedThisMonth), icon: TrendingUp, tone: "brand" },
    { label: "Events in next 14 days", value: kpis.upcomingEventCount, icon: CalendarDays, tone: "brand" },
  ];

  return (
    <div className="wfd-page">
      <div className="wfd-header">
        <span className="wfd-icon"><HeartHandshake size={18} /></span>
        <div>
          <h2>Welfare Dashboard</h2>
          <p>Cases, pledges, and events at a glance.</p>
        </div>
      </div>

      {error && <div className="wfd-error"><AlertCircle size={14} /> Couldn't load some data: {error}</div>}

      <div className="wfd-kpi-grid">
        {cards.map((c) => (
          <div className={`wfd-kpi-card ${c.tone}`} key={c.label}>
            <span className="wfd-kpi-icon"><c.icon size={16} /></span>
            <div>
              <p className="wfd-kpi-label">{c.label}</p>
              <p className="wfd-kpi-value">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="wfd-columns">
        <section className="wfd-panel">
          <h3><AlertCircle size={15} /> Alerts {alerts.length > 0 && <span className="wfd-count">{alerts.length}</span>}</h3>
          {alerts.length === 0 ? (
            <p className="wfd-empty">Nothing needs attention right now.</p>
          ) : (
            <ul className="wfd-alert-list">
              {alerts.map((a) => (
                <li key={a.key} className={`wfd-alert ${a.tone}`} onClick={a.action} role={a.action ? "button" : undefined}>
                  <span>{a.text}</span>
                  {a.action && <ArrowRight size={13} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wfd-panel">
          <h3><CheckCircle2 size={15} /> Pending actions</h3>
          {pendingActions.length === 0 ? (
            <p className="wfd-empty">Nothing waiting on you.</p>
          ) : (
            <ul className="wfd-action-list">
              {pendingActions.map((a) => (
                <li key={a.key} onClick={a.action} role={a.action ? "button" : undefined}>
                  <a.icon size={14} />
                  <span>{a.text}</span>
                  <ArrowRight size={13} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="wfd-panel wfd-events-panel">
        <h3><CalendarDays size={15} /> Upcoming events</h3>
        {upcomingEvents.length === 0 ? (
          <p className="wfd-empty">No events in the next {UPCOMING_WINDOW_DAYS} days.</p>
        ) : (
          <div className="wfd-event-grid">
            {upcomingEvents.map((e) => (
              <div className="wfd-event-card" key={e.id} onClick={() => onNavigate?.("welfare-events", { eventId: e.id })}>
                <div className="wfd-event-top">
                  <strong>{e.title}</strong>
                  <span className="wfd-event-days">{e.daysAway === 0 ? "Today" : `${e.daysAway}d`}</span>
                </div>
                <div className="wfd-event-bars">
                  <div className="wfd-event-bar-row">
                    <span>Tasks</span>
                    <div className="wfd-bar"><div className="wfd-bar-fill tasks" style={{ width: `${e.completionRate ?? 0}%` }} /></div>
                    <small>{e.completionRate === null ? "—" : `${e.completionRate}%`}</small>
                  </div>
                  <div className="wfd-event-bar-row">
                    <span>Budget</span>
                    <div className="wfd-bar"><div className={`wfd-bar-fill budget ${e.budgetRate > 100 ? "over" : ""}`} style={{ width: `${Math.min(e.budgetRate ?? 0, 100)}%` }} /></div>
                    <small>{e.budgetRate === null ? "—" : `${e.budgetRate}%`}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="wfd-fund-note">
        <Users size={13} /> Welfare fund balance is intentionally not shown here — it would need to net
        against your real cashbook to be trustworthy. See AUDIT_REPORT.md, Finance integration.
      </p>
    </div>
  );
}
