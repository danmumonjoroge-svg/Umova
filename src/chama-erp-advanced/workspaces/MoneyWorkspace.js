import React from "react";
import { PiggyBank, TrendingUp, HeartHandshake, Send, FileText, HandCoins, ScanSearch, Building2, Wallet, BarChart3, UserCheck, ClipboardList, ArrowLeftRight, Briefcase } from "lucide-react";
import { formatKES } from "../shell/format";
import { useCapabilities, useMine, useWork } from "../shell/work";
import { ActionCard, CardGrid, SectionTitle, WorkspaceHeader, StaleNote } from "../shell/ui";

// Money workspace — "What can I do with money here?"
// Members get their own money; officials additionally get the Chama's.
// Accounting vocabulary (ledger, debit, credit, posting) stays out of it.
export default function MoneyWorkspace({ go }) {
  const can = useCapabilities();
  const mine = useMine();
  const { work } = useWork();
  const me = mine.data?.me;
  const owed = mine.data?.owed || 0;
  const officialMoney = can.reconcile || can.accounts || can.reports;

  const memberSection = (
    <React.Fragment key="m">
      <SectionTitle>My money</SectionTitle>
      <CardGrid>
        <ActionCard icon={PiggyBank} title="My savings" value={me ? formatKES(me.savings_balance) : "…"} action="View savings" onClick={() => go("money/statement?account=savings")} />
        <ActionCard icon={TrendingUp} title="My shares" value={me ? formatKES(me.shares_balance) : "…"} action="View shares" onClick={() => go("money/statement?account=shares")} />
        <ActionCard icon={HeartHandshake} title="My welfare" value={me ? formatKES(me.welfare_balance) : "…"} action="View welfare" onClick={() => go("money/statement?account=welfare")} />
        <ActionCard icon={Send} title="Contribute" sub="Tell us what you sent" action="Contribute" onClick={() => go("money/contribute")} />
        <ActionCard icon={HandCoins} title="Loan repayments" value={owed > 0 ? `${formatKES(owed)} owed` : "No active loan"} action={owed > 0 ? "Repay" : "My loans"} tone={owed > 0 ? "gold" : ""} onClick={() => go(owed > 0 ? "money/repay" : "loans/mine")} />
        <ActionCard icon={FileText} title="My statement" sub="Everything paid in and out" action="Open" onClick={() => go("money/statement")} />
      </CardGrid>
    </React.Fragment>
  );

  const officialSection = officialMoney && (
    <React.Fragment key="o">
      <SectionTitle>Chama money</SectionTitle>
      <CardGrid>
        {can.record && <ActionCard icon={UserCheck} title="Record for a member" sub="Cash or payments from members without a phone" action="Record" onClick={() => go("money/record")} />}
        {can.reconcile && <ActionCard icon={ScanSearch} title="Contributions to check" value={work.contribsToCheck ?? "…"} sub="waiting for you" action="Check" tone={work.contribsToCheck > 0 ? "warn" : ""} onClick={() => go("money/reconciliation")} />}
        {can.accounts && <ActionCard icon={Building2} title="Chama accounts" sub="Bank & M-Pesa accounts" action="Open" onClick={() => go("money/accounts")} />}
        {can.accounts && <ActionCard icon={ArrowLeftRight} title="Move money" sub="Transfers, expenses, project payments" value={can.approveFunds ? (work.fundsToApprove ?? "…") : undefined} action={can.approveFunds ? "Approve" : "Open"} tone={work.fundsToApprove > 0 ? "warn" : ""} onClick={() => go("money/move")} />}
        {can.accounts && <ActionCard icon={Briefcase} title="Projects" sub="Investments and businesses" action="Open" onClick={() => go("money/projects")} />}
        {can.reconcile && <ActionCard icon={HandCoins} title="Loan collections" sub="Record loan repayments" action="Open" onClick={() => go("loans/repayments")} />}
        {can.welfare && <ActionCard icon={HeartHandshake} title="Welfare funds" sub="Fund position & insights" action="View" onClick={() => go("welfare/insights")} />}
        {can.reports && <ActionCard icon={ClipboardList} title="Group report" sub="Savings, loan book, fines, welfare" action="Open" onClick={() => go("money/group-report")} />}
        {can.accounts && <ActionCard icon={BarChart3} title="Financial information" sub="Totals across the Chama" action="View" onClick={() => go("money/finances")} />}
        {can.approveLoans && !can.reconcile && <ActionCard icon={Wallet} title="Loans" sub="Applications and payouts" action="Open" onClick={() => go("loans")} />}
      </CardGrid>
    </React.Fragment>
  );

  // Treasurer's day is the Chama's money, so it leads for them.
  return (
    <div>
      <WorkspaceHeader title="Money" subtitle="Your savings, contributions and loan payments" />
      <StaleNote fromCache={mine.fromCache} cachedAt={mine.cachedAt} online={mine.online} />
      {can.reconcile ? [officialSection, memberSection] : [memberSection, officialSection]}
    </div>
  );
}
