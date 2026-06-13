import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

const LoanApprovalDashboard = () => {
  const [loans, setLoans] = useState([]);

  useEffect(() => {
    fetchLoans();
  }, []);

  // =========================
  // FETCH PENDING LOANS
  // =========================
  const fetchLoans = async () => {
    const { data, error } = await supabase
      .from("loans")
      .select("*")
      .eq("status", "pending");

    console.log("📦 PENDING LOANS:", data);

    if (!error) setLoans(data);
  };

  // =========================
  // APPROVE LOAN
  // =========================
  const approveLoan = async (loan) => {
    const { error } = await supabase
      .from("loans")
      .update({ status: "approved" })
      .eq("id", loan.id);

    if (!error) {
      await postToLedger(loan);
      fetchLoans();
    }
  };

  // =========================
  // REJECT LOAN
  // =========================
  const rejectLoan = async (loan) => {
    await supabase
      .from("loans")
      .update({ status: "rejected" })
      .eq("id", loan.id);

    fetchLoans();
  };

  // =========================
  // LEDGER POSTING (AUTO)
  // =========================
  const postToLedger = async (loan) => {
    console.log("💰 Posting to ledger...");

    const { error } = await supabase.from("general_ledger").insert([
      {
        member_no: loan.member_no,
        type: "loan_disbursement",
        amount: loan.amount,
        debit_account_id: 1011, // Loans
        credit_account_id: 1007, // Cashbook
      },
    ]);

    console.log("⚠️ LEDGER ERROR:", error);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>🏦 Loan Approval Dashboard</h2>

      {loans.length === 0 ? (
        <p>No pending loans</p>
      ) : (
        loans.map((loan) => (
          <div
            key={loan.id}
            style={{
              border: "1px solid #ddd",
              marginBottom: 10,
              padding: 10,
            }}
          >
            <p><b>Member:</b> {loan.member_no}</p>
            <p><b>Amount:</b> {loan.amount}</p>
            <p><b>Score:</b> {loan.score}%</p>
            <p><b>Status:</b> {loan.status}</p>

            <button
              onClick={() => approveLoan(loan)}
              style={{ marginRight: 10 }}
            >
              ✅ Approve
            </button>

            <button onClick={() => rejectLoan(loan)}>
              ❌ Reject
            </button>
          </div>
        ))
      )}
    </div>
  );
};

export default LoanApprovalDashboard;