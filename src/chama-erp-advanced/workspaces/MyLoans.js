import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { HandCoins, AlertCircle, Clock } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate } from "../shell/format";
import { Spinner, StaleNote, Notice, EmptyState, Pill, ActionCard, CardGrid, Panel, SubCard, SubCardList } from "../shell/ui";

// My Loans — loans that exist (chama_loans) with what is still owed. The
// application form / application tracking stays in MemberLoanApplication.
export default function MyLoans({ go }) {
  const { chama, member } = useChama();
  const { data, loading, error, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id && member?.id ? `myloans:${chama.id}:${member.id}` : null,
    async () => {
      const [l, r] = await Promise.all([
        supabase.from("chama_loans").select("id,amount,balance,status,disbursed,disbursement_date,interest_rate,repayment_months").eq("chama_id", chama.id).eq("member_id", member.id).order("created_at", { ascending: false }),
        supabase.from("chama_loan_repayments").select("id,loan_id,amount,paid_on").eq("chama_id", chama.id).eq("member_id", member.id).order("paid_on", { ascending: false }).limit(20),
      ]);
      if (l.error || r.error) throw new Error((l.error || r.error).message);
      return { loans: l.data || [], repayments: r.data || [] };
    },
    !!(chama?.id && member?.id)
  );

  if (loading && !data) return <Spinner />;
  if (!data) return <Notice tone="error" icon={AlertCircle}>Could not load your loans{error ? `: ${error}` : ""}.</Notice>;

  const { loans, repayments } = data;
  const owed = loans.filter((l) => l.disbursed && l.status === "active").reduce((s, l) => s + Number(l.balance ?? l.amount ?? 0), 0);

  return (
    <div>
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      <CardGrid>
        {owed > 0 && <ActionCard icon={HandCoins} tone="gold" title="Loan" value={`${formatKES(owed)} outstanding`} action="Repay" onClick={() => go("money/repay")} />}
        <ActionCard icon={Clock} title="Loan applications" sub="See where your application is" action="View" onClick={() => go("loans/applications")} />
      </CardGrid>

      <Panel icon={HandCoins} title="My loans" badge={loans.length || ""} tone="green">
        {loans.length === 0 ? <EmptyState icon={HandCoins}>You have no loans.</EmptyState> : (
          <SubCardList>
            {loans.map((l) => (
              <SubCard key={l.id} tone={l.status === "closed" ? "ok" : l.disbursed ? "gold" : ""} title={`${formatKES(l.amount)} loan`}
                sub={`${l.disbursed ? `Paid out ${formatDate(l.disbursement_date)}` : "Approved — waiting to be paid out"}${l.disbursed && l.status === "active" ? ` · ${formatKES(l.balance ?? l.amount)} still owed` : ""}`}
                right={<Pill tone={l.status === "closed" ? "ok" : l.disbursed ? "gold" : "neutral"}>{l.status === "closed" ? "Fully repaid" : l.disbursed ? "Repaying" : "Waiting"}</Pill>} />
            ))}
          </SubCardList>
        )}
      </Panel>

      {repayments.length > 0 && (
        <Panel icon={Clock} title="Recent repayments" badge={repayments.length} defaultOpen={false}>
          <SubCardList>
            {repayments.map((r) => <SubCard key={r.id} title={formatKES(r.amount)} sub={formatDate(r.paid_on)} right={<span className="cm-pill ok">Paid</span>} />)}
          </SubCardList>
        </Panel>
      )}
    </div>
  );
}
