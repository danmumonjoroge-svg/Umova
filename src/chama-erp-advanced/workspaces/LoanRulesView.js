import React from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import { Info } from "lucide-react";
import useCachedQuery from "../shell/useCachedQuery";
import { formatKES } from "../shell/format";
import { Spinner, StaleNote, Notice } from "../shell/ui";

// Read-only, plain-language loan rules for every member. Officials change the
// rules in LoanRulesCard (gated there and by the database). Uses the same
// chama_loan_rules row and the same fallback defaults as MemberLoanApplication
// so the two screens can never disagree.
const DEFAULTS = { savings_multiplier: 3, required_approvals: 3, default_interest_rate: 10, default_interest_type: "flat_monthly", requires_guarantors: true, min_guarantors: 1, guarantor_coverage_percent: 100, max_loan_amount: null, min_membership_months: 0 };

export default function LoanRulesView() {
  const { chama } = useChama();
  const { data, loading, fromCache, cachedAt, online } = useCachedQuery(
    chama?.id ? `loanrules:${chama.id}` : null,
    async () => {
      const { data: row, error } = await supabase.from("chama_loan_rules").select("*").eq("chama_id", chama.id).maybeSingle();
      if (error) throw new Error(error.message);
      return { rules: row || null };
    },
    !!chama?.id
  );
  if (loading && !data) return <Spinner />;
  const custom = !!data?.rules;
  const r = { ...DEFAULTS, ...(data?.rules || {}) };
  const per = r.default_interest_type === "reducing_annual" ? "a year, charged on what you still owe" : "a month, charged on the amount you borrowed";

  const lines = [
    [`You can borrow up to ${r.savings_multiplier}× your savings`, r.max_loan_amount ? `, but never more than ${formatKES(r.max_loan_amount)}.` : "."],
    [`Interest is ${r.default_interest_rate}% ${per}.`, ""],
    [r.requires_guarantors ? `You need at least ${r.min_guarantors} guarantor${r.min_guarantors > 1 ? "s" : ""}, together covering ${r.guarantor_coverage_percent}% of the loan.` : "You do not need a guarantor.", ""],
    [`${r.required_approvals} official${r.required_approvals > 1 ? "s" : ""} must approve your application.`, ""],
    ...(Number(r.min_membership_months) > 0 ? [[`You must have been a member for at least ${r.min_membership_months} month${r.min_membership_months > 1 ? "s" : ""}.`, ""]] : []),
  ];

  return (
    <div>
      <StaleNote fromCache={fromCache} cachedAt={cachedAt} online={online} />
      {!custom && <Notice icon={Info}>Your Chama has not set its own loan rules yet, so these standard rules apply.</Notice>}
      <ul className="cm-rules">{lines.map(([a, b], i) => <li key={i}>{a}{b}</li>)}</ul>
    </div>
  );
}
