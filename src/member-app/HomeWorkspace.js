import React, { useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Landmark, FileText, Wallet } from "lucide-react";
import { Card, PageHeader, TxRow, kes } from "./ui";

function AttentionCard({ items }) {
  return (
    <Card title="Needs your attention">
      {items.length === 0
        ? <p className="uma-empty">Nothing needs your attention right now.</p>
        : items.map((it) => (
            <div className="uma-row" key={it.text}>
              <span>{it.text}</span>
              {it.to && <Link className="uma-btn uma-btn--ghost" to={it.to}>{it.cta}</Link>}
            </div>
          ))}
    </Card>
  );
}

export function QuickActions() {
  const tiles = [
    { to: "/member/loans/manage?action=apply", label: "Apply for Loan", icon: Landmark },
    { to: "/member/statements", label: "View Statement", icon: FileText },
    { to: "/member/savings", label: "View Savings", icon: Wallet },
  ];
  return (
    <div className="uma-grid c3" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
      {tiles.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className="uma-tile"><Icon size={20} color="#C6A15B" />{label}</Link>
      ))}
    </div>
  );
}

export function RecentActivity({ ledger, limit = 6 }) {
  const rows = useMemo(() => [
    ...ledger.savings.transactions.map((t) => ({ ...t, _l: "Savings" })),
    ...ledger.shares.transactions.map((t) => ({ ...t, _l: "Shares" })),
    ...ledger.loans.transactions.map((t) => ({ ...t, _l: "Loan" })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit), [ledger, limit]);
  return (
    <Card title="Recent activity">
      {rows.length === 0 ? <p className="uma-empty">No transactions yet.</p>
        : rows.map((t, i) => <TxRow key={t.id || i} tx={t} label={t._l} />)}
      <div className="uma-actions"><Link className="uma-btn uma-btn--ghost" to="/member/money">See all</Link></div>
    </Card>
  );
}

export default function HomeWorkspace() {
  const { profile, member, ledger, ledgerLoading, ledgerError, ledgerMetrics, unreadNotifications } = useOutletContext();
  const first = (profile?.name || "Member").split(" ")[0];

  const attention = useMemo(() => {
    const a = [];
    const kyc = String(member?.kyc_status || "").toUpperCase();
    if (member && kyc !== "VERIFIED") a.push({ text: "Your identity verification is not complete", to: "/member/profile", cta: "Review" });
    if (unreadNotifications > 0) a.push({ text: `${unreadNotifications} new notification${unreadNotifications > 1 ? "s" : ""}`, to: "/member/notifications", cta: "Open" });
    if (ledgerMetrics.loans > 0) a.push({ text: `You have an outstanding loan of ${kes(ledgerMetrics.loans)}`, to: "/member/loans", cta: "View loan" });
    return a;
  }, [member, unreadNotifications, ledgerMetrics.loans]);

  return (
    <>
      <PageHeader title={`Hello, ${first}`} description={`Umova SACCO · Member ${profile?.member_no || ""}`} />
      {ledgerError && <Card title="We couldn't load your balances"><p className="uma-empty">Please pull to refresh or try again shortly.</p></Card>}
      <div className="uma-grid c3">
        <Card tone="green" title="My Savings" amount={ledgerLoading ? "…" : kes(ledgerMetrics.savings)} to="/member/savings" cta="View savings" />
        <Card title="My Loan" amount={ledgerLoading ? "…" : kes(ledgerMetrics.loans)}
          note={!ledgerLoading && ledgerMetrics.loans === 0 ? "No outstanding loan" : "Outstanding balance"} to="/member/loans" cta="View loans" />
        <Card title="My Shares" amount={ledgerLoading ? "…" : kes(ledgerMetrics.shares)} to="/member/shares" cta="View shares" />
      </div>
      <div className="uma-grid c2" style={{ marginTop: 12 }}>
        <AttentionCard items={attention} />
        <div><QuickActions /></div>
      </div>
      <div style={{ marginTop: 12 }}><RecentActivity ledger={ledger} /></div>
    </>
  );
}
