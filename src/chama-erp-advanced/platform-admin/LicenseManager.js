import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import {
  Building2, PlusCircle, Loader2, X, ShieldCheck, ShieldAlert, Clock,
  Wallet, TrendingUp, Gift, CreditCard, History,
} from "lucide-react";
import "./LicenseManager.css";

// -----------------------------------------------------------------------------
// LicenseManager (Platform Manager Dashboard)
// This is the "who's paid, who hasn't, how many days are left" screen —
// the real operating console for running the platform, not just a raw
// license_status/license_expiry field editor.
//
// Model: prepaid, like a utility meter. A chama's license_expiry is when
// its paid period runs out; recording a payment pushes it forward, same
// as topping up. Blocking already happens automatically at login time
// (see ChamaContext.js's isLicenseValid()) purely by comparing that date
// to today — nobody has to manually flip a switch to lock someone out.
// This screen is where you flip the switch that lets them back IN.
// -----------------------------------------------------------------------------

const PERIOD_PRESETS = [
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
];

function formatKES(v) {
  return `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function daysLeft(expiry) {
  if (!expiry) return null;
  const ms = new Date(expiry).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

// One computed "what's actually true right now" status, instead of trusting
// the raw license_status string alone — same rule the login gate uses.
function effectiveStatus(chama) {
  if (chama.license_plan === "free") return { label: "Free", tone: "free", days: null };
  if (chama.license_status === "suspended") return { label: "Suspended", tone: "bad", days: null };
  const d = daysLeft(chama.license_expiry);
  if (d === null) return { label: "Active (no expiry set)", tone: "good", days: null };
  if (d < 0) return { label: `Overdue ${Math.abs(d)}d`, tone: "bad", days: d };
  if (d === 0) return { label: "Due today", tone: "warn", days: d };
  if (d <= 7) return { label: `Due in ${d}d`, tone: "warn", days: d };
  return { label: chama.license_status === "trial" ? `Trial · ${d}d left` : `${d}d left`, tone: "good", days: d };
}

const emptyNewChama = { name: "", chama_no: "", phone: "" };

export default function LicenseManager() {
  const [chamas, setChamas] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [creating, setCreating] = useState(false);
  const [newChama, setNewChama] = useState(emptyNewChama);
  const [saving, setSaving] = useState(false);

  const [payModal, setPayModal] = useState(null); // chama being paid for
  const [payForm, setPayForm] = useState({ amount: "", method: "MPESA", reference: "", periodDays: 30, notes: "" });
  const [paying, setPaying] = useState(false);

  const [historyFor, setHistoryFor] = useState(null); // chama whose payment history is shown

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [chamasRes, paymentsRes] = await Promise.all([
      supabase.from("chamas").select("id, name, chama_no, phone, license_status, license_expiry, license_plan, created_at").order("created_at", { ascending: false }),
      supabase.from("chama_payments").select("*").order("paid_on", { ascending: false }),
    ]);
    if (chamasRes.error) setError(chamasRes.error.message);
    else setChamas(chamasRes.data || []);
    setPayments(paymentsRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const rows = chamas.map((c) => ({ ...c, _status: effectiveStatus(c) }));
    return {
      total: chamas.length,
      free: rows.filter((r) => r._status.tone === "free").length,
      good: rows.filter((r) => r._status.tone === "good").length,
      dueSoon: rows.filter((r) => r._status.tone === "warn").length,
      overdue: rows.filter((r) => r._status.tone === "bad").length,
      revenue: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    };
  }, [chamas, payments]);

  const createChama = async (e) => {
    e.preventDefault();
    if (!newChama.name.trim() || !newChama.chama_no.trim()) return;
    setSaving(true);
    const { error: err } = await supabase.from("chamas").insert([{
      name: newChama.name, chama_no: newChama.chama_no, phone: newChama.phone || null,
      license_status: "trial", license_plan: "trial", license_expiry: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    }]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setCreating(false);
    setNewChama(emptyNewChama);
    load();
  };

  const openPayModal = (c) => { setPayModal(c); setPayForm({ amount: "", method: "MPESA", reference: "", periodDays: 30, notes: "" }); };

  const submitPayment = async () => {
    if (!payForm.amount || Number(payForm.amount) <= 0) return;
    setPaying(true);
    const { error: err } = await supabase.rpc("record_chama_payment", {
      p_chama_id: payModal.id,
      p_amount: Number(payForm.amount),
      p_method: payForm.method,
      p_reference: payForm.reference || null,
      p_period_days: Number(payForm.periodDays),
      p_notes: payForm.notes || null,
    });
    setPaying(false);
    if (err) { setError(err.message); return; }
    setPayModal(null);
    load();
  };

  const toggleFree = async (c) => {
    const nowFree = c.license_plan === "free";
    await supabase.rpc("set_chama_free", { p_chama_id: c.id, p_free: !nowFree });
    load();
  };

  const openHistory = (c) => setHistoryFor(c);
  const historyRows = historyFor ? payments.filter((p) => p.chama_id === historyFor.id) : [];

  return (
    <div className="plm-page">
      <div className="plm-header">
        <div>
          <span className="plm-icon"><Building2 size={18} /></span>
          <div>
            <h1>Platform Manager</h1>
            <p>Who's paid, who's overdue, and how many days each chama has left.</p>
          </div>
        </div>
        <button className="plm-add-btn" onClick={() => setCreating((v) => !v)}>
          <PlusCircle size={16} /> New chama
        </button>
      </div>

      <div className="plm-summary-strip">
        <div className="plm-summary-card"><span>Total chamas</span><strong>{summary.total}</strong></div>
        <div className="plm-summary-card good"><span>Paid up</span><strong>{summary.good}</strong></div>
        <div className="plm-summary-card warn"><span>Due soon</span><strong>{summary.dueSoon}</strong></div>
        <div className="plm-summary-card bad"><span>Overdue</span><strong>{summary.overdue}</strong></div>
        <div className="plm-summary-card free"><span>Free mode</span><strong>{summary.free}</strong></div>
        <div className="plm-summary-card revenue"><span><TrendingUp size={12} /> Total collected</span><strong>{formatKES(summary.revenue)}</strong></div>
      </div>

      {error && <div className="plm-error">{error}</div>}

      {creating && (
        <form className="plm-form" onSubmit={createChama}>
          <div className="plm-form-grid">
            <label>Chama name<input value={newChama.name} onChange={(e) => setNewChama((f) => ({ ...f, name: e.target.value }))} required /></label>
            <label>Chama code<input value={newChama.chama_no} onChange={(e) => setNewChama((f) => ({ ...f, chama_no: e.target.value }))} placeholder="e.g. CHM-100001" required /></label>
            <label>Phone (optional)<input value={newChama.phone} onChange={(e) => setNewChama((f) => ({ ...f, phone: e.target.value }))} /></label>
          </div>
          <p className="plm-form-hint">Starts on a 30-day trial, same as self-registration.</p>
          <div className="plm-form-actions">
            <button type="button" className="plm-cancel" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="plm-submit" disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : "Create chama"}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="plm-loading"><Loader2 size={20} className="spin" /></div>
      ) : chamas.length === 0 ? (
        <p className="plm-empty">No chamas yet.</p>
      ) : (
        <div className="plm-table">
          <div className="plm-table-head">
            <span>Chama</span><span>Code</span><span>Status</span><span>Expiry</span><span></span>
          </div>
          {chamas.map((c) => {
            const st = effectiveStatus(c);
            const Icon = st.tone === "good" ? ShieldCheck : st.tone === "warn" ? Clock : st.tone === "free" ? Gift : ShieldAlert;
            return (
              <div className="plm-table-row" key={c.id}>
                <span className="plm-name">{c.name}</span>
                <span>{c.chama_no}</span>
                <span className={`plm-status ${st.tone}`}><Icon size={13} /> {st.label}</span>
                <span>{c.license_expiry || "—"}</span>
                <div className="plm-row-actions">
                  <button className="plm-pay-btn" onClick={() => openPayModal(c)} disabled={c.license_plan === "free"}><CreditCard size={12} /> Record payment</button>
                  <button className="plm-history-btn" onClick={() => openHistory(c)}><History size={12} /></button>
                  <button className={`plm-free-btn ${c.license_plan === "free" ? "active" : ""}`} onClick={() => toggleFree(c)}>
                    <Gift size={12} /> {c.license_plan === "free" ? "Free" : "Make free"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {payModal && (
        <div className="plm-modal-overlay" onClick={() => setPayModal(null)}>
          <div className="plm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="plm-modal-head">
              <h3><Wallet size={16} /> Record payment — {payModal.name}</h3>
              <button onClick={() => setPayModal(null)}><X size={18} /></button>
            </div>
            <p className="plm-modal-hint">
              Current expiry: <strong>{payModal.license_expiry || "none set"}</strong>. This payment extends it —
              if it's already in the future, the new period stacks on top instead of replacing it.
            </p>

            <label>Amount (KES)<input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} /></label>
            <label>
              Method
              <select value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank Transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <label>Reference (optional)<input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="M-Pesa code, receipt no." /></label>
            <label>
              Period this covers
              <div className="plm-period-chips">
                {PERIOD_PRESETS.map((p) => (
                  <button type="button" key={p.days} className={`plm-period-chip ${Number(payForm.periodDays) === p.days ? "active" : ""}`}
                    onClick={() => setPayForm((f) => ({ ...f, periodDays: p.days }))}>
                    {p.label}
                  </button>
                ))}
              </div>
            </label>
            <label>Notes (optional)<input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} /></label>

            <div className="plm-modal-actions">
              <button className="plm-cancel" onClick={() => setPayModal(null)}>Cancel</button>
              <button className="plm-submit" onClick={submitPayment} disabled={paying}>
                {paying ? <Loader2 size={14} className="spin" /> : "Record & extend license"}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="plm-modal-overlay" onClick={() => setHistoryFor(null)}>
          <div className="plm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="plm-modal-head">
              <h3><History size={16} /> Payment history — {historyFor.name}</h3>
              <button onClick={() => setHistoryFor(null)}><X size={18} /></button>
            </div>
            {historyRows.length === 0 ? (
              <p className="plm-empty">No payments recorded yet.</p>
            ) : (
              <div className="plm-history-list">
                {historyRows.map((p) => (
                  <div className="plm-history-row" key={p.id}>
                    <div>
                      <strong>{formatKES(p.amount)}</strong>
                      <span>{p.method} {p.reference ? `· ${p.reference}` : ""}</span>
                    </div>
                    <div className="plm-history-meta">
                      <span>{p.paid_on}</span>
                      <span>+{p.period_days}d</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
