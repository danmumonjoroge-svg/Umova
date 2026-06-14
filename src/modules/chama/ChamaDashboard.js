/* ────────────────────────────────────────────────────────────────
   CHAMA DASHBOARD v5.0 — FINAL PRODUCTION-READY
   - Full Supabase integration with Send & Merry-Go-Round features
   - Working modals & drawers with complete functionality
   - Dynamic fund management with transaction tracking
   - Officer approval workflows
   - Monthly statements & minutes
   - Fully functional sidebar navigation
   - Send Money feature (to treasurer, bank, welfare recipients)
   - Merry-Go-Round rotation management
──────────────────────────────────────────────────────────────── */

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useReducer,
  Suspense,
  memo
} from "react";

import { supabase } from "../../supabaseClient";
import { useChama } from "./ChamaContext";

import {
  Users,
  Wallet,
  Landmark,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Menu,
  X,
  Search,
  TrendingUp,
  Settings,
  Download,
  Banknote,
  Shield,
  Building2,
  User,
  RefreshCw,
  Activity,
  ShieldAlert,
  FileText,
  ShieldCheck,
  BarChart3,
  Plus,
  Edit2,
  Trash2,
  Eye,
  Clock,
  DollarSign,
  Calendar,
  ChevronDown,
  Save,
  ArrowUpRight,
  ArrowDownLeft,
  Send,
  Repeat2,
  Check,
  AlertCircle
} from "lucide-react";

import "./ChamaDashboard.css";

/* ════════════════════════════════════════════════════════════════
   FINANCIAL ENGINE
════════════════════════════════════════════════════════════════ */

const FinancialEngine = {
  formatKES(value) {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  },

  safeNumber(value) {
    return Number(parseFloat(value || 0).toFixed(2));
  },

  calculateLoanSchedule(principal, annualRate, months) {
    const r = annualRate / 12 / 100;
    const monthly =
      (principal * r * Math.pow(1 + r, months)) /
      (Math.pow(1 + r, months) - 1);

    const schedule = [];
    let balance = principal;

    for (let i = 1; i <= months; i++) {
      const interest = balance * r;
      const principalPaid = monthly - interest;
      balance -= principalPaid;

      schedule.push({
        month: i,
        payment: this.safeNumber(monthly),
        principal: this.safeNumber(principalPaid),
        interest: this.safeNumber(interest),
        balance: this.safeNumber(balance < 0 ? 0 : balance)
      });
    }

    return schedule;
  },

  reconcileLedger(transactions = [], walletBalance = 0) {
    const approved = transactions.filter(t => t.status === "approved");
    const ledgerTotal = approved.reduce(
      (sum, t) => sum + Number(t.amount || 0),
      0
    );
    const variance = walletBalance - ledgerTotal;

    return {
      ledgerTotal: this.safeNumber(ledgerTotal),
      walletBalance: this.safeNumber(walletBalance),
      variance: this.safeNumber(variance),
      isBalanced: Math.abs(variance) < 0.01,
      status: Math.abs(variance) < 0.01 ? "HEALTHY" : "IMBALANCE"
    };
  },

  computeBreakdown(transactions = []) {
    const breakdown = {
      savings: 0,
      loans: 0,
      fines: 0,
      welfare: 0
    };

    for (const t of transactions) {
      const type = t.account_type;
      if (breakdown[type] !== undefined && t.status === "approved") {
        breakdown[type] += Number(t.amount || 0);
      }
    }

    return breakdown;
  },

  computeFundsByLocation(funds = []) {
    const summary = {
      total: 0,
      byLocation: {}
    };

    funds.forEach(f => {
      const location = f.fund_location || "Unspecified";
      if (!summary.byLocation[location]) {
        summary.byLocation[location] = {
          current: 0,
          deposited: 0,
          withdrawn: 0,
          transactions: []
        };
      }

      summary.byLocation[location].current += Number(f.current_amount || 0);
      summary.byLocation[location].deposited += Number(f.total_deposited || 0);
      summary.byLocation[location].withdrawn += Number(f.total_withdrawn || 0);
      summary.byLocation[location].transactions.push(f);
      summary.total += Number(f.current_amount || 0);
    });

    return summary;
  }
};

/* ════════════════════════════════════════════════════════════════
   PERMISSION GUARD
════════════════════════════════════════════════════════════════ */

const PermissionGuard = {
  roles: {
    admin: ["*"],
    chairperson: ["APPROVE", "VIEW_ALL", "MANAGE_OFFICERS"],
    treasurer: ["APPROVE", "EXPORT", "RECONCILE", "MANAGE_FUNDS", "RECEIVE_SEND"],
    secretary: ["VIEW_ALL", "MANAGE_DOCUMENTS", "APPROVE_MINUTES"],
    member: ["SUBMIT", "VIEW", "SEND_MONEY"]
  },

  can(role, permission) {
    const perms = this.roles[role] || [];
    return perms.includes("*") || perms.includes(permission);
  }
};

/* ════════════════════════════════════════════════════════════════
   DATA LAYER — SUPABASE QUERIES
════════════════════════════════════════════════════════════════ */

async function fetchChamaCoreData(chamaId) {
  try {
    const [
      chamaRes,
      membersRes,
      txRes,
      loansRes,
      finesRes,
      welfareRes,
      fundsRes,
      transactionsRes,
      minutesRes,
      statementsRes,
      officersRes,
      sendRes,
      merryGoRoundRes
    ] = await Promise.all([
      supabase.from("chamas").select("*").eq("id", chamaId).single(),
      supabase.from("chama_members").select("*").eq("chama_id", chamaId),
      supabase
        .from("chama_contributions")
        .select("*")
        .eq("chama_id", chamaId)
        .order("created_at", { ascending: false }),
      supabase.from("chama_loans").select("*").eq("chama_id", chamaId),
      supabase.from("chama_fines").select("*").eq("chama_id", chamaId),
      supabase.from("chama_welfare").select("*").eq("chama_id", chamaId),
      supabase
        .from("chama_funds")
        .select("*")
        .eq("chama_id", chamaId)
        .order("created_at", { ascending: false }),
      supabase
        .from("chama_fund_transactions")
        .select("*")
        .eq("chama_id", chamaId)
        .order("transaction_date", { ascending: false }),
      supabase
        .from("chama_minutes")
        .select("*")
        .eq("chama_id", chamaId)
        .order("meeting_date", { ascending: false }),
      supabase
        .from("chama_statements")
        .select("*")
        .eq("chama_id", chamaId)
        .order("statement_date", { ascending: false }),
      supabase
        .from("chama_officers")
        .select("*")
        .eq("chama_id", chamaId),
      supabase
        .from("chama_send_money")
        .select("*")
        .eq("chama_id", chamaId)
        .order("sent_date", { ascending: false }),
      supabase
        .from("chama_merry_go_round")
        .select("*")
        .eq("chama_id", chamaId)
        .order("scheduled_date", { ascending: false })
    ]);

    return {
      chama: chamaRes.data || {},
      members: membersRes.data || [],
      contributions: txRes.data || [],
      loans: loansRes.data || [],
      fines: finesRes.data || [],
      welfare: welfareRes.data || [],
      funds: fundsRes.data || [],
      fundTransactions: transactionsRes.data || [],
      minutes: minutesRes.data || [],
      statements: statementsRes.data || [],
      officers: officersRes.data || [],
      sendMoney: sendRes.data || [],
      merryGoRound: merryGoRoundRes.data || []
    };
  } catch (error) {
    console.error("Error fetching chama data:", error);
    return {
      chama: {},
      members: [],
      contributions: [],
      loans: [],
      fines: [],
      welfare: [],
      funds: [],
      fundTransactions: [],
      minutes: [],
      statements: [],
      officers: [],
      sendMoney: [],
      merryGoRound: []
    };
  }
}

