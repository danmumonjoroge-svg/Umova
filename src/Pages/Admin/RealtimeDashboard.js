import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function RealtimeDashboard() {
  const [stats, setStats] = useState({
    savings: 0,
    loans: 0,
    repayments: 0,
    members: 0,
  });

  const fetchData = async () => {
    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*");

    const { data: members } = await supabase
      .from("members")
      .select("id");

    let savings = 0;
    let loans = 0;
    let repayments = 0;

    ledger.forEach((tx) => {
      const amount = Number(tx.amount || 0);

      if (tx.credit_account_id === 1018) {
        savings += amount;
      }

      if (tx.type === "loan") {
        loans += amount;
      }

      if (tx.type === "loan_repayment") {
        repayments += amount;
      }
    });

    setStats({
      savings,
      loans,
      repayments,
      members: members?.length || 0,
    });
  };

  useEffect(() => {
    fetchData();

    // REALTIME SUBSCRIPTION
    const channel = supabase
      .channel("ledger-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "general_ledger" },
        () => {
          fetchData(); // auto refresh
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6">

      <h1 className="text-2xl font-bold mb-4">
        Live Dashboard
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        <div className="bg-green-100 p-4">
          <p>Savings</p>
          <h2>KES {stats.savings.toFixed(2)}</h2>
        </div>

        <div className="bg-blue-100 p-4">
          <p>Loans</p>
          <h2>KES {stats.loans.toFixed(2)}</h2>
        </div>

        <div className="bg-yellow-100 p-4">
          <p>Repayments</p>
          <h2>KES {stats.repayments.toFixed(2)}</h2>
        </div>

        <div className="bg-gray-100 p-4">
          <p>Members</p>
          <h2>{stats.members}</h2>
        </div>

      </div>

    </div>
  );
}