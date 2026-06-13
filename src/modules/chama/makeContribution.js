import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";

export default function MakeContribution() {
  const { chama, member } = useChama() || {};

  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submitContribution = async () => {
    setMessage("");

    if (!amount || Number(amount) <= 0) {
      setMessage("Enter a valid amount");
      return;
    }

    if (!chama?.id || !member?.id) {
      setMessage("Session not valid. Please login again.");
      return;
    }

    setLoading(true);

    const payload = {
      chama_id: chama.id,
      member_id: member.id,
      amount: Number(amount),
      month: new Date().toISOString().slice(0, 7), // YYYY-MM
      status: "pending",
      created_at: new Date(),
    };

    const { error } = await supabase
      .from("chama_contributions")
      .insert([payload]);

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setAmount("");
    setMessage("Contribution submitted for approval ✅");
  };

  return (
    <div style={{ padding: 20, maxWidth: 500 }}>
      <h2>Make Contribution</h2>

      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Submit your monthly savings for approval
      </p>

      <input
        type="number"
        placeholder="Enter amount (KES)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 6,
        }}
      />

      <button
        onClick={submitContribution}
        disabled={loading}
        style={{
          marginTop: 10,
          width: "100%",
          padding: 10,
          background: "#10b981",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {loading ? "Submitting..." : "Submit Contribution"}
      </button>

      {message && (
        <p style={{ marginTop: 10, fontSize: 13 }}>{message}</p>
      )}
    </div>
  );
}