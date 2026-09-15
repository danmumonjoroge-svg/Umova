import { supabase } from "../supabaseClient";

// ================= CALC =================
const calculateDailyInterest = (balance, rate) => {
  const dailyRate = (rate / 100) / 365;
  return balance * dailyRate;
};

// ================= PULL =================
export const pullInterestByDate = async (selectedDate) => {
  const { data: loans, error } = await supabase
    .from("loans")
    .select("*")
    .eq("status", "ACTIVE");

  if (error) throw error;

  for (let loan of loans) {
    const lastDate = loan.last_interest_date || selectedDate;

    const days =
      (new Date(selectedDate) - new Date(lastDate)) /
      (1000 * 60 * 60 * 24);

    if (days <= 0) continue;

    const interest =
      calculateDailyInterest(Number(loan.balance), Number(loan.interest_rate || 12)) * days;

    if (interest <= 0) continue;

    await supabase.from("loan_interest_logs").insert([
      {
        loan_id: loan.id,
        member_no: loan.member_no,
        amount: interest,
        period_start: lastDate,
        period_end: selectedDate,
        posted: false,
        locked: false
      }
    ]);

    await supabase
      .from("loans")
      .update({ last_interest_date: selectedDate })
      .eq("id", loan.id);
  }

  return "Interest pulled successfully";
};

// ================= GET (FILTER) =================
export const getUnpostedInterest = async (filters = {}) => {
  let query = supabase
    .from("loan_interest_logs")
    .select("*")
    .eq("posted", false);

  if (filters.date) {
    query = query.eq("period_end", filters.date);
  }

  if (filters.member_no) {
    query = query.eq("member_no", filters.member_no);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
};

// ================= POST =================
export const postPulledInterest = async () => {
  const { data: logs, error } = await supabase
    .from("loan_interest_logs")
    .select("*")
    .eq("posted", false);

  if (error) throw error;

  for (let row of logs) {
    const today = new Date().toISOString().split("T")[0];

    const { error: glError } = await supabase
      .from("general_ledger")
      .insert([
        {
          date: today,
          account: "Interest Receivable",
          debit: row.amount,
          credit: 0,
          member_no: row.member_no,
          reference: "Interest Posting"
        },
        {
          date: today,
          account: "Interest Income",
          debit: 0,
          credit: row.amount,
          member_no: row.member_no,
          reference: "Interest Posting"
        }
      ]);

    if (glError) throw glError;

    await supabase
      .from("loan_interest_logs")
      .update({
        posted: true,
        posted_date: today
      })
      .eq("id", row.id);
  }

  return "Interest posted to GL";
};

// ================= LOCK =================
export const lockInterestPeriod = async (date) => {
  const { error } = await supabase
    .from("loan_interest_logs")
    .update({ locked: true })
    .eq("period_end", date);

  if (error) throw error;

  return "Period locked";
};

// ================= REVERSE =================
export const reverseInterest = async (date) => {
  const { data: logs, error } = await supabase
    .from("loan_interest_logs")
    .select("*")
    .eq("posted", true)
    .eq("period_end", date);

  if (error) throw error;

  for (let row of logs) {
    if (row.locked) {
      throw new Error("Cannot reverse locked period");
    }

    const today = new Date().toISOString().split("T")[0];

    // REVERSE GL ENTRY
    await supabase.from("general_ledger").insert([
      {
        date: today,
        account: "Interest Income",
        debit: row.amount,
        credit: 0,
        member_no: row.member_no,
        reference: "Interest Reversal"
      },
      {
        date: today,
        account: "Interest Receivable",
        debit: 0,
        credit: row.amount,
        member_no: row.member_no,
        reference: "Interest Reversal"
      }
    ]);

    // MARK UNPOSTED
    await supabase
      .from("loan_interest_logs")
      .update({
        posted: false,
        posted_date: null
      })
      .eq("id", row.id);
  }

  return "Interest reversed successfully";
};