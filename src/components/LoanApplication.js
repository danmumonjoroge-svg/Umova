import { useState } from "react";

export default function LoanApplication() {
  const [amount, setAmount] = useState("");
  const [security, setSecurity] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    alert(`Loan of KES ${amount} submitted with security: ${security}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-3xl font-bold mb-6 text-green-700">Apply for Loan</h1>
      <form className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block font-semibold mb-2">Loan Amount (KES)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border px-4 py-2 rounded"
            required
          />
        </div>
        <div>
          <label className="block font-semibold mb-2">Security (Guarantor, Title, Logbook)</label>
          <input
            type="text"
            value={security}
            onChange={(e) => setSecurity(e.target.value)}
            className="w-full border px-4 py-2 rounded"
            placeholder="E.g. 2 guarantors, vehicle logbook"
            required
          />
        </div>
        <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition">
          Submit Loan Application
        </button>
      </form>
    </div>
  );
}