import { supabase } from "../supabaseClient";

export const generateLoanSchedule = async ({
  loan_id,
  member_no,
  principalAmount,
  interestRate = 12, // annual %
  months = 12,
  startDate = new Date(),
}) => {
  const P = Number(principalAmount);
  const r = interestRate / 100 / 12; // monthly interest rate
  const n = months;

  // ================= EMI CALCULATION =================
  const EMI =
    (P * r * Math.pow(1 + r, n)) /
    (Math.pow(1 + r, n) - 1);

  let balance = P;

  const schedule = [];

  for (let i = 1; i <= n; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    // ================= INTEREST =================
    const interest = balance * r;

    // ================= PRINCIPAL =================
    const principal = EMI - interest;

    // ================= NEW BALANCE =================
    balance -= principal;

    schedule.push({
      loan_id,
      member_no,
      installment_no: i,

      due_date: dueDate.toISOString().split("T")[0],

      principal: Number(principal.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      total: Number(EMI.toFixed(2)),

      balance: balance > 0 ? Number(balance.toFixed(2)) : 0,

      status: "PENDING",
    });
  }

  // ================= SAVE =================
  const { error } = await supabase
    .from("loan_schedule")
    .insert(schedule);

  if (error) {
    console.error("Schedule Error:", error);
  } else {
    console.log("Loan schedule generated successfully");
  }
};