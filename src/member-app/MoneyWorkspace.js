import React, { useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Card, PageHeader, TxRow, BalanceTrend, kes } from "./ui";

export default function MoneyWorkspace() {
  const { ledger, ledgerLoading, ledgerMetrics } = useOutletContext();
  const l = (v) => (ledgerLoading ? "…" : v);
  const all = useMemo(() => [
    ...ledger.savings.transactions.map((t) => ({ ...t, _l: "Savings" })),
    ...ledger.shares.transactions.map((t) => ({ ...t, _l: "Shares" })),
    ...ledger.loans.transactions.map((t) => ({ ...t, _l: "Loan" })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)), [ledger]);

  return (
    <>
      <PageHeader title="My Money" description="Your savings, shares and contributions in one place." />
      <div className="uma-grid c2">
        <Card tone="green" title="My Savings" amount={l(kes(ledgerMetrics.savings))} to="/member/savings" cta="Open savings">
          <BalanceTrend transactions={ledger.savings.transactions} />
        </Card>
        <Card title="My Shares" amount={l(kes(ledgerMetrics.shares))} note="Share capital you hold" to="/member/shares" cta="Open shares" />
        <Card title="My Contributions" amount={l(kes(ledger.totalDeposits))}
          note={`Total deposited to date · ${ledger.savings.transactions.filter((t) => t.direction === "in").length} deposits`}
          to="/member/savings" cta="See deposits" />
        <Card title="My Transactions" note={all.length ? `${all.length} on record` : "No transactions yet"}>
          {all.slice(0, 3).map((t, i) => <TxRow key={t.id || i} tx={t} label={t._l} />)}
        </Card>
      </div>
      <section className="uma-card" style={{ marginTop: 12 }}>
        <h3>All transactions</h3>
        {all.length === 0 ? <p className="uma-empty">Nothing here yet.</p>
          : all.slice(0, 50).map((t, i) => <TxRow key={t.id || i} tx={t} label={t._l} />)}
        <div className="uma-actions"><Link className="uma-btn uma-btn--ghost" to="/member/statements">Get a statement</Link></div>
      </section>
    </>
  );
}
