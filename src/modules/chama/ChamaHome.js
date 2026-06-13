import React, { useEffect, useState } from "react";
import { useChama } from "./ChamaContext";
import { supabase } from "../../supabaseClient";
import ChamaDashboardLayout from "./ChamaDashboardLayout";

export default function ChamaHome() {
  const { chama, member } = useChama();

  const [stats, setStats] = useState({
    savings: 0,
    loans: 0,
    fines: 0,
    contributions: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chama?.id) return;

    const loadStats = async () => {
      setLoading(true);

      // 🔥 SAFER AGGREGATION QUERIES (works even if tables are small/empty)
      const [txRes] = await Promise.all([
        supabase
          .from("chama_transactions")
          .select("amount, account_type")
          .eq("chama_id", chama.id),
      ]);

      const rows = txRes.data || [];

      const summary = {
        savings: 0,
        loans: 0,
        fines: 0,
        contributions: 0,
      };

      rows.forEach((r) => {
        const amt = Number(r.amount || 0);

        if (r.account_type === "savings") summary.savings += amt;
        if (r.account_type === "loan") summary.loans += amt;
        if (r.account_type === "fine") summary.fines += amt;
        if (r.account_type === "contribution") summary.contributions += amt;
      });

      setStats(summary);
      setLoading(false);
    };

    loadStats();
  }, [chama?.id]);

  const quickTiles = [
    { label: "My Savings", value: stats.savings, color: "#10B981" },
    { label: "My Loans", value: stats.loans, color: "#3B82F6" },
    { label: "Fines", value: stats.fines, color: "#F59E0B" },
    { label: "Contributions", value: stats.contributions, color: "#8B5CF6" },
  ];

  return (
    <ChamaDashboardLayout activeTab="Dashboard">

      {/* HEADER CARD */}
      <div style={{
        background: "#0F172A",
        color: "white",
        padding: "20px",
        borderRadius: "12px",
        marginBottom: "20px"
      }}>
        <h2 style={{ margin: 0 }}>
          Welcome, {member?.full_name || member?.phone || "Member"}
        </h2>

        <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
          {chama?.name} ({chama?.chama_no})
        </p>
      </div>

      {/* QUICK STATS */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
        gap: "12px"
      }}>
        {quickTiles.map((t) => (
          <div key={t.label} style={{
            background: "#fff",
            padding: "16px",
            borderRadius: "10px",
            border: "1px solid #E2E8F0"
          }}>
            <div style={{ fontSize: "13px", color: "#64748B" }}>
              {t.label}
            </div>

            <div style={{
              fontSize: "20px",
              fontWeight: "bold",
              marginTop: "6px",
              color: t.color
            }}>
              KES {Number(t.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* ACTION CENTER (FUTURE SYSTEM ENTRY POINTS) */}
      <div style={{ marginTop: "25px" }}>
        <h3 style={{ marginBottom: "10px" }}>Quick Actions</h3>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: "10px"
        }}>
          {[
            "Record Contribution",
            "Request Loan",
            "View Statements",
            "Welfare Fund",
            "Pending Approvals",
            "Reports"
          ].map((a) => (
            <button key={a} style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid #E2E8F0",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600
            }}>
              {a}
            </button>
          ))}
        </div>
      </div>

    </ChamaDashboardLayout>
  );
}