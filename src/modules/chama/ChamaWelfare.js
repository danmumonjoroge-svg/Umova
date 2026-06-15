import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import "./ChamaWelfare.css";

import { HeartHandshake, Search, RefreshCcw, AlertTriangle } from "lucide-react";

const ChamaWelfare = () => {
  const [data, setData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  /* ================= FETCH ================= */
  const fetchData = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("chama_contributions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setData(data || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* ================= HELPERS ================= */
  const num = (v) => Number(v || 0);

  /* ================= GROUP BY MEMBER ================= */
  const memberMap = useMemo(() => {
    const map = {};

    data.forEach((row) => {
      const name = row.name || "Unknown";

      if (!map[name]) {
        map[name] = {
          name,
          welfare: 0,
          contributions: 0,
        };
      }

      map[name].welfare += num(row.welfare);
      map[name].contributions += 1;
    });

    return Object.values(map);
  }, [data]);

  /* ================= FILTER ================= */
  const filtered = useMemo(() => {
    return memberMap.filter((m) =>
      m.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [memberMap, search]);

  /* ================= KPIS ================= */
  const totalWelfare = memberMap.reduce(
    (a, b) => a + b.welfare,
    0
  );

  const averageContribution =
    memberMap.length > 0
      ? totalWelfare / memberMap.length
      : 0;

  const lowContributors = memberMap.filter(
    (m) => m.welfare < averageContribution * 0.5
  );

  /* ================= TARGET (CONFIGURABLE) ================= */
  const WELFARE_TARGET = 5000; // per member baseline (can be dynamic later)

  return (
    <div className="welfare-container">

      {/* HEADER */}
      <div className="welfare-header">

        <div className="welfare-title">
          <HeartHandshake size={18} />
          Welfare Fund Module
        </div>

        <div className="welfare-actions">

          <div className="welfare-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search member..."
            />
          </div>

          <button className="refresh-btn" onClick={fetchData}>
            <RefreshCcw size={14} /> Refresh
          </button>

        </div>

      </div>

      {/* KPI STRIP */}
      <div className="welfare-kpis">

        <div className="kpi-card">
          <p>Total Welfare Pool</p>
          <h3>KES {totalWelfare}</h3>
        </div>

        <div className="kpi-card">
          <p>Average Contribution</p>
          <h3>KES {averageContribution.toFixed(0)}</h3>
        </div>

        <div className="kpi-card danger">
          <p>Low Contributors</p>
          <h3>{lowContributors.length}</h3>
        </div>

      </div>

      {/* WARNING PANEL */}
      {lowContributors.length > 0 && (
        <div className="warning-box">

          <AlertTriangle size={16} />
          <span>
            {lowContributors.length} members are below expected welfare contribution level
          </span>

        </div>
      )}

      {/* TABLE */}
      <div className="table-wrapper">

        {loading ? (
          <p>Loading welfare data...</p>
        ) : (

          <table className="welfare-table">

            <thead>
              <tr>
                <th>Member</th>
                <th>Total Welfare</th>
                <th>Expected Target</th>
                <th>Gap</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              {filtered.map((m) => {

                const gap = WELFARE_TARGET - m.welfare;

                const status =
                  m.welfare >= WELFARE_TARGET
                    ? "Good"
                    : m.welfare >= WELFARE_TARGET * 0.5
                    ? "Warning"
                    : "Critical";

                return (
                  <tr key={m.name}>

                    <td className="name-cell">{m.name}</td>

                    <td>KES {m.welfare}</td>

                    <td>KES {WELFARE_TARGET}</td>

                    <td className={gap > 0 ? "red" : "green"}>
                      KES {gap}
                    </td>

                    <td
                      className={
                        status === "Good"
                          ? "green"
                          : status === "Warning"
                          ? "orange"
                          : "red"
                      }
                    >
                      {status}
                    </td>

                  </tr>
                );
              })}

            </tbody>

          </table>

        )}

      </div>

    </div>
  );
};

export default ChamaWelfare;