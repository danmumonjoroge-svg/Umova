// src/components/Dashboard/DashboardMain.js
//
// Member shell. Markup uses the class names from DashboardMain.css (.dashboard-shell, .sidebar, .appbar, .stage,
// .bnav ...); layout is driven by CSS breakpoints so phone, tablet and desktop each get a proper layout:
//   < 640px   phone   : compact header (menu · title · bell), bottom tab bar, drawer sidebar
//   640-1023  tablet  : same, with the date in the header
//   >= 1024   desktop : permanent sidebar (collapsible), full header, no bottom bar
//
// KPIs are NOT shown here any more. Each page (Savings, Share Capital, Loans, Statements) owns its own hero with
// only its own figures, so the shell never repeats balances that don't belong to the page you are on.

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { supabase } from "../../supabaseClient";
import { useMemberLedger } from "../../hooks/useMemberLedger";
import logo from "../../asset/logo/umovalogo.png";
import {
  LayoutDashboard, User, Wallet, LineChart, Landmark,
  FileText, LogOut, Menu, X, ShieldCheck, Activity, Bell, ChevronLeft, Power,
} from "lucide-react";
import { canExitApp, exitApp } from "../../utils/exitApp";
import "./DashboardMain.css";

const kes = (n) => `KES ${Number(n || 0).toLocaleString()}`;

// Page metadata: title for the header, and which single figure (if any) belongs in the header chip for that page.
const PAGE_META = {
  dashboard: { title: "Dashboard" },
  profile:   { title: "Profile" },
  savings:   { title: "Savings",       chip: "savings" },
  shares:    { title: "Share Capital", chip: "shares" },
  loans:     { title: "Loans",         chip: "loans" },
  statement: { title: "Statements" },
};

