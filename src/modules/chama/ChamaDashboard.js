import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";
import {
  Wallet, Briefcase, Clock, Search, Filter,
  TrendingUp, Building2, Check, X, BadgeCheck,
  Send, Users, Scale, ChevronRight, Upload,
  Plus, Eye, ArrowUpRight, ArrowDownLeft,
  Landmark, PiggyBank, ShieldCheck, HeartHandshake,
  AlertCircle, FileText, CreditCard, BarChart3,
  Home, RefreshCw, DollarSign, Receipt, Settings,
  ChevronLeft, Menu, CheckCircle2, XCircle, Loader2
} from "lucide-react";

import "./ChamaDashboard.css";

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "";

// ─── ACCOUNT TYPE CONFIG ──────────────────────────────────────────────────────
const ACCOUNT_TYPES = {
  savings:  { label: "Savings",   color: "emerald", icon: PiggyBank,      sidebar: true },
  loans:    { label: "Loans",     color: "amber",   icon: Briefcase,      sidebar: true },
  fines:    { label: "Fines",     color: "rose",    icon: Scale,          sidebar: true },
  welfare:  { label: "Welfare",   color: "violet",  icon: HeartHandshake, sidebar: true },
};

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    pending:  { cls: "badge-pending",  icon: Clock,         label: "Pending" },
    approved: { cls: "badge-approved", icon: CheckCircle2,  label: "Approved" },
    rejected: { cls: "badge-rejected", icon: XCircle,       label: "Rejected" },
  };
  const cfg = map[status] || map.pending;
  const Icon = cfg.icon;
  return (
    <span className={`status-badge ${cfg.cls}`}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
};

// ─── TYPE PILL ────────────────────────────────────────────────────────────────
const TypePill = ({ type }) => {
  const cfg = ACCOUNT_TYPES[type] || { label: type, color: "slate" };
  return <span className={`type-pill pill-${cfg.color}`}>{cfg.label}</span>;
};

