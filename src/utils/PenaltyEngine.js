import { supabase } from "../supabaseClient";

const PENALTY_RATE = 0.02; // 2%

export const runPenaltyEngine = async () => {
  const today = new Date();

  const { data: loans, error } = await supabase
    .from("loans")
    .select("*")
    .eq("status", "ACTIVE");

  if (error) throw error;

  for (let loan of loans) {
    if (!loan.due_date) continue;

    const due = new Date(loan.due_date);
    const diffDays = Math.floor((today - due) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) continue;

    const penalty = Number(loan.balance) * PENALTY_RATE;

    // UPDATE LOAN
    await supabase
      .from("loans")
      .update({
        penalty_accrued: Number(loan.penalty_accrued || 0) + penalty,
        arrears_days: diffDays
      })
      .eq("id", loan.id);

    // POST TO GL
    await supabase.from("general_ledger").insert([
      {
        date: today.toISOString().split("T")[0],
        account: "Penalty Receivable",
        debit: penalty,
        credit: 0,
        member_no: loan.member_no,
        reference: "Penalty Charge"
      },
      {
        date: today.toISOString().split("T")[0],
        account: "Penalty Income",
        debit: 0,
        credit: penalty,
        member_no: loan.member_no,
        reference: "Penalty Charge"
      }
    ]);
  }

  return "Penalty run completed";
};