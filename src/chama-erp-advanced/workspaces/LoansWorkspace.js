import React from "react";
import { Wallet, FilePlus, HandCoins, BookOpen, CheckCircle2, Landmark, Settings } from "lucide-react";
import { formatKES } from "../shell/format";
import { useCapabilities, useMine, useWork } from "../shell/work";
import { ActionCard, CardGrid, SectionTitle, WorkspaceHeader, StaleNote } from "../shell/ui";

// Loans workspace — a landing page of things you can do, not a menu of tables.
export default function LoansWorkspace({ go }) {
  const can = useCapabilities();
  const mine = useMine();
  const { work } = useWork();
  const owed = mine.data?.owed || 0;
  const staff = can.approveLoans || can.disburse;

  return (
    <div>
      <WorkspaceHeader title="Loans" subtitle="Borrow, repay and see how loans work in your Chama" />
      <StaleNote fromCache={mine.fromCache} cachedAt={mine.cachedAt} online={mine.online} />
      <CardGrid>
        <ActionCard icon={Wallet} title="My loans" value={owed > 0 ? `${formatKES(owed)} owed` : "No active loan"} action="View" tone={owed > 0 ? "gold" : ""} onClick={() => go("loans/mine")} />
        <ActionCard icon={FilePlus} title="Apply for a loan" sub="Start an application" action="Apply" onClick={() => go("loans/apply")} />
        <ActionCard icon={HandCoins} title="Repay a loan" value={owed > 0 ? formatKES(owed) : undefined} sub={owed > 0 ? "still to repay" : "You have nothing to repay"} action={owed > 0 ? "Repay" : undefined} disabled={owed <= 0} onClick={() => go("money/repay")} />
        <ActionCard icon={BookOpen} title="Loan rules" sub="How much, how long, what it costs" action="Read" onClick={() => go("loans/rules")} />
      </CardGrid>

      {staff && (
        <>
          <SectionTitle>For officials</SectionTitle>
          <CardGrid>
            {can.approveLoans && <ActionCard icon={CheckCircle2} title="Applications & approvals" value={work.loanApps ?? "…"} sub="waiting for a decision" action="Review" tone={work.loanApps > 0 ? "warn" : ""} onClick={() => go("loans/approvals")} />}
            {can.disburse && <ActionCard icon={Landmark} title="Disbursement" value={work.toDisburse ?? "…"} sub="approved, to pay out" action="Pay out" tone={work.toDisburse > 0 ? "warn" : ""} onClick={() => go("loans/disbursement")} />}
            {can.disburse && <ActionCard icon={HandCoins} title="Repayments" sub="Record what members repay" action="Open" onClick={() => go("loans/repayments")} />}
            {can.approveLoans && <ActionCard icon={Settings} title="Set loan rules" sub="Limits, interest, guarantors" action="Edit" onClick={() => go("loans/rules-edit")} />}
          </CardGrid>
        </>
      )}
    </div>
  );
}
