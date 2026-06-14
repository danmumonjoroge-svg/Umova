import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import "./ERPDashboard.css";

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
    <div className="erp-page">

      {/* HEADER */}
      <div className="erp-header">
        <h1 className="erp-title">🏢 ERP Intelligence Control Center</h1>
        <p className="erp-subtitle">
          Real-Time Operations • Financial Engine • Risk Monitoring System
        </p>
      </div>

      {/* KPI CARDS */}
      <div className="erp-kpi-grid">
        <Card title="Members" value={stats.members} />
        <Card title="Deposits" value={stats.deposits} money />
        <Card title="Loans Issued" value={stats.loans} money />
        <Card title="Cash Flow" value={stats.cashflow} money />
      </div>

      {/* INSIGHTS GRID */}
      <div className="erp-grid-2">

        {/* ACTIVITY SCORE */}
        <div className="erp-glass-card">
          <h2 className="erp-section-title">🧠 Activity Intelligence Score</h2>

          <div className="erp-score-circle">
            {stats.activityScore}
          </div>

          <p className="erp-muted erp-center">
            Based on financial velocity & system activity
          </p>
        </div>

        {/* ALERTS */}
        <div className="erp-glass-card">
          <h2 className="erp-section-title">⚠ Risk Alerts</h2>

          {alerts.length === 0 ? (
            <p className="erp-ok">✔ System Stable</p>
          ) : (
            alerts.map((a, i) => (
              <div key={i} className="erp-alert-card">
                {a}
              </div>
            ))
          )}
        </div>

      </div>

      {/* LIVE TRANSACTIONS */}
      <div className="erp-live-panel">
        <h2 className="erp-section-title">📡 Live Transaction Stream</h2>

        {loading ? (
          <p className="erp-muted">Loading system activity...</p>
        ) : recent.length === 0 ? (
          <p className="erp-muted">No transactions recorded yet.</p>
        ) : (
          <div className="erp-feed">
            {recent.map((r, i) => (
              <div key={i} className="erp-feed-row">
                <div className="erp-feed-info">
                  <b className="erp-member">
                    {r.member_no || "SYSTEM"}
                  </b>
                  <p className="erp-desc">{r.description}</p>
                </div>

                <div className="erp-amount">
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
    <div className="erp-card">
      <p className="erp-muted">{title}</p>
      <h2 className="erp-value">
        {money
          ? `KES ${Number(value || 0).toLocaleString()}`
          : value}
      </h2>
    </div>
  );
}