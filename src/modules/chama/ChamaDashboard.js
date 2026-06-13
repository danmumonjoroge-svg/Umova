import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import {
  Landmark, Wallet, Briefcase, Clock, Plus, Search, Filter,
  HelpCircle, TrendingUp, Building2, Check, X, BadgeCheck
} from "lucide-react";

import "./ChamaDashboard.css";

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
});
const fmt = (n) => currencyFormatter.format(n || 0);

export default function ChamaDashboard() {
  const { chama, member } = useChama();
  const role = String(member?.role || "member").toLowerCase().trim();
  const isTreasurerOrAdmin = ["treasurer", "admin", "super_admin"].includes(role);

  const [transactions, setTransactions] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actioningId, setActioningId] = useState(null);
  const [showInvForm, setShowInvForm] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState("ALL");

  const [newInv, setNewInv] = useState({
    asset_name: "", category: "Sacco", amount_invested: "", description: "",
  });

  // ── Data load ──────────────────────────────────────────────────────────
  const loadEcosystemData = useCallback(async () => {
    if (!chama?.id) return;
    setLoading(true);
    try {
      const [txRaw, walletRaw, invRaw] = await Promise.all([
        supabase.from("chama_contributions").select("*").eq("chama_id", chama.id).order("created_at", { ascending: false }),
        supabase.from("chama_wallets").select("*").eq("chama_id", chama.id),
        supabase.from("chama_investments").select("*").eq("chama_id", chama.id).order("created_at", { ascending: false }),
      ]);

      setTransactions(txRaw.data || []);
      setWallets(walletRaw.data || []);
      setInvestments(invRaw.data || []);
    } catch (err) {
      console.error("Dashboard data load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [chama?.id]);

  useEffect(() => { loadEcosystemData(); }, [loadEcosystemData]);

  // ── Derived figures ────────────────────────────────────────────────────
  const ledgerSplit = useMemo(() => {
    return transactions.reduce((acc, current) => {
      if (current.status === "pending") acc.pending.push(current);
      else if (current.status === "approved") acc.approved.push(current);
      return acc;
    }, { pending: [], approved: [] });
  }, [transactions]);

  const summary = useMemo(() => {
    let savings = 0;
    let pending = 0;
    let totalInvested = 0;

    ledgerSplit.approved.forEach((t) => {
      if (t.account_type === "savings") savings += Number(t.amount || 0);
    });
    ledgerSplit.pending.forEach((t) => { pending += Number(t.amount || 0); });
    investments.forEach((i) => { totalInvested += Number(i.amount_invested || 0); });

    const totalNetWorth = savings + totalInvested;
    return {
      savings, pending, totalInvested, totalNetWorth,
      liquidityRatio: totalNetWorth > 0 ? (savings / totalNetWorth) * 100 : 0,
    };
  }, [ledgerSplit, investments]);

  const filteredInvestments = useMemo(() => {
    return investments.filter((inv) => {
      const matchesSearch =
        inv.asset_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (inv.description && inv.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesFilter = assetFilter === "ALL" || inv.category === assetFilter;
      return matchesSearch && matchesFilter;
    });
  }, [investments, searchQuery, assetFilter]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const handleProcessTransaction = async (id, targetStatus) => {
    setActioningId(id);
    try {
      const { error } = await supabase.from("chama_contributions")
        .update({
          status: targetStatus,
          approved_at: targetStatus === "approved" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
      await loadEcosystemData();
    } catch (err) {
      console.error("Transaction update failed:", err);
    } finally {
      setActioningId(null);
    }
  };

  const handleCreateInvestment = async (e) => {
    e.preventDefault();
    if (!newInv.asset_name || !newInv.amount_invested) return;
    try {
      const { error } = await supabase.from("chama_investments").insert([{
        chama_id: chama.id,
        asset_name: newInv.asset_name,
        category: newInv.category,
        amount_invested: parseFloat(newInv.amount_invested),
        description: newInv.description,
      }]);
      if (error) throw error;
      setNewInv({ asset_name: "", category: "Sacco", amount_invested: "", description: "" });
      setShowInvForm(false);
      await loadEcosystemData();
    } catch (err) {
      console.error("Investment creation failed:", err);
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="cdash-loading">
        <div className="cdash-spinner" />
        <p>Loading group overview…</p>
      </div>
    );
  }

  return (
    <div className="cdash">

      {/* ===================== KPI ROW ===================== */}
      <section className="cdash-kpis">

        <div className="cdash-kpi-card accent-teal">
          <div className="cdash-kpi-head">
            <span>Net Group Worth</span>
            <Landmark size={16} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.totalNetWorth)}</div>
          <div className="cdash-kpi-bar"><div style={{ width: "100%" }} /></div>
          <p className="cdash-kpi-note">Savings + invested assets combined</p>
        </div>

        <div className="cdash-kpi-card accent-emerald">
          <div className="cdash-kpi-head">
            <span>Liquid Savings</span>
            <Wallet size={16} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.savings)}</div>
          <div className="cdash-kpi-bar emerald"><div style={{ width: `${summary.liquidityRatio}%` }} /></div>
          <p className="cdash-kpi-note">{summary.liquidityRatio.toFixed(1)}% of total worth is liquid</p>
        </div>

        <div className="cdash-kpi-card accent-amber">
          <div className="cdash-kpi-head">
            <span>Invested Capital</span>
            <Briefcase size={16} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.totalInvested)}</div>
          <div className="cdash-kpi-bar amber"><div style={{ width: `${100 - summary.liquidityRatio}%` }} /></div>
          <p className="cdash-kpi-note">{(100 - summary.liquidityRatio).toFixed(1)}% allocated to assets</p>
        </div>

        <div className="cdash-kpi-card accent-rose">
          <div className="cdash-kpi-head">
            <span>Pending Review</span>
            <Clock size={16} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.pending)}</div>
          <div className="cdash-kpi-bar rose"><div style={{ width: ledgerSplit.pending.length > 0 ? "100%" : "0%" }} /></div>
          <p className="cdash-kpi-note">{ledgerSplit.pending.length} contribution(s) awaiting approval</p>
        </div>

      </section>

      {/* ===================== TWO COLUMN LAYOUT ===================== */}
      <div className="cdash-split">

        {/* --------------- LEFT: investments + wallets --------------- */}
        <div className="cdash-col">

          <div className="cdash-panel">

            <div className="cdash-panel-head">
              <div>
                <h2>Investment Portfolio</h2>
                <p>Assets and placements held by the group</p>
              </div>
              {isTreasurerOrAdmin && (
                <button className="cdash-btn-primary" onClick={() => setShowInvForm((s) => !s)}>
                  <Plus size={14} /> Add Asset
                </button>
              )}
            </div>

            <div className="cdash-toolbar">
              <div className="cdash-search">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search assets…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="cdash-filter">
                <Filter size={14} />
                <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                  <option value="ALL">All categories</option>
                  <option value="Sacco">Sacco Deposits</option>
                  <option value="Bank Asset">Bank Placements</option>
                  <option value="Agriculture">Agriculture & Livestock</option>
                  <option value="Shares">Equity Shares</option>
                </select>
              </div>
            </div>

            {showInvForm && (
              <form onSubmit={handleCreateInvestment} className="cdash-form">
                <h3>New Investment</h3>
                <div className="cdash-form-grid">
                  <label>
                    <span>Asset Name</span>
                    <input
                      type="text" required placeholder="e.g. CIC Money Market Fund"
                      value={newInv.asset_name}
                      onChange={(e) => setNewInv({ ...newInv, asset_name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Category</span>
                    <select
                      value={newInv.category}
                      onChange={(e) => setNewInv({ ...newInv, category: e.target.value })}
                    >
                      <option value="Sacco">Sacco Deposits</option>
                      <option value="Bank Asset">Bank Placement</option>
                      <option value="Agriculture">Agriculture & Livestock</option>
                      <option value="Shares">Equity Shares</option>
                    </select>
                  </label>
                  <label>
                    <span>Amount (KES)</span>
                    <input
                      type="number" required placeholder="Principal value"
                      value={newInv.amount_invested}
                      onChange={(e) => setNewInv({ ...newInv, amount_invested: e.target.value })}
                    />
                  </label>
                </div>
                <label className="cdash-form-full">
                  <span>Description</span>
                  <input
                    type="text" placeholder="Notes, yield, certificate reference…"
                    value={newInv.description}
                    onChange={(e) => setNewInv({ ...newInv, description: e.target.value })}
                  />
                </label>
                <div className="cdash-form-actions">
                  <button type="button" className="cdash-btn-ghost" onClick={() => setShowInvForm(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="cdash-btn-primary">
                    Save Investment
                  </button>
                </div>
              </form>
            )}

            {filteredInvestments.length === 0 ? (
              <div className="cdash-empty">
                <HelpCircle size={26} />
                <p>No investments match your search.</p>
              </div>
            ) : (
              <div className="cdash-asset-grid">
                {filteredInvestments.map((inv) => (
                  <div key={inv.id} className="cdash-asset-card">
                    <div className="cdash-asset-top">
                      <div className="cdash-asset-info">
                        <span className="cdash-asset-tag">{inv.category}</span>
                        <h4>{inv.asset_name}</h4>
                      </div>
                      <div className="cdash-asset-value">{fmt(inv.amount_invested)}</div>
                    </div>
                    {inv.description && <p className="cdash-asset-desc">{inv.description}</p>}
                    <div className="cdash-asset-footer">
                      <span><TrendingUp size={11} /> Active</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* --------------- WALLETS --------------- */}
          <div className="cdash-panel">
            <div className="cdash-panel-head">
              <div>
                <h2>Holding Wallets</h2>
                <p>Liquidity pools by custody partner</p>
              </div>
            </div>

            {wallets.length === 0 ? (
              <div className="cdash-empty">
                <Wallet size={26} />
                <p>No wallets configured yet.</p>
              </div>
            ) : (
              <div className="cdash-wallet-grid">
                {wallets.map((w) => (
                  <div key={w.id} className="cdash-wallet-card">
                    <div className="cdash-wallet-head">
                      <div className="cdash-wallet-icon"><Building2 size={14} /></div>
                      <span>{w.type} custody</span>
                    </div>
                    <h4>{w.name}</h4>
                    <div className="cdash-wallet-balance">{fmt(w.balance)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* --------------- RIGHT: pending approvals --------------- */}
        <div className="cdash-col cdash-col-side">
          <div className="cdash-panel cdash-sticky">

            <div className="cdash-panel-head">
              <div>
                <h2>Pending Approvals</h2>
                <p>Contributions awaiting review</p>
              </div>
            </div>

            {ledgerSplit.pending.length === 0 ? (
              <div className="cdash-empty cdash-empty-success">
                <BadgeCheck size={22} />
                <h4>All caught up</h4>
                <p>No contributions awaiting approval.</p>
              </div>
            ) : (
              <div className="cdash-approval-list">
                {ledgerSplit.pending.map((tx) => (
                  <div
                    key={tx.id}
                    className={`cdash-approval-row ${actioningId === tx.id ? "processing" : ""}`}
                  >
                    <div className="cdash-approval-info">
                      <div className="cdash-approval-member">
                        <span className="cdash-approval-avatar">
                          {String(tx.member_name || "M").charAt(0)}
                        </span>
                        <strong>{tx.member_name || "Member"}</strong>
                      </div>
                      <div className="cdash-approval-meta">
                        <span className="cdash-approval-amount">{fmt(tx.amount)}</span>
                        <span className="cdash-approval-type">{tx.account_type}</span>
                      </div>
                    </div>

                    {isTreasurerOrAdmin ? (
                      <div className="cdash-approval-actions">
                        <button
                          disabled={actioningId !== null}
                          onClick={() => handleProcessTransaction(tx.id, "approved")}
                          className="cdash-icon-btn approve"
                          aria-label="Approve"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          disabled={actioningId !== null}
                          onClick={() => handleProcessTransaction(tx.id, "rejected")}
                          className="cdash-icon-btn reject"
                          aria-label="Reject"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="cdash-approval-locked">
                        <span className="cdash-pulse" /> Pending
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}