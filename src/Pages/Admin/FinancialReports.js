import { useState } from "react";
import { generateFinancialReports } from "../../services/financialReportAPI";

export default function FinancialReports() {

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const runReport = async () => {
    try {
      setLoading(true);

      const res = await generateFinancialReports({
        from: "2025-01-01",
        to: "2026-12-31",
        journal_lines: [],
        chart_of_accounts: []
      });

      setReport(res);

    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded shadow">

      <h2 className="text-lg font-bold mb-3">
        Financial Reporting Engine
      </h2>

      <button
        onClick={runReport}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
      >
        {loading ? "Generating..." : "Generate Reports"}
      </button>

      {/* ================= INCOME STATEMENT ================= */}
      {report && (
        <div className="mt-4 p-3 border rounded">

          <h3 className="font-bold">Income Statement</h3>
          <p>Income: {report.income_statement.income}</p>
          <p>Expenses: {report.income_statement.expenses}</p>
          <p className="font-bold text-green-600">
            Profit: {report.income_statement.profit}
          </p>

        </div>
      )}

      {/* ================= BALANCE SHEET ================= */}
      {report && (
        <div className="mt-4 p-3 border rounded">

          <h3 className="font-bold">Balance Sheet</h3>

          <p>Assets: {report.balance_sheet.assets}</p>
          <p>Liabilities: {report.balance_sheet.liabilities}</p>
          <p>Equity: {report.balance_sheet.equity}</p>

          <p className="mt-2 font-bold">
            Balanced: {report.balance_sheet.balanced ? "YES" : "NO"}
          </p>

        </div>
      )}

      {/* ================= CASH FLOW ================= */}
      {report && (
        <div className="mt-4 p-3 border rounded">

          <h3 className="font-bold">Cash Flow</h3>
          <p>Net Cash: {report.cash_flow.net_cash}</p>

        </div>
      )}

    </div>
  );
}