// ─── AVATAR ───────────────────────────────────────────────────────────────────
const Avatar = ({ name, size = "md" }) => (
  <div className={`avatar avatar-${size}`}>
    {String(name || "?").charAt(0).toUpperCase()}
  </div>
);

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────
const EmptyState = ({ icon: Icon, title, sub }) => (
  <div className="empty-state">
    <div className="empty-icon"><Icon size={28} /></div>
    <h4>{title}</h4>
    {sub && <p>{sub}</p>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: MEMBERS LIST
// ═══════════════════════════════════════════════════════════════════════════════
const MembersModal = ({ members, onClose }) => {
  const [search, setSearch] = useState("");
  const filtered = members.filter(m =>
    m.member_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.role?.toLowerCase().includes(search.toLowerCase()) ||
    m.phone?.includes(search)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Users size={20} />
            <div>
              <h3>Chama Members</h3>
              <p>{members.length} registered member{members.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-search-bar">
          <Search size={14} />
          <input placeholder="Search by name, role or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="modal-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={m.id}>
                  <td className="td-num">{i + 1}</td>
                  <td>
                    <div className="td-member">
                      <Avatar name={m.member_name} size="sm" />
                      <span>{m.member_name}</span>
                    </div>
                  </td>
                  <td><span className={`role-tag role-${m.role?.toLowerCase()}`}>{m.role || "Member"}</span></td>
                  <td className="td-mono">{m.phone || "—"}</td>
                  <td>{fmtDate(m.created_at)}</td>
                  <td>
                    <span className={`dot-status ${m.status === "active" ? "dot-active" : "dot-inactive"}`}>
                      {m.status || "active"}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="td-empty">No members match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: CONTRIBUTIONS TABLE (all members × all types)
// ═══════════════════════════════════════════════════════════════════════════════
const ContributionsModal = ({ transactions, members, onClose }) => {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [memberFilter, setMemberFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filtered = transactions.filter(tx => {
    const okType   = typeFilter   === "ALL" || tx.account_type === typeFilter;
    const okMember = memberFilter === "ALL" || tx.member_id    === memberFilter;
    const okStatus = statusFilter === "ALL" || tx.status       === statusFilter;
    return okType && okMember && okStatus;
  });

  const total = filtered.filter(t => t.status === "approved").reduce((s, t) => s + Number(t.amount || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-xl" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Receipt size={20} />
            <div>
              <h3>All Contributions</h3>
              <p>{filtered.length} transaction{filtered.length !== 1 ? "s" : ""} · Approved total: {fmt(total)}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-filter-row">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="ALL">All Types</option>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}>
            <option value="ALL">All Members</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.member_name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="ALL">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="modal-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Member</th>
                <th>Type</th>
                <th>Amount</th>
                <th>M-Pesa Ref</th>
                <th>Notes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <tr key={tx.id}>
                  <td className="td-num">{i + 1}</td>
                  <td>
                    <div className="td-date">
                      <span>{fmtDate(tx.created_at)}</span>
                      <span className="td-time">{fmtTime(tx.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="td-member">
                      <Avatar name={tx.member_name} size="sm" />
                      <span>{tx.member_name}</span>
                    </div>
                  </td>
                  <td><TypePill type={tx.account_type} /></td>
                  <td className="td-amount">{fmt(tx.amount)}</td>
                  <td className="td-mono">{tx.mpesa_ref || "—"}</td>
                  <td className="td-notes">{tx.notes || "—"}</td>
                  <td><StatusBadge status={tx.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="td-empty">No transactions match selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: SEND CONTRIBUTION (member-facing)
// ═══════════════════════════════════════════════════════════════════════════════
const SendContributionModal = ({ member, chama, onClose, onSuccess }) => {
  const [form, setForm] = useState({ amount: "", account_type: "savings", mpesa_ref: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter a valid amount.");
    if (!form.mpesa_ref.trim()) return setError("M-Pesa reference code is required.");

    setSubmitting(true);
    try {
      const { error: err } = await supabase.from("chama_contributions").insert([{
        chama_id: chama.id,
        member_id: member?.id,
        member_name: member?.member_name || "Unknown",
        amount: parseFloat(form.amount),
        account_type: form.account_type,
        mpesa_ref: form.mpesa_ref.trim().toUpperCase(),
        notes: form.notes,
        status: "pending",
        created_at: new Date().toISOString(),
      }]);
      if (err) throw err;
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.message || "Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const types = Object.entries(ACCOUNT_TYPES);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Send size={20} />
            <div>
              <h3>Record Contribution</h3>
              <p>M-Pesa payment confirmation</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {/* Type selector cards */}
          <div className="field-group">
            <label>Contribution Type</label>
            <div className="type-card-grid">
              {types.map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={key}
                    className={`type-card ${form.account_type === key ? `type-card-active tc-${cfg.color}` : ""}`}
                    onClick={() => setForm(f => ({ ...f, account_type: key }))}
                    type="button"
                  >
                    <Icon size={18} />
                    <span>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field-group">
            <label>Amount You Sent (KES)</label>
            <div className="amount-input-wrap">
              <span className="amount-prefix">KES</span>
              <input
                type="number"
                placeholder="e.g. 500"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>

          <div className="field-group">
            <label>M-Pesa Reference Code</label>
            <input
              type="text"
              placeholder="e.g. QHG7X8KP21"
              value={form.mpesa_ref}
              onChange={e => setForm(f => ({ ...f, mpesa_ref: e.target.value }))}
              className="mono-input"
            />
            <span className="field-hint">Found in the M-Pesa confirmation SMS you received.</span>
          </div>

          <div className="field-group">
            <label>Notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. June mandatory contribution"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {error && (
            <div className="form-error">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div className="send-modal-notice">
            <ShieldCheck size={15} />
            <p>Your payment will stay <strong>pending</strong> until the Treasurer verifies your M-Pesa reference code against the received amount.</p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><Loader2 size={14} className="spin" /> Submitting…</> : <><Send size={14} /> Submit Payment</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: FUND LOCATIONS (Treasurer only)
// ═══════════════════════════════════════════════════════════════════════════════
const FundLocationsModal = ({ wallets, onClose, onSave, isTreasurer }) => {
  const [entries, setEntries] = useState(
    wallets.length > 0
      ? wallets.map(w => ({ ...w, _editing: false }))
      : [{ id: null, name: "", type: "bank", balance: "", institution: "" }]
  );
  const [saving, setSaving] = useState(false);

  const addEntry = () => setEntries(e => [...e, { id: null, name: "", type: "bank", balance: "", institution: "" }]);
  const removeEntry = (i) => setEntries(e => e.filter((_, idx) => idx !== i));
  const updateEntry = (i, field, val) => setEntries(e => e.map((en, idx) => idx === i ? { ...en, [field]: val } : en));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(entries);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Building2 size={20} />
            <div>
              <h3>Fund Locations</h3>
              <p>Where the chama money is held</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {entries.map((entry, i) => (
            <div key={i} className="wallet-entry-card">
              <div className="wallet-entry-head">
                <span className="wallet-entry-num">Account {i + 1}</span>
                {isTreasurer && entries.length > 1 && (
                  <button className="remove-entry-btn" onClick={() => removeEntry(i)}><X size={12} /></button>
                )}
              </div>
              {isTreasurer ? (
                <div className="wallet-entry-fields">
                  <div className="field-row-2">
                    <div className="field-group">
                      <label>Institution Name</label>
                      <input value={entry.institution || entry.name || ""} onChange={e => updateEntry(i, "institution", e.target.value)} placeholder="e.g. KCB, Umoja Sacco" />
                    </div>
                    <div className="field-group">
                      <label>Type</label>
                      <select value={entry.type} onChange={e => updateEntry(i, "type", e.target.value)}>
                        <option value="bank">Bank</option>
                        <option value="sacco">Sacco</option>
                        <option value="mobile">Mobile Money</option>
                        <option value="cash">Cash in Hand</option>
                      </select>
                    </div>
                  </div>
                  <div className="field-group">
                    <label>Current Balance (KES)</label>
                    <div className="amount-input-wrap">
                      <span className="amount-prefix">KES</span>
                      <input type="number" value={entry.balance} onChange={e => updateEntry(i, "balance", e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="wallet-readonly">
                  <span className="wallet-ro-name">{entry.institution || entry.name}</span>
                  <span className="wallet-ro-type">{entry.type}</span>
                  <span className="wallet-ro-balance">{fmt(entry.balance)}</span>
                </div>
              )}
            </div>
          ))}

          {isTreasurer && (
            <button className="add-wallet-btn" onClick={addEntry}>
              <Plus size={14} /> Add Another Account
            </button>
          )}
        </div>

        {isTreasurer && (
          <div className="modal-footer">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save Fund Locations
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL: BANK STATEMENT UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════
const BankStatementModal = ({ chama, member, onClose }) => {
  const [file, setFile] = useState(null);
  const [month, setMonth] = useState("");
  const [institution, setInstitution] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const handleUpload = async () => {
    if (!file || !month || !institution) return setError("Fill in all fields and select a file.");
    setUploading(true);
    setError("");
    try {
      const ext = file.name.split(".").pop();
      const path = `statements/${chama.id}/${institution}-${month}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chama-documents").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      await supabase.from("chama_bank_statements").insert([{
        chama_id: chama.id,
        uploaded_by: member?.member_name,
        institution,
        month,
        file_path: path,
        created_at: new Date().toISOString(),
      }]);
      setDone(true);
    } catch (e) {
      setError(e.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Upload size={20} />
            <div>
              <h3>Upload Bank Statement</h3>
              <p>Monthly financial records</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {done ? (
          <div className="modal-body upload-success">
            <CheckCircle2 size={48} className="success-big-icon" />
            <h4>Statement uploaded successfully</h4>
            <p>The document has been stored securely.</p>
            <button className="btn-primary mt-16" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="modal-body">
              <div className="field-group">
                <label>Bank / Institution</label>
                <input value={institution} onChange={e => setInstitution(e.target.value)} placeholder="e.g. KCB, Equity, Cooperative" />
              </div>
              <div className="field-group">
                <label>Statement Month</label>
                <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
              </div>
              <div className="field-group">
                <label>Statement File (PDF or image)</label>
                <div className="file-drop-zone" onClick={() => fileRef.current?.click()}>
                  {file ? (
                    <div className="file-selected">
                      <FileText size={20} />
                      <span>{file.name}</span>
                      <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={24} />
                      <p>Click to select or drag & drop</p>
                      <span>PDF, JPG, PNG accepted</span>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={e => setFile(e.target.files[0])} />
              </div>
              {error && <div className="form-error"><AlertCircle size={14} /> {error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 size={14} className="spin" /> Uploading…</> : <><Upload size={14} /> Upload Statement</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR PANEL: Per-type ledger view
// ═══════════════════════════════════════════════════════════════════════════════
const SidebarLedger = ({ type, transactions, members, onClose }) => {
  const cfg = ACCOUNT_TYPES[type];
  const Icon = cfg?.icon || Wallet;
  const [search, setSearch] = useState("");

  const typeTxs = transactions.filter(tx => tx.account_type === type);

  // Build per-member summary
  const memberSummary = useMemo(() => {
    const map = {};
    members.forEach(m => {
      map[m.id] = { member: m, approved: 0, pending: 0, rejected: 0, txs: [] };
    });
    typeTxs.forEach(tx => {
      if (!map[tx.member_id]) {
        map[tx.member_id] = { member: { member_name: tx.member_name, id: tx.member_id }, approved: 0, pending: 0, rejected: 0, txs: [] };
      }
      map[tx.member_id][tx.status] += Number(tx.amount || 0);
      map[tx.member_id].txs.push(tx);
    });
    return Object.values(map);
  }, [typeTxs, members]);

  const [expanded, setExpanded] = useState(null);

  const filtered = memberSummary.filter(r =>
    r.member?.member_name?.toLowerCase().includes(search.toLowerCase())
  );

  const grandTotal = memberSummary.reduce((s, r) => s + r.approved, 0);

  return (
    <div className="sidebar-ledger-overlay" onClick={onClose}>
      <div className="sidebar-ledger-panel" onClick={e => e.stopPropagation()}>
        <div className={`sidebar-ledger-header slh-${cfg?.color}`}>
          <div className="sidebar-ledger-title">
            <Icon size={22} />
            <div>
              <h2>{cfg?.label} Ledger</h2>
              <p>Per-member breakdown · Total approved: {fmt(grandTotal)}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sidebar-ledger-search">
          <Search size={14} />
          <input placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="sidebar-ledger-body">
          {filtered.map((row, i) => (
            <div key={row.member?.id || i} className="member-ledger-block">
              <div className="mlb-summary" onClick={() => setExpanded(expanded === i ? null : i)}>
                <div className="mlb-left">
                  <Avatar name={row.member?.member_name} />
                  <div>
                    <h4>{row.member?.member_name}</h4>
                    <div className="mlb-mini-stats">
                      <span className="mms-approved">{fmt(row.approved)} approved</span>
                      {row.pending > 0 && <span className="mms-pending">· {fmt(row.pending)} pending</span>}
                    </div>
                  </div>
                </div>
                <div className="mlb-right">
                  <span className="mlb-count">{row.txs.length} tx{row.txs.length !== 1 ? "s" : ""}</span>
                  <ChevronRight size={14} className={`mlb-chevron ${expanded === i ? "rotated" : ""}`} />
                </div>
              </div>

              {expanded === i && (
                <div className="mlb-transactions">
                  {row.txs.length === 0 ? (
                    <p className="mlb-empty">No {cfg?.label.toLowerCase()} transactions yet.</p>
                  ) : (
                    <table className="data-table compact-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>M-Pesa Ref</th>
                          <th>Notes</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.txs.map(tx => (
                          <tr key={tx.id}>
                            <td>{fmtDate(tx.created_at)}</td>
                            <td className="td-amount">{fmt(tx.amount)}</td>
                            <td className="td-mono">{tx.mpesa_ref || "—"}</td>
                            <td className="td-notes">{tx.notes || "—"}</td>
                            <td><StatusBadge status={tx.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <EmptyState icon={Icon} title="No results" sub="No members match your search." />
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function ChamaDashboard() {
  const { chama, member } = useChama();
  const role = String(member?.role || "member").toLowerCase().trim();
  const isTreasurerOrAdmin = ["treasurer", "admin", "super_admin"].includes(role);

  // ── DATA ──────────────────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioningId, setActioningId] = useState(null);

  // ── UI STATE ──────────────────────────────────────────────────────────────
  const [modal, setModal] = useState(null); // "members" | "contributions" | "send" | "funds" | "statement"
  const [sidebarType, setSidebarType] = useState(null); // "savings" | "loans" | "fines" | "welfare"
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");

  // ── LOAD DATA ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!chama?.id) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [txRaw, walletRaw, membersRaw] = await Promise.all([
        supabase.from("chama_contributions").select("*").eq("chama_id", chama.id).order("created_at", { ascending: false }),
        supabase.from("chama_wallets").select("*").eq("chama_id", chama.id),
        supabase.from("chama_members").select("*").eq("chama_id", chama.id).order("member_name", { ascending: true }),
      ]);
      setTransactions(txRaw.data || []);
      setWallets(walletRaw.data || []);
      setMembersList(membersRaw.data || []);
    } catch (err) {
      console.error("Data load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [chama?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── COMPUTED ──────────────────────────────────────────────────────────────
  const { pending, approved } = useMemo(() => {
    return transactions.reduce((acc, tx) => {
      if (tx.status === "pending") acc.pending.push(tx);
      else if (tx.status === "approved") acc.approved.push(tx);
      return acc;
    }, { pending: [], approved: [] });
  }, [transactions]);

  const summary = useMemo(() => {
    const totals = { savings: 0, loans: 0, fines: 0, welfare: 0, pending: 0 };
    approved.forEach(tx => { totals[tx.account_type] = (totals[tx.account_type] || 0) + Number(tx.amount || 0); });
    pending.forEach(tx => { totals.pending += Number(tx.amount || 0); });
    return totals;
  }, [approved, pending]);

  const filteredPending = useMemo(() => {
    if (txTypeFilter === "ALL") return pending;
    return pending.filter(tx => tx.account_type === txTypeFilter.toLowerCase());
  }, [pending, txTypeFilter]);

  // ── APPROVE / REJECT ──────────────────────────────────────────────────────
  const handleProcess = async (id, status) => {
    setActioningId(id);
    try {
      const { error } = await supabase.from("chama_contributions")
        .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null, processed_by: member?.member_name })
        .eq("id", id);
      if (error) throw error;
      await loadData(true);
    } catch (err) {
      console.error("Process error:", err);
    } finally {
      setActioningId(null);
    }
  };

  // ── SAVE WALLETS ──────────────────────────────────────────────────────────
  const handleSaveWallets = async (entries) => {
    for (const entry of entries) {
      const payload = {
        chama_id: chama.id,
        name: entry.institution || entry.name,
        type: entry.type,
        balance: parseFloat(entry.balance) || 0,
      };
      if (entry.id) {
        await supabase.from("chama_wallets").update(payload).eq("id", entry.id);
      } else {
        await supabase.from("chama_wallets").insert([payload]);
      }
    }
    await loadData(true);
  };

  if (loading) {
    return (
      <div className="cdash-loading-screen">
        <div className="loading-pulse"><Landmark size={32} /></div>
        <p>Loading chama data…</p>
      </div>
    );
  }

  const totalFunds = wallets.reduce((s, w) => s + Number(w.balance || 0), 0);

  return (
    <div className="cdash">

      {/* ── TOP BAR ───────────────────────────────────────────────────────── */}
      <header className="cdash-topbar">
        <div className="topbar-left">
          <div className="chama-badge">
            <Landmark size={16} />
            <span>{chama?.name}</span>
            <span className="chama-code">{chama?.chama_no}</span>
          </div>
        </div>
        <div className="topbar-right">
          <button className="topbar-btn" onClick={() => loadData(true)} title="Refresh">
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          </button>
          <button className="topbar-btn highlight" onClick={() => setModal("send")}>
            <Send size={15} /> Record Payment
          </button>
        </div>
      </header>

      {/* ── KPI CARDS ─────────────────────────────────────────────────────── */}
      <section className="kpi-grid">
        {Object.entries(ACCOUNT_TYPES).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={key} className={`kpi-card kpi-${cfg.color}`} onClick={() => setSidebarType(key)}>
              <div className="kpi-top">
                <span>{cfg.label}</span>
                <div className="kpi-icon"><Icon size={16} /></div>
              </div>
              <div className="kpi-value">{fmt(summary[key])}</div>
              <div className="kpi-action">View breakdown <ChevronRight size={12} /></div>
            </div>
          );
        })}
        <div className="kpi-card kpi-slate" onClick={() => setModal("funds")}>
          <div className="kpi-top">
            <span>Total Funds</span>
            <div className="kpi-icon"><Building2 size={16} /></div>
          </div>
          <div className="kpi-value">{fmt(totalFunds)}</div>
          <div className="kpi-action">
            {wallets.length > 0 ? `Across ${wallets.length} account${wallets.length > 1 ? "s" : ""}` : "Set fund locations"}
            <ChevronRight size={12} />
          </div>
        </div>
        <div className="kpi-card kpi-rose-pending">
          <div className="kpi-top">
            <span>Pending Review</span>
            <div className="kpi-icon"><Clock size={16} /></div>
          </div>
          <div className="kpi-value">{fmt(summary.pending)}</div>
          <div className="kpi-action">{pending.length} transaction{pending.length !== 1 ? "s" : ""} waiting</div>
        </div>
      </section>

      {/* ── QUICK ACTION BUTTONS ──────────────────────────────────────────── */}
      <section className="quick-actions">
        <button className="qa-btn" onClick={() => setModal("members")}>
          <Users size={18} />
          <div>
            <span>Members</span>
            <small>{membersList.length} registered</small>
          </div>
          <ChevronRight size={14} className="qa-arrow" />
        </button>
        <button className="qa-btn" onClick={() => setModal("contributions")}>
          <Receipt size={18} />
          <div>
            <span>All Contributions</span>
            <small>{transactions.length} records</small>
          </div>
          <ChevronRight size={14} className="qa-arrow" />
        </button>
        <button className="qa-btn" onClick={() => setModal("funds")}>
          <Building2 size={18} />
          <div>
            <span>Fund Locations</span>
            <small>{wallets.length > 0 ? `${wallets.length} account${wallets.length > 1 ? "s" : ""}` : "Not configured"}</small>
          </div>
          <ChevronRight size={14} className="qa-arrow" />
        </button>
        {isTreasurerOrAdmin && (
          <button className="qa-btn" onClick={() => setModal("statement")}>
            <Upload size={18} />
            <div>
              <span>Bank Statement</span>
              <small>Upload monthly statement</small>
            </div>
            <ChevronRight size={14} className="qa-arrow" />
          </button>
        )}
      </section>

      {/* ── FUND LOCATIONS STRIP ──────────────────────────────────────────── */}
      {wallets.length > 0 && (
        <section className="fund-strip">
          <div className="fund-strip-label">
            <Building2 size={14} /> Fund Locations
          </div>
          <div className="fund-strip-cards">
            {wallets.map((w) => (
              <div key={w.id} className="fund-strip-card">
                <span className="fsc-type">{w.type?.toUpperCase()}</span>
                <span className="fsc-name">{w.name}</span>
                <span className="fsc-balance">{fmt(w.balance)}</span>
              </div>
            ))}
          </div>
          {isTreasurerOrAdmin && (
            <button className="fund-strip-edit" onClick={() => setModal("funds")}>
              <Settings size={13} /> Edit
            </button>
          )}
        </section>
      )}

      {/* ── MAIN CONTENT: pending approvals ──────────────────────────────── */}
      <div className="cdash-main">

        {/* PENDING APPROVAL QUEUE */}
        <section className="panel panel-full">
          <div className="panel-header">
            <div>
              <h2>Pending Approvals</h2>
              <p>{filteredPending.length} transaction{filteredPending.length !== 1 ? "s" : ""} awaiting verification</p>
            </div>
            <div className="panel-header-actions">
              <div className="filter-select-wrap">
                <Filter size={12} />
                <select value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}>
                  <option value="ALL">All Types</option>
                  {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {filteredPending.length === 0 ? (
            <EmptyState icon={BadgeCheck} title="All clear" sub="No pending transactions to review." />
          ) : (
            <div className="approval-list">
              {filteredPending.map(tx => (
                <div key={tx.id} className={`approval-row ${actioningId === tx.id ? "row-processing" : ""}`}>
                  <Avatar name={tx.member_name} />
                  <div className="ar-info">
                    <strong>{tx.member_name}</strong>
                    <div className="ar-meta">
                      <TypePill type={tx.account_type} />
                      {tx.mpesa_ref && <span className="ar-ref"><CreditCard size={10} /> {tx.mpesa_ref}</span>}
                      {tx.notes && <span className="ar-notes">{tx.notes}</span>}
                    </div>
                  </div>
                  <div className="ar-right">
                    <span className="ar-amount">{fmt(tx.amount)}</span>
                    <span className="ar-date">{fmtDate(tx.created_at)}</span>
                  </div>
                  {isTreasurerOrAdmin ? (
                    <div className="ar-actions">
                      <button
                        className="icon-btn btn-approve"
                        disabled={actioningId !== null}
                        onClick={() => handleProcess(tx.id, "approved")}
                        title="Approve"
                      >
                        {actioningId === tx.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                      </button>
                      <button
                        className="icon-btn btn-reject"
                        disabled={actioningId !== null}
                        onClick={() => handleProcess(tx.id, "rejected")}
                        title="Reject"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="pending-label"><span className="pulse-dot" /> Pending</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* RECENT APPROVED */}
        <section className="panel panel-full">
          <div className="panel-header">
            <div>
              <h2>Recent Approved</h2>
              <p>Last 10 verified transactions</p>
            </div>
            <button className="panel-link" onClick={() => setModal("contributions")}>
              View all <ArrowUpRight size={13} />
            </button>
          </div>

          <div className="modal-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {approved.slice(0, 10).map(tx => (
                  <tr key={tx.id}>
                    <td>{fmtDate(tx.created_at)}</td>
                    <td>
                      <div className="td-member">
                        <Avatar name={tx.member_name} size="sm" />
                        {tx.member_name}
                      </div>
                    </td>
                    <td><TypePill type={tx.account_type} /></td>
                    <td className="td-amount">{fmt(tx.amount)}</td>
                    <td className="td-mono">{tx.mpesa_ref || "—"}</td>
                  </tr>
                ))}
                {approved.length === 0 && (
                  <tr><td colSpan={5} className="td-empty">No approved transactions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      {modal === "members" && (
        <MembersModal members={membersList} onClose={() => setModal(null)} />
      )}
      {modal === "contributions" && (
        <ContributionsModal transactions={transactions} members={membersList} onClose={() => setModal(null)} />
      )}
      {modal === "send" && (
        <SendContributionModal member={member} chama={chama} onClose={() => setModal(null)} onSuccess={() => loadData(true)} />
      )}
      {modal === "funds" && (
        <FundLocationsModal wallets={wallets} onClose={() => setModal(null)} onSave={handleSaveWallets} isTreasurer={isTreasurerOrAdmin} />
      )}
      {modal === "statement" && (
        <BankStatementModal chama={chama} member={member} onClose={() => setModal(null)} />
      )}

      {/* ── SIDEBAR LEDGERS ───────────────────────────────────────────────── */}
      {sidebarType && (
        <SidebarLedger
          type={sidebarType}
          transactions={transactions}
          members={membersList}
          onClose={() => setSidebarType(null)}
        />
      )}
    </div>
  );
}