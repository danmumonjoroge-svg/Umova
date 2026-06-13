import { useState } from "react";
import { postJournal } from "../../services/journalAPI";

export default function LoanPenalties() {

  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePenalty = async () => {
    if (!memberId || !amount) {
      alert("Enter member ID and amount");
      return;
    }

    try {
      setLoading(true);

      const penalty = Number(amount);

      await postJournal({
        member_id: memberId,
        reference: `PEN-${Date.now()}`,
        description: "Loan penalty",

        lines: [
          // Penalty receivable
          { account_id: 1102, debit: penalty, credit: 0 },

          // Income
          { account_id: 1020, debit: 0, credit: penalty }
        ]
      });

      alert("Penalty posted successfully");

      setMemberId("");
      setAmount("");

    } catch (err) {
      alert(err.message || "Error posting penalty");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded shadow">

      <h2 className="text-lg font-bold mb-3">
        Loan Penalties
      </h2>

      <input
        className="border p-2 w-full mb-2"
        placeholder="Member ID"
        value={memberId}
        onChange={(e) => setMemberId(e.target.value)}
      />

      <input
        className="border p-2 w-full mb-2"
        type="number"
        placeholder="Penalty Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <button
        onClick={handlePenalty}
        disabled={loading}
        className="bg-red-600 text-white px-4 py-2 rounded w-full"
      >
        {loading ? "Processing..." : "Apply Penalty"}
      </button>

    </div>
  );
}