export default function DashboardMain() {
  const location = useLocation();
  const { profile, logout } = useAuth();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false); // desktop only (CSS ignores it below 1024px)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);
  const [lastSeenNotifAt, setLastSeenNotifAt] = useState(() => {
    try { return localStorage.getItem("umova-notif-last-seen") || null; } catch { return null; }
  });
  const unreadNotifications = useMemo(() => {
    if (!lastSeenNotifAt) return notifications.length;
    return notifications.filter((n) => new Date(n.created_at) > new Date(lastSeenNotifAt)).length;
  }, [notifications, lastSeenNotifAt]);
  const markNotificationsSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenNotifAt(now);
    try { localStorage.setItem("umova-notif-last-seen", now); } catch { /* badge just won't persist */ }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("notifications").select("*").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error("[NOTIFICATIONS]", err.message);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const sub = supabase
      .channel("dashboard-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => setNotifications((prev) => [payload.new, ...prev].slice(0, 20)))
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [loadNotifications]);

  // ── Ledger (shared hook; same figures as before) ──────────────────────────
  const memberNo = profile?.member_no || profile?.memberNo;
  const { ledger, loading: ledgerLoading, reload: reloadLedger } = useMemberLedger(memberNo);

  const ledgerMetrics = useMemo(() => ({
    // Math.max(0, …): a member-facing screen shouldn't show a negative figure if the underlying data is odd.
    savings:  Math.max(0, ledger.savings.balance),
    loans:    Math.max(0, ledger.loans.balance),
    shares:   Math.max(0, ledger.shares.balance),
    interest: Math.max(0, ledger.totalRepayments),
  }), [ledger]);

  useEffect(() => {
    if (!memberNo) return;
    const sub = supabase
      .channel(`dashboard-${memberNo}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "general_ledger", filter: `member_no=eq.${memberNo}` },
        () => reloadLedger())
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [memberNo, reloadLedger]);

  const handleLogout = async () => {
    try { await logout(); } catch (err) { console.error(err); }
  };

  const confirmLogout = () => {
    if (window.confirm("Log out of your account?")) handleLogout();
  };

  // Close drawer / notification panel when the route changes; Escape closes either.
  useEffect(() => { setDrawerOpen(false); setNotifPanelOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!notifPanelOpen && !drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") { setNotifPanelOpen(false); setDrawerOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notifPanelOpen, drawerOpen]);

  // ── Derived header bits ───────────────────────────────────────────────────
  const seg = location.pathname.split("/").filter(Boolean)[1] || "dashboard";
  const isHome = seg === "dashboard";
  const meta = PAGE_META[seg] || { title: seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
  const chipValue = meta.chip && !ledgerLoading ? ledgerMetrics[meta.chip] : null;
  const chipLabel = { savings: "Savings", shares: "Shares", loans: "Loan balance" }[meta.chip];

  const today = useMemo(() => new Date().toLocaleDateString("en-KE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  }), []);

  const firstName = (profile?.name || "Member").trim().split(/\s+/)[0];
  const initials = (profile?.name || "M").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const navigation = [
    { label: "Dashboard",     icon: LayoutDashboard, path: "/member/dashboard" },
    { label: "Profile",       icon: User,            path: "/member/profile" },
    { label: "Savings",       icon: Wallet,          path: "/member/savings",   suffix: kes(ledgerMetrics.savings) },
    { label: "Share Capital", icon: LineChart,       path: "/member/shares",    suffix: kes(ledgerMetrics.shares) },
    { label: "Loans",         icon: Landmark,        path: "/member/loans",     suffix: ledgerMetrics.loans > 0 ? "Active" : "Clear", warn: ledgerMetrics.loans > 0 },
    { label: "Statements",    icon: FileText,        path: "/member/statement" },
  ];

  // Share Capital stays in the drawer: five tabs is the most a phone bar fits.
  const bottomNav = [
    { label: "Home",      icon: LayoutDashboard, path: "/member/dashboard" },
    { label: "Savings",   icon: Wallet,          path: "/member/savings" },
    { label: "Loans",     icon: Landmark,        path: "/member/loans" },
    { label: "Statement", icon: FileText,        path: "/member/statement" },
    { label: "Profile",   icon: User,            path: "/member/profile" },
  ];

  return (
    <div className={`dashboard-shell${collapsed ? " is-collapsed" : ""}`}>

      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      {/* ── SIDEBAR (drawer below 1024px, permanent above) ───────────────── */}
      <aside
        className={`sidebar${drawerOpen ? " sidebar--open" : ""}${collapsed ? " sidebar--collapsed" : ""}`}
        aria-label="Member navigation"
      >
        <div className="sidebar__logo-strip">
          <div className="sidebar__brand">
            <div className="sidebar__logo-wrap"><img className="sidebar__logo-img" src={logo} alt="UMOVA" /></div>
            <div className="sidebar__brand-text">
              <span className="sidebar__brand-name">UMOVA</span>
              <span className="sidebar__brand-tagline">SACCO Core ERP</span>
            </div>
          </div>
          <button type="button" className="sidebar__collapse-btn" onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label="Collapse sidebar">
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="sidebar__close-btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar__identity">
          <div className="sidebar__profile-card">
            <div className="sidebar__avatar">{initials}</div>
            <div className="sidebar__member-info">
              <div className="sidebar__member-name">{profile?.name || "Member Account"}</div>
              <div className="sidebar__member-no">{memberNo || "—"}</div>
            </div>
            <span className="sidebar__pulse-dot" title="Session active" />
          </div>
        </div>

        <div className="sidebar__nav-container">
          <div className="sidebar__nav-section">
            <div className="sidebar__nav-section-label">Financial Ledgers</div>
            <ul className="sidebar__nav">
              {navigation.map(({ label, icon: Icon, path, suffix, warn }) => (
                <li key={path}>
                  <NavLink
                    to={path}
                    title={label}
                    className={({ isActive }) => `sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`}
                  >
                    <span className="sidebar__nav-left">
                      <Icon size={18} className="sidebar__nav-icon" />
                      <span className="sidebar__nav-label">{label}</span>
                    </span>
                    {suffix && (
                      <span className={`sidebar__nav-badge${warn ? " sidebar__nav-badge--warn" : ""}`}>{suffix}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sidebar__security-strip">
          <div className="sidebar__security-card">
            <div>
              <div className="sidebar__security-label">Security Environment</div>
              <div className="sidebar__security-status">
                <span className="sidebar__pulse-dot" /> Double-Entry Mode Active
              </div>
            </div>
            <Activity size={16} className="sidebar__security-icon" />
          </div>
        </div>

        <div className="sidebar__footer">
          <button type="button" className="sidebar__logout-btn" onClick={handleLogout} title="Logout">
            <LogOut size={16} className="logout-icon" />
            <span className="sidebar__btn-label">Disconnect Session</span>
          </button>

          {/* Phone app only: close the app without signing out. */}
          {canExitApp() && (
            <button type="button" className="sidebar__exit-btn" onClick={exitApp} title="Exit app">
              <Power size={16} />
              <span className="sidebar__btn-label">Exit app</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      <div className="stage">
        <header className="appbar">
          <div className="appbar__left">
            <button type="button" className="appbar__menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="appbar__title-group">
              <h1 className="appbar__page-title">{meta.title}</h1>
              <p className="appbar__subtitle">Welcome back, <strong>{firstName}</strong></p>
            </div>
          </div>

          <div className="appbar__right">
            {/* Only the figure that belongs to this page (none on Home / Profile / Statements) */}
            {chipValue != null && (
              <div className={`appbar__chip appbar__chip--${meta.chip === "loans" ? "amber" : "green"}`}>
                <span className="appbar__chip-label">{chipLabel}</span>
                <span className="appbar__chip-value">{kes(chipValue)}</span>
              </div>
            )}

            {/* Home page only */}
            {isHome && (
              <button type="button" className="appbar__logout-btn" onClick={confirmLogout} aria-label="Log out" title="Log out">
                <LogOut size={18} className="logout-icon" />
                <span className="appbar__logout-label">Log out</span>
              </button>
            )}

            <div className="appbar__bell">
              <button type="button" className="notification-btn" aria-label="Notifications" aria-expanded={notifPanelOpen}
                onClick={() => { setNotifPanelOpen((v) => !v); if (!notifPanelOpen) markNotificationsSeen(); }}>
                <Bell size={19} />
                {unreadNotifications > 0 && (
                  <span className="notification-btn__badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                )}
              </button>

              {notifPanelOpen && (
                <>
                  <div className="notif-scrim" onClick={() => setNotifPanelOpen(false)} aria-hidden="true" />
                  <div className="notif-panel" role="dialog" aria-label="Notifications">
                    <div className="notif-panel__head">Notifications</div>
                    <div className="notif-panel__body">
                      {notifications.length === 0 && <p className="notif-panel__empty">No notifications yet.</p>}
                      {notifications.map((n, i) => (
                        <div className="notif-panel__item" key={n.id || i}>
                          <b>{n.title || "Notification"}</b>
                          <span>{n.message || n.body}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="appbar__date-panel">
              <span className="appbar__date-text">{today}</span>
              <span className="appbar__ssl-badge"><ShieldCheck size={10} /> SSL Ledger Isolated</span>
            </div>
          </div>
        </header>

        <main className="stage__viewport">
          <div className="page-enter">
            <Outlet context={{
              memberNo,
              ledgerMetrics,
              ledgerLoading,
              notifications,
              unreadNotifications,
              markNotificationsSeen,
            }} />
          </div>
        </main>
      </div>

      {/* PHONE / TABLET BOTTOM NAV (hidden at >= 1024px by CSS) */}
      <nav className="bnav" aria-label="Main">
        {bottomNav.map(({ label, icon: Icon, path }) => (
          <NavLink key={path} to={path} className={({ isActive }) => `bnav__item${isActive ? " bnav__item--active" : ""}`}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
