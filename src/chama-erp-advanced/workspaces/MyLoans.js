import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { HandCoins, AlertCircle, Clock } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES, formatDate } from "../shell/format";
import { Spinner, StaleNote, Notice, EmptyState, Pill, ActionCard, CardGrid } from "../shell/ui";

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

      {loans.length === 0 ? <EmptyState icon={HandCoins}>You have no loans.</EmptyState> : (
        <ul className="cm-txns">
          {loans.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{formatKES(l.amount)} loan</strong>
                <small>
                  {l.disbursed ? `Paid out ${formatDate(l.disbursement_date)}` : "Approved — waiting to be paid out"}
                  {l.disbursed && l.status === "active" ? ` · ${formatKES(l.balance ?? l.amount)} still owed` : ""}
                </small>
              </div>
              <Pill tone={l.status === "closed" ? "ok" : l.disbursed ? "gold" : "neutral"}>{l.status === "closed" ? "Fully repaid" : l.disbursed ? "Repaying" : "Waiting"}</Pill>
            </li>
          ))}
        </ul>
      )}

      {repayments.length > 0 && (
        <>
          <h4 className="cm-subhead">Recent repayments</h4>
          <ul className="cm-txns">
            {repayments.map((r) => <li key={r.id}><div><strong>{formatKES(r.amount)}</strong><small>{formatDate(r.paid_on)}</small></div><span className="in">Paid</span></li>)}
          </ul>
        </>
      )}
    </div>
  );
}
