import { useState } from "react";
import { runPARClassification } from "../../services/parAPI";

export default function PARDashboard() {

  const [loans, setLoans] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // ================= SAMPLE LOAD (replace with Supabase later) =================
  const loadLoans = () => {
    setLoans([
      { id: 1, member_id: "M001", outstanding: 50000, due_date: "2026-03-01" },
      { id: 2, member_id: "M002", outstanding: 20000, due_date: "2026-02-10" },
      { id: 3, member_id: "M003", outstanding: 80000, due_date: "2025-12-01" }
    ]);
  };

  // ================= RUN PAR =================
  const runPAR = async () => {
    try {
      setLoading(true);

      const res = await runPARClassification(loans);

      setResult(res);

    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded shadow">

      <h2 className="text-lg font-bold mb-3">
        PAR Classification Engine
      </h2>

      <button
        onClick={loadLoans}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
      >
        Load Loans
      </button>

      <button
        onClick={runPAR}
        disabled={!loans.length || loading}
        className="bg-green-600 text-white px-4 py-2 rounded w-full mt-2"
      >
        {loading ? "Calculating..." : "Run PAR Analysis"}
      </button>

      {/* SUMMARY */}
      {result && (
        <div className="mt-4 p-3 border rounded bg-gray-50">

          <p><b>Total Portfolio:</b> {result.portfolio}</p>
          <p><b>At Risk:</b> {result.at_risk}</p>
          <p className="text-red-600 font-bold">
            PAR Ratio: {result.par_ratio}%
          </p>

        </div>
      )}

      {/* TABLE */}
      {result && (
        <table className="w-full mt-3 text-sm border">

          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">Member</th>
              <th className="p-2">Outstanding</th>
              <th className="p-2">Days Overdue</th>
              <th className="p-2">PAR Status</th>
            </tr>
          </thead>

          <tbody>
            {result.loans.map((l) => (
              <tr key={l.loan_id} className="text-center border-t">

                <td className="p-2">{l.member_id}</td>
                <td className="p-2">{l.outstanding}</td>
                <td className="p-2">{l.days_overdue}</td>

                <td className="p-2 font-bold">
                  {l.par}
                </td>

              </tr>
            ))}
          </tbody>

        </table>
      )}

    </div>
  );
}