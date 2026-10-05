import "./umova-theme.css";
import "./AdminLayout.css";

import { useState, useMemo, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";

import {
  Home,
  Users,
  CreditCard,
  FileText,
  BarChart3,
  Settings as SettingsIcon,
  Wallet,
  BookOpen,
  Bell,
  Store,
  Landmark,
  MoreHorizontal,
  ChevronDown,
  ChevronLeft,
  Menu,
  Search,
  LogOut,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────
// Navigation is organised as MODULE → WORKSPACE pages. Every `to` below is an
// EXISTING route under /admin (unchanged from the previous MENU), so App.js
// needs no edits. Modules with children show them as an expandable group on
// desktop and as a bottom sheet on mobile.
//
// APPROVER_ROLES mirrors App.js's AdminLevelGuard — POS and Chama are hidden
// for roles that would just be redirected back.
// ─────────────────────────────────────────────

const APPROVER_ROLES = ["admin", "superadmin", "manager"];

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: Home, to: "dashboard" },
  {
    key: "members",
    label: "Members",
    icon: Users,
    children: [
      { label: "Members", to: "members" },
      { label: "Member Statements", to: "member-statements" },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: Wallet,
    children: [
      { label: "Payments", to: "payments" },
      { label: "Withdrawals", to: "withdrawal" },
      { label: "Cash & Bank", to: "cash-bank" },
      { label: "Accounts Payable", to: "accounts-payable" },
      { label: "Accounts Receivable", to: "accounts-receivable" },
      { label: "Fixed Assets", to: "fixed-assets" },
    ],
  },
  {
    key: "loans",
    label: "Loans",
    icon: CreditCard,
    children: [
      { label: "Loan Portfolio", to: "loans" },
      { label: "Applications", to: "loan-application" },
      { label: "Approval", to: "loan-approval" },
      { label: "Disbursement", to: "loan-disbursement" },
      { label: "Repayments", to: "loan-repayments" },
      { label: "Loan Schedule", to: "loan-schedule" },
      { label: "Penalties", to: "loan-penalties" },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    icon: BookOpen,
    children: [
      { label: "Journal", to: "journal-entry" },
      { label: "Trial Balance", to: "trial-balance" },
      { label: "Income Statement", to: "income-statement" },
      { label: "Balance Sheet", to: "balance-sheet" },
      { label: "Accounting Periods", to: "accounting-periods" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    children: [
      { label: "Financial Reports", to: "reports" },
      { label: "ERP Overview", to: "erp-dashboard" },
      { label: "Interest Dashboard", to: "interest-dashboard" },
      { label: "Risk Engine", to: "stories" },
    ],
  },
  {
    key: "pos",
    label: "POS",
    icon: Store,
    approverOnly: true,
    children: [
      { label: "POS Dashboard", to: "pos" },
      { label: "POS Businesses", to: "pos-tenants" },
      { label: "POS Requests", to: "pos-requests" },
    ],
  },
  { key: "chama", label: "Chama", icon: Landmark, to: "chama", approverOnly: true },
  { key: "settings", label: "Settings", icon: SettingsIcon, to: "settings" },
];

const byKey = (k) => NAV.find((n) => n.key === k);

// Mobile bottom bar. Home is a direct link; Money/Loans open their workspace
// sheet; More opens everything else.
const BOTTOM_PRIMARY = ["money", "loans"];
const MORE_KEYS = ["members", "accounting", "reports", "pos", "chama", "settings"];

const useOnline = () => {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
};

export default function AdminLayout() {
  const { profile, role, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();

  const [search, setSearch] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [sheet, setSheet] = useState(null); // null | "money" | "loans" | "more"
  const [openGroups, setOpenGroups] = useState({});

  const isApprover = APPROVER_ROLES.includes(role);

  const nav = useMemo(
    () => NAV.filter((n) => !n.approverOnly || isApprover),
    [isApprover]
  );

  const isActive = (to) => {
    const full = `/admin/${to}`;
    return location.pathname === full || location.pathname.startsWith(`${full}/`);
  };

  const activeModule = useMemo(
    () =>
      nav.find((n) =>
        n.children ? n.children.some((c) => isActive(c.to)) : isActive(n.to)
      ),
    [nav, location.pathname]
  );

  const currentLabel = useMemo(() => {
    if (!activeModule) return "Dashboard";
    if (activeModule.children) {
      return activeModule.children.find((c) => isActive(c.to))?.label || activeModule.label;
    }
    return activeModule.label;
  }, [activeModule, location.pathname]);

  // Keep the active module expanded on desktop, and close sheets on navigation.
  useEffect(() => {
    if (activeModule?.children) {
      setOpenGroups((g) => ({ ...g, [activeModule.key]: true }));
    }
    setSheet(null);
    setShowNotifications(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sheet]);

  // Global page search: flat list of every reachable page.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    nav.forEach((n) => {
      if (n.children) {
        n.children.forEach((c) => {
          if (`${n.label} ${c.label}`.toLowerCase().includes(q)) {
            out.push({ label: c.label, group: n.label, to: c.to });
          }
        });
      } else if (n.label.toLowerCase().includes(q)) {
        out.push({ label: n.label, group: "", to: n.to });
      }
    });
    return out.slice(0, 8);
  }, [search, nav]);

  const goTo = (to) => {
    setSearch("");
    navigate(`/admin/${to}`);
  };

  const displayName = profile?.name || "Admin";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const onDashboard = isActive("dashboard");
  const sheetModules =
    sheet === "more"
      ? MORE_KEYS.map(byKey).filter((n) => n && (!n.approverOnly || isApprover))
      : sheet
      ? [byKey(sheet)]
      : [];

  return (
    <div className="admin-container">
      {/* ───────── DESKTOP / TABLET SIDEBAR ───────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">U</span>
          <div className="brand-text">
            <strong>UMOVA</strong>
            <small>ADMIN</small>
          </div>
        </div>

        <nav className="menu-scroll" aria-label="Admin navigation">
          {nav.map((n) => {
            const Icon = n.icon;
            if (!n.children) {
              return (
                <Link
                  key={n.key}
                  to={`/admin/${n.to}`}
                  title={n.label}
                  className={`menu-item ${isActive(n.to) ? "active" : ""}`}
                >
                  <Icon size={20} />
                  <span className="menu-label">{n.label}</span>
                </Link>
              );
            }
            const open = !!openGroups[n.key];
            const moduleActive = activeModule?.key === n.key;
            return (
              <div key={n.key} className="menu-group">
                {/* Tablet rail: icon links straight to the module's first page */}
                <button
                  type="button"
                  title={n.label}
                  className={`menu-item menu-group-btn ${moduleActive ? "active-module" : ""}`}
                  aria-expanded={open}
                  onClick={() => setOpenGroups((g) => ({ ...g, [n.key]: !g[n.key] }))}
                >
                  <Icon size={20} />
                  <span className="menu-label">{n.label}</span>
                  <ChevronDown size={16} className={`chev ${open ? "open" : ""}`} />
                </button>
                {open && (
                  <div className="submenu">
                    {n.children.map((c) => (
                      <Link
                        key={c.to}
                        to={`/admin/${c.to}`}
                        className={`submenu-item ${isActive(c.to) ? "active" : ""}`}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="profile-section">
          <div className="avatar">{initials}</div>
          <div className="profile-text">
            <div className="admin-name">{displayName}</div>
            <div className="admin-role">{role || "Staff"}</div>
          </div>
        </div>
      </aside>

      {/* ───────── MAIN ───────── */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            {!onDashboard && (
              <button
                className="icon-btn mobile-only"
                onClick={() => navigate(-1)}
                aria-label="Back"
              >
                <ChevronLeft size={22} />
              </button>
            )}
            {onDashboard && (
              <button
                className="icon-btn mobile-only"
                onClick={() => setSheet("more")}
                aria-label="Open menu"
              >
                <Menu size={22} />
              </button>
            )}
            <h3>{currentLabel}</h3>
          </div>

          <div className="topbar-search desktop-only">
            <Search size={16} />
            <input
              placeholder="Search pages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search pages"
            />
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r) => (
                  <button key={r.to} type="button" onClick={() => goTo(r.to)}>
                    <span>{r.label}</span>
                    {r.group && <small>{r.group}</small>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-right">
            <span className={`online-status ${online ? "on" : "off"}`} title={online ? "Online" : "Offline — transactions cannot be posted"}>
              <i /> <span className="status-text">{online ? "Online" : "Offline"}</span>
            </span>

            <div className="notification-wrapper">
              <button
                className="icon-btn"
                onClick={() => setShowNotifications((v) => !v)}
                aria-label="Notifications"
              >
                <Bell size={20} />
              </button>
              {showNotifications && (
                <div className="notification-dropdown">
                  {/* Real alerts (pending approvals, arrears…) are wired in with
                      the dashboard "Attention Required" work — no placeholders. */}
                  <div className="dropdown-empty">No new notifications</div>
                </div>
              )}
            </div>

            <button className="icon-btn desktop-only" onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {!online && (
          <div className="offline-banner" role="alert">
            You are offline. Payments and journals cannot be posted until the connection returns.
          </div>
        )}

        <div className="page-content">
          <div className="content-area">
            <Outlet />
          </div>
        </div>
      </main>

      {/* ───────── MOBILE BOTTOM NAV ───────── */}
      <nav className="bottom-nav" aria-label="Primary">
        <Link to="/admin/dashboard" className={`bn-item ${onDashboard ? "active" : ""}`}>
          <Home size={22} />
          <span>Home</span>
        </Link>
        {BOTTOM_PRIMARY.map((k) => {
          const n = byKey(k);
          const Icon = n.icon;
          return (
            <button
              key={k}
              type="button"
              className={`bn-item ${activeModule?.key === k ? "active" : ""}`}
              onClick={() => setSheet(sheet === k ? null : k)}
            >
              <Icon size={22} />
              <span>{n.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`bn-item ${activeModule && !BOTTOM_PRIMARY.includes(activeModule.key) && activeModule.key !== "dashboard" ? "active" : ""}`}
          onClick={() => setSheet(sheet === "more" ? null : "more")}
        >
          <MoreHorizontal size={22} />
          <span>More</span>
        </button>
      </nav>

      {/* ───────── MOBILE WORKSPACE SHEET ───────── */}
      {sheet && (
        <>
          <div className="sheet-overlay" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-head">
              <strong>{sheet === "more" ? "More" : byKey(sheet)?.label}</strong>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close">
                <X size={22} />
              </button>
            </div>

            <div className="sheet-body">
              {sheetModules.map((n) => {
                const Icon = n.icon;
                return (
                  <div key={n.key} className="sheet-section">
                    {sheet === "more" && (
                      <div className="sheet-section-title">
                        <Icon size={16} /> {n.label}
                      </div>
                    )}
                    {n.children ? (
                      <div className="sheet-grid">
                        {n.children.map((c) => (
                          <Link key={c.to} to={`/admin/${c.to}`} className={`sheet-card ${isActive(c.to) ? "active" : ""}`}>
                            {c.label}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      sheet === "more" && (
                        <div className="sheet-grid">
                          <Link to={`/admin/${n.to}`} className={`sheet-card ${isActive(n.to) ? "active" : ""}`}>
                            Open {n.label}
                          </Link>
                        </div>
                      )
                    )}
                  </div>
                );
              })}

              {sheet === "more" && (
                <button type="button" className="sheet-signout" onClick={logout}>
                  <LogOut size={18} /> Sign out
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
