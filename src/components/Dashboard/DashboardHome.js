// src/components/Dashboard/DashboardHome.js
// ─────────────────────────────────────────────────────────────────────────────
// Consumes ledgerMetrics from DashboardMain via useOutletContext — no duplicate
// Supabase ledger queries. Role detection checks local admin storage states and
// queries by UUID/email to guarantee administrative access layout execution.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { supabase } from "../../supabaseClient";
import {
  Wallet, Landmark, TrendingUp, Gem, User, ShieldAlert,
  ArrowDownLeft, ArrowUpRight, History, Bell, Settings,
  PieChart, Send, FileText, Download, CheckCircle,
  RefreshCw, X, ShieldCheck, Lock, LayoutDashboard, HelpCircle
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT MAPPING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ACCOUNTS = {
  SAVINGS:  1018,
  LOANS:    1011,
  SHARES:   1012,
  INTEREST: 1020,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardHome() {
  const navigate                      = useNavigate();
  const { profile, logout }           = useAuth();

  // Consume pre-computed ledger data from DashboardMain's Outlet context
  const { memberNo, ledgerMetrics }   = useOutletContext();

  // Local UI states
  const [loading, setLoading]             = useState(true);
  const [currentTime, setCurrentTime]     = useState(new Date());
  const [activePanel, setActivePanel]     = useState("");

  // Role resolution states
  const [userRole, setUserRole]           = useState(null);
  const [roleLoading, setRoleLoading]     = useState(true);

  // Data metrics states
  const [quickStats, setQuickStats]       = useState({
    totalDeposits: 0, totalWithdrawals: 0,
    totalShares: 0, totalLoanRepayments: 0,
  });
  const [systemStats, setSystemStats]     = useState({
    members: 0, loans: 0, transactions: 0, notifications: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [notifications, setNotifications]           = useState([]);
  const [announcements, setAnnouncements]           = useState([]);
  const [healthScore, setHealthScore]               = useState(0);
  const [profileCompletion, setProfileCompletion]   = useState(0);
  const [loanEligibility, setLoanEligibility]       = useState(0);

  // ─────────────────────────────────────────────────────────────────────────
  // REVISED ROLE DETECTION LAYER — Resolves UUID, Email, and LocalStorage flags
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const resolveRole = async () => {
      // Step 1: Check for explicit admin/staff flags in localStorage
      try {
        const cachedStaff = localStorage.getItem("staff_session") || localStorage.getItem("admin_user");
        if (cachedStaff) {
          const parsed = JSON.parse(cachedStaff);
          if ((parsed.role === "admin" || parsed.role === "staff") && parsed.email === profile?.email) {
            setUserRole(parsed.role);
            setRoleLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn("[ROLE_CHECK] Local storage fallback skipped.");
      }

      if (!profile?.id && !profile?.member_no) {
        setRoleLoading(false);
        return;
      }

      setRoleLoading(true);
      try {
        // Step 2: Attempt matching primary keys against metadata UUID
        let { data, error } = await supabase
          .from("users")
          .select("role")
          .eq("id", profile.id);

        // Step 3: Secondary email lookup check if ID maps are missing
        if ((!data || data.length === 0) && profile?.email) {
          const fallback = await supabase
            .from("users")
            .select("role")
            .eq("email", profile.email);
          data = fallback.data;
          error = fallback.error;
        }

        if (error) {
          console.warn("[ROLE_CHECK] Error tracking data:", error.message);
          setUserRole("member"); 
        } else if (data && data.length > 0) {
          setUserRole(data[0].role || "member"); 
        } else {
          console.warn(`[ROLE_CHECK] No explicit roles found for user entry. Defaulting to member.`);
          setUserRole("member"); 
        }
      } catch (err) {
        console.error("[ROLE_CHECK] Exception safe-handled:", err.message);
        setUserRole("member");
      } finally {
        setRoleLoading(false);
      }
    };

    resolveRole();
  }, [profile]);

  const isStaff = userRole === "staff";
  const isAdmin = userRole === "admin";
  const isPrivileged = isStaff || isAdmin;

  // ─────────────────────────────────────────────────────────────────────────
  // LIVE SYSTEM CLOCK
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // DERIVED RATIO BALANCES
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const { savings = 0, loans = 0, shares = 0 } = ledgerMetrics || {};

    let score = 0;
    if (savings > 10000)             score += 35;
    if (shares  > 5000)              score += 35;
    if (Math.abs(loans) < savings)   score += 30;
    setHealthScore(score);

    setLoanEligibility((Number(savings) + Number(shares)) * 3);
  }, [ledgerMetrics]);

  // ─────────────────────────────────────────────────────────────────────────
  // PROFILE COMPLETION CALCULATOR
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    const fields  = ["name", "member_no", "phone", "email", "national_id"];
    const filled  = fields.filter(f => profile?.[f]).length;
    setProfileCompletion(Math.round((filled / fields.length) * 100));
  }, [profile]);

  // ─────────────────────────────────────────────────────────────────────────
  // DATALOADERS & LEDGER PARSING
  // ─────────────────────────────────────────────────────────────────────────
  const loadTransactions = useCallback(async (mno) => {
    if (!mno) return;
    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", mno)
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) { console.error("[HOME] transactions:", error.message); return; }

    const ledger = data || [];
    let deposits = 0, withdrawals = 0, loanRepayments = 0;

    ledger.forEach(tx => {
      const amt    = Number(tx.amount || 0);
      const debit  = Number(tx.debit_account_id);
      const credit = Number(tx.credit_account_id);
      if (credit === ACCOUNTS.SAVINGS) deposits       += amt;
      if (debit  === ACCOUNTS.SAVINGS) withdrawals    += amt;
      if (credit === ACCOUNTS.LOANS)   loanRepayments += amt;
    });

    setRecentTransactions(ledger);
    setQuickStats({
      totalDeposits:       deposits,
      totalWithdrawals:    withdrawals,
      totalShares:         ledgerMetrics?.shares || 0,
      totalLoanRepayments: loanRepayments,
    });
  }, [ledgerMetrics?.shares]);

  const loadNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) { console.error("[HOME] notifications:", error.message); return; }
    setNotifications(data || []);
  }, []);

  const loadSystemStats = useCallback(async () => {
    if (!isPrivileged) return;
    const [members, loans, transactions, notifs] = await Promise.all([
      supabase.from("members").select("*",       { count: "exact", head: true }),
      supabase.from("loans").select("*",         { count: "exact", head: true }),
      supabase.from("transactions").select("*",  { count: "exact", head: true }),
      supabase.from("notifications").select("*", { count: "exact", head: true }),
    ]);
    setSystemStats({
      members:       members.count      || 0,
      loans:         loans.count        || 0,
      transactions:  transactions.count || 0,
      notifications: notifs.count       || 0,
    });
  }, [isPrivileged]);

  const loadAnnouncements = useCallback(() => {
    setAnnouncements([
      { title: "Dividend Processing Update",  body: "Annual member dividend distribution processes are scheduling next week." },
      { title: "System Infrastructure Upgrade", body: "Mobile core system ledger reconciliations completed successfully." },
      { title: "Instant Emergency Facilities",  body: "Emergency loan parameters updated to allow immediate processing." },
      { title: "KYC Account Verification",    body: "Please verify national identification details to maintain active standing." },
    ]);
  }, []);

  // Orchestrator initialization
  useEffect(() => {
    if (!profile || roleLoading) return;

    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([
          loadTransactions(profile.member_no),
          loadNotifications(),
          loadSystemStats(),        
        ]);
        loadAnnouncements();
      } catch (err) {
        console.error("[HOME] initialization failure:", err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [profile, roleLoading, loadTransactions, loadNotifications, loadSystemStats, loadAnnouncements]);

  const { savings = 0, loans = 0, shares = 0, interest = 0 } = ledgerMetrics || {};

  const netWorth = useMemo(() => (
    Number(savings) + Number(shares) - Math.abs(Number(loans))
  ), [savings, shares, loans]);

  const handleLogout = useCallback(async () => { await logout(); }, [logout]);

  // Loading Framework
  if (loading || roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white p-10 rounded-[40px] shadow-2xl w-full max-w-sm text-center">
          <div className="w-20 h-20 border-[5px] border-green-100 border-t-green-600 rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Initializing</h2>
          <p className="text-slate-400 mt-2 text-sm">Loading your SACCO environment…</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white p-10 rounded-[35px] shadow-2xl text-center">
          <h2 className="text-3xl font-black text-red-600">Session Expired</h2>
          <p className="mt-3 text-slate-500 text-sm">Please log in again to continue.</p>
          <button
            onClick={() => navigate("/login")}
            className="mt-6 bg-green-600 hover:bg-green-700 text-white px-8 py-3.5 rounded-2xl font-bold transition text-sm"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── HERO FRAMEWORK ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-green-800 via-green-700 to-emerald-600 rounded-[36px] overflow-hidden shadow-2xl relative">
        <div className="absolute -top-16 -right-16 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 p-8">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
            <div>
              <p className="uppercase tracking-[5px] text-[10px] text-green-300/80 font-semibold">UMOVA INVESTMENT LTD</p>
              <h1 className="text-4xl md:text-5xl font-black mt-3 text-white leading-[1.05] tracking-tight">
                Welcome back,<br />
                <span className="text-green-200">{profile?.name?.split(" ")[0]}</span>
              </h1>

              <div className="flex flex-wrap gap-2.5 mt-5">
                <RolePill>{profile?.member_no}</RolePill>
                <RolePill variant="dark">{String(userRole || "member").toUpperCase()}</RolePill>
                <RolePill variant={profile?.kyc_status === "VERIFIED" ? "verified" : "pending"}>
                  KYC: {profile?.kyc_status || "PENDING"}
                </RolePill>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-[28px] p-6 min-w-[260px]">
              <p className="text-[11px] text-green-300/70 uppercase tracking-widest font-semibold">Active Session</p>
              <h2 className="text-4xl font-black text-white mt-2 font-mono tracking-tight">
                {currentTime.toLocaleTimeString()}
              </h2>
              <p className="text-green-200/70 text-sm mt-2">{currentTime.toDateString()}</p>
              <div className="flex items-center gap-2 mt-4 text-green-300/80 text-xs">
                <Lock size={11} />
                <span className="font-medium">SSL Ledger Isolated</span>
              </div>
              <button
                onClick={handleLogout}
                className="mt-5 w-full bg-red-500/80 hover:bg-red-600 border border-red-400/20 text-white py-3 rounded-2xl font-bold text-sm transition-all duration-200"
              >
                Disconnect Session
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── PRIVILEGED MANAGEMENT CONSOLE ──────────────────────────────── */}
      {isPrivileged && (
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-[36px] overflow-hidden shadow-2xl relative">
          <div className="absolute top-0 right-0 w-80 h-80 bg-green-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-emerald-900/20 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 p-8">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6 mb-8">
              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-[10px] uppercase tracking-[5px] text-slate-400 font-semibold">
                    {isAdmin ? "Administrator" : "Staff"} Access Confirmed
                  </p>
                </div>
                <h2 className="text-3xl font-black text-white tracking-tight">
                  {isAdmin ? "Admin Control Centre" : "Staff Operations Hub"}
                </h2>
                <p className="text-slate-400 text-sm mt-2 max-w-lg">
                  {isAdmin
                    ? "Full administrative privileges are active. System operational parameters exposed."
                    : "Staff operations active. General ledger reporting tools and logs enabled."
                  }
                </p>
                <div className="flex flex-wrap gap-2.5 mt-4">
                  <span className="bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full">
                    Role: {String(userRole).toUpperCase()}
                  </span>
                  <span className="bg-white/5 border border-white/10 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <ShieldCheck size={11} /> ERP ACCESS ON
                  </span>
                </div>
              </div>

              <button
                onClick={() => navigate("/admin")}
                className="group flex items-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-8 py-4 rounded-2xl font-black text-base shadow-2xl shadow-emerald-900/30 transition-all duration-200 hover:shadow-emerald-500/25 hover:-translate-y-0.5 whitespace-nowrap"
              >
                <LayoutDashboard size={20} className="transition-transform group-hover:rotate-6" />
                Open Admin Dashboard
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                { icon: <User size={20} />,       label: "Members",    path: "/admin/members" },
                { icon: <Landmark size={20} />,   label: "Loans",      path: "/admin/loans" },
                { icon: <PieChart size={20} />,   label: "Reports",    path: "/admin/reports" },
                { icon: <Wallet size={20} />,     label: "Payments",   path: "/admin/payments" },
                { icon: <FileText size={20} />,   label: "Statements", path: "/admin/member-statements" },
                { icon: <Settings size={20} />,   label: "Settings",   path: "/admin/settings" },
              ].map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => navigate(item.path)}
                  className="group bg-white/5 hover:bg-white/10 border border-white/8 hover:border-white/15 rounded-[22px] p-5 flex flex-col items-center justify-center gap-3 transition-all duration-200 hover:-translate-y-0.5"
                >
                  <div className="text-slate-300 group-hover:text-emerald-400 transition-colors">{item.icon}</div>
                  <span className="font-bold text-xs text-slate-300 group-hover:text-white transition-colors">{item.label}</span>
                </button>
              ))}
            </div>

            {isAdmin && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                {[
                  { label: "Total Members",    value: systemStats.members },
                  { label: "Active Loans",     value: systemStats.loans },
                  { label: "Transactions",     value: systemStats.transactions },
                  { label: "Notifications",    value: systemStats.notifications },
                ].map((s, idx) => (
                  <div key={idx} className="bg-white/5 border border-white/8 rounded-[18px] px-4 py-3.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{s.label}</p>
                    <p className="text-2xl font-black text-white mt-1 font-mono">{s.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── KPI BALANCES GRID ───────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Savings Balance"
          value={savings}
          icon={<Wallet size={28} />}
          gradient="from-green-600 to-emerald-700"
          shadow="shadow-green-200"
          onClick={() => setActivePanel("deposit")}
        />
        <KpiCard
          title="Loan Balance"
          value={Math.abs(loans)}
          icon={<Landmark size={28} />}
          gradient="from-rose-600 to-red-700"
          shadow="shadow-red-200"
          onClick={() => setActivePanel("loan")}
        />
        <KpiCard
          title="Share Capital"
          value={shares}
          icon={<TrendingUp size={28} />}
          gradient="from-blue-600 to-indigo-700"
          shadow="shadow-blue-200"
          onClick={() => setActivePanel("deposit")}
        />
        <KpiCard
          title="Net Worth"
          value={netWorth}
          icon={<Gem size={28} />}
          gradient="from-violet-600 to-purple-800"
          shadow="shadow-purple-200"
          onClick={() => setActivePanel("analytics")}
        />
      </div>

      {/* ── PROGRESS PROGRESS METRICS ───────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-4">
        <MetricCard
          title="Financial Health"
          value={`${healthScore}%`}
          subtitle="Based on ledger metrics structure"
          barValue={healthScore}
          barColor="bg-green-500"
          onClick={() => setActivePanel("analytics")}
        />
        <MetricCard
          title="Profile Completion"
          value={`${profileCompletion}%`}
          subtitle="Manage active record statuses"
          barValue={profileCompletion}
          barColor="bg-blue-500"
          onClick={() => setActivePanel("profile")}
        />
        <MetricCard
          title="Loan Eligibility"
          value={`KES ${Number(loanEligibility).toLocaleString()}`}
          subtitle="Estimated qualification multiplier"
          barValue={Math.min(100, (loanEligibility / 500000) * 100)}
          barColor="bg-violet-500"
          onClick={() => setActivePanel("loan")}
        />
      </div>

      {/* ── INTERACTION MATRIX ─────────────────────────────────────────── */}
      <div className="bg-white rounded-[32px] p-6 shadow-xl border border-slate-100">
        <div className="mb-5">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Quick Actions</h2>
          <p className="text-slate-400 text-sm mt-1">Fast SACCO balance queries and workflows</p>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
          {[
            { icon: <Wallet size={20} />,     label: "Deposit",    panel: "deposit"   },
            { icon: <Landmark size={20} />,   label: "Loans",      panel: "loan"      },
            { icon: <FileText size={20} />,   label: "Statements", panel: "statement" },
            { icon: <User size={20} />,       label: "Profile",    panel: "profile"   },
            { icon: <Send size={20} />,       label: "Transfer",   panel: "transfer"  },
            { icon: <Bell size={20} />,       label: "Alerts",     panel: "alerts"    },
            { icon: <PieChart size={20} />,   label: "Analytics",  panel: "analytics" },
            { icon: <Settings size={20} />,   label: "Settings",   panel: "settings"  },
          ].map((item, idx) => (
            <button
              key={idx}
              onClick={() => setActivePanel(item.panel)}
              className="group bg-slate-50 hover:bg-green-50 border border-slate-100 hover:border-green-200 rounded-[22px] py-5 flex flex-col items-center justify-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="text-slate-500 group-hover:text-green-600 transition-colors">{item.icon}</div>
              <span className="text-[11px] font-bold text-slate-600 group-hover:text-green-700 transition-colors">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── CENTRAL DATA TABLES ────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-[32px] p-6 shadow-xl border border-slate-100">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Recent Transactions</h2>
              <p className="text-slate-400 text-sm mt-0.5">Isolated transaction ledger timeline</p>
            </div>
            <button
              onClick={() => setActivePanel("statement")}
              className="text-green-700 hover:text-green-900 font-bold text-xs flex items-center gap-1.5 bg-green-50 hover:bg-green-100 px-3 py-2 rounded-xl transition"
            >
              <History size={14} /> View All
            </button>
          </div>

          <div className="space-y-2.5">
            {recentTransactions.length > 0
              ? recentTransactions.map((tx, i) => <TxRow key={i} tx={tx} />)
              : <div className="text-center py-12 text-slate-400 text-sm">No transaction events on ledger.</div>
            }
          </div>
        </div>

        <div className="space-y-5">
          <div className="bg-white rounded-[32px] p-6 shadow-xl border border-slate-100">
            <h2 className="text-xl font-black text-slate-800 mb-4 tracking-tight">Announcements</h2>
            <div className="space-y-3">
              {announcements.map((item, i) => (
                <div key={i} className="bg-slate-50 rounded-2xl p-4 border-l-[3px] border-green-600">
                  <h3 className="font-bold text-slate-800 text-sm">{item.title}</h3>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── ACCOUNT STATUS SUMMARIES ───────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Deposits"
          value={quickStats.totalDeposits}
          icon={<ArrowDownLeft className="text-green-600" size={28} />}
          onClick={() => setActivePanel("statement")}
        />
        <SummaryCard
          title="Total Withdrawals"
          value={quickStats.totalWithdrawals}
          icon={<ArrowUpRight className="text-red-600" size={28} />}
          onClick={() => setActivePanel("statement")}
        />
        <SummaryCard
          title="Loan Repayments"
          value={quickStats.totalLoanRepayments}
          icon={<Landmark className="text-blue-600" size={28} />}
          onClick={() => setActivePanel("loan")}
        />
        <SummaryCard
          title="Interest Earned"
          value={interest}
          icon={<TrendingUp className="text-violet-600" size={28} />}
          onClick={() => setActivePanel("analytics")}
        />
      </div>

      {/* ── SLIDE DRAWERS ORCHESTRATION LAYER ───────────────────────────── */}
      {activePanel && (
        <SlidePanel onClose={() => setActivePanel("")}>
          {activePanel === "deposit"   && <DepositPanel   profile={profile} />}
          {activePanel === "loan"      && <LoanPanel      limit={loanEligibility} balance={loans} />}
          {activePanel === "statement" && <StatementPanel transactions={recentTransactions} />}
          {activePanel === "profile"   && <ProfilePanel   member={profile} completion={profileCompletion} />}
          {activePanel === "transfer"  && <TransferPanel  savingsBalance={savings} profile={profile} />}
          {activePanel === "alerts"    && <AlertsPanel    notifications={notifications} />}
          {activePanel === "analytics" && <AnalyticsPanel savings={savings} shares={shares} loans={loans} />}
          {activePanel === "settings"  && <SettingsPanel  profile={profile} />}
        </SlidePanel>
      )}

      <p className="text-center text-xs text-slate-400 py-3">
        UMOVA Investment Ltd &nbsp;•&nbsp; SACCO Core ERP &nbsp;•&nbsp; Secure Ledger Infrastructure
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI REUSABLE PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const RolePill = ({ children, variant = "default" }) => {
  const map = {
    default:  "bg-white/15 text-white",
    dark:     "bg-black/20 text-white",
    verified: "bg-emerald-400/20 text-emerald-200 border border-emerald-400/30",
    pending:  "bg-amber-400/20 text-amber-200 border border-amber-400/30",
  };
  return <span className={`px-3.5 py-1.5 rounded-full text-xs font-bold ${map[variant]}`}>{children}</span>;
};

const KpiCard = ({ title, value, icon, gradient, shadow, onClick }) => (
  <div
    onClick={onClick}
    className={`bg-gradient-to-br ${gradient} rounded-[28px] p-5 text-white shadow-xl ${shadow} cursor-pointer hover:-translate-y-1 transition-all duration-200`}
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-75">{title}</p>
        <h2 className="text-2xl font-black mt-2.5 tracking-tight">KES {Number(value).toLocaleString()}</h2>
      </div>
      <div className="p-2.5 bg-white/15 rounded-2xl opacity-90">{icon}</div>
    </div>
  </div>
);

const MetricCard = ({ title, value, subtitle, barValue, barColor, onClick }) => (
  <div
    onClick={onClick}
    className="bg-white rounded-[28px] p-5 shadow-xl border border-slate-100 cursor-pointer hover:border-green-400/50 transition-all"
  >
    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{title}</p>
    <h2 className="text-3xl font-black text-slate-800 mt-2 tracking-tight">{value}</h2>
    <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
    <div className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, barValue || 0)}%` }} />
    </div>
  </div>
);

const SummaryCard = ({ title, value, icon, onClick }) => (
  <div
    onClick={onClick}
    className="bg-white rounded-[28px] p-5 shadow-xl border border-slate-50 cursor-pointer hover:shadow-2xl hover:-translate-y-0.5 transition-all"
  >
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</p>
        <h2 className="text-2xl font-black text-slate-800 mt-2">KES {Number(value).toLocaleString()}</h2>
      </div>
      <div className="p-3 bg-slate-50 rounded-2xl">{icon}</div>
    </div>
  </div>
);

const TxRow = ({ tx }) => {
  const isCredit = tx.credit_account_id === ACCOUNTS.SAVINGS;
  return (
    <div className="bg-slate-50 rounded-[20px] p-4 flex items-center justify-between hover:bg-slate-100 transition-colors">
      <div className="flex items-center gap-3.5">
        <div className={`p-2.5 rounded-xl ${isCredit ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
          {isCredit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
        </div>
        <div>
          <p className="font-bold text-slate-800 text-sm">{tx.description || "System Transaction"}</p>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            {tx.created_at ? new Date(tx.created_at).toLocaleString() : "—"}
          </p>
        </div>
      </div>
      <span className="font-black text-slate-700 text-base font-mono">KES {Number(tx.amount || 0).toLocaleString()}</span>
    </div>
  );
};

const SlidePanel = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
    <div className="w-full max-w-xl bg-white h-full shadow-2xl overflow-y-auto relative p-6 border-l border-slate-100">
      <button onClick={onClose} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition">
        <X size={20} />
      </button>
      <div className="mt-8">{children}</div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL SLIDE-DRAWERS INTERFACE IMPLEMENTATIONS (PLACEHOLDERS)
// ─────────────────────────────────────────────────────────────────────────────
const DepositPanel = ({ profile }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <Wallet className="text-green-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Deposit & Equity Manager</h3>
    </div>
    <p className="text-slate-500 text-sm">Account allocation structures for member <strong className="text-slate-800">{profile?.name}</strong>.</p>
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs font-mono text-slate-500">
      [Placeholder: Insert custom M-Pesa gateway or internal deposit pipeline fields here]
    </div>
  </div>
);

const LoanPanel = ({ limit, balance }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <Landmark className="text-red-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Credit Facilities Panel</h3>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="p-4 bg-slate-50 rounded-xl">
        <p className="text-xs text-slate-400 font-bold uppercase">Max Eligibility</p>
        <p className="text-lg font-bold text-slate-800 mt-1 font-mono">KES {limit.toLocaleString()}</p>
      </div>
      <div className="p-4 bg-slate-50 rounded-xl">
        <p className="text-xs text-slate-400 font-bold uppercase">Active Risk Liability</p>
        <p className="text-lg font-bold text-red-600 mt-1 font-mono">KES {Math.abs(balance).toLocaleString()}</p>
      </div>
    </div>
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs font-mono text-slate-500">
      [Placeholder: Insert amortization calculator forms or application submissions here]
    </div>
  </div>
);

const StatementPanel = ({ transactions }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <FileText className="text-blue-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Full Audit Statement</h3>
    </div>
    <p className="text-slate-500 text-sm">Reviewing localized account events ledger cache logs.</p>
    <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
      {transactions.map((t, idx) => (
        <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs flex justify-between items-center font-mono">
          <div>
            <p className="font-bold text-slate-700">{t.description || "Ledger Entry"}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{new Date(t.created_at).toLocaleDateString()}</p>
          </div>
          <span className="font-bold text-slate-800">KES {Number(t.amount || 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  </div>
);

const ProfilePanel = ({ member, completion }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <User className="text-violet-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">KYC Profiles Data</h3>
    </div>
    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2 text-sm text-slate-600">
      <p><strong>Full System Name:</strong> {member?.name}</p>
      <p><strong>National Identification ID:</strong> {member?.national_id || "Not Provided"}</p>
      <p><strong>Secured Matrix Phone:</strong> {member?.phone || "None"}</p>
      <p><strong>System Identification Number:</strong> {member?.member_no}</p>
      <p><strong>Completeness Metrics:</strong> {completion}%</p>
    </div>
  </div>
);

const TransferPanel = ({ savingsBalance, profile }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <Send className="text-emerald-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Inter-Account Ledger Transfers</h3>
    </div>
    <p className="text-slate-500 text-sm">Transfer liquidity safely across integrated SACCO nodes.</p>
    <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 text-emerald-800 text-xs font-bold">
      Maximum Liquid Remittance Limit: KES {savingsBalance.toLocaleString()}
    </div>
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs font-mono text-slate-500">
      [Placeholder: Insert destination account lookup forms and transaction tokens verification here]
    </div>
  </div>
);

const AlertsPanel = ({ notifications }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <Bell className="text-amber-500" size={24} />
      <h3 className="text-xl font-black text-slate-800">System Notification Log</h3>
    </div>
    <div className="space-y-2">
      {notifications.length > 0 ? notifications.map((n, idx) => (
        <div key={idx} className="p-3 bg-slate-50 rounded-xl text-xs border border-slate-100">
          <p className="font-bold text-slate-700">{n.title || "Notification Action"}</p>
          <p className="text-slate-500 mt-1">{n.message || n.body}</p>
        </div>
      )) : (
        <p className="text-center text-slate-400 text-xs py-6">No notifications on stream.</p>
      )}
    </div>
  </div>
);

const AnalyticsPanel = ({ savings, shares, loans }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <PieChart className="text-purple-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Asset Optimization Summary</h3>
    </div>
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs space-y-2 text-slate-500 font-mono">
      <p>Savings Liquidity Index: {Number(savings).toLocaleString()}</p>
      <p>Capital Retention Stock: {Number(shares).toLocaleString()}</p>
      <p>Debt Diversification Vector: {Number(loans).toLocaleString()}</p>
    </div>
  </div>
);

const SettingsPanel = ({ profile }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 border-b pb-4">
      <Settings className="text-slate-600" size={24} />
      <h3 className="text-xl font-black text-slate-800">Account Configurations</h3>
    </div>
    <p className="text-slate-500 text-sm">Manage configuration keys for email link: <strong className="text-slate-700">{profile?.email}</strong></p>
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs font-mono text-slate-500">
      [Placeholder: Insert multi-factor configuration UI or password change requests elements here]
    </div>
  </div>
);