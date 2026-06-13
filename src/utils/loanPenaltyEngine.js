import { supabase } from "../supabaseClient";

/**
 * LOAN PENALTY ENGINE
 * Runs calculation of overdue loans and penalties
 */

export const calculatePenalties = async () => {
  const { data: loans } = await supabase
    .from("loans")
    .select("*");

  const today = new Date();

  let updates = [];

  for (let loan of loans || []) {
    if (!loan.due_date || loan.balance <= 0) continue;

    const dueDate = new Date(loan.due_date);

    if (today <= dueDate) continue;

    // DAYS OVERDUE
    const daysLate = Math.floor(
      (today - dueDate) / (1000 * 60 * 60 * 24)
    );

    // PENALTY CALCULATION (1% per day)
    const penaltyRate = 0.01;
    const penalty = loan.balance * penaltyRate * daysLate;

    const newBalance = Number(loan.balance) + penalty;

    updates.push({
      id: loan.id,
      penalty,
      newBalance,
      daysLate,
    });

    // UPDATE LOAN TABLE
    await supabase
      .from("loans")
      .update({
        penalty: penalty,
        balance: newBalance,
        status: "OVERDUE",
      })
      .eq("id", loan.id);

    // OPTIONAL: LOG TO LEDGER (UNCOMMENT IF NEEDED)
    /*
    await supabase.from("general_ledger").insert({
      date: new Date(),
      type: "loan_penalty",
      amount: penalty,
      member_no: loan.member_no,
      description: "Overdue penalty charged",
      debit_account_id: 1019,
      credit_account_id: 3002, // Penalty Income Account
    });
    */
  }

  return updates;
};