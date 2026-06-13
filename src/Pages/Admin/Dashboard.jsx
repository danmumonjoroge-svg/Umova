import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function Dashboard() {
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ACC = useMemo(
    () => ({
      CASH: "1007",
      LOANS: "1011",
      SAVINGS: "1018",
      SHARES: "1012",
      INTEREST_INCOME: "1020",
      EXPENSE: "1006",
    }),
    []
  );

  // ================= SAFE NUMBER =================
  const n = (v) => {
    const x = Number(String(v ?? 0).replace(/,/g, "").trim());
    return isNaN(x) ? 0 : x;
  };

  // ================= LOAD =================
  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("general_ledger")
      .select("*");

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    setLedger(data || []);
    setLoading(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ================= CORE LEDGER ENGINE =================
  const calcAccount = (accountId, mode = "asset") => {
    let balance = 0;

    ledger.forEach((tx) => {
      const amt = n(tx.amount);
      const debit = String(tx.debit_account_id);
      const credit = String(tx.credit_account_id);

      if (mode === "asset") {
        if (debit === accountId) balance += amt;
        if (credit === accountId) balance -= amt;
      }

      if (mode === "liability") {
        if (credit === accountId) balance += amt;
        if (debit === accountId) balance -= amt;
      }

      if (mode === "income") {
        if (credit === accountId) balance += amt;
      }

      if (mode === "expense") {
        if (debit === accountId) balance += amt;
      }
    });

    return balance;
  };

  // ================= KPIs =================
  const kpi = useMemo(() => {
    const cash = calcAccount(ACC.CASH, "asset");
    const loans = calcAccount(ACC.LOANS, "asset");
    const savings = calcAccount(ACC.SAVINGS, "liability");
    const shares = calcAccount(ACC.SHARES, "liability");

    return { cash, loans, savings, shares };
  }, [ledger]);

  // ================= PROFIT & LOSS =================
  const pl = useMemo(() => {
    const income = calcAccount(ACC.INTEREST_INCOME, "income");
    const expense = calcAccount(ACC.EXPENSE, "expense");

    return {
      income,
      expense,
      net: income - expense,
    };
  }, [ledger]);

  // ================= BALANCE SHEET =================
  const bs = useMemo(() => {
    const assets = kpi.cash + kpi.loans;
    const liabilities = kpi.savings + kpi.shares;
    const equity = assets - liabilities;

    return { assets, liabilities, equity };
  }, [kpi]);

  // ================= RISK ENGINE =================
  const risk = useMemo(() => {
    const liquidity = kpi.cash / (kpi.loans || 1);
    const par = kpi.loans > kpi.savings
      ? ((kpi.loans - kpi.savings) / (kpi.loans || 1)) * 100
      : 5;

    let score = 50;
    if (liquidity < 0.2) score += 25;
    if (liquidity > 0.6) score -= 20;
    if (kpi.loans > kpi.savings * 2) score += 15;

    return {
      liquidity: liquidity * 100,
      par,
      score: Math.min(100, Math.max(0, score)),
    };
  }, [kpi]);

  // ================= FORMAT =================
  const format = (v) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v || 0);

  // ================= EXPORT =================
  const exportCSV = () => {
    const rows = [
      ["Metric", "Value"],
      ["Cash", kpi.cash],
      ["Loans", kpi.loans],
      ["Savings", kpi.savings],
      ["Shares", kpi.shares],
      ["Assets", bs.assets],
      ["Liabilities", bs.liabilities],
      ["Equity", bs.equity],
      ["Income", pl.income],
      ["Expense", pl.expense],
      ["Net", pl.net],
      ["PAR", risk.par],
      ["Liquidity", risk.liquidity],
      ["Risk Score", risk.score],
    ];

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "sacco_dashboard.csv";
    link.click();
  };

  // ================= PRINT =================
  const printReport = () => window.print();

  // ================= UI =================
  return (
    <div style={styles.page}>

      {/* HEADER */}
      <div style={styles.header}>
        <h1 style={styles.title}>🏦 SACCO Executive Dashboard</h1>
        <p style={styles.subtitle}>
          Real-time General Ledger Intelligence Engine
        </p>

        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button style={styles.btnGreen} onClick={refresh}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          <button style={styles.btnBlue} onClick={exportCSV}>
            Export CSV
          </button>

          <button style={styles.btnDark} onClick={printReport}>
            Print
          </button>
        </div>
      </div>

      {/* KPI */}
      <div style={styles.kpiGrid}>
        <Card title="Cash" value={kpi.cash} />
        <Card title="Loans" value={kpi.loans} />
        <Card title="Savings" value={kpi.savings} />
        <Card title="Shares" value={kpi.shares} />
      </div>

      {/* MAIN GRID */}
      <div style={styles.grid2}>

        <Panel title="💰 Balance Sheet">
          <Row label="Assets" value={bs.assets} />
          <Row label="Liabilities" value={bs.liabilities} />
          <Row label="Equity" value={bs.equity} />
        </Panel>

        <Panel title="📊 Profit & Loss">
          <Row label="Income" value={pl.income} />
          <Row label="Expense" value={pl.expense} />
          <Row label="Net Profit" value={pl.net} />
        </Panel>

      </div>

      {/* RISK */}
      <div style={styles.panel}>
        <h3>🧠 Risk Engine</h3>

        <div style={styles.riskGrid}>
          <Risk label="Liquidity %" value={risk.liquidity} />
          <Risk label="PAR %" value={risk.par} />
          <Risk label="Risk Score" value={risk.score} />
        </div>
      </div>

    </div>
  );
}

// ================= COMPONENTS =================
function Card({ title, value }) {
  return (
    <div style={styles.card}>
      <p>{title}</p>
      <h3>{Number(value || 0).toLocaleString()}</h3>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={styles.panel}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>{Number(value || 0).toLocaleString()}</strong>
    </div>
  );
}

function Risk({ label, value }) {
  return (
    <div style={styles.riskCard}>
      <p>{label}</p>
      <h4>{Number(value || 0).toFixed(2)}</h4>
    </div>
  );
}

// ================= STYLES =================
const styles = {
  page: {
    padding: 28,
    fontFamily: "Inter, Arial",
    background: "linear-gradient(135deg,#eef2ff,#f8fafc)",
    minHeight: "100vh",
  },

  header: { marginBottom: 20 },

  title: { fontSize: 26, fontWeight: 800 },

  subtitle: { color: "#6b7280", fontSize: 13 },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4,1fr)",
    gap: 12,
    marginBottom: 20,
  },

  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },

  card: {
    background: "white",
    padding: 14,
    borderRadius: 12,
    boxShadow: "0 4px 15px rgba(0,0,0,0.05)",
  },

  panel: {
    marginTop: 15,
    background: "white",
    padding: 16,
    borderRadius: 12,
  },

  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
  },

  riskGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3,1fr)",
    gap: 10,
  },

  riskCard: {
    background: "#f9fafb",
    padding: 12,
    borderRadius: 10,
  },

  btnGreen: {
    background: "#16a34a",
    color: "white",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
  },

  btnBlue: {
    background: "#2563eb",
    color: "white",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
  },

  btnDark: {
    background: "#111827",
    color: "white",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
  },
};