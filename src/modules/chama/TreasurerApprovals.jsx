import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";

export default function TreasurerApprovals() {
  const { chama, member } = useChama() || {};

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [actionLoading, setActionLoading] = useState(null);

  // ─────────────────────────────────────────────
  // LOAD PENDING CONTRIBUTIONS
  // ─────────────────────────────────────────────
  const load = async () => {
    if (!chama?.id) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("chama_contributions")
      .select("*")
      .eq("chama_id", chama.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error.message);
      setItems([]);
    } else {
      setItems(data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [chama?.id]);

  // ─────────────────────────────────────────────
  // APPROVE CONTRIBUTION
  // ─────────────────────────────────────────────
  const approve = async (id) => {
    setActionLoading(id);

    const { error } = await supabase
      .from("chama_contributions")
      .update({
        status: "approved",
        approved_by: member?.id || null,
        approved_at: new Date(),
      })
      .eq("id", id);

    setActionLoading(null);

    if (error) {
      alert(error.message);
      return;
    }

    load();
  };

  // ─────────────────────────────────────────────
  // REJECT CONTRIBUTION
  // ─────────────────────────────────────────────
  const reject = async (id) => {
    setActionLoading(id);

    const { error } = await supabase
      .from("chama_contributions")
      .update({
        status: "rejected",
        approved_by: member?.id || null,
        approved_at: new Date(),
      })
      .eq("id", id);

    setActionLoading(null);

    if (error) {
      alert(error.message);
      return;
    }

    load();
  };

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────

  if (!chama?.id) {
    return <p>Loading session...</p>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Pending Contributions</h2>

      {loading ? (
        <p>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No pending contributions</p>
      ) : (
        items.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 12,
              border: "1px solid #eee",
              marginBottom: 10,
              borderRadius: 8,
            }}
          >
            <div>
              <b>KES {Number(c.amount).toLocaleString()}</b>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                Month: {c.month}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => approve(c.id)}
                disabled={actionLoading === c.id}
                style={{
                  background: "#10b981",
                  color: "white",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                Approve
              </button>

              <button
                onClick={() => reject(c.id)}
                disabled={actionLoading === c.id}
                style={{
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                Reject
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}