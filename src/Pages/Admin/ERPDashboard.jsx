import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function ERPDashboard() {
  const [stats, setStats] = useState({
    members: 0,
    deposits: 0,
    loans: 0,
    cashflow: 0,
    activityScore: 0,
  });

  const [recent, setRecent] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // ================= SAFE NUMBER =================
  const clean = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  // ================= REAL-TIME SYNC =================
  useEffect(() => {
    load();

    const channel = supabase
      .channel("erp-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "general_ledger" },
        () => load()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ================= LOAD ERP ENGINE =================
  const load = async () => {
    setLoading(true);

    // MEMBERS
    const { count: members } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true });

    // LEDGER
    const { data: ledger } = await supabase
      .from("general_ledger")
      .select("*");

    let deposits = 0;
    let loans = 0;
    let cashflow = 0;
    let largeTx = 0;

    (ledger || []).forEach((r) => {
      const amt = clean(r.amount);

      const debit = String(r.debit_account_id || "").trim();
      const credit = String(r.credit_account_id || "").trim();

      // Savings deposits
      if (credit === "1018") deposits += amt;

      // Loan disbursement
      if (debit === "1011") loans += amt;

      // Cash movement
      if (debit === "1007" || credit === "1007") cashflow += amt;

      // ALERT RULE
      if (amt >= 500000) largeTx++;
    });

    // ================= ACTIVITY SCORE =================
    const activityScore = Math.min(
      100,
      ((deposits + loans + cashflow) / 1000000) * 10
    ).toFixed(1);

    // ================= ALERT ENGINE =================
    const alertsList = [];

    if (largeTx > 0) {
      alertsList.push(`⚠ ${largeTx} high-value transaction(s) detected`);
    }

    if (cashflow < deposits * 0.3) {
      alertsList.push("⚠ Low liquidity compared to deposits");
    }

    if (loans > deposits * 2) {
      alertsList.push("⚠ Loan exposure exceeds deposit safety ratio");
    }

    // ================= RECENT ACTIVITY =================
    const { data: recentTx } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: false })
      .limit(15);

    setStats({
      members: members || 0,
      deposits,
      loans,
      cashflow,
      activityScore,
    });

    setRecent(recentTx || []);
    setAlerts(alertsList);
    setLoading(false);
  };

  // ================= UI =================
  return (
    <div style={styles.page}>

      {/* HEADER */}
      <div style={styles.header}>
        <h1 style={styles.title}>🏢 ERP Intelligence Control Center</h1>
        <p style={styles.subtitle}>
          Real-Time Operations • Financial Engine • Risk Monitoring System
        </p>
      </div>

      {/* KPI CARDS */}
      <div style={styles.kpiGrid}>
        <Card title="Members" value={stats.members} />
        <Card title="Deposits" value={stats.deposits} money />
        <Card title="Loans Issued" value={stats.loans} money />
        <Card title="Cash Flow" value={stats.cashflow} money />
      </div>

      {/* INSIGHTS GRID */}
      <div style={styles.grid2}>

        {/* ACTIVITY SCORE */}
        <div style={styles.glassCard}>
          <h2 style={styles.sectionTitle}>🧠 Activity Intelligence Score</h2>

          <div style={styles.scoreCircle}>
            {stats.activityScore}
          </div>

          <p style={styles.muted}>
            Based on financial velocity & system activity
          </p>
        </div>

        {/* ALERTS */}
        <div style={styles.glassCard}>
          <h2 style={styles.sectionTitle}>⚠ Risk Alerts</h2>

          {alerts.length === 0 ? (
            <p style={styles.ok}>✔ System Stable</p>
          ) : (
            alerts.map((a, i) => (
              <div key={i} style={styles.alertCard}>
                {a}
              </div>
            ))
          )}
        </div>

      </div>

      {/* LIVE TRANSACTIONS */}
      <div style={styles.livePanel}>
        <h2 style={styles.sectionTitle}>📡 Live Transaction Stream</h2>

        {loading ? (
          <p style={styles.muted}>Loading system activity...</p>
        ) : (
          <div style={styles.feed}>
            {recent.map((r, i) => (
              <div key={i} style={styles.feedRow}>
                <div>
                  <b style={styles.member}>
                    {r.member_no || "SYSTEM"}
                  </b>
                  <p style={styles.desc}>{r.description}</p>
                </div>

                <div style={styles.amount}>
                  KES {Number(r.amount || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ================= CARD =================
function Card({ title, value, money }) {
  return (
    <div style={styles.card}>
      <p style={styles.muted}>{title}</p>
      <h2 style={styles.value}>
        {money
          ? `KES ${Number(value || 0).toLocaleString()}`
          : value}
      </h2>
    </div>
  );
}

// ================= STYLES =================
const styles = {

  page: {
    padding: 26,
    fontFamily: "Inter, system-ui, Arial",
    background:
      "linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #f1f5f9 100%)",
    minHeight: "100vh",
    color: "#0f172a",
  },

  header: {
    marginBottom: 20,
  },

  title: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },

  subtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 14,
    marginBottom: 18,
  },

  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 18,
  },

  glassCard: {
    background: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(10px)",
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(226,232,240,0.8)",
    boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
  },

  livePanel: {
    background: "#ffffff",
    padding: 18,
    borderRadius: 16,
    boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 12,
  },

  scoreCircle: {
    width: 110,
    height: 110,
    borderRadius: "50%",
    background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 800,
    margin: "12px auto",
    boxShadow: "0 10px 20px rgba(37,99,235,0.25)",
  },

  muted: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "center",
  },

  ok: {
    color: "#16a34a",
    fontWeight: 600,
  },

  alertCard: {
    background: "#fff7ed",
    borderLeft: "4px solid #f59e0b",
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
    fontSize: 13,
    color: "#92400e",
  },

  feed: {
    maxHeight: 360,
    overflowY: "auto",
  },

  feedRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid #f1f5f9",
  },

  member: {
    fontSize: 13,
    color: "#1e293b",
  },

  desc: {
    fontSize: 12,
    color: "#64748b",
  },

  amount: {
    fontWeight: 700,
    color: "#16a34a",
  },

  card: {
    background: "white",
    padding: 14,
    borderRadius: 12,
  },

  muted: {
    color: "#64748b",
    fontSize: 12,
  },

  value: {
    fontSize: 20,
    fontWeight: 800,
  },
};