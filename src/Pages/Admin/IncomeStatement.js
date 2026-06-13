import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function IncomeStatement() {
  const [income, setIncome] = useState(0);
  const [expense, setExpense] = useState(0);
  const [profit, setProfit] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*");

    let totalIncome = 0;
    let totalExpense = 0;

    ledger.forEach((tx) => {
      const amount = Number(tx.amount || 0);

      // SAVINGS = INCOME
      if (tx.credit_account_id === 1018) {
        totalIncome += amount;
      }

      // LOAN DISBURSEMENT = EXPENSE
      if (tx.type === "loan") {
        totalExpense += amount;
      }
    });

    setIncome(totalIncome);
    setExpense(totalExpense);
    setProfit(totalIncome - totalExpense);
  };

  return (
    <div className="p-6">

      <h1 className="text-2xl font-bold mb-4">
        Income Statement
      </h1>

      <div className="grid grid-cols-3 gap-4">

        <div className="bg-green-100 p-4">
          <p>Total Income</p>
          <h2>KES {income.toFixed(2)}</h2>
        </div>

        <div className="bg-red-100 p-4">
          <p>Total Expense</p>
          <h2>KES {expense.toFixed(2)}</h2>
        </div>

        <div className="bg-blue-100 p-4">
          <p>Profit</p>
          <h2>KES {profit.toFixed(2)}</h2>
        </div>

      </div>

    </div>
  );
}