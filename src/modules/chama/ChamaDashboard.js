import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import {
  Landmark, Wallet, Briefcase, Clock, Plus, Search, Filter,
  HelpCircle, TrendingUp, Building2, Check, X, BadgeCheck,
  Send, Users, ShieldAlert, AlertTriangle, Scale
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

  // Core Entity States
  const [transactions, setTransactions] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Interface Component States
  const [actioningId, setActioningId] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");

  // Multi-variant Send Form State
  const [sendForm, setSendForm] = useState({
    amount: "",
    account_type: "savings", // options: savings, loans, fines
    notes: ""
  });
  const [formSubmitting, setFormSubmitting] = useState(false);

  // ── ECOSYSTEM ARCHITECTURE DATA INGESTION ──────────────────────────────
  const loadEcosystemData = useCallback(async () => {
    if (!chama?.id) return;
    setLoading(true);
    try {
      const [txRaw, walletRaw, membersRaw] = await Promise.all([
        supabase.from("chama_contributions").select("*").eq("chama_id", chama.id).order("created_at", { ascending: false }),
        supabase.from("chama_wallets").select("*").eq("chama_id", chama.id),
        supabase.from("chama_members").select("*").eq("chama_id", chama.id).order("member_name", { ascending: true })
      ]);

      setTransactions(txRaw.data || []);
      setWallets(walletRaw.data || []);
      setMembersList(membersRaw.data || []);
    } catch (err) {
      console.error("Critical error pipelines failing context loads:", err);
    } finally {
      setLoading(false);
    }
  }, [chama?.id]);

  useEffect(() => { 
    loadEcosystemData(); 
  }, [loadEcosystemData]);

  // ── FINANCIAL COMPUTED ENGINE PIPELINES (USEMEMO) ──────────────────────
  const ledgerSplit = useMemo(() => {
    return transactions.reduce((acc, current) => {
      if (current.status === "pending") acc.pending.push(current);
      else if (current.status === "approved") acc.approved.push(current);
      return acc;
    }, { pending: [], approved: [] });
  }, [transactions]);

  const summary = useMemo(() => {
    let totalSavings = 0;
    let totalLoansIssued = 0;
    let totalFinesCollected = 0;
    let pendingVerificationValue = 0;

    ledgerSplit.approved.forEach((t) => {
      const amt = Number(t.amount || 0);
      if (t.account_type === "savings") totalSavings += amt;
      if (t.account_type === "loans" || t.account_type === "loan_repayment") totalLoansIssued += amt;
      if (t.account_type === "fines") totalFinesCollected += amt;
    });

    ledgerSplit.pending.forEach((t) => { 
      pendingVerificationValue += Number(t.amount || 0); 
    });

    const netCapitalWorth = totalSavings + totalFinesCollected - (totalLoansIssued * 0.2); // Factoring fractional reserves

    return {
      savings: totalSavings,
      loans: totalLoansIssued,
      fines: totalFinesCollected,
      pending: pendingVerificationValue,
      netWorth: netCapitalWorth
    };
  }, [ledgerSplit]);

  // Filters members dynamically for inline widget view
  const filteredMembers = useMemo(() => {
    return membersList.filter(m => 
      m.member_name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.role?.toLowerCase().includes(memberSearch.toLowerCase())
    );
  }, [membersList, memberSearch]);

  const filteredPendingTransactions = useMemo(() => {
    return ledgerSplit.pending.filter(tx => {
      if (txTypeFilter === "ALL") return true;
      return tx.account_type === txTypeFilter.toLowerCase();
    });
  }, [ledgerSplit.pending, txTypeFilter]);

  // ── TRANSACTION DISPATCH MATRIX (MUTATIONS) ──────────────────────────
  const handleSendContribution = async (e) => {
    e.preventDefault();
    if (!sendForm.amount || parseFloat(sendForm.amount) <= 0) return;

    setFormSubmitting(true);
    try {
      const { error } = await supabase.from("chama_contributions").insert([{
        chama_id: chama.id,
        member_id: member?.id,
        member_name: member?.member_name || "Anonymous Contributor",
        amount: parseFloat(sendForm.amount),
        account_type: sendForm.account_type,
        status: "pending",
        notes: sendForm.notes,
        created_at: new Date().toISOString()
      }]);

      if (error) throw error;
      
      setSendForm({ amount: "", account_type: "savings", notes: "" });
      setShowSendModal(false);
      await loadEcosystemData();
    } catch (err) {
      console.error("Failed to inject pending ledger entry into target table:", err);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleProcessTransaction = async (id, targetStatus) => {
    setActioningId(id);
    try {
      const { error } = await supabase.from("chama_contributions")
        .update({
          status: targetStatus,
          approved_at: targetStatus === "approved" ? new Date().toISOString() : null,
          processed_by: member?.member_name || "System"
        })
        .eq("id", id);
        
      if (error) throw error;
      await loadEcosystemData();
    } catch (err) {
      console.error("Verification pipelines failed state mutation processing:", err);
    } finally {
      setActioningId(null);
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="cdash-loading">
        <div className="cdash-spinner" />
        <p>Synchronizing Ledger Infrastructure Engine...</p>
      </div>
    );
  }

  return (
    <div className="cdash animate-fade-in">
      
      {/* ── TOP ACTION CONSOLE BAR ─────────────────────────────────────── */}
      <div className="cdash-header-bar">
        <div>
          <span className="cdash-eyebrow">Financial Accounting Pipeline</span>
          <h1>Ecosystem Health Metrics</h1>
        </div>
        <button className="cdash-btn-action send-btn" onClick={() => setShowSendModal(true)}>
          <Send size={16} /> Send Contribution
        </button>
      </div>

      {/* ── METRIC DATA KPI CARDS (SAVINGS, LOANS, FINES, PENDING) ─────── */}
      <section className="cdash-kpis">
        <div className="cdash-kpi-card accent-emerald">
          <div className="cdash-kpi-head">
            <span>Chama Liquid Savings</span>
            <Wallet size={18} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.savings)}</div>
          <div className="cdash-kpi-bar emerald"><div style={{ width: "100%" }} /></div>
          <p className="cdash-kpi-note">Active running account balances</p>
        </div>

        <div className="cdash-kpi-card accent-amber">
          <div className="cdash-kpi-head">
            <span>Outstanding Loans</span>
            <Briefcase size={18} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.loans)}</div>
          <div className="cdash-kpi-bar amber"><div style={{ width: "65%" }} /></div>
          <p className="cdash-kpi-note">Capital out with borrowing members</p>
        </div>

        <div className="cdash-kpi-card accent-gold">
          <div className="cdash-kpi-head">
            <span>Levies & Fines Pool</span>
            <Scale size={18} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.fines)}</div>
          <div className="cdash-kpi-bar gold"><div style={{ width: "100%" }} /></div>
          <p className="cdash-kpi-note">Penalty allocations & administrative fines</p>
        </div>

        <div className="cdash-kpi-card accent-rose">
          <div className="cdash-kpi-head">
            <span>Pending Validation</span>
            <Clock size={18} />
          </div>
          <div className="cdash-kpi-value">{fmt(summary.pending)}</div>
          <div className="cdash-kpi-bar rose"><div style={{ width: filteredPendingTransactions.length > 0 ? "100%" : "0%" }} /></div>
          <p className="cdash-kpi-note">Awaiting Treasurer verification</p>
        </div>
      </section>

      {/* ── DOUBLE PIPELINE WORKSPACE GRID ────────────────────────────── */}
      <div className="cdash-split">
        
        {/* LEFT COLUMN: WALLET NODES & MEMBERS DIRECTORY WIDGET */}
        <div className="cdash-col">
          
          {/* CUSTODY WALLETS */}
          <div className="cdash-panel">
            <div className="cdash-panel-head">
              <div>
                <h2>Liquidity Holding Vaults</h2>
                <p>Asset distribution over target custody nodes</p>
              </div>
            </div>
            {wallets.length === 0 ? (
              <div className="cdash-empty">
                <Building2 size={32} />
                <p>No backing wallets mapped to this instance profile.</p>
              </div>
            ) : (
              <div className="cdash-wallet-grid">
                {wallets.map((w) => (
                  <div key={w.id} className="cdash-wallet-card">
                    <div className="cdash-wallet-head">
                      <div className="cdash-wallet-icon"><Building2 size={14} /></div>
                      <span>{w.type?.toUpperCase()}</span>
                    </div>
                    <h4>{w.name}</h4>
                    <div className="cdash-wallet-balance">{fmt(w.balance)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ACTIVE CHAMA MEMBERS DIRECTORY WIDGET */}
          <div className="cdash-panel">
            <div className="cdash-panel-head">
              <div>
                <h2>Chama Members Directory</h2>
                <p>Registered contributors inside this workspace</p>
              </div>
              <div className="cdash-panel-search-wrap">
                <Search size={14} />
                <input 
                  type="text" 
                  placeholder="Search members..." 
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="cdash-members-list">
              {filteredMembers.slice(0, 5).map((m) => (
                <div key={m.id} className="cdash-member-row">
                  <div className="cdash-member-profile">
                    <div className="cdash-member-avatar">
                      {String(m.member_name || "M").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4>{m.member_name}</h4>
                      <span>Joined {new Date(m.created_at).toLocaleDateString("en-KE")}</span>
                    </div>
                  </div>
                  <span className={`cdash-role-tag ${m.role?.toLowerCase()}`}>
                    {m.role || "Member"}
                  </span>
                </div>
              ))}
              {filteredMembers.length === 0 && (
                <p className="cdash-panel-fallback">No registered system members match criteria.</p>
              )}
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: PENDING APPROVAL STREAM */}
        <div className="cdash-col cdash-col-side">
          <div className="cdash-panel cdash-sticky">
            <div className="cdash-panel-head">
              <div>
                <h2>Pending Processing Ledger</h2>
                <p>Transactions awaiting confirmation</p>
              </div>
              <div className="cdash-panel-filter-tool">
                <Filter size={12} />
                <select value={txTypeFilter} onChange={(e) => setTxTypeFilter(e.target.value)}>
                  <option value="ALL">All Accounts</option>
                  <option value="Savings">Savings Only</option>
                  <option value="Loans">Loans Only</option>
                  <option value="Fines">Fines Only</option>
                </select>
              </div>
            </div>

            {filteredPendingTransactions.length === 0 ? (
              <div className="cdash-empty cdash-empty-success">
                <BadgeCheck size={32} className="success-icon" />
                <h4>Ledger Integrity Clean</h4>
                <p>No operational entries are stacked in the queues.</p>
              </div>
            ) : (
              <div className="cdash-approval-list">
                {filteredPendingTransactions.map((tx) => (
                  <div key={tx.id} className={`cdash-approval-row ${actioningId === tx.id ? "processing" : ""}`}>
                    <div className="cdash-approval-info">
                      <div className="cdash-approval-member">
                        <span className="cdash-approval-avatar">
                          {String(tx.member_name || "M").charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>{tx.member_name}</strong>
                          <span className="cdash-tx-notes">{tx.notes || "Standard contribution deposit"}</span>
                        </div>
                      </div>
                      <div className="cdash-approval-meta">
                        <span className="cdash-approval-amount">{fmt(tx.amount)}</span>
                        <span className={`cdash-type-badge ${tx.account_type}`}>
                          {tx.account_type}
                        </span>
                      </div>
                    </div>

                    {isTreasurerOrAdmin ? (
                      <div className="cdash-approval-actions">
                        <button
                          disabled={actioningId !== null}
                          onClick={() => handleProcessTransaction(tx.id, "approved")}
                          className="cdash-icon-btn approve"
                          title="Verify Asset Clear"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          disabled={actioningId !== null}
                          onClick={() => handleProcessTransaction(tx.id, "rejected")}
                          className="cdash-icon-btn reject"
                          title="Reject System Ingestion"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="cdash-approval-locked">
                        <span className="cdash-pulse" /> Pending Approval
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── TRANSACTIONAL MODAL DIALOG (SEND CONTRIBUTION INPUTS) ─────── */}
      {showSendModal && (
        <div className="cdash-modal-overlay">
          <div className="cdash-modal-box animate-scale-up">
            <div className="cdash-modal-head">
              <h3>Dispatch Contribution Funds</h3>
              <button className="close-modal-btn" onClick={() => setShowSendModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSendContribution} className="cdash-modal-form">
              <div className="cdash-modal-field">
                <label>Target Account Category</label>
                <select 
                  value={sendForm.account_type} 
                  onChange={(e) => setSendForm({...sendForm, account_type: e.target.value})}
                >
                  <option value="savings">Savings Contribution</option>
                  <option value="loans">Loan Amortization Repayment</option>
                  <option value="fines">Levy / Late Penalty Fee Payment</option>
                </select>
              </div>

              <div className="cdash-modal-field">
                <label>Transaction Principal Value (KES)</label>
                <div className="currency-input-wrapper">
                  <span className="currency-denom">KES</span>
                  <input 
                    type="number" 
                    required 
                    placeholder="e.g. 4,000" 
                    value={sendForm.amount}
                    onChange={(e) => setSendForm({...sendForm, amount: e.target.value})}
                  />
                </div>
              </div>

              <div className="cdash-modal-field">
                <label>Reference Notes / Manifest</label>
                <input 
                  type="text" 
                  placeholder="e.g. M-Pesa Ref or June Mandatory Contribution" 
                  value={sendForm.notes}
                  onChange={(e) => setSendForm({...sendForm, notes: e.target.value})}
                />
              </div>

              <div className="cdash-modal-warning">
                <AlertTriangle size={16} />
                <p>Funds will transition immediately into a <strong>pending</strong> state waiting for a certified Treasurer verification signature.</p>
              </div>

              <div className="cdash-modal-actions">
                <button type="button" className="cdash-btn-ghost" onClick={() => setShowSendModal(false)}>
                  Abort
                </button>
                <button type="submit" className="cdash-btn-primary" disabled={formSubmitting}>
                  {formSubmitting ? <div className="cdash-spinner-micro" /> : "Transmit Pipeline Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}