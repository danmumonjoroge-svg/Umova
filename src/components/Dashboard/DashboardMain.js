// src/components/Dashboard/DashboardMain.js

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { supabase } from "../../supabaseClient";
import logo from "../../asset/logo/umovalogo.png";
import {
  LayoutDashboard, User, Wallet, LineChart, Landmark,
  FileText, LogOut, Menu, X, ShieldCheck, Activity, Bell,
  TrendingUp, TrendingDown, ChevronRight, Zap
} from "lucide-react";

const COA = {
  SAVINGS:  1018,
  LOANS:    1011,
  INTEREST: 1020,
  SHARES:   1012,
};

// ── Tiny sparkline using inline SVG ──────────────────────────────────────────
function Sparkline({ values = [], color = "#10b981", height = 28 }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 80, h = height;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="opacity-60">
      <polyline points={pts} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Animated count-up number ─────────────────────────────────────────────────
function CountUp({ value, prefix = "KES ", duration = 900 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = value / (duration / 16);
    const timer = setInterval(() => {
      start = Math.min(start + step, value);
      setDisplay(Math.round(start));
      if (start >= value) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <span>{prefix}{display.toLocaleString()}</span>;
}

export default function DashboardMain() {
  const location = useLocation();
  const { profile, logout } = useAuth();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [ledgerMetrics, setLedgerMetrics] = useState({
    savings: 0, loans: 0, shares: 0, interest: 0,
  });
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  // Fake sparkline history — replace with real time-series if available
  const [sparkHistory] = useState({
    savings:  [120, 145, 140, 160, 155, 175, 180, 190, 185, 200, 210, 220],
    loans:    [0, 10, 20, 15, 25, 30, 20, 35, 30, 40, 38, 42],
    shares:   [50, 55, 60, 58, 65, 70, 72, 75, 78, 80, 85, 90],
    interest: [0, 2, 4, 3, 5, 6, 5, 7, 8, 9, 10, 11],
  });

  const today = useMemo(() =>
    new Date().toLocaleDateString("en-KE", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }), []);

  const computeLedgerBalances = useCallback(async (memberNo) => {
    if (!memberNo) return;
    try {
      const { data, error } = await supabase
        .from("general_ledger")
        .select("amount, id, debit_account_id, credit_account_id")
        .eq("member_no", memberNo);
      if (error) throw error;

      let savings = 0, loans = 0, shares = 0, interest = 0;
      (data || []).forEach((tx) => {
        const amt    = Number(tx.amount || 0);
        const debit  = Number(tx.debit_account_id);
        const credit = Number(tx.credit_account_id);

        if (credit === COA.SAVINGS)   savings  += amt;
        if (debit  === COA.SAVINGS)   savings  -= amt;
        if (debit  === COA.LOANS)     loans    += amt;
        if (credit === COA.LOANS)     loans    -= amt;
        if (credit === COA.SHARES)    shares   += amt;
        if (debit  === COA.SHARES)    shares   -= amt;
        if (credit === COA.INTEREST)  interest += amt;
      });

      setLedgerMetrics({
        savings:  Math.max(0, savings),
        loans:    Math.max(0, loans),
        shares:   Math.max(0, shares),
        interest: Math.max(0, interest),
      });
      setMetricsLoaded(true);
    } catch (err) {
      console.error("[LEDGER_CORE]", err.message);
    }
  }, []);

  useEffect(() => {
    const no = profile?.member_no || profile?.memberNo;
    if (!no) return;
    computeLedgerBalances(no);

    const sub = supabase
      .channel(`dashboard-${no}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "general_ledger", filter: `member_no=eq.${no}` },
        () => computeLedgerBalances(no)
      )
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [profile?.member_no, profile?.memberNo, computeLedgerBalances]);

  const handleLogout = async () => {
    try { await logout(); } catch (err) { console.error(err); }
  };

  const navigation = [
    { label: "Dashboard",     icon: LayoutDashboard, path: "/member/dashboard",  suffix: null },
    { label: "Profile",       icon: User,            path: "/member/profile",    suffix: null },
    { label: "Savings",       icon: Wallet,          path: "/member/savings",    suffix: `KES ${ledgerMetrics.savings.toLocaleString()}`,  trend: "up"   },
    { label: "Share Capital", icon: LineChart,       path: "/member/shares",     suffix: `KES ${ledgerMetrics.shares.toLocaleString()}`,   trend: "up"   },
    { label: "Loans",         icon: Landmark,        path: "/member/loans",      suffix: ledgerMetrics.loans > 0 ? "Active" : "Clear",     trend: ledgerMetrics.loans > 0 ? "down" : "up" },
    { label: "Statements",    icon: FileText,        path: "/member/statement",  suffix: null },
  ];

  const pageTitle = useMemo(() => {
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length <= 1 || seg[1] === "dashboard") return "MEMBER DASHBOARD";
    return seg[1].replace(/-/g, " ").toUpperCase();
  }, [location.pathname]);

  const initials = (profile?.name || "M").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Quick stat cards shown in the top of sidebar
  const sideStats = [
    { label: "Savings",  value: ledgerMetrics.savings,  color: "#10b981", spark: sparkHistory.savings  },
    { label: "Loans",    value: ledgerMetrics.loans,    color: "#f59e0b", spark: sparkHistory.loans    },
  ];

  return (
    <>
      {/* ── GLOBAL STYLES injected once ────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;0,9..40,900;1,9..40,400&family=JetBrains+Mono:wght@400;600;700&display=swap');

        .umova-dash * { font-family: 'DM Sans', sans-serif; box-sizing: border-box; }
        .umova-dash .mono { font-family: 'JetBrains Mono', monospace; }

        .sidebar-glass {
          background: linear-gradient(160deg, #052e16 0%, #14532d 40%, #166534 100%);
          box-shadow: 4px 0 40px rgba(0,0,0,0.35);
        }

        .nav-item {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-radius: 14px;
          transition: all 0.18s ease;
          font-size: 13.5px;
          font-weight: 500;
          color: rgba(187,247,208,0.75);
          cursor: pointer;
          text-decoration: none;
          gap: 10px;
          overflow: hidden;
        }
        .nav-item::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 14px;
          background: rgba(255,255,255,0.0);
          transition: background 0.18s ease;
        }
        .nav-item:hover::before { background: rgba(255,255,255,0.08); }
        .nav-item:hover { color: #fff; }
        .nav-item.active {
          background: #fff;
          color: #14532d;
          font-weight: 700;
          box-shadow: 0 4px 20px rgba(0,0,0,0.18);
        }
        .nav-item.active::before { display: none; }

        .metric-card {
          background: #fff;
          border-radius: 20px;
          padding: 20px 22px;
          border: 1px solid #f1f5f9;
          box-shadow: 0 2px 12px rgba(0,0,0,0.05);
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .metric-card:hover {
          box-shadow: 0 8px 32px rgba(0,0,0,0.10);
          transform: translateY(-2px);
        }

        .avatar-ring {
          width: 44px; height: 44px;
          border-radius: 14px;
          background: linear-gradient(135deg, #34d399, #059669);
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 16px; color: #fff;
          letter-spacing: -0.5px;
          box-shadow: 0 4px 12px rgba(5,150,105,0.35);
          flex-shrink: 0;
        }

        .pill-badge {
          font-size: 10px; font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          padding: 2px 8px; border-radius: 6px;
          background: rgba(0,0,0,0.18); color: rgba(187,247,208,0.9);
          white-space: nowrap;
        }
        .pill-badge.active-item {
          background: rgba(5,150,105,0.15);
          color: #065f46;
        }
        .pill-badge.warn { background: rgba(245,158,11,0.15); color: #92400e; }

        .top-bar-shadow { box-shadow: 0 1px 0 #e2e8f0, 0 4px 24px rgba(0,0,0,0.04); }

        .sidebar-stat {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .collapse-btn {
          width: 28px; height: 28px;
          border-radius: 9px;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.12);
          display: flex; align-items: center; justify-content: center;
          color: rgba(187,247,208,0.8);
          cursor: pointer;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .collapse-btn:hover { background: rgba(255,255,255,0.18); color: #fff; }

        .status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #34d399;
          animation: pulse-dot 2s infinite;
          box-shadow: 0 0 0 0 rgba(52,211,153,0.4);
        }
        @keyframes pulse-dot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.4); }
          50% { box-shadow: 0 0 0 5px rgba(52,211,153,0); }
        }

        .page-fade-in {
          animation: fadeUp 0.35s ease both;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }

        .notif-badge {
          position: absolute; top: 4px; right: 4px;
          width: 17px; height: 17px;
          background: #ef4444; color: #fff;
          font-size: 9px; font-weight: 900;
          border-radius: 99px;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid #fff;
        }

        .topbar-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 99px;
          font-size: 10px; font-weight: 700;
          background: #f0fdf4; color: #15803d;
          border: 1px solid #bbf7d0;
          letter-spacing: 0.02em;
        }
      `}</style>

      <div className="umova-dash" style={{ height: "100vh", overflow: "hidden", background: "#f8fafc", display: "flex", position: "relative" }}>

        {/* MOBILE OVERLAY */}
        {mobileSidebarOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)", zIndex: 40 }}
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
        <aside
          className="sidebar-glass scrollbar-thin"
          style={{
            width: collapsed ? 76 : 288,
            minWidth: collapsed ? 76 : 288,
            display: "flex",
            flexDirection: "column",
            transition: "width 0.25s ease, min-width 0.25s ease",
            overflow: "hidden",
            zIndex: 50,
            position: window.innerWidth < 1280 ? "fixed" : "relative",
            top: 0, bottom: 0, left: 0,
            transform: window.innerWidth < 1280
              ? mobileSidebarOpen ? "translateX(0)" : "translateX(-100%)"
              : "translateX(0)",
          }}
        >
          {/* Logo row */}
          <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, overflow: "hidden" }}>
              <div style={{ background: "rgba(255,255,255,0.1)", padding: 8, borderRadius: 14, flexShrink: 0, backdropFilter: "blur(8px)" }}>
                <img src={logo} alt="UMOVA" style={{ width: 32, height: 32, objectFit: "contain" }} />
              </div>
              {!collapsed && (
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontWeight: 900, fontSize: 18, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1 }}>UMOVA</div>
                  <div style={{ fontSize: 9, color: "rgba(187,247,208,0.6)", letterSpacing: "3px", fontWeight: 700, marginTop: 4, textTransform: "uppercase" }}>SACCO CORE ERP</div>
                </div>
              )}
            </div>
            <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <ChevronRight size={14} style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.25s" }} />
            </button>
          </div>

          {/* Member identity card */}
          {!collapsed && (
            <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="avatar-ring">{initials}</div>
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {profile?.name || "Member Account"}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "rgba(187,247,208,0.6)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {profile?.member_no || profile?.memberNo || "—"}
                    </div>
                  </div>
                  <div className="status-dot" title="Session active" />
                </div>

                {/* Quick balance bars inside identity card */}
                {metricsLoaded && (
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {sideStats.map(({ label, value, color, spark }) => (
                      <div className="sidebar-stat" key={label} style={{ flexDirection: "column", alignItems: "flex-start", padding: "8px 10px", gap: 4 }}>
                        <div style={{ fontSize: 9, color: "rgba(187,247,208,0.5)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
                        <div className="mono" style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>
                          {value.toLocaleString()}
                        </div>
                        <Sparkline values={spark} color={color} height={20} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Collapsed avatar */}
          {collapsed && (
            <div style={{ padding: "14px 0", display: "flex", justifyContent: "center", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="avatar-ring">{initials}</div>
            </div>
          )}

          {/* Navigation */}
          <div className="scrollbar-thin" style={{ flex: 1, overflowY: "auto", padding: collapsed ? "12px 10px" : "16px 12px" }}>
            {!collapsed && (
              <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(187,247,208,0.35)", letterSpacing: "3.5px", textTransform: "uppercase", marginBottom: 10, paddingLeft: 6 }}>
                FINANCIAL LEDGERS
              </div>
            )}
            <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileSidebarOpen(false)}
                    className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                    title={collapsed ? item.label : undefined}
                    style={collapsed ? { justifyContent: "center", padding: "10px 0" } : {}}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 11, flexShrink: 0 }}>
                      <Icon size={18} style={{ flexShrink: 0 }} />
                      {!collapsed && <span>{item.label}</span>}
                    </div>
                    {!collapsed && item.suffix && (
                      <span className={`pill-badge ${({ isActive }) => isActive ? "active-item" : ""} ${item.trend === "down" && ledgerMetrics.loans > 0 ? "warn" : ""}`}>
                        {item.suffix}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* Security status strip */}
          {!collapsed && (
            <div style={{ padding: "10px 12px 8px" }}>
              <div style={{ background: "rgba(5,46,22,0.6)", border: "1px solid rgba(52,211,153,0.12)", borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#d1fae5" }}>Security Environment</div>
                  <div style={{ fontSize: 10, color: "rgba(52,211,153,0.7)", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="status-dot" style={{ width: 5, height: 5 }} />
                    Double-Entry Mode Active
                  </div>
                </div>
                <Activity size={16} style={{ color: "rgba(52,211,153,0.35)" }} />
              </div>
            </div>
          )}

          {/* Logout */}
          <div style={{ padding: collapsed ? "10px 10px 16px" : "8px 12px 18px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              onClick={handleLogout}
              title="Logout"
              style={{
                width: "100%",
                padding: collapsed ? "10px 0" : "11px 16px",
                borderRadius: 14,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.18)",
                color: "#fca5a5",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "center",
                gap: collapsed ? 0 : 8,
                transition: "all 0.18s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.22)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.color = "#fca5a5"; }}
            >
              <LogOut size={15} />
              {!collapsed && "Disconnect Session"}
            </button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* TOP BAR */}
          <header className="top-bar-shadow" style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 30 }}>

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileSidebarOpen(true)}
                style={{ display: "none", padding: 8, border: "1px solid #e2e8f0", borderRadius: 10, background: "transparent", cursor: "pointer", color: "#64748b" }}
                className="mobile-menu-btn"
              >
                <Menu size={18} />
              </button>

              {/* Page breadcrumb */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Zap size={14} style={{ color: "#16a34a" }} />
                  <h1 style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.4px", margin: 0 }}>{pageTitle}</h1>
                </div>
                <p style={{ fontSize: 11.5, color: "#94a3b8", margin: 0, marginTop: 2, fontWeight: 500 }}>
                  Welcome back,&nbsp;
                  <span style={{ fontWeight: 700, color: "#475569" }}>{profile?.name || "Member"}</span>
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>

              {/* Live balance chips — shown in topbar for quick glance */}
              {metricsLoaded && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ padding: "5px 12px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: 6 }}>
                    <TrendingUp size={12} style={{ color: "#16a34a" }} />
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#15803d" }}>
                      KES {ledgerMetrics.savings.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 9, color: "#86efac", fontWeight: 600, textTransform: "uppercase" }}>savings</span>
                  </div>
                  {ledgerMetrics.loans > 0 && (
                    <div style={{ padding: "5px 12px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 6 }}>
                      <TrendingDown size={12} style={{ color: "#d97706" }} />
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#b45309" }}>
                        KES {ledgerMetrics.loans.toLocaleString()}
                      </span>
                      <span style={{ fontSize: 9, color: "#fcd34d", fontWeight: 600, textTransform: "uppercase" }}>loan</span>
                    </div>
                  )}
                </div>
              )}

              {/* Notification bell */}
              <div style={{ position: "relative", padding: 8, cursor: "pointer", color: "#94a3b8", borderRadius: 10, border: "1px solid #f1f5f9", background: "#fafafa" }}>
                <Bell size={18} />
                {unreadNotifications > 0 && (
                  <span className="notif-badge">{unreadNotifications}</span>
                )}
              </div>

              {/* Date + SSL pill */}
              <div style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{today}</span>
                <span className="topbar-chip">
                  <ShieldCheck size={10} />
                  SSL Ledger Isolated
                </span>
              </div>
            </div>
          </header>

          {/* MAIN SCROLL AREA */}
          <main
            className="scrollbar-thin"
            style={{ flex: 1, overflowY: "auto", padding: "24px 24px 32px", background: "#f8fafc" }}
          >
            {/* Summary metric row — visible on every page */}
            {metricsLoaded && (
              <div
                className="page-fade-in"
                style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}
              >
                {[
                  { label: "Savings Balance",   value: ledgerMetrics.savings,  prefix: "KES ", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: <Wallet size={16} />,   spark: sparkHistory.savings,  trend: "+",  sub: "Account 1018" },
                  { label: "Active Loan",        value: ledgerMetrics.loans,    prefix: "KES ", color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: <Landmark size={16} />, spark: sparkHistory.loans,    trend: ledgerMetrics.loans > 0 ? "↑" : "✓", sub: "Account 1011" },
                  { label: "Share Capital",      value: ledgerMetrics.shares,   prefix: "KES ", color: "#7c3aed", bg: "#faf5ff", border: "#e9d5ff", icon: <LineChart size={16} />, spark: sparkHistory.shares,  trend: "+",  sub: "Account 1012" },
                  { label: "Interest Accrued",   value: ledgerMetrics.interest, prefix: "KES ", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", icon: <Activity size={16} />, spark: sparkHistory.interest, trend: ledgerMetrics.interest > 0 ? "↑" : "—", sub: "Account 1020" },
                ].map(({ label, value, prefix, color, bg, border, icon, spark, trend, sub }) => (
                  <div className="metric-card" key={label} style={{ borderTop: `3px solid ${color}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6 }}>{label}</div>
                        <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px", lineHeight: 1 }}>
                          {metricsLoaded ? <CountUp value={value} prefix={prefix} /> : "—"}
                        </div>
                        <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 5, fontWeight: 600 }}>{sub}</div>
                      </div>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>
                        {icon}
                      </div>
                    </div>
                    <div style={{ marginTop: 14, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                      <Sparkline values={spark} color={color} height={28} />
                      <span style={{ fontSize: 10, fontWeight: 800, color, background: bg, border: `1px solid ${border}`, padding: "2px 7px", borderRadius: 6 }}>
                        {trend}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Routed page content */}
            <div className="page-fade-in">
              <Outlet context={{ memberNo: profile?.member_no || profile?.memberNo, ledgerMetrics }} />
            </div>
          </main>
        </div>

      </div>

      {/* Responsive override for mobile hamburger */}
      <style>{`
        @media (max-width: 1279px) {
          .mobile-menu-btn { display: flex !important; }
        }
      `}</style>
    </>
  );
}