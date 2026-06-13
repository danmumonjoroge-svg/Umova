import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import ChamaDashboardLayout from "./ChamaDashboardLayout";

export default function ChamaStatements() {
  const { chama, member } = useChama();

  const [transactions, setTransactions] = useState([]);
  const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(true);

  // ─────────────────────────────────────────────
  // LOAD LEDGER
  // ─────────────────────────────────────────────
  const loadLedger = async () => {
    if (!chama?.id) return;

    setLoading(true);

    let query = supabase
      .from("chama_transactions")
      .select("*")
      .eq("chama_id", chama.id)
      .order("created_at", { ascending: false });

    const { data } = await query;

    setTransactions(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadLedger();
  }, [chama?.id]);

  // ─────────────────────────────────────────────
  // FILTER BY MONTH
  // ─────────────────────────────────────────────
  const filtered = transactions.filter((t) => {
    if (!month) return true;

    const tMonth = new Date(t.created_at)
      .toISOString()
      .slice(0, 7); // YYYY-MM

    return tMonth === month;
  });

  // ─────────────────────────────────────────────
  // CALCULATIONS
  // ─────────────────────────────────────────────
  const summary = filtered.reduce(
    (acc, t) => {
      const amt = Number(t.amount || 0);

      if (t.account_type === "savings") acc.savings += amt;
      if (t.account_type === "loan") acc.loans += amt;
      if (t.account_type === "fine") acc.fines += amt;
      if (t.account_type === "contribution") acc.contributions += amt;

      acc.total += amt;
      return acc;
    },
    { savings: 0, loans: 0, fines: 0, contributions: 0, total: 0 }
  );

  return (
    <ChamaDashboardLayout activeTab="statements">

      <h2>📄 Monthly Statement</h2>

      <p style={{ opacity: 0.6 }}>
        Member: {member?.full_name || member?.phone}
      </p>

      {/* FILTER */}
      <div style={{ marginTop: 15 }}>
        <label>Select Month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            display: "block",
            padding: 8,
            marginTop: 5,
            marginBottom: 20
          }}
        />
      </div>

      {/* SUMMARY */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        gap: 10,
        marginBottom: 20
      }}>
        {[
          { label: "Savings", value: summary.savings, color: "#10B981" },
          { label: "Loans", value: summary.loans, color: "#3B82F6" },
          { label: "Fines", value: summary.fines, color: "#F59E0B" },
          { label: "Contributions", value: summary.contributions, color: "#8B5CF6" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "#fff",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #E2E8F0"
          }}>
            <div style={{ fontSize: 12, color: "#64748B" }}>
              {s.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: "bold", color: s.color }}>
              KES {Number(s.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* LEDGER TABLE */}
      <div style={{
        background: "#fff",
        borderRadius: 10,
        border: "1px solid #E2E8F0",
        overflow: "hidden"
      }}>

        <div style={{
          padding: 12,
          borderBottom: "1px solid #E2E8F0",
          fontWeight: 600
        }}>
          Transaction Ledger
        </div>

        {loading ? (
          <div style={{ padding: 20 }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20 }}>No transactions found</div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} style={{
              display: "flex",
              justifyContent: "space-between",
              padding: 12,
              borderBottom: "1px solid #F1F5F9"
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {t.description || t.account_type}
                </div>
                <div style={{ fontSize: 12, color: "#64748B" }}>
                  {new Date(t.created_at).toLocaleDateString()}
                </div>
              </div>

              <div style={{
                fontWeight: "bold",
                color:
                  t.account_type === "loan"
                    ? "#3B82F6"
                    : t.account_type === "fine"
                    ? "#F59E0B"
                    : "#10B981"
              }}>
                KES {Number(t.amount).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>

    </ChamaDashboardLayout>
  );
}