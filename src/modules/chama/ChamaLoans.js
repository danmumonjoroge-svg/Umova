import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import "./ChamaLoans.css";

import { CreditCard, Search, RefreshCcw, TrendingDown } from "lucide-react";

const ChamaLoans = () => {
  const [data, setData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  /* ================= FETCH ================= */
  const fetchLoans = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("chama_contributions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setData(data || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchLoans();
  }, []);

  /* ================= FILTER ================= */
  const filtered = useMemo(() => {
    return data.filter((row) =>
      (row.name || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  /* ================= HELPERS ================= */
  const num = (v) => Number(v || 0);

  /* ================= LOAN TOTALS ================= */
  const totalLoansIssued = data.reduce(
    (a, b) => a + num(b.loans),
    0
  );

  const totalRepayments = data.reduce(
    (a, b) => a + (num(b.loan_repayment) || 0),
    0
  );

  const totalBalance = totalLoansIssued - totalRepayments;

  return (
    <div className="loans-container">

      {/* HEADER */}
      <div className="loans-header">

        <div className="loans-title">
          <CreditCard size={18} />
          Loan Book (SACCO Ledger)
        </div>

        <div className="loans-actions">

          <div className="loans-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search member..."
            />
          </div>

          <button className="refresh-btn" onClick={fetchLoans}>
            <RefreshCcw size={14} /> Refresh
          </button>

        </div>

      </div>

      {/* KPI STRIP */}
      <div className="loan-kpis">

        <div className="kpi-card">
          <p>Total Loans Issued</p>
          <h3>KES {totalLoansIssued}</h3>
        </div>

        <div className="kpi-card">
          <p>Total Repayments</p>
          <h3>KES {totalRepayments}</h3>
        </div>

        <div className="kpi-card danger">
          <p>Outstanding Balance</p>
          <h3>KES {totalBalance}</h3>
        </div>

      </div>

      {/* TABLE */}
      <div className="table-wrapper">

        {loading ? (
          <p>Loading loan book...</p>
        ) : (

          <table className="loans-table">

            <thead>
              <tr>
                <th>Member</th>
                <th>Date</th>

                <th>Loan Issued</th>
                <th>Repayment</th>
                <th>Balance</th>
              </tr>
            </thead>

            <tbody>

              {filtered.map((row) => {

                const loan = num(row.loans);
                const repayment = num(row.loan_repayment || 0);
                const balance = loan - repayment;

                return (
                  <tr key={row.id}>

                    <td className="name-cell">{row.name}</td>

                    <td>
                      {row.created_at
                        ? new Date(row.created_at).toLocaleDateString()
                        : "-"}
                    </td>

                    <td className="blue">KES {loan}</td>
                    <td className="green">KES {repayment}</td>
                    <td className="total">
                      KES {balance}
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

export default ChamaLoans;