import "./AdminLayout.css";

import { useState, useMemo, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";

import {
  Home,
  Users,
  CreditCard,
  FileText,
  BarChart3,
  Settings as SettingsIcon,
  DollarSign,
  BookOpen,
  TrendingUp,
  Activity,
  Bell,
  Menu,
  X,
  Store,
  ClipboardList,
  Building2,
  Lock,
  Package,
} from "lucide-react";

// ─────────────────────────────────────────────
// FIXED: this used to be a self-contained tab-switcher — its own
// activeTab state, its own hardcoded component imports, NO <Outlet/>.
// App.js has always routed real nested pages under <AdminLayout/>
// (/admin/dashboard, /admin/members, /admin/pos, etc.), but this file
// never rendered any of them — it just always showed its own internal
// "dashboard" tab regardless of the URL. That's why clicking into POS
// (or honestly any admin page) looked like it "bounced back": the URL
// changed, the route matched, but this shell ignored it completely.
//
// Now MENU items are real paths (relative to /admin, matching App.js
// exactly) rendered as <Link>s, active-state comes from useLocation(),
// and page content comes from <Outlet/> — i.e. whatever App.js actually
// routed to, not a duplicate internal copy of it.
//
// APPROVER_ROLES mirrors App.js's AdminLevelGuard exactly — POS
// Businesses/Requests are hidden from the menu entirely for roles that
// would just get redirected back by that guard anyway, rather than
// showing a link that appears to do nothing when clicked.
// ─────────────────────────────────────────────

const APPROVER_ROLES = ["admin", "superadmin", "manager"];

const MENU = [
  {
    title: "CORE OPERATIONS",
    items: [
      { key: "dashboard", label: "Dashboard", to: "dashboard", icon: Home },
      { key: "erp", label: "ERP Overview", to: "erp-dashboard", icon: BarChart3 },
      { key: "members", label: "Members", to: "members", icon: Users },
      { key: "statements", label: "Member Statements", to: "member-statements", icon: FileText },
      { key: "payments", label: "Payments", to: "payments", icon: DollarSign },
      { key: "withdrawal", label: "Withdrawal", to: "withdrawal", icon: CreditCard },
      { key: "cash_bank", label: "Cash & Bank Management", to: "cash-bank", icon: Building2 },
      { key: "accounts_payable", label: "Accounts Payable", to: "accounts-payable", icon: ClipboardList },
      { key: "accounts_receivable", label: "Accounts Receivable", to: "accounts-receivable", icon: FileText },
      { key: "fixed_assets", label: "Fixed Assets", to: "fixed-assets", icon: Package },
    ],
  },
  {
    title: "LOAN ENGINE",
    items: [
      { key: "loan", label: "Loans", to: "loans", icon: CreditCard },
      { key: "loan_applications", label: "Loan Applications", to: "loan-application", icon: FileText },
      { key: "loan_approval", label: "Loan Approval", to: "loan-approval", icon: Activity },
      { key: "loan_disbursement", label: "Loan Disbursement", to: "loan-disbursement", icon: Activity },
      { key: "loan_repayments", label: "Loan Repayments", to: "loan-repayments", icon: DollarSign },
      { key: "loan_schedule", label: "Loan Schedule", to: "loan-schedule", icon: BookOpen },
      { key: "loan_penalties", label: "Loan Penalties", to: "loan-penalties", icon: Activity },
      { key: "interest_dashboard", label: "Interest Dashboard", to: "interest-dashboard", icon: TrendingUp },
    ],
  },
  {
    title: "ACCOUNTING CORE",
    items: [
      { key: "trial_balance", label: "Trial Balance", to: "trial-balance", icon: BookOpen },
      { key: "journal_entry", label: "Journal Entry", to: "journal-entry", icon: FileText },
      { key: "accounting_periods", label: "Accounting Periods", to: "accounting-periods", icon: Lock },
      { key: "income_statement", label: "Income Statement", to: "income-statement", icon: TrendingUp },
      { key: "balance_sheet", label: "Balance Sheet", to: "balance-sheet", icon: BarChart3 },
    ],
  },
  {
    title: "POS MANAGEMENT",
    // Hidden entirely for roles AdminLevelGuard would bounce anyway —
    // see App.js. Filtered in filteredMenu below, not here, so the
    // search box still works against a stable list.
    approverOnly: true,
    items: [
      { key: "pos_dashboard", label: "POS Dashboard", to: "pos", icon: Store },
      { key: "pos_tenants", label: "POS Businesses", to: "pos-tenants", icon: Building2 },
      { key: "pos_requests", label: "POS Requests", to: "pos-requests", icon: ClipboardList },
    ],
  },
  {
    title: "CHAMA MANAGEMENT",
    // Same approverOnly gating as POS MANAGEMENT — /admin/chama sits
    // behind AdminLevelGuard in App.js, so anyone who'd be bounced
    // there shouldn't see the entry either.
    approverOnly: true,
    items: [
      { key: "chama_dashboard", label: "Chama Dashboard", to: "chama", icon: Users },
    ],
  },
  {
    title: "REPORTING",
    items: [
      { key: "financial_reports", label: "Financial Reports", to: "reports", icon: BarChart3 },
      { key: "stories", label: "Risk Engine", to: "stories", icon: TrendingUp },
    ],
  },
  {
    title: "SYSTEM CONTROL",
    items: [
      { key: "settings", label: "Settings", to: "settings", icon: SettingsIcon },
    ],
  },
];

export default function AdminLayout() {
  const { profile, role, logout } = useAuth();
  const location = useLocation();

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isApprover = APPROVER_ROLES.includes(role);

  const filteredMenu = useMemo(() => {
    const visible = MENU.filter((group) => !group.approverOnly || isApprover);

    if (!search) return visible;

    return visible
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.label.toLowerCase().includes(search.toLowerCase())
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [search, isApprover]);

  // Matches the current URL against an item's `to` — handles both
  // "/admin/dashboard" (exact) and any deeper sub-paths under it.
  const isActive = (to) => {
    const full = `/admin/${to}`;
    return location.pathname === full || location.pathname.startsWith(`${full}/`);
  };

  const handleSelectTab = () => setMobileOpen(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const currentLabel = useMemo(() => {
    for (const group of MENU) {
      for (const item of group.items) {
        if (isActive(item.to)) return item.label;
      }
    }
    return "Dashboard";
  }, [location.pathname]);

  const displayName = profile?.name || "Admin";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="admin-container">

      {/* MOBILE OVERLAY — tap to close the drawer */}
      <div
        className={`sidebar-overlay ${mobileOpen ? "visible" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* SIDEBAR */}
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`}>

        <div className="sidebar-top">
          <div className="sidebar-top-row">
            <div className="toggle-btn" onClick={() => setCollapsed(!collapsed)} title="Collapse sidebar">
              <Menu size={20} />
            </div>
            <div className="toggle-btn mobile-only" onClick={() => setMobileOpen(false)} title="Close menu">
              <X size={20} />
            </div>
          </div>

          {!collapsed && (
            <>
              <h2 className="brand-title">UMOVA ERP</h2>
              <input
                className="search-input"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </>
          )}
        </div>

        <div className="menu-scroll">
          {filteredMenu.map((group) => (
            <div key={group.title}>
              {!collapsed && <div className="group-title">{group.title}</div>}

              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    to={item.to}
                    onClick={handleSelectTab}
                    className={`menu-item ${isActive(item.to) ? "active" : ""}`}
                  >
                    <Icon size={20} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="profile-section">
          <div className="avatar">{initials}</div>
          {!collapsed && (
            <div>
              <div className="admin-name">{displayName}</div>
              <div className="admin-role">{role || "Staff"}</div>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN */}
      <main className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <h3>{currentLabel}</h3>
          </div>

          <div className="topbar-right">
            <div className="notification-wrapper">
              <div className="notification-btn" onClick={() => setShowNotifications(!showNotifications)}>
                <Bell size={20} />
                <span className="badge">3</span>
              </div>

              {showNotifications && (
                <div className="notification-dropdown">
                  <div className="dropdown-item">📌 New Loan Application</div>
                  <div className="dropdown-item">💰 Payment Received</div>
                  <div className="dropdown-item">⚠️ Loan Overdue Alert</div>
                </div>
              )}
            </div>

            <div className="online-status">● Online</div>
            <button className="toggle-btn" onClick={logout} title="Sign out">
              Sign out
            </button>
          </div>
        </div>

        <div className="page-content">
          <div className="content-area">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
