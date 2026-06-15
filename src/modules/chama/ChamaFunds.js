import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  Landmark,
  Wallet,
  TrendingUp,
  ArrowRightLeft,
  Package,
  Building2,
} from "lucide-react";

const Card = ({ title, value, icon: Icon, color }) => (
  <div className={`card ${color}`}>
    <div className="icon">
      <Icon size={18} />
    </div>
    <div>
      <div className="title">{title}</div>
      <div className="value">{value}</div>
    </div>
  </div>
);

const ChamaFundsDashboard = ({ chamaId }) => {
  const [data, setData] = useState([]);

  useEffect(() => {
    load();
  }, [chamaId]);

  const load = async () => {
    const { data } = await supabase
      .from("chama_fund_movements")
      .select("*")
      .eq("chama_id", chamaId);

    setData(data || []);
  };

  /* ===================== CORE CALCULATION ===================== */

  const breakdown = useMemo(() => {
    const accounts = {}; // KCB, CIC, Cash, etc.
    const assets = {};   // sheep, land, etc.

    let totalIn = 0;
    let totalOut = 0;

    data.forEach((tx) => {
      const amount = Number(tx.amount || 0);

      // ---------------- MONEY IN ----------------
      if (tx.type === "deposit" || tx.type === "investment") {
        totalIn += amount;

        const dest = tx.to_destination || "Uncategorized";

        accounts[dest] = (accounts[dest] || 0) + amount;
      }

      // ---------------- MONEY OUT ----------------
      if (tx.type === "withdrawal") {
        totalOut += amount;

        const src = tx.from_source || "Uncategorized";

        accounts[src] = (accounts[src] || 0) - amount;
      }

      // ---------------- TRANSFER ----------------
      if (tx.type === "transfer") {
        const from = tx.from_source || "Unknown";
        const to = tx.to_destination || "Unknown";

        accounts[from] = (accounts[from] || 0) - amount;
        accounts[to] = (accounts[to] || 0) + amount;
      }

      // ---------------- ASSETS ----------------
      if (tx.asset_name) {
        assets[tx.asset_name] =
          (assets[tx.asset_name] || 0) + Number(tx.asset_value || 0);
      }
    });

    return { accounts, assets, totalIn, totalOut };
  }, [data]);

  const netWorth = useMemo(() => {
    const assetTotal = Object.values(breakdown.assets).reduce(
      (a, b) => a + b,
      0
    );

    const accountTotal = Object.values(breakdown.accounts).reduce(
      (a, b) => a + b,
      0
    );

    return assetTotal + accountTotal;
  }, [breakdown]);

  /* ===================== UI ===================== */

  return (
    <div className="funds">

      {/* HEADER */}
      <div className="header">
        <h1>Funds Position Dashboard</h1>
        <p>Real-time SACCO treasury visibility</p>
      </div>

      {/* KPI CARDS */}
      <div className="grid">

        <Card
          title="Total Inflow"
          value={`KES ${breakdown.totalIn}`}
          icon={TrendingUp}
          color="green"
        />

        <Card
          title="Total Outflow"
          value={`KES ${breakdown.totalOut}`}
          icon={ArrowRightLeft}
          color="red"
        />

        <Card
          title="Net Position"
          value={`KES ${netWorth}`}
          icon={Landmark}
          color="blue"
        />

        <Card
          title="Assets Value"
          value={`KES ${Object.values(breakdown.assets).reduce((a,b)=>a+b,0)}`}
          icon={Package}
          color="purple"
        />

      </div>

      {/* ================= BANK / FUND BREAKDOWN ================= */}
      <div className="section">
        <h2>🏦 Where Funds Are Held</h2>

        {Object.entries(breakdown.accounts).map(([name, value]) => (
          <div className="row" key={name}>
            <div className="left">
              <Building2 size={14} />
              <span>{name}</span>
            </div>
            <b>KES {value}</b>
          </div>
        ))}
      </div>

      {/* ================= ASSETS ================= */}
      <div className="section">
        <h2>🐄 Assets & Investments</h2>

        {Object.entries(breakdown.assets).map(([name, value]) => (
          <div className="row" key={name}>
            <span>{name}</span>
            <b>KES {value}</b>
          </div>
        ))}
      </div>

      {/* ================= RAW MOVEMENTS ================= */}
      <div className="section">
        <h2>📜 Recent Movements</h2>

        {data.slice(0, 8).map((t) => (
          <div className="tx" key={t.id}>
            <div>
              <b>{t.type}</b>
              <p>{t.description}</p>
              <small>
                {t.from_source} → {t.to_destination}
              </small>
            </div>

            <div className="amount">
              KES {t.amount}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};

export default ChamaFundsDashboard;