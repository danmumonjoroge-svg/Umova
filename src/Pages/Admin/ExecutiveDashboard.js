import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function ExecutiveDashboard() {
  const [stats, setStats] = useState({
    members: 0,
    savings: 0,
    loans: 0,
    repayments: 0,
    overdue: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    // MEMBERS
    const { data: members } = await supabase
      .from("members")
      .select("id");

    // LEDGER
    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*");

    // LOANS
    const { data: loans } = await supabase
      .from("loans")
      .select("*");

    let savings = 0;
    let loanIssued = 0;
    let repayments = 0;
    let overdue = 0;

    // PROCESS LEDGER
    ledger.forEach((tx) => {
      const amount = Number(tx.amount || 0);

      // SAVINGS
      if (tx.credit_account_id === 1018) {
        savings += amount;
      }

      // LOAN ISSUED
      if (tx.type === "loan") {
        loanIssued += amount;
      }

      // REPAYMENTS
      if (tx.type === "loan_repayment") {
        repayments += amount;
      }
    });

    // OVERDUE LOANS
    loans.forEach((l) => {
      if (l.status === "overdue") {
        overdue++;
      }
    });

    setStats({
      members: members?.length || 0,
      savings,
      loans: loanIssued,
      repayments,
      overdue,
    });
  };

  return (
    <div className="p-6">

      <h1 className="text-3xl font-bold mb-6">
        Executive Dashboard
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">

        <div className="bg-white p-4 shadow">
          <p>Total Members</p>
          <h2 className="text-2xl font-bold">
            {stats.members}
          </h2>
        </div>

        <div className="bg-green-100 p-4 shadow">
          <p>Total Savings</p>
          <h2 className="text-2xl font-bold">
            KES {stats.savings.toFixed(2)}
          </h2>
        </div>

        <div className="bg-blue-100 p-4 shadow">
          <p>Total Loans Issued</p>
          <h2 className="text-2xl font-bold">
            KES {stats.loans.toFixed(2)}
          </h2>
        </div>

        <div className="bg-yellow-100 p-4 shadow">
          <p>Total Repayments</p>
          <h2 className="text-2xl font-bold">
            KES {stats.repayments.toFixed(2)}
          </h2>
        </div>

        <div className="bg-red-100 p-4 shadow">
          <p>Overdue Loans</p>
          <h2 className="text-2xl font-bold">
            {stats.overdue}
          </h2>
        </div>

      </div>

    </div>
  );
}