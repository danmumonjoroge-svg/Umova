import { supabase } from "../supabaseClient";
import { postJournal } from "./journalEngine";

export const processRepayment = async ({
  loan,
  amount,
  payment_method = "cash",
}) => {
  const loanBalance = Number(loan.balance || 0);
  const payAmount = Number(amount);

  if (!payAmount || payAmount <= 0) {
    throw new Error("Invalid repayment amount");
  }

  if (payAmount > loanBalance) {
    throw new Error("Repayment exceeds loan balance");
  }

  const newBalance = loanBalance - payAmount;

  // ================= 1. POST TO GENERAL LEDGER =================
  await postJournal({
    date: new Date(),
    type: "loan_repayment",
    amount: payAmount,
    member_no: loan.member_no,
    description: "Loan repayment",

    debit_account_id: 1007, // Cash/Bank
    credit_account_id: 1011, // Loans Receivable
  });

  // ================= 2. UPDATE LOAN =================
  await supabase
    .from("loans")
    .update({
      balance: newBalance,
      status: newBalance === 0 ? "closed" : "active",
    })
    .eq("loan_id", loan.loan_id);

  // ================= 3. SAVE REPAYMENT RECORD =================
  await supabase.from("loan_repayments").insert([
    {
      loan_id: loan.loan_id,
      member_no: loan.member_no,
      amount: payAmount,
      balance_after: newBalance,
      payment_method,
    },
  ]);

  return { success: true, newBalance };
};