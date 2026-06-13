import { useState } from "react";
import { runLoanApproval } from "../../services/loanApprovalAPI";

export default function LoanApproval() {

  const [member, setMember] = useState({
    credit_score: 720,
    par: "PAR 0",
    savings_balance: 50000
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const runApproval = async () => {
    try {
      setLoading(true);

      const res = await runLoanApproval(member);

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
        Loan Approval Engine (Credit Committee AI)
      </h2>

      <button
        onClick={runApproval}
        className="bg-green-600 text-white px-4 py-2 rounded w-full"
      >
        Run Loan Decision
      </button>

      {/* RESULT */}
      {result && (
        <div className="mt-4 border p-4 rounded">

          <p className={`text-xl font-bold ${
            result.status === "APPROVED"
              ? "text-green-600"
              : result.status === "REVIEW"
              ? "text-yellow-600"
              : "text-red-600"
          }`}>
            {result.status}
          </p>

          <p className="mt-2">
            Max Loan: <b>{result.max_loan_limit}</b>
          </p>

          <p>
            Interest Rate: <b>{result.interest_rate * 100}%</b>
          </p>

          <ul className="mt-2 text-sm text-gray-600">
            {result.reason.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>

        </div>
      )}

    </div>
  );
}