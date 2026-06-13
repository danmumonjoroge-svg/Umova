import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function Dashboard() {
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);

  const [kpi, setKpi] = useState({
    savings: 0,
    loans: 0,
    shares: 0,
    cash: 0,
  });

  const [balanceSheet, setBalanceSheet] = useState({
    assets: 0,
    liabilities: 0,
    equity: 0,
  });

  const [pl, setPl] = useState({
    income: 0,
    expense: 0,
    net: 0,
  });

  const [risk, setRisk] = useState({
    liquidity: 0,
    defaultScore: 0,
    par: 0,
  });

  const [forecast, setForecast] = useState([]);

  // ================= SAFE HELPERS =================
  const clean = (v) => {
    if (v === null || v === undefined) return 0;
    const n = Number(String(v).replace(/,/g, "").trim());
    return isNaN(n) ? 0 : n;
  };

  const normalize = (data) =>
    (data || []).map((r) => ({
      debit: String(r.debit_account_id || "").trim(),
      credit: String(r.credit_account_id || "").trim(),
      amount: clean(r.amount),
      date: r.date || null,
    }));

  const format = (v) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(clean(v));

  // ================= LOAD DATA =================
  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("general_ledger")
      .select("*"); // IMPORTANT FIX: fetch everything

    if (error || !data) {
      console.error(error);
      setLoading(false);
      return;
    }

    const cleanData = normalize(data);

    setLedger(cleanData);
    engine(cleanData);

    setLoading(false);
  };

  // ================= CORE LEDGER ENGINE =================
  const calc = (data, id, type) => {
    let total = 0;
    const accountId = String(id).trim();

    data.forEach((r) => {
      const amt = clean(r.amount);
      const debit = r.debit;
      const credit = r.credit;

      if (type === "asset") {
        if (debit === accountId) total += amt;
        if (credit === accountId) total -= amt;
      }

      if (type === "liability") {
        if (credit === accountId) total += amt;
        if (debit === accountId) total -= amt;
      }
    });

    return clean(total);
  };

  // ================= ENGINE =================
  const engine = (data) => {
    // KPIs
    const savings = calc(data, "1018", "liability");
    const loans = calc(data, "1011", "asset");
    const shares = calc(data, "1012", "liability");
    const cash = calc(data, "1007", "asset");

    setKpi({ savings, loans, shares, cash });

    // BALANCE SHEET
    const assets = cash + loans;
    const liabilities = savings + shares;
    const equity = assets - liabilities;

    setBalanceSheet({
      assets,
      liabilities,
      equity,
    });

    // P&L
    const income = loans * 0.02;
    const expense = savings * 0.005;

    setPl({
      income,
      expense,
      net: income - expense,
    });

    // RISK ENGINE (DOCTOR VIEW)
    const liquidity = cash / (loans || 1);

    let score = 55;
    if (liquidity > 0.6) score -= 20;
    if (liquidity < 0.2) score += 25;
    if (loans > savings * 2) score += 15;

    const par =
      loans > savings ? ((loans - savings) / loans) * 100 : 5;

    setRisk({
      liquidity: liquidity * 100,
      defaultScore: Math.min(100, Math.max(0, score)),
      par,
    });

    // FORECAST ENGINE
    const base = assets;

    setForecast([
      { month: "M+1", value: base * 1.02 },
      { month: "M+2", value: base * 1.04 },
      { month: "M+3", value: base * 1.06 },
    ]);
  };

  // ================= WHATSAPP =================
  const sendWhatsApp = async () => {
    await fetch("/api/whatsapp/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kpi, balanceSheet, risk, pl }),
    });
  };

  // ================= SMS =================
  const sendSMS = async () => {
    await fetch("/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `SACCO REPORT | Loans ${format(
          kpi.loans
        )} | Savings ${format(kpi.savings)} | PAR ${format(risk.par)}%`,
      }),
    });
  };

  // ================= UI =================
  return (
    <div style={styles.page}>

      {/* HEADER */}
      <div style={styles.header}>
        <h1 style={styles.title}>
          🏦 SACCO Executive Banking Dashboard
        </h1>
        <p style={styles.subtitle}>
          Core Banking Engine • Risk Intelligence • Financial Control Center
        </p>
      </div>

      {/* KPI */}
      <div style={styles.kpiGrid}>
        <Card title="Savings" value={kpi.savings} color="#16a34a" />
        <Card title="Loans" value={kpi.loans} color="#dc2626" />
        <Card title="Shares" value={kpi.shares} color="#2563eb" />
        <Card title="Cashbook (1007)" value={kpi.cash} color="#f59e0b" />
      </div>

      {/* MAIN GRID */}
      <div style={styles.grid2}>

        <Panel title="💰 Balance Sheet">
          <Row label="Assets" value={balanceSheet.assets} />
          <Row label="Liabilities" value={balanceSheet.liabilities} />
          <Row label="Equity" value={balanceSheet.equity} />
        </Panel>

        <Panel title="📊 Profit & Loss">
          <Row label="Income" value={pl.income} />
          <Row label="Expense" value={pl.expense} />
          <Row label="Net Profit" value={pl.net} />
        </Panel>

      </div>

      {/* RISK */}
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>🧠 Financial Health (Doctor View)</h2>

        <div style={styles.riskGrid}>
          <Risk label="Liquidity %" value={risk.liquidity} color="#2563eb" />
          <Risk label="Default Score" value={risk.defaultScore} color="#dc2626" />
          <Risk label="PAR %" value={risk.par} color="#f59e0b" />
        </div>
      </div>

      {/* FORECAST */}
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>📈 Forecast Engine</h2>

        {forecast.map((f, i) => (
          <div key={i} style={styles.row}>
            <span>{f.month}</span>
            <strong>KES {format(f.value)}</strong>
          </div>
        ))}
      </div>

      {/* ACTIONS */}
      <div style={styles.panel}>
        <h2 style={styles.sectionTitle}>⚡ Executive Actions</h2>

        <div style={styles.actions}>
          <button style={styles.btnGreen} onClick={sendWhatsApp}>
            📲 WhatsApp Report
          </button>

          <button style={styles.btnBlue} onClick={sendSMS}>
            📩 SMS Alert
          </button>
        </div>
      </div>

    </div>
  );
}

// ================= UI COMPONENTS =================
function Card({ title, value, color }) {
  return (
    <div style={{ ...styles.card, borderLeft: `4px solid ${color}` }}>
      <p>{title}</p>
      <h3>KES {Number(value || 0).toLocaleString()}</h3>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={styles.panelBox}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span>{label}</span>
      <strong>KES {Number(value || 0).toLocaleString()}</strong>
    </div>
  );
}

function Risk({ label, value, color }) {
  return (
    <div style={{ ...styles.riskCard, borderTop: `3px solid ${color}` }}>
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

  panelBox: {
    background: "white",
    padding: 16,
    borderRadius: 12,
    marginTop: 15,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 10,
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

  actions: {
    display: "flex",
    gap: 10,
  },

  btnGreen: {
    background: "#16a34a",
    color: "white",
    padding: 10,
    border: "none",
    borderRadius: 8,
  },

  btnBlue: {
    background: "#2563eb",
    color: "white",
    padding: 10,
    border: "none",
    borderRadius: 8,
  },
};