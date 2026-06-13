import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import ChamaDashboardLayout from "./ChamaDashboardLayout";

export default function ChamaContribute() {
  const { chama, member } = useChama();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);

  // ─────────────────────────────
  // SUBMIT CONTRIBUTION
  // ─────────────────────────────
  const submitContribution = async () => {
    if (!amount) return alert("Enter amount");

    setLoading(true);

    const { error } = await supabase.from("chama_contributions").insert([
      {
        chama_id: chama.id,
        member_id: member.id,
        member_name: member.full_name,
        phone: member.phone,
        amount: Number(amount),
        method,
        reference,
        status: "pending",
      },
    ]);

    setLoading(false);

    if (error) return alert(error.message);

    alert("Contribution submitted for approval");

    setAmount("");
    setReference("");
  };

  return (
    <ChamaDashboardLayout activeTab="contributions">

      <h2>💰 Contribute to Chama</h2>

      <p style={{ opacity: 0.6 }}>
        Submit your contribution. It will be approved by the treasurer.
      </p>

      {/* FORM */}
      <div style={{
        maxWidth: 400,
        background: "#fff",
        padding: 15,
        borderRadius: 10,
        marginTop: 20
      }}>

        {/* AMOUNT */}
        <label>Amount (KES)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 10 }}
        />

        {/* METHOD */}
        <label>Payment Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 10 }}
        >
          <option value="mpesa">M-Pesa</option>
          <option value="cash">Cash</option>
          <option value="bank">Bank</option>
        </select>

        {/* REFERENCE */}
        <label>Reference (Optional)</label>
        <input
          type="text"
          placeholder="Mpesa code / receipt / bank ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 15 }}
        />

        {/* BUTTON */}
        <button
          onClick={submitContribution}
          disabled={loading}
          style={{
            width: "100%",
            padding: 10,
            background: "#10B981",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer"
          }}
        >
          {loading ? "Submitting..." : "Submit Contribution"}
        </button>
      </div>

    </ChamaDashboardLayout>
  );
}