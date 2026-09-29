import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import {
  PiggyBank, HandCoins, HeartHandshake, Send, FileText, CalendarDays, Megaphone, AlertCircle,
  Users, ScanSearch, Landmark, CheckCircle2, Clock, Building2, Wallet, TrendingUp, PlusCircle,
} from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { useCapabilities, loadWork } from "../shell/work";
import { formatKES, formatDate, firstName, monthStartISO, todayISO, roleLabel } from "../shell/format";
import { ActionCard, CardGrid, SectionTitle, StaleNote, Spinner, Pill, Notice } from "../shell/ui";

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// Everything Home needs in one round of parallel reads. Counts for officials
// are only requested when hasRole() says the person could act on them — this
// is about not fetching pointless data; the database, not this check, is what
// must ultimately refuse a request from someone without the role.
async function loadHome({ chamaId, memberId, can }) {
  const monthStart = monthStartISO();
  const today = todayISO();

  const [me, loans, contribs, apps, events] = await Promise.all([
    supabase.from("chama_members").select("id,name,role,status,savings_balance,shares_balance,welfare_balance").eq("id", memberId).single().then(must),
    supabase.from("chama_loans").select("id,amount,balance,status,disbursed").eq("chama_id", chamaId).eq("member_id", memberId).then(must),
    supabase.from("chama_contribution_requests").select("id,amount,status,contribution_type,contributed_on").eq("chama_id", chamaId).eq("member_id", memberId).gte("contributed_on", monthStart).then(must),
    supabase.from("chama_loan_applications").select("id,status,requested_amount").eq("chama_id", chamaId).eq("member_id", memberId).in("status", ["Pending", "Awaiting Approval"]).then(must),
    supabase.from("welfare_events").select("id,title,event_date,location,status").eq("chama_id", chamaId).gte("event_date", today).in("status", ["planned", "ongoing"]).order("event_date", { ascending: true }).limit(3).then(must),
  ]);

  // Announcements come from an optional table (sql/007). If it isn't installed
  // yet, Home simply has no announcements — it must not fail to load.
  let announcements = [];
  try {
    const { data, error } = await supabase.from("chama_announcements").select("id,title,body,kind,event_date,pinned,created_at,expires_on")
      .eq("chama_id", chamaId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(10);
    if (!error) announcements = (data || []).filter((a) => !a.expires_on || a.expires_on >= today);
  } catch { /* table not installed */ }

  const work = await loadWork(chamaId, can);

  return { me, loans, contribs, apps, events, announcements, work };
}

const KIND_ICON = { meeting: CalendarDays, reminder: Clock, welfare: HeartHandshake, notice: Megaphone };

export default function HomeWorkspace({ go }) {
  const { chama, member } = useChama();

  const can = useCapabilities();

  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && member?.id ? `home:${chama.id}:${member.id}` : null,
    () => loadHome({ chamaId: chama.id, memberId: member.id, can }),
    !!(chama?.id && member?.id)
  );

  if (loading && !data) return <Spinner />;
  if (!data) return <Notice tone="error" icon={AlertCircle}>Could not load your home screen{error ? `: ${error}` : ""}. Check your connection and try again.</Notice>;

  const { me, loans, contribs, apps, events, announcements, work } = data;

  const activeLoans = loans.filter((l) => l.disbursed && l.status === "active");
  const loanOwed = activeLoans.reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0);
  const loanWaiting = loans.filter((l) => !l.disbursed && l.status === "active");

  // Contribution status for THIS month. There is no per-member monthly target
  // stored anywhere, so this reports what happened, never "X of Y due".
  const confirmed = contribs.filter((c) => c.status === "APPROVED" && c.contribution_type !== "loan_repayment").reduce((s, c) => s + Number(c.amount || 0), 0);
  const awaiting = contribs.filter((c) => ["PENDING", "VERIFIED"].includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const rejected = contribs.filter((c) => c.status === "REJECTED");
  const monthName = new Date().toLocaleString(undefined, { month: "long" });

  const attention = [];
  rejected.forEach((c) => attention.push({ key: `rej-${c.id}`, tone: "error", text: `Your ${formatKES(c.amount)} contribution of ${formatDate(c.contributed_on)} was not accepted. Check the details and send it again.`, route: "money/contribute", cta: "Contribute" }));
  if (apps.length) attention.push({ key: "apps", tone: "info", text: `Your loan application${apps.length > 1 ? "s are" : " is"} waiting for approval.`, route: "loans/applications", cta: "View" });
  if (loanWaiting.length) attention.push({ key: "wait", tone: "info", text: "Your loan is approved and waiting for the treasurer to pay it out.", route: "loans/mine", cta: "View" });
  if (work.contribsToCheck) attention.push({ key: "chk", tone: "warn", text: `${work.contribsToCheck} contribution${work.contribsToCheck > 1 ? "s" : ""} waiting for you to check.`, route: "money/reconciliation", cta: "Check now" });
  if (work.toDisburse) attention.push({ key: "dis", tone: "warn", text: `${work.toDisburse} approved loan${work.toDisburse > 1 ? "s" : ""} waiting to be paid out.`, route: "loans/disbursement", cta: "Pay out" });
  if (work.loanApps) attention.push({ key: "la", tone: "warn", text: `${work.loanApps} loan application${work.loanApps > 1 ? "s" : ""} need${work.loanApps > 1 ? "" : "s"} a decision.`, route: "loans/approvals", cta: "Review" });
  if (work.pendingMembers) attention.push({ key: "pm", tone: "warn", text: `${work.pendingMembers} new member${work.pendingMembers > 1 ? "s" : ""} waiting to be approved.`, route: "members?status=pending", cta: "Review" });
  if (work.openCases) attention.push({ key: "wc", tone: "info", text: `${work.openCases} welfare case${work.openCases > 1 ? "s" : ""} open.`, route: "welfare/cases", cta: "Open" });

  // Next thing happening: welfare events and dated announcements, soonest first.
  const upcoming = [
    ...events.map((e) => ({ key: `e${e.id}`, title: e.title, date: e.event_date, place: e.location, kind: "welfare" })),
    ...announcements.filter((a) => a.event_date && a.event_date >= todayISO()).map((a) => ({ key: `a${a.id}`, title: a.title, date: a.event_date, kind: a.kind || "meeting" })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const next = upcoming[0];

  // Role-specific shortcuts — capability checks via hasRole, no separate role system.
  const desk = [];
  if (can.reconcile) desk.push({ icon: ScanSearch, title: "Check contributions", value: work.contribsToCheck ?? 0, sub: "waiting", route: "money/reconciliation", action: "Open" });
  if (can.disburse) desk.push({ icon: Landmark, title: "Loan payouts", value: work.toDisburse ?? 0, sub: "to pay out", route: "loans/disbursement", action: "Open" });
  if (can.reconcile) desk.push({ icon: HandCoins, title: "Loan collections", sub: "Record repayments", route: "loans/repayments", action: "Open" });
  if (can.accounts) desk.push({ icon: Building2, title: "Chama accounts", sub: "Where money is kept", route: "money/accounts", action: "Open" });
  if (can.accounts) desk.push({ icon: TrendingUp, title: "Chama finances", sub: "Totals across the chama", route: "money/finances", action: "View" });
  if (can.members) desk.push({ icon: Users, title: "Members", value: work.pendingMembers ?? 0, sub: "pending approval", route: "members?status=pending", action: "Open" });
  if (can.approveLoans) desk.push({ icon: CheckCircle2, title: "Loan approvals", value: work.loanApps ?? 0, sub: "need a decision", route: "loans/approvals", action: "Open" });
  if (can.post) desk.push({ icon: PlusCircle, title: "Post an update", sub: "Meetings & notices", route: "more/updates", action: "Write" });
  if (can.welfare) desk.push({ icon: HeartHandshake, title: "Welfare cases", value: work.openCases ?? 0, sub: "open", route: "welfare/cases", action: "Open" });

  return (
    <div className="cm-home">
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />

      <section className="cm-hero">
        <div className="cm-hero-top">
          <div>
            <p className="cm-hero-hello">Hello, {firstName(me.name || member?.name)}</p>
            <p className="cm-hero-chama">{chama?.name}</p>
          </div>
          <Pill tone="gold">{roleLabel(me.role || member?.role)}</Pill>
        </div>
        <p className="cm-hero-label">My savings</p>
        <p className="cm-hero-amount">{formatKES(me.savings_balance)}</p>
        <div className="cm-hero-row">
          <div><span>Shares</span><strong>{formatKES(me.shares_balance)}</strong></div>
          <div><span>Welfare</span><strong>{formatKES(me.welfare_balance)}</strong></div>
          <div><span>Loan owed</span><strong>{loanOwed > 0 ? formatKES(loanOwed) : "None"}</strong></div>
        </div>
      </section>

      <div className={`cm-status ${confirmed > 0 ? "ok" : awaiting > 0 ? "wait" : "none"}`}>
        {confirmed > 0 ? <CheckCircle2 size={18} /> : awaiting > 0 ? <Clock size={18} /> : <AlertCircle size={18} />}
        <div>
          <strong>{monthName} contributions</strong>
          <span>
            {confirmed > 0 && `${formatKES(confirmed)} confirmed`}
            {confirmed > 0 && awaiting > 0 && " · "}
            {awaiting > 0 && `${formatKES(awaiting)} waiting for the treasurer to check`}
            {confirmed === 0 && awaiting === 0 && "Nothing recorded yet this month"}
          </span>
        </div>
      </div>

      <div className="cm-quick">
        <button onClick={() => go("money/contribute")}><Send size={20} /><span>Contribute</span></button>
        <button onClick={() => go("loans/apply")}><Wallet size={20} /><span>Apply for loan</span></button>
        {loanOwed > 0 && <button onClick={() => go("money/repay")}><HandCoins size={20} /><span>Repay loan</span></button>}
        <button onClick={() => go("money/statement")}><FileText size={20} /><span>My statement</span></button>
      </div>

      {attention.length > 0 && (
        <>
          <SectionTitle>Needs your attention</SectionTitle>
          <div className="cm-attn">
            {attention.map((a) => (
              <button key={a.key} className={`cm-attn-item ${a.tone}`} onClick={() => go(a.route)}>
                <span>{a.text}</span><em>{a.cta} →</em>
              </button>
            ))}
          </div>
        </>
      )}

      {desk.length > 0 && (
        <>
          <SectionTitle>For your role</SectionTitle>
          <CardGrid>
            {desk.map((d) => <ActionCard key={d.title} icon={d.icon} title={d.title} value={d.value} sub={d.sub} action={d.action} onClick={() => go(d.route)} />)}
          </CardGrid>
        </>
      )}
      <CardGrid>
        <ActionCard icon={PiggyBank} title="My savings" value={formatKES(me.savings_balance)} action="View savings" onClick={() => go("money/statement?account=savings")} />
        <ActionCard icon={HandCoins} title="Loan" value={loanOwed > 0 ? `${formatKES(loanOwed)} owed` : "No active loan"} action={loanOwed > 0 ? "Repay" : "Apply"} tone={loanOwed > 0 ? "gold" : ""} onClick={() => go(loanOwed > 0 ? "money/repay" : "loans/apply")} />
        {next && <ActionCard icon={KIND_ICON[next.kind] || CalendarDays} title="Coming up" value={next.title} sub={`${formatDate(next.date, { weekday: "short", day: "numeric", month: "short" })}${next.place ? ` · ${next.place}` : ""}`} action="See updates" onClick={() => go("more/updates")} />}
      </CardGrid>

      {announcements.length > 0 && (
        <>
          <SectionTitle right={<button className="cm-link" onClick={() => go("more/updates")}>See all</button>}>Chama updates</SectionTitle>
          <div className="cm-list">
            {announcements.slice(0, 2).map((a) => {
              const I = KIND_ICON[a.kind] || Megaphone;
              return (
                <button key={a.id} className="cm-list-item" onClick={() => go("more/updates")}>
                  <span className="cm-list-icon"><I size={16} /></span>
                  <span><strong>{a.title}</strong><small>{formatDate(a.created_at)}</small></span>
                </button>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}
