import { useState } from "react";
import { calculateCreditScore } from "../../services/creditScoreAPI";

export default function CreditScore() {

  const [member, setMember] = useState({
    repayment_rate: 0.8,
    par: "PAR 30",
    arrears_days: 15,
    savings_score: 0.7,
    loan_utilization: 0.6
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const runScore = async () => {
    try {
      setLoading(true);

      const res = await calculateCreditScore(member);

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
        Credit Scoring Engine
      </h2>

      <button
        onClick={runScore}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
      >
        Calculate Score
      </button>

      {/* RESULT */}
      {result && (
        <div className="mt-4 p-4 border rounded">

          <p className="text-xl font-bold">
            Score: {result.score} / 1000
          </p>

          <p className={`font-bold mt-2 ${
            result.risk === "HIGH RISK"
              ? "text-red-600"
              : result.risk === "MEDIUM RISK"
              ? "text-yellow-600"
              : "text-green-600"
          }`}>
            {result.risk}
          </p>

        </div>
      )}

    </div>
  );
}