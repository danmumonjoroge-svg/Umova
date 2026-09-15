import { useState } from "react";
import { postJournal } from "../../services/journalAPI";
import { getSystemAccount } from "../../services/chartOfAccountsAPI";

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

      // NOTE: crediting INTEREST_INCOME here matches the pre-existing
      // behaviour of this page — but your Chart of Accounts has no
      // dedicated "Penalty Income" account (Section 6 of the master
      // instruction expects a PENALTY_INCOME system account; it doesn't
      // exist in the data reviewed). Penalties are currently classified
      // as interest income, which may not be what you actually want for
      // reporting purposes — worth a real decision, not something to
      // silently reclassify here.
      const penaltyReceivableAcct = await getSystemAccount("LOAN_PENALTY_RECEIVABLE");
      const interestIncomeAcct = await getSystemAccount("INTEREST_INCOME");

      await postJournal({
        member_no: memberId,
        reference: `PEN-${Date.now()}`,
        description: "Loan penalty",
        source_module: "loan_penalty",
        lines: [
          { account_id: penaltyReceivableAcct, debit: penalty, credit: 0 },
          { account_id: interestIncomeAcct, debit: 0, credit: penalty },
        ],
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