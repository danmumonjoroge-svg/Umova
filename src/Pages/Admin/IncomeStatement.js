import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

const ACC = {
  LOAN: 1011,
  INTEREST_INCOME: 1020,
  SAVINGS: 1018,
};

const format = (v) =>
  Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function IncomeStatement() {
  const [gl, setGl] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: true });

    setLoading(false);

    if (error) return alert(error.message);

    setGl(data || []);
  };

  const filtered = useMemo(() => {
    return gl.filter((tx) => {
      if (!fromDate && !toDate) return true;

      const d = tx.date;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [gl, fromDate, toDate]);

  const breakdown = useMemo(() => {
    let interestIncome = 0;
    let savingsIncome = 0;

    let loanExpense = 0;
    let operatingExpense = 0;

    filtered.forEach((tx) => {
      const amt = Number(tx.amount || 0);

      // INTEREST INCOME (STRICT ACCOUNT BASED)
      if (tx.credit_account_id === ACC.INTEREST_INCOME) {
        interestIncome += amt;
      }

      // SAVINGS INFLOW (treated as income in SACCO logic)
      if (tx.credit_account_id === ACC.SAVINGS) {
        savingsIncome += amt;
      }

      // LOAN DISBURSEMENT = EXPENSE
      if (tx.debit_account_id === ACC.LOAN && tx.transaction_type === "loan_disbursement") {
        loanExpense += amt;
      }

      // OPTIONAL: OTHER EXPENSES (extendable rule engine)
      if (tx.type === "expense") {
        operatingExpense += amt;
      }
    });

    const totalIncome = interestIncome + savingsIncome;
    const totalExpense = loanExpense + operatingExpense;
    const netProfit = totalIncome - totalExpense;

    return {
      interestIncome,
      savingsIncome,
      loanExpense,
      operatingExpense,
      totalIncome,
      totalExpense,
      netProfit,
    };
  }, [filtered]);

  const exportCSV = () => {
    const rows = [
      ["Category", "Amount"],
      ["Interest Income", breakdown.interestIncome],
      ["Savings Income", breakdown.savingsIncome],
      ["Loan Expense", breakdown.loanExpense],
      ["Operating Expense", breakdown.operatingExpense],
      ["Total Income", breakdown.totalIncome],
      ["Total Expense", breakdown.totalExpense],
      ["Net Profit", breakdown.netProfit],
    ];

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `income_statement_${Date.now()}.csv`;
    a.click();
  };

  const printView = () => window.print();

  return (
    <div className="p-6 bg-gray-50 min-h-screen">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">📊 Income Statement Engine</h1>

        <div className="flex gap-2 items-center">

          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border p-2 rounded"
          />

          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border p-2 rounded"
          />

          <button
            onClick={fetchData}
            className="bg-blue-600 text-white px-3 py-2 rounded"
          >
            Refresh
          </button>

          <button
            onClick={exportCSV}
            className="bg-green-600 text-white px-3 py-2 rounded"
          >
            Export CSV
          </button>

          <button
            onClick={printView}
            className="bg-gray-700 text-white px-3 py-2 rounded"
          >
            Print
          </button>

        </div>
      </div>

      {loading && (
        <p className="text-sm text-gray-500 mb-3">Loading financial data...</p>
      )}

      {/* CARDS */}
      <div className="grid grid-cols-3 gap-4 mb-6">

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Interest Income</p>
          <h2 className="text-green-600 font-bold text-xl">
            {format(breakdown.interestIncome)}
          </h2>
        </div>

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Savings Income</p>
          <h2 className="text-green-600 font-bold text-xl">
            {format(breakdown.savingsIncome)}
          </h2>
        </div>

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Loan Expense</p>
          <h2 className="text-red-600 font-bold text-xl">
            {format(breakdown.loanExpense)}
          </h2>
        </div>

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Operating Expense</p>
          <h2 className="text-red-600 font-bold text-xl">
            {format(breakdown.operatingExpense)}
          </h2>
        </div>

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Total Income</p>
          <h2 className="text-blue-600 font-bold text-xl">
            {format(breakdown.totalIncome)}
          </h2>
        </div>

        <div className="bg-white p-4 shadow rounded">
          <p className="text-gray-500">Total Expense</p>
          <h2 className="text-blue-600 font-bold text-xl">
            {format(breakdown.totalExpense)}
          </h2>
        </div>

      </div>

      {/* RESULT */}
      <div className="bg-white p-6 shadow rounded text-center">
        <p className="text-gray-500">Net Profit / (Loss)</p>
        <h1
          className={`text-3xl font-bold mt-2 ${
            breakdown.netProfit >= 0 ? "text-green-600" : "text-red-600"
          }`}
        >
          {format(breakdown.netProfit)}
        </h1>
      </div>

    </div>
  );
}