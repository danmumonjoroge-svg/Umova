import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import "./chamacontributions.css";

import { Wallet, Search, RefreshCcw } from "lucide-react";

const Contributions = () => {
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

  /* ================= FILTER ================= */
  const filtered = useMemo(() => {
    return data.filter((row) =>
      (row.name || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  /* ================= FORMAT ================= */
  const format = (val) => Number(val || 0);

  return (
    <div className="contributions-container">

      {/* HEADER */}
      <div className="contributions-header">

        <div className="contributions-title">
          <Wallet size={18} />
          Contributions Ledger
        </div>

        <div className="contributions-actions">

          <div className="contributions-search">
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

      {/* TABLE */}
      <div className="table-wrapper">

        {loading ? (
          <p>Loading ledger...</p>
        ) : (

          <table className="contributions-table">

            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>

                <th>Savings</th>
                <th>Fines</th>
                <th>Loans</th>
                <th>Welfare</th>
                <th>Merry Go Round</th>

                <th>Total</th>
              </tr>
            </thead>

            <tbody>

              {filtered.map((row) => {

                const savings = format(row.savings);
                const fines = format(row.fines);
                const loans = format(row.loans);
                const welfare = format(row.welfare);
                const mg = format(row.merry_go_round);

                const total =
                  savings + fines + loans + welfare + mg;

                return (
                  <tr key={row.id}>

                    <td className="name-cell">{row.name}</td>

                    <td>
                      {row.created_at
                        ? new Date(row.created_at).toLocaleDateString()
                        : "-"}
                    </td>

                    <td className="green">KES {savings}</td>
                    <td className="red">KES {fines}</td>
                    <td className="blue">KES {loans}</td>
                    <td className="purple">KES {welfare}</td>
                    <td className="orange">KES {mg}</td>

                    <td className="total">
                      KES {total}
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

export default Contributions;