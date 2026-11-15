import React, { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate, todayISO } from "../shell/format";
import { toCSV } from "../welfare/welfareFormat";
import { Spinner, StaleNote, Notice, EmptyState, Panel, Stat, StatGrid, SubCard, SubCardList } from "../shell/ui";
import { Printer, Share2, Download, AlertCircle, LayoutDashboard, Wallet, Users, HandCoins, Gavel, HeartHandshake } from "lucide-react";
import "./GroupReport.css";

// -----------------------------------------------------------------------------
// GroupReport — the Chama's group statement, for officials.
// Read-only. Everything comes from one database call, chama_group_report(),
// which sums the ledger, member balances and loan book on the server (so big
// Chamas are not cut off by row limits). Nothing here writes.
// -----------------------------------------------------------------------------

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODS = [
  { key: "month", label: "This month", from: () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); } },
  { key: "3m", label: "Last 3 months", from: () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() - 2, 1)); } },
  { key: "year", label: "This year", from: () => `${new Date().getFullYear()}-01-01` },
  { key: "all", label: "All time", from: () => null },
];
const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "savings", label: "Savings" },
  { key: "loans", label: "Loan book" },
  { key: "fines", label: "Fines" },
  { key: "welfare", label: "Welfare" },
];
const ACCOUNT_LABEL = { savings: "Savings", shares: "Shares", welfare: "Welfare", fine: "Fines", loan_repayment: "Loan repayments", loan_disbursement: "Loans paid out" };
const ACCOUNT_ORDER = ["savings", "shares", "welfare", "fine", "loan_repayment", "loan_disbursement"];
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

export default function GroupReport() {
  const { chama, member, hasRole } = useChama();
  const allowed = hasRole(["secretary", "treasurer"]);
  const [period, setPeriod] = useState("3m");
  const [section, setSection] = useState("overview");
  const p = PERIODS.find((x) => x.key === period);
  const from = p.from();
  const to = todayISO();

  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && member?.id && allowed ? `grp:${chama.id}:${period}` : null,
    async () => {
      const { data: d, error: e } = await supabase.rpc("chama_group_report", { p_chama_id: chama.id, p_requester: member.id, p_from: from, p_to: to });
      if (e) throw new Error(e.message);
      return d;
    },
    !!(chama?.id && member?.id && allowed)
  );

  const v = useMemo(() => {
    if (!data) return null;
    const members = (data.members || []).filter((m) => (m.status || "active") === "active");
    const accounts = ACCOUNT_ORDER.map((k) => (data.accounts || []).find((a) => a.account === k) || { account: k, opening: 0, paid_in: 0, paid_out: 0, closing: 0 });
    const loans = data.loans || [];
    const active = loans.filter((l) => l.status === "active");
    const totals = { savings: sum(members, "savings"), shares: sum(members, "shares"), welfare: sum(members, "welfare"), owed: sum(members, "loan_owed"), fines: sum(members, "fines_paid") };
    // Records vs balances on file: say so rather than quietly choosing one.
    const mismatch = ["savings", "shares", "welfare"].filter((k) => Math.abs(Number(accounts.find((a) => a.account === k)?.closing || 0) - totals[k]) > 0.5)
      .map((k) => `${ACCOUNT_LABEL[k]}: records ${formatKES(accounts.find((a) => a.account === k).closing)}, member balances ${formatKES(totals[k])}`);
    return { members, accounts, loans, active, totals, mismatch, finers: members.filter((m) => Number(m.fines_paid) > 0).sort((a, b) => b.fines_paid - a.fines_paid) };
  }, [data]);

  if (!allowed) return <Notice tone="error" icon={AlertCircle}>The group report is for Chama officials.</Notice>;
  if (loading && !data) return <Spinner label="Preparing the report…" />;
  if (!data || !v) return <Notice tone="error" icon={AlertCircle}>Could not load the report{error ? `: ${error}` : ""}.{" "}{String(error || "").includes("does not exist") ? "The report has not been set up in the database yet (run sql/009)." : ""}</Notice>;

  const periodLabel = from ? `${formatDate(from)} – ${formatDate(to)}` : `Up to ${formatDate(to)}`;
  const acc = (k) => v.accounts.find((a) => a.account === k);

  const share = async () => {
    const text = `${chama?.name} — group summary (${periodLabel})\nSavings: ${formatKES(v.totals.savings)}\nShares: ${formatKES(v.totals.shares)}\nWelfare fund: ${formatKES(v.totals.welfare)}\nLoans outstanding: ${formatKES(v.totals.owed)} (${v.active.length} active)\nFines collected: ${formatKES(acc("fine").paid_in)}\nMembers: ${v.members.length}`;
    if (navigator.share) { try { await navigator.share({ title: "Group summary", text }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const download = () => {
    const parts = [
      ["GROUP STATEMENT", toCSV(v.accounts.map((a) => ({ Account: ACCOUNT_LABEL[a.account], Opening: a.opening, "Paid in": a.paid_in, "Paid out": a.paid_out, Closing: a.closing })))],
      ["MEMBERS", toCSV(v.members.map((m) => ({ Member: m.name, Phone: m.phone || "", Savings: m.savings, Shares: m.shares, Welfare: m.welfare, "Loan owed": m.loan_owed, "Fines paid (period)": m.fines_paid, "Paid in (period)": m.paid_in_period })))],
      ["LOAN BOOK", toCSV(v.loans.map((l) => ({ Member: l.member, "Paid out on": l.disbursed_on || "", Amount: l.amount, Repaid: l.repaid, Balance: l.balance, Status: l.status })))],
    ];
    const csv = parts.filter(([, body]) => body).map(([title, body]) => `${chama?.name} — ${title} (${periodLabel})\n${body}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `group-report-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const show = (k) => (section === k ? "grp-sec on" : "grp-sec");

  return (
    <div className="cm-print-area grp">
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      <div className="cm-print-only"><h2>{chama?.name} — Group report</h2><p>{periodLabel} · printed {formatDate(new Date())}</p></div>

      <div className="cm-toolbar cm-no-print">
        <div className="cm-chips">{PERIODS.map((x) => <button key={x.key} className={`cm-chip ${period === x.key ? "on" : ""}`} onClick={() => setPeriod(x.key)}>{x.label}</button>)}</div>
        <div className="cm-chips">{SECTIONS.map((x) => <button key={x.key} className={`cm-chip ${section === x.key ? "on" : ""}`} onClick={() => setSection(x.key)}>{x.label}</button>)}</div>
      </div>

      {v.mismatch.length > 0 && (
        <Notice tone="warn" icon={AlertCircle}>Records and member balances do not agree — {v.mismatch.join("; ")}. The report shows both as they are; please look into the difference.</Notice>
      )}

      {/* ---------- Overview ---------- */}
      <section className={show("overview")}>
        <h3 className="grp-print-title">Overview</h3>
        <Panel icon={LayoutDashboard} title="The Chama at a glance" subtitle={periodLabel} tone="green">
          <StatGrid>
            <Stat label="Members" value={v.members.length} />
            <Stat label="Total savings" value={formatKES(v.totals.savings)} />
            <Stat label="Total shares" value={formatKES(v.totals.shares)} />
            <Stat label="Welfare fund" value={formatKES(v.totals.welfare)} />
            <Stat label="Loans outstanding" value={formatKES(v.totals.owed)} tone="gold" />
            <Stat label="Active loans" value={v.active.length} />
            <Stat label="Fines collected" value={formatKES(acc("fine").paid_in)} />
            <Stat label="Waiting to be checked" value={data.awaiting_check} tone={data.awaiting_check > 0 ? "warn" : ""} />
          </StatGrid>
        </Panel>

        <Panel icon={Wallet} title="Group statement" subtitle={periodLabel}>
          <div className="cm-accs">
            {v.accounts.filter((a) => a.opening || a.paid_in || a.paid_out || a.closing).map((a) => (
              <div className="cm-acc" key={a.account}>
                <div className="cm-acc-head"><span>{ACCOUNT_LABEL[a.account]}</span><strong>{formatKES(a.closing)}</strong></div>
                <div className="cm-acc-row">
                  <div><span>Opening</span><b>{formatKES(a.opening)}</b></div>
                  <div><span>Paid in</span><b>{formatKES(a.paid_in)}</b></div>
                  <div><span>Paid out</span><b>{formatKES(a.paid_out)}</b></div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      {/* ---------- Savings ---------- */}
      <section className={show("savings")}>
        <h3 className="grp-print-title">Savings, shares and welfare by member</h3>
        <Panel icon={Users} title="Members" subtitle={`Savings, shares and welfare · paid in (${period === "all" ? "total" : "period"})`} badge={v.members.length || ""}>
          {v.members.length === 0 ? <EmptyState>No members yet.</EmptyState> : (
            <SubCardList>
              <SubCard tone="gold" title="Everyone together" value={formatKES(v.totals.savings)} sub="total savings">
                <StatGrid cols={3}>
                  <Stat label="Shares" value={formatKES(v.totals.shares)} />
                  <Stat label="Welfare" value={formatKES(v.totals.welfare)} />
                  <Stat label="Paid in" value={formatKES(sum(v.members, "paid_in_period"))} />
                </StatGrid>
              </SubCard>
              {v.members.map((m) => (
                <SubCard key={m.id} title={m.name} value={formatKES(m.savings)} sub="savings">
                  <StatGrid cols={3}>
                    <Stat label="Shares" value={formatKES(m.shares)} />
                    <Stat label="Welfare" value={formatKES(m.welfare)} />
                    <Stat label="Paid in" value={formatKES(m.paid_in_period)} />
                  </StatGrid>
                </SubCard>
              ))}
            </SubCardList>
          )}
        </Panel>
      </section>

      {/* ---------- Loan book ---------- */}
      <section className={show("loans")}>
        <h3 className="grp-print-title">Loan book</h3>
        <Panel icon={HandCoins} title="Loan book" subtitle={periodLabel} tone="green">
          <StatGrid>
            <Stat label="Paid out (all loans)" value={formatKES(sum(v.loans, "amount"))} />
            <Stat label="Repaid so far" value={formatKES(sum(v.loans, "repaid"))} />
            <Stat label="Still owed" value={formatKES(v.totals.owed)} tone="gold" />
            <Stat label="Repaid this period" value={formatKES(data.loan_repaid_in_period)} />
          </StatGrid>
          {(data.loans_waiting_payout > 0 || data.loan_applications_open > 0) && (
            <p className="cm-hint">{data.loan_applications_open} application(s) awaiting a decision · {data.loans_waiting_payout} approved loan(s) waiting to be paid out.</p>
          )}
        </Panel>
        <Panel icon={Users} title="Loans by member" badge={v.loans.length || ""}>
          {v.loans.length === 0 ? <EmptyState>No loans paid out yet.</EmptyState> : (
            <SubCardList>
              {v.loans.map((l) => (
                <SubCard key={l.id} tone={l.status === "active" ? "gold" : "ok"} title={l.member} sub={`Paid out ${formatDate(l.disbursed_on)}`} value={formatKES(l.balance)}>
                  <StatGrid cols={3}>
                    <Stat label="Loan" value={formatKES(l.amount)} />
                    <Stat label="Repaid" value={formatKES(l.repaid)} />
                    <Stat label="Status" value={l.status === "active" ? "Active" : l.status === "closed" ? "Cleared" : l.status} />
                  </StatGrid>
                </SubCard>
              ))}
            </SubCardList>
          )}
        </Panel>
      </section>

      {/* ---------- Fines ---------- */}
      <section className={show("fines")}>
        <h3 className="grp-print-title">Fines</h3>
        <Panel icon={Gavel} title="Fines" subtitle={periodLabel} tone="green">
          <StatGrid cols={2}>
            <Stat label="Fines collected" value={formatKES(acc("fine").paid_in)} />
            <Stat label="Members fined" value={v.finers.length} />
          </StatGrid>
        </Panel>
        <Panel icon={Users} title="Who paid fines" badge={v.finers.length || ""} defaultOpen={v.finers.length > 0}>
          {v.finers.length === 0 ? <EmptyState>No fines collected in this period.</EmptyState> : (
            <SubCardList>
              {v.finers.map((m) => <SubCard key={m.id} title={m.name} value={<span className="in">{formatKES(m.fines_paid)}</span>} />)}
            </SubCardList>
          )}
        </Panel>
      </section>

      {/* ---------- Welfare ---------- */}
      <section className={show("welfare")}>
        <h3 className="grp-print-title">Welfare</h3>
        <Panel icon={HeartHandshake} title="Welfare" subtitle={periodLabel} tone="green">
          <StatGrid>
            <Stat label="Welfare fund (balances)" value={formatKES(v.totals.welfare)} />
            <Stat label="Paid in" value={formatKES(acc("welfare").paid_in)} />
            <Stat label="Open cases" value={data.welfare?.cases_open ?? 0} />
            <Stat label="Closed cases" value={data.welfare?.cases_closed ?? 0} />
            <Stat label="Given to cases" value={formatKES(data.welfare?.case_contributions_in_period)} />
          </StatGrid>
        </Panel>
      </section>

      <div className="cm-actions-row cm-no-print">
        <button className="cm-btn" onClick={() => window.print()}><Printer size={15} /> Print / save as PDF</button>
        <button className="cm-btn" onClick={share}><Share2 size={15} /> Share summary</button>
        <button className="cm-btn" onClick={download}><Download size={15} /> Download (Excel)</button>
      </div>
    </div>
  );
}