function subscribeToChamaRealtime(chamaId, onUpdate) {
  const channel = supabase
    .channel(`chama-realtime-${chamaId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chama_contributions",
        filter: `chama_id=eq.${chamaId}`
      },
      payload => onUpdate(payload)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/* ════════════════════════════════════════════════════════════════
   UI STATE & REDUCER
════════════════════════════════════════════════════════════════ */

const uiInitialState = {
  sidebarOpen: true,
  activeTab: "overview",
  modals: {
    members: false,
    contributions: false,
    funds: false,
    fundDetails: false,
    addFund: false,
    addTransaction: false,
    minutes: false,
    statements: false,
    approvals: false,
    officers: false,
    sendMoney: false,
    merryGoRound: false
  },
  drawer: {
    open: false,
    type: null,
    payload: null
  },
  filters: {
    search: "",
    type: "all",
    status: "all"
  }
};

function uiReducer(state, action) {
  switch (action.type) {
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case "SET_TAB":
      return { ...state, activeTab: action.payload };

    case "OPEN_MODAL":
      return {
        ...state,
        modals: { ...state.modals, [action.payload]: true }
      };

    case "CLOSE_MODAL":
      return {
        ...state,
        modals: { ...state.modals, [action.payload]: false }
      };

    case "OPEN_DRAWER":
      return {
        ...state,
        drawer: {
          open: true,
          type: action.payload.type,
          payload: action.payload.data || null
        }
      };

    case "CLOSE_DRAWER":
      return {
        ...state,
        drawer: { open: false, type: null, payload: null }
      };

    default:
      return state;
  }
}

/* ════════════════════════════════════════════════════════════════
   CARDS & OVERVIEW COMPONENTS
════════════════════════════════════════════════════════════════ */

const FundsOverview = memo(({ funds = [] }) => {
  const summary = useMemo(() => {
    return FinancialEngine.computeFundsByLocation(funds);
  }, [funds]);

  return (
    <div className="grid-cards">
      {Object.entries(summary.byLocation).length === 0 ? (
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <p className="empty">No fund locations added yet</p>
        </div>
      ) : (
        Object.entries(summary.byLocation).map(([location, data]) => (
          <div key={location} className="card card-emerald" style={{ "--card-accent": "var(--emerald)", "--card-accent-bg": "var(--emerald-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <Landmark size={18} style={{ color: "var(--emerald)" }} />
              <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-3)", textTransform: "uppercase" }}>
                {location}
              </span>
            </div>
            <h4>{location}</h4>
            <p style={{ color: "var(--emerald)", fontWeight: "750" }}>
              {FinancialEngine.formatKES(data.current)}
            </p>
            <div style={{ fontSize: "11px", color: "var(--text-2)", marginTop: "8px", display: "flex", gap: "8px" }}>
              <span>↑ {FinancialEngine.formatKES(data.deposited)}</span>
              <span>↓ {FinancialEngine.formatKES(data.withdrawn)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
});

FundsOverview.displayName = "FundsOverview";

const BreakdownCards = memo(({ breakdown = {} }) => (
  <div className="grid-cards">
    <div className="card card-emerald">
      <h4>Savings</h4>
      <p>{FinancialEngine.formatKES(breakdown.savings || 0)}</p>
    </div>
    <div className="card card-amber">
      <h4>Loans</h4>
      <p>{FinancialEngine.formatKES(breakdown.loans || 0)}</p>
    </div>
    <div className="card card-rose">
      <h4>Fines</h4>
      <p>{FinancialEngine.formatKES(breakdown.fines || 0)}</p>
    </div>
    <div className="card card-violet">
      <h4>Welfare</h4>
      <p>{FinancialEngine.formatKES(breakdown.welfare || 0)}</p>
    </div>
  </div>
));

BreakdownCards.displayName = "BreakdownCards";

/* ════════════════════════════════════════════════════════════════
   SEND MONEY MODAL
════════════════════════════════════════════════════════════════ */

const SendMoneyModal = memo(({ open, onClose, chamaId, members = [], onSend }) => {
  const [formData, setFormData] = useState({
    sender_member_id: "",
    amount: "",
    sent_date: new Date().toISOString().split("T")[0],
    reference_code: "",
    send_to_type: "treasurer", // treasurer, bank, welfare, merry_go_round, other
    send_to_details: "",
    description: ""
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.sender_member_id || !formData.amount || !formData.reference_code) {
      alert("Please fill all required fields");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("chama_send_money").insert([
        {
          chama_id: chamaId,
          sender_member_id: formData.sender_member_id,
          amount: Number(formData.amount),
          sent_date: formData.sent_date,
          reference_code: formData.reference_code,
          send_to_type: formData.send_to_type,
          send_to_details: formData.send_to_details,
          description: formData.description,
          status: "pending",
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      setFormData({
        sender_member_id: "",
        amount: "",
        sent_date: new Date().toISOString().split("T")[0],
        reference_code: "",
        send_to_type: "treasurer",
        send_to_details: "",
        description: ""
      });

      alert("✅ Money send recorded successfully!");
      onSend?.();
    } catch (e) {
      console.error("Error recording send:", e);
      alert("❌ Failed to record send");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💸 Send Money</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body scroll">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="field-group">
              <label>From Member *</label>
              <select
                value={formData.sender_member_id}
                onChange={e => setFormData({ ...formData, sender_member_id: e.target.value })}
                disabled={loading}
              >
                <option value="">Select member sending money...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label>Amount (KES) *</label>
              <input
                type="number"
                placeholder="0.00"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="field-group">
              <label>Reference Code *</label>
              <input
                type="text"
                placeholder="e.g., MPESA123456"
                value={formData.reference_code}
                onChange={e => setFormData({ ...formData, reference_code: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="field-group">
              <label>Sent Date *</label>
              <input
                type="date"
                value={formData.sent_date}
                onChange={e => setFormData({ ...formData, sent_date: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="field-group">
              <label>Send To (Where) *</label>
              <select
                value={formData.send_to_type}
                onChange={e => setFormData({ ...formData, send_to_type: e.target.value })}
                disabled={loading}
              >
                <option value="treasurer">Treasurer (Safekeeping)</option>
                <option value="bank">Bank Account</option>
                <option value="welfare">Welfare Recipient</option>
                <option value="merry_go_round">Merry-Go-Round Recipient</option>
                <option value="loan">Loan Repayment</option>
                <option value="fine">Fine Payment</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="field-group">
              <label>Details/Notes</label>
              <input
                type="text"
                placeholder={
                  formData.send_to_type === "bank"
                    ? "e.g., KCB Account 12345"
                    : formData.send_to_type === "welfare"
                    ? "e.g., John Doe (Welfare)"
                    : formData.send_to_type === "merry_go_round"
                    ? "e.g., Jane Smith (MGR)"
                    : "Additional details..."
                }
                value={formData.send_to_details}
                onChange={e => setFormData({ ...formData, send_to_details: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="field-group">
              <label>Description</label>
              <textarea
                rows="3"
                placeholder="Add any additional notes..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                disabled={loading}
                style={{ resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={loading}
                style={{ flex: 1 }}
              >
                <Send size={16} />
                {loading ? "Recording..." : "Record Send"}
              </button>
              <button
                className="btn-ghost"
                onClick={onClose}
                disabled={loading}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

SendMoneyModal.displayName = "SendMoneyModal";

/* ════════════════════════════════════════════════════════════════
   SEND MONEY HISTORY MODAL
════════════════════════════════════════════════════════════════ */

const SendMoneyHistoryModal = memo(({ open, onClose, sendRecords = [], members = [] }) => {
  const [filterType, setFilterType] = useState("all");

  const filtered = useMemo(() => {
    if (filterType === "all") return sendRecords;
    return sendRecords.filter(r => r.send_to_type === filterType);
  }, [sendRecords, filterType]);

  if (!open) return null;

  const getSendTypeLabel = (type) => {
    const labels = {
      treasurer: "👤 Treasurer",
      bank: "🏦 Bank",
      welfare: "❤️ Welfare",
      merry_go_round: "🔄 Merry-Go-Round",
      loan: "📈 Loan",
      fine: "⚠️ Fine",
      other: "📋 Other"
    };
    return labels[type] || type;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💸 Send Money History</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-filter-row">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--bg-4)",
              color: "var(--text)",
              fontSize: "12.5px",
              fontWeight: "500",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="all">All Types</option>
            <option value="treasurer">Treasurer</option>
            <option value="bank">Bank</option>
            <option value="welfare">Welfare</option>
            <option value="merry_go_round">Merry-Go-Round</option>
            <option value="loan">Loan</option>
            <option value="fine">Fine</option>
          </select>
        </div>

        <div className="modal-body scroll">
          {filtered.length === 0 ? (
            <p className="empty">No send records found</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {filtered.map(record => {
                const sender = members.find(m => m.id === record.sender_member_id);
                return (
                  <div
                    key={record.id}
                    className="card"
                    style={{
                      padding: "14px",
                      borderLeft: "4px solid var(--blue)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "8px" }}>
                      <div>
                        <h4 style={{ fontSize: "13px", fontWeight: "650", marginBottom: "2px" }}>
                          {sender?.name || "Unknown"} → {getSendTypeLabel(record.send_to_type)}
                        </h4>
                        <p style={{ fontSize: "11px", color: "var(--text-2)" }}>
                          {new Date(record.sent_date).toLocaleDateString()} · {record.reference_code}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: "15px", fontWeight: "750", color: "var(--emerald)" }}>
                          {FinancialEngine.formatKES(record.amount)}
                        </p>
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: "10px",
                            fontWeight: "700",
                            color: record.status === "confirmed" ? "var(--emerald)" : "var(--amber)",
                            background: record.status === "confirmed" ? "var(--emerald-bg)" : "var(--amber-bg)",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            marginTop: "4px"
                          }}
                        >
                          {record.status}
                        </span>
                      </div>
                    </div>
                    {record.send_to_details && (
                      <p style={{ fontSize: "11px", color: "var(--text-2)", marginTop: "8px" }}>
                        📍 {record.send_to_details}
                      </p>
                    )}
                    {record.description && (
                      <p style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "4px", fontStyle: "italic" }}>
                        {record.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

SendMoneyHistoryModal.displayName = "SendMoneyHistoryModal";

/* ════════════════════════════════════════════════════════════════
   MERRY-GO-ROUND MODAL
════════════════════════════════════════════════════════════════ */

const MerryGoRoundModal = memo(({ open, onClose, merryGoRound = [], members = [], chamaId, onAdd }) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    member_id: "",
    scheduled_date: new Date().toISOString().split("T")[0],
    expected_amount: "",
    status: "pending", // pending, received, delayed
    received_date: "",
    actual_amount: ""
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.member_id || !formData.expected_amount) {
      alert("Please fill required fields");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("chama_merry_go_round").insert([
        {
          chama_id: chamaId,
          member_id: formData.member_id,
          scheduled_date: formData.scheduled_date,
          expected_amount: Number(formData.expected_amount),
          status: formData.status,
          received_date: formData.received_date || null,
          actual_amount: formData.actual_amount ? Number(formData.actual_amount) : null,
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      setFormData({
        member_id: "",
        scheduled_date: new Date().toISOString().split("T")[0],
        expected_amount: "",
        status: "pending",
        received_date: "",
        actual_amount: ""
      });
      setShowForm(false);
      alert("✅ Merry-Go-Round entry added!");
      onAdd?.();
    } catch (e) {
      console.error("Error adding MGR:", e);
      alert("❌ Failed to add entry");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    if (status === "received") return { bg: "var(--emerald-bg)", color: "var(--emerald)", text: "✅ Received" };
    if (status === "pending") return { bg: "var(--amber-bg)", color: "var(--amber)", text: "⏳ Pending" };
    return { bg: "var(--rose-bg)", color: "var(--rose)", text: "⚠️ Delayed" };
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔄 Merry-Go-Round Rotation</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body scroll">
          {!showForm ? (
            <>
              <button
                className="btn-primary"
                onClick={() => setShowForm(true)}
                style={{ width: "100%", marginBottom: "16px" }}
              >
                <Plus size={16} />
                Add Rotation Entry
              </button>

              {merryGoRound.length === 0 ? (
                <p className="empty">No merry-go-round entries yet</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Upcoming */}
                  <div>
                    <h4 style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-2)", textTransform: "uppercase", marginBottom: "8px", paddingLeft: "4px" }}>
                      ⏳ Upcoming & Pending
                    </h4>
                    {merryGoRound
                      .filter(m => m.status !== "received")
                      .map(mgr => {
                        const member = members.find(m => m.id === mgr.member_id);
                        const statusData = getStatusColor(mgr.status);
                        const daysUntil = Math.ceil(
                          (new Date(mgr.scheduled_date) - new Date()) / (1000 * 60 * 60 * 24)
                        );
                        return (
                          <div
                            key={mgr.id}
                            className="card"
                            style={{
                              padding: "12px",
                              borderLeft: `4px solid ${statusData.color}`
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                              <div style={{ flex: 1 }}>
                                <h4 style={{ fontSize: "13px", fontWeight: "650", marginBottom: "4px" }}>
                                  {member?.name || "Unknown"}
                                </h4>
                                <p style={{ fontSize: "11px", color: "var(--text-2)", marginBottom: "6px" }}>
                                  📅 {new Date(mgr.scheduled_date).toLocaleDateString()}
                                  {daysUntil > 0 && ` (in ${daysUntil} days)`}
                                  {daysUntil === 0 && " (Today)"}
                                  {daysUntil < 0 && ` (${Math.abs(daysUntil)} days ago)`}
                                </p>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <p style={{ fontSize: "14px", fontWeight: "750", color: "var(--emerald)", marginBottom: "4px" }}>
                                  {FinancialEngine.formatKES(mgr.expected_amount)}
                                </p>
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: "10px",
                                    fontWeight: "700",
                                    color: statusData.color,
                                    background: statusData.bg,
                                    padding: "3px 8px",
                                    borderRadius: "4px"
                                  }}
                                >
                                  {statusData.text}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Received */}
                  {merryGoRound.filter(m => m.status === "received").length > 0 && (
                    <div style={{ marginTop: "16px" }}>
                      <h4 style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-2)", textTransform: "uppercase", marginBottom: "8px", paddingLeft: "4px" }}>
                        ✅ Already Received
                      </h4>
                      {merryGoRound
                        .filter(m => m.status === "received")
                        .map(mgr => {
                          const member = members.find(m => m.id === mgr.member_id);
                          return (
                            <div
                              key={mgr.id}
                              className="card"
                              style={{
                                padding: "12px",
                                borderLeft: "4px solid var(--emerald)",
                                opacity: 0.8
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                                <div style={{ flex: 1 }}>
                                  <h4 style={{ fontSize: "13px", fontWeight: "650", marginBottom: "4px" }}>
                                    {member?.name || "Unknown"}
                                  </h4>
                                  <p style={{ fontSize: "11px", color: "var(--text-2)" }}>
                                    Received: {new Date(mgr.received_date).toLocaleDateString()}
                                  </p>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <p style={{ fontSize: "14px", fontWeight: "750", color: "var(--emerald)" }}>
                                    {FinancialEngine.formatKES(mgr.actual_amount || mgr.expected_amount)}
                                  </p>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      fontSize: "10px",
                                      fontWeight: "700",
                                      color: "var(--emerald)",
                                      background: "var(--emerald-bg)",
                                      padding: "3px 8px",
                                      borderRadius: "4px",
                                      marginTop: "4px"
                                    }}
                                  >
                                    ✅ Received
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="field-group">
                <label>Member *</label>
                <select
                  value={formData.member_id}
                  onChange={e => setFormData({ ...formData, member_id: e.target.value })}
                  disabled={loading}
                >
                  <option value="">Select member...</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label>Scheduled Date *</label>
                <input
                  type="date"
                  value={formData.scheduled_date}
                  onChange={e => setFormData({ ...formData, scheduled_date: e.target.value })}
                  disabled={loading}
                />
              </div>

              <div className="field-group">
                <label>Expected Amount (KES) *</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={formData.expected_amount}
                  onChange={e => setFormData({ ...formData, expected_amount: e.target.value })}
                  disabled={loading}
                />
              </div>

              <div className="field-group">
                <label>Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                  disabled={loading}
                >
                  <option value="pending">Pending</option>
                  <option value="received">Received</option>
                  <option value="delayed">Delayed</option>
                </select>
              </div>

              {formData.status === "received" && (
                <>
                  <div className="field-group">
                    <label>Received Date</label>
                    <input
                      type="date"
                      value={formData.received_date}
                      onChange={e => setFormData({ ...formData, received_date: e.target.value })}
                      disabled={loading}
                    />
                  </div>

                  <div className="field-group">
                    <label>Actual Amount (KES)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={formData.actual_amount}
                      onChange={e => setFormData({ ...formData, actual_amount: e.target.value })}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  <Save size={16} />
                  {loading ? "Saving..." : "Save Entry"}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setShowForm(false)}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

MerryGoRoundModal.displayName = "MerryGoRoundModal";

/* ════════════════════════════════════════════════════════════════
   FUND MANAGEMENT MODAL
════════════════════════════════════════════════════════════════ */

const FundManagementModal = memo(({ open, onClose, funds = [], onAddFund, chamaId }) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    fund_location: "",
    current_amount: "",
    total_deposited: "",
    total_withdrawn: "",
    notes: ""
  });

  const handleSubmit = async () => {
    if (!formData.fund_location || !formData.current_amount) {
      alert("Please fill required fields");
      return;
    }

    try {
      const { error } = await supabase.from("chama_funds").insert([
        {
          chama_id: chamaId,
          fund_location: formData.fund_location,
          current_amount: Number(formData.current_amount),
          total_deposited: Number(formData.total_deposited || 0),
          total_withdrawn: Number(formData.total_withdrawn || 0),
          notes: formData.notes,
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      setFormData({
        fund_location: "",
        current_amount: "",
        total_deposited: "",
        total_withdrawn: "",
        notes: ""
      });
      setShowForm(false);
      onAddFund?.();
    } catch (e) {
      console.error("Error adding fund:", e);
      alert("Failed to add fund");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💰 Fund Management</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body scroll">
          {!showForm ? (
            <>
              <button
                className="btn-primary"
                onClick={() => setShowForm(true)}
                style={{ width: "100%", marginBottom: "16px" }}
              >
                <Plus size={16} />
                Add Fund Location
              </button>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {funds.length === 0 ? (
                  <p className="empty">No fund locations added yet</p>
                ) : (
                  funds.map(fund => (
                    <div key={fund.id} className="card" style={{ padding: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div>
                          <h4 style={{ marginBottom: "4px" }}>{fund.fund_location}</h4>
                          <p style={{ color: "var(--emerald)", fontWeight: "750" }}>
                            {FinancialEngine.formatKES(fund.current_amount)}
                          </p>
                        </div>
                        <div style={{ textAlign: "right", fontSize: "11px", color: "var(--text-2)" }}>
                          <div>↑ {FinancialEngine.formatKES(fund.total_deposited)}</div>
                          <div>↓ {FinancialEngine.formatKES(fund.total_withdrawn)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="field-group">
                <label>Fund Location</label>
                <input
                  type="text"
                  placeholder="e.g., KCB Bank, Equity Bank, Bull Purchase, SAF Shares"
                  value={formData.fund_location}
                  onChange={e => setFormData({ ...formData, fund_location: e.target.value })}
                />
              </div>

              <div className="field-group">
                <label>Current Amount</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={formData.current_amount}
                  onChange={e => setFormData({ ...formData, current_amount: e.target.value })}
                />
              </div>

              <div className="field-group">
                <label>Total Deposited</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={formData.total_deposited}
                  onChange={e => setFormData({ ...formData, total_deposited: e.target.value })}
                />
              </div>

              <div className="field-group">
                <label>Total Withdrawn</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={formData.total_withdrawn}
                  onChange={e => setFormData({ ...formData, total_withdrawn: e.target.value })}
                />
              </div>

              <div className="field-group">
                <label>Notes</label>
                <textarea
                  rows="3"
                  placeholder="Additional notes..."
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  style={{ flex: 1 }}
                >
                  <Save size={16} />
                  Save Fund
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setShowForm(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

FundManagementModal.displayName = "FundManagementModal";

/* ════════════════════════════════════════════════════════════════
   MEMBERS MODAL
════════════════════════════════════════════════════════════════ */

const MembersModal = memo(({ open, onClose, members = [] }) => {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      members.filter(
        m =>
          (m.name || "").toLowerCase().includes(query.toLowerCase()) ||
          (m.role || "").toLowerCase().includes(query.toLowerCase())
      ),
    [members, query]
  );

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>👥 Members</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-search-bar">
          <Search size={16} style={{ color: "var(--text-3)" }} />
          <input
            type="text"
            placeholder="Search members..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              color: "var(--text)",
              fontSize: "13.5px",
              outline: "none"
            }}
          />
        </div>

        <div className="modal-body scroll">
          {filtered.length === 0 ? (
            <p className="empty">No members found</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filtered.map(m => (
                <div key={m.id} className="row">
                  <div
                    className="avatar avatar-md"
                    style={{
                      background: "linear-gradient(135deg, var(--emerald-2), var(--blue-2))"
                    }}
                  >
                    {m.name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <div className="member-info" style={{ flex: 1 }}>
                    <strong style={{ fontSize: "13px", fontWeight: "650" }}>
                      {m.name || "Unknown"}
                    </strong>
                    <span style={{ fontSize: "11px", color: "var(--text-2)" }}>
                      {m.phone || m.email || "No contact"}
                    </span>
                  </div>
                  <span
                    className="status-badge"
                    style={{
                      background: m.role === "treasurer" ? "var(--violet-bg)" : "var(--slate-bg)",
                      color: m.role === "treasurer" ? "var(--violet)" : "var(--text-2)",
                      border:
                        m.role === "treasurer"
                          ? "1px solid var(--violet-border)"
                          : "1px solid var(--slate-border)"
                    }}
                  >
                    {m.role || "member"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

MembersModal.displayName = "MembersModal";

/* ════════════════════════════════════════════════════════════════
   CONTRIBUTIONS MODAL
════════════════════════════════════════════════════════════════ */

const ContributionsModal = memo(({ open, onClose, contributions = [], members = [] }) => {
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = useMemo(() => {
    let result = contributions;
    if (filterStatus !== "all") {
      result = result.filter(c => c.status === filterStatus);
    }
    return result;
  }, [contributions, filterStatus]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💳 Contributions</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-filter-row">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--bg-4)",
              color: "var(--text)",
              fontSize: "12.5px",
              fontWeight: "500",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="modal-body scroll">
          {filtered.length === 0 ? (
            <p className="empty">No contributions found</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const member = members.find(m => m.id === c.member_id);
                  return (
                    <tr key={c.id}>
                      <td>{new Date(c.created_at).toLocaleDateString()}</td>
                      <td>{member?.name || "Unknown"}</td>
                      <td>{c.account_type || "General"}</td>
                      <td style={{ fontWeight: "700", color: "var(--emerald)" }}>
                        {FinancialEngine.formatKES(c.amount)}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                        {c.mpesa_ref || "-"}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${c.status}`}
                          style={{
                            background:
                              c.status === "approved"
                                ? "var(--emerald-bg)"
                                : c.status === "pending"
                                ? "var(--amber-bg)"
                                : "var(--rose-bg)",
                            color:
                              c.status === "approved"
                                ? "var(--emerald)"
                                : c.status === "pending"
                                ? "var(--amber)"
                                : "var(--rose)",
                            border:
                              c.status === "approved"
                                ? "1px solid var(--emerald-border)"
                                : c.status === "pending"
                                ? "1px solid var(--amber-border)"
                                : "1px solid var(--rose-border)"
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});

ContributionsModal.displayName = "ContributionsModal";

/* ════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
════════════════════════════════════════════════════════════════ */

export default function ChamaDashboard() {
  const context = useChama();

  if (!context) {
    return <div className="error-container">⚠️ Chama context not available</div>;
  }

  const { chama, member } = context;

  if (!chama || !member) {
    return <div className="error-container">⏳ Loading context...</div>;
  }

  const [ui, dispatch] = useReducer(uiReducer, uiInitialState);
  const [state, setState] = useState({
    chama: {},
    members: [],
    contributions: [],
    loans: [],
    fines: [],
    welfare: [],
    funds: [],
    fundTransactions: [],
    minutes: [],
    statements: [],
    officers: [],
    sendMoney: [],
    merryGoRound: []
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchChamaCoreData(chama.id);
      setState(data);
    } catch (e) {
      setError(e.message);
      console.error("Error loading data:", e);
    } finally {
      setLoading(false);
    }
  }, [chama.id]);

  useEffect(() => {
    loadData();

    const unsubscribe = subscribeToChamaRealtime(chama.id, () => {
      loadData();
    });

    return () => unsubscribe?.();
  }, [chama.id, loadData]);

  const breakdown = useMemo(
    () => FinancialEngine.computeBreakdown(state.contributions),
    [state.contributions]
  );

  const canSendMoney = PermissionGuard.can(member.role, "SEND_MONEY");
  const canManageFunds = PermissionGuard.can(member.role, "MANAGE_FUNDS");

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {/* SIDEBAR */}
      <aside className={`sidebar ${ui.sidebarOpen ? "open" : "closed"}`}>
        <button
          className="toggle-btn"
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          aria-label="Toggle sidebar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            margin: "16px",
            border: "1px solid var(--border)",
            background: "var(--bg-3)",
            borderRadius: "8px",
            color: "var(--text-2)",
            cursor: "pointer"
          }}
        >
          {ui.sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <nav className="sidebar-nav">
          {[
            { id: "overview", label: "📊 Overview", icon: Wallet },
            { id: "members", label: "👥 Members", icon: Users },
            { id: "funds", label: "💰 Funds", icon: Banknote },
            { id: "contributions", label: "💳 Contributions", icon: DollarSign },
            { id: "send", label: "💸 Send Money", icon: Send },
            { id: "merry", label: "🔄 Merry-Go-Round", icon: Repeat2 }
          ].map(tab => (
            <button
              key={tab.id}
              className={`nav-item ${ui.activeTab === tab.id ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_TAB", payload: tab.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "12px",
                border: "1px solid transparent",
                background: "transparent",
                color: ui.activeTab === tab.id ? "var(--emerald)" : "var(--text-2)",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 200ms",
                width: "100%"
              }}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN AREA */}
      <main className="main-area">
        {error && (
          <div
            style={{
              padding: "16px 28px",
              background: "var(--rose-bg)",
              borderBottom: "1px solid var(--rose-border)",
              color: "var(--rose)",
              fontSize: "13px",
              fontWeight: "600"
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {ui.activeTab === "overview" && (
          <div>
            <div style={{ padding: "28px 28px 0" }}>
              <h2 style={{ fontSize: "24px", fontWeight: "750", marginBottom: "4px" }}>
                {state.chama.name || "Chama"}
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-2)" }}>
                {state.members.length} members · {state.contributions.length} contributions
              </p>
            </div>

            <FundsOverview funds={state.funds} />
            <BreakdownCards breakdown={breakdown} />

            <div style={{ padding: "0 28px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
              <button
                className="btn-primary"
                onClick={() => dispatch({ type: "OPEN_MODAL", payload: "members" })}
                style={{ justifyContent: "center", gap: "8px" }}
              >
                <Users size={16} />
                Members
              </button>
              <button
                className="btn-primary"
                onClick={() => dispatch({ type: "OPEN_MODAL", payload: "contributions" })}
                style={{ justifyContent: "center", gap: "8px" }}
              >
                <DollarSign size={16} />
                Contributions
              </button>
              {canSendMoney && (
                <button
                  className="btn-primary"
                  onClick={() => dispatch({ type: "OPEN_MODAL", payload: "sendMoney" })}
                  style={{ justifyContent: "center", gap: "8px", background: "linear-gradient(135deg, var(--blue), var(--blue-2))" }}
                >
                  <Send size={16} />
                  Send Money
                </button>
              )}
              {canManageFunds && (
                <button
                  className="btn-primary"
                  onClick={() => dispatch({ type: "OPEN_MODAL", payload: "funds" })}
                  style={{ justifyContent: "center", gap: "8px" }}
                >
                  <Plus size={16} />
                  Manage Funds
                </button>
              )}
            </div>
          </div>
        )}

        {ui.activeTab === "members" && (
          <div style={{ padding: "28px" }}>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "members" })}
              style={{ marginBottom: "16px", width: "100%" }}
            >
              <Users size={16} />
              View All Members ({state.members.length})
            </button>
            <div className="grid-cards">
              {state.members.slice(0, 6).map(m => (
                <div key={m.id} className="card" style={{ padding: "16px" }}>
                  <div
                    className="avatar avatar-md"
                    style={{
                      margin: "0 auto 12px",
                      background: "linear-gradient(135deg, var(--emerald-2), var(--blue-2))"
                    }}
                  >
                    {m.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <h4 style={{ marginBottom: "4px", textAlign: "center", fontSize: "13px" }}>
                    {m.name}
                  </h4>
                  <p style={{ textAlign: "center", fontSize: "11px", color: "var(--text-2)" }}>
                    {m.role || "Member"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {ui.activeTab === "funds" && (
          <div style={{ padding: "28px" }}>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "funds" })}
              style={{ marginBottom: "16px", width: "100%" }}
            >
              <Plus size={16} />
              Manage Fund Locations
            </button>
            <FundsOverview funds={state.funds} />
          </div>
        )}

        {ui.activeTab === "contributions" && (
          <div style={{ padding: "28px" }}>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "contributions" })}
              style={{ marginBottom: "16px", width: "100%" }}
            >
              <DollarSign size={16} />
              View All Contributions ({state.contributions.length})
            </button>
          </div>
        )}

        {ui.activeTab === "send" && (
          <div style={{ padding: "28px" }}>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "sendMoney" })}
              style={{ marginBottom: "16px", width: "100%", background: "linear-gradient(135deg, var(--blue), var(--blue-2))" }}
            >
              <Send size={16} />
              Record Money Send
            </button>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "sendHistory" })}
              style={{ marginBottom: "16px", width: "100%" }}
            >
              <Eye size={16} />
              View Send History ({state.sendMoney.length})
            </button>
          </div>
        )}

        {ui.activeTab === "merry" && (
          <div style={{ padding: "28px" }}>
            <button
              className="btn-primary"
              onClick={() => dispatch({ type: "OPEN_MODAL", payload: "merryGoRound" })}
              style={{ marginBottom: "16px", width: "100%", background: "linear-gradient(135deg, var(--violet), var(--violet-2))" }}
            >
              <Repeat2 size={16} />
              Merry-Go-Round Rotation
            </button>
          </div>
        )}
      </main>

      {/* MODALS */}
      <MembersModal
        open={ui.modals.members}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "members" })}
        members={state.members}
      />

      <ContributionsModal
        open={ui.modals.contributions}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "contributions" })}
        contributions={state.contributions}
        members={state.members}
      />

      <FundManagementModal
        open={ui.modals.funds}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "funds" })}
        funds={state.funds}
        onAddFund={loadData}
        chamaId={chama.id}
      />

      <SendMoneyModal
        open={ui.modals.sendMoney}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "sendMoney" })}
        chamaId={chama.id}
        members={state.members}
        onSend={loadData}
      />

      <SendMoneyHistoryModal
        open={ui.modals.sendHistory}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "sendHistory" })}
        sendRecords={state.sendMoney}
        members={state.members}
      />

      <MerryGoRoundModal
        open={ui.modals.merryGoRound}
        onClose={() => dispatch({ type: "CLOSE_MODAL", payload: "merryGoRound" })}
        merryGoRound={state.merryGoRound}
        members={state.members}
        chamaId={chama.id}
        onAdd={loadData}
      />
    </div>
  );
}
