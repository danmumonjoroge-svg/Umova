import React, { useState, useMemo, Suspense } from "react";
import { useChama } from "./ChamaContext";
import {
  Wallet, Send, CheckCircle, Settings, Landmark, ScanSearch, Building2,
  HeartHandshake, CalendarPlus, TrendingUp, Menu, X, LogOut, Coins, Loader2,
  Users, Gift, Clock, HandCoins, ChevronDown,
} from "lucide-react";
import "./ChamaDashboardAdvanced.css";

// -----------------------------------------------------------------------------
// ChamaDashboardAdvanced
// The entire dashboard, built only from the modules in this package —
// loans/, contributions/, welfare/. No dependency on any original upload.
//
// Sidebar structure: standalone items sit at the top level; "Loans" and
// "Welfare" are collapsible groups — click the group header to expand it,
// then pick a specific screen inside (My Loans / Approvals / Rules /
// Disbursement / Repayments under Loans; Cases / Events / Insights under
// Welfare). Each leaf item is still individually role-gated exactly as
// before — grouping only changes how they're presented, not who can see
// what.
// -----------------------------------------------------------------------------

// Small, always-visible reminder of the chama's own license state — same
// prepaid-meter framing as the platform manager dashboard, just from the
// chama's side. Only renders anything when it's actually worth seeing
// (free mode, or expiry within 14 days); otherwise stays silent so a
// healthy, fully-paid chama isn't nagged every time someone opens the app.
function LicenseBadge({ chama }) {
  if (!chama) return null;
  if (chama.license_plan === "free") {
    return <span className="cda-license-badge free"><Gift size={12} /> Free plan</span>;
  }
  if (!chama.license_expiry) return null;
  const d = Math.round((new Date(chama.license_expiry).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (d > 14) return null;
  if (d < 0) return <span className="cda-license-badge overdue"><Clock size={12} /> Overdue {Math.abs(d)}d</span>;
  return <span className="cda-license-badge duesoon"><Clock size={12} /> {d === 0 ? "Due today" : `${d}d left`}</span>;
}

const DashboardOverview      = React.lazy(() => import("./DashboardOverview"));
const MembersDirectory       = React.lazy(() => import("./MembersDirectory"));
const MemberLoanApplication  = React.lazy(() => import("./loans/MemberLoanApplication"));
const LoanApprovalQueue      = React.lazy(() => import("./loans/LoanApprovalQueue"));
const LoanRulesCard          = React.lazy(() => import("./loans/LoanRulesCard"));
const LoanDisbursementDesk   = React.lazy(() => import("./loans/LoanDisbursementDesk"));
const LoanRepaymentDesk      = React.lazy(() => import("./loans/LoanRepaymentDesk"));
const MemberContributionForm = React.lazy(() => import("./contributions/MemberContributionForm"));
const TreasurerReconciliation = React.lazy(() => import("./contributions/TreasurerReconciliation"));
const ChamaBankAccounts      = React.lazy(() => import("./contributions/ChamaBankAccounts"));
const WelfareCaseDesk        = React.lazy(() => import("./welfare/WelfareCaseDesk"));
const WelfareEventPlanner    = React.lazy(() => import("./welfare/WelfareEventPlanner"));
const WelfareInsightsReport  = React.lazy(() => import("./welfare/WelfareInsightsReport"));

// -----------------------------------------------------------------------------
// NAV — a mix of standalone items and collapsible groups. Every leaf still
// carries its own `roles` (null = everyone); a group is only shown at all
// if at least one of its items passes hasRole().
// -----------------------------------------------------------------------------
const NAV = [
  { type: "item", key: "overview", label: "Overview", icon: TrendingUp, Component: DashboardOverview, roles: null },
  { type: "item", key: "members", label: "Members", icon: Users, Component: MembersDirectory, roles: null },
  {
    type: "group", key: "loans", label: "Loans", icon: Wallet,
    items: [
      { key: "my-loan", label: "My Loans", icon: Wallet, Component: MemberLoanApplication, roles: null },
      { key: "approvals", label: "Approvals", icon: CheckCircle, Component: LoanApprovalQueue, roles: ["secretary", "treasurer", "chairperson"] },
      { key: "loan-rules", label: "Rules", icon: Settings, Component: LoanRulesCard, roles: ["secretary", "treasurer", "chairperson"] },
      { key: "disbursement", label: "Disbursement", icon: Landmark, Component: LoanDisbursementDesk, roles: ["treasurer"] },
      { key: "repayments", label: "Repayments", icon: HandCoins, Component: LoanRepaymentDesk, roles: ["treasurer"] },
    ],
  },
  { type: "item", key: "contribute", label: "Contribute", icon: Send, Component: MemberContributionForm, roles: null },
  { type: "item", key: "reconciliation", label: "Reconciliation", icon: ScanSearch, Component: TreasurerReconciliation, roles: ["treasurer"] },
  { type: "item", key: "accounts", label: "Chama Accounts", icon: Building2, Component: ChamaBankAccounts, roles: ["treasurer", "chairperson"] },
  {
    type: "group", key: "welfare", label: "Welfare", icon: HeartHandshake,
    items: [
      { key: "welfare-cases", label: "Cases", icon: HeartHandshake, Component: WelfareCaseDesk, roles: ["welfare_officer", "secretary", "treasurer", "chairperson"] },
      { key: "welfare-events", label: "Events", icon: CalendarPlus, Component: WelfareEventPlanner, roles: ["welfare_officer", "secretary", "treasurer", "chairperson"] },
      { key: "welfare-insights", label: "Insights", icon: TrendingUp, Component: WelfareInsightsReport, roles: ["welfare_officer", "secretary", "treasurer", "chairperson"] },
    ],
  },
];

function flattenLeaves(nav) {
  const leaves = [];
  nav.forEach((entry) => {
    if (entry.type === "item") leaves.push(entry);
    else entry.items.forEach((i) => leaves.push({ ...i, groupKey: entry.key }));
  });
  return leaves;
}

const Loading = () => (
  <div className="cda-loading"><Loader2 size={22} className="spin" /></div>
);

export default function ChamaDashboardAdvanced() {
  const { chama, member, hasRole, logout } = useChama();
  const [active, setActive] = useState("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => new Set());

  // Filter every leaf by role, then drop any group left with zero visible items.
  const visibleNav = useMemo(() => {
    return NAV.map((entry) => {
      if (entry.type === "item") {
        return !entry.roles || hasRole(entry.roles) ? entry : null;
      }
      const items = entry.items.filter((i) => !i.roles || hasRole(i.roles));
      return items.length > 0 ? { ...entry, items } : null;
    }).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.role]);

  const allLeaves = useMemo(() => flattenLeaves(visibleNav), [visibleNav]);
  const activeItem = allLeaves.find((i) => i.key === active) || allLeaves[0];
  const ActiveComponent = activeItem?.Component;

  const initials = (member?.name || "?")
    .split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const selectLeaf = (key, groupKey) => {
    setActive(key);
    setMobileOpen(false);
    if (groupKey) setOpenGroups((prev) => new Set(prev).add(groupKey));
  };

  const toggleGroup = (key) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="cda-shell">
      {mobileOpen && <div className="cda-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`cda-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="cda-sidebar-head">
          <span className="cda-logo"><Coins size={18} /></span>
          <div>
            <h1>{chama?.name || "Chama ERP"}</h1>
            <small>{chama?.chama_no}</small>
            <LicenseBadge chama={chama} />
          </div>
          <button className="cda-close-btn" onClick={() => setMobileOpen(false)}><X size={16} /></button>
        </div>

        <div className="cda-user">
          <span className="cda-avatar">{initials}</span>
          <div>
            <p>{member?.name}</p>
            <span className="cda-role-badge">{member?.role}</span>
          </div>
        </div>

        <nav className="cda-nav">
          {visibleNav.map((entry) => {
            if (entry.type === "item") {
              return (
                <button
                  key={entry.key}
                  className={`cda-nav-item ${active === entry.key ? "active" : ""}`}
                  onClick={() => selectLeaf(entry.key, null)}
                >
                  <entry.icon size={17} />
                  <span>{entry.label}</span>
                </button>
              );
            }

            const isOpen = openGroups.has(entry.key);
            const groupHasActive = entry.items.some((i) => i.key === active);
            return (
              <div className="cda-nav-group" key={entry.key}>
                <button
                  className={`cda-nav-item cda-nav-group-head ${groupHasActive ? "active" : ""}`}
                  onClick={() => toggleGroup(entry.key)}
                >
                  <entry.icon size={17} />
                  <span>{entry.label}</span>
                  <ChevronDown size={14} className={`cda-chevron ${isOpen || groupHasActive ? "open" : ""}`} />
                </button>
                {(isOpen || groupHasActive) && (
                  <div className="cda-nav-subitems">
                    {entry.items.map((item) => (
                      <button
                        key={item.key}
                        className={`cda-nav-subitem ${active === item.key ? "active" : ""}`}
                        onClick={() => selectLeaf(item.key, entry.key)}
                      >
                        <item.icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <button className="cda-logout" onClick={logout}>
          <LogOut size={15} /> Log out
        </button>
      </aside>

      <div className="cda-main">
        <header className="cda-topbar">
          <button className="cda-menu-btn" onClick={() => setMobileOpen(true)}><Menu size={18} /></button>
          <h2>{activeItem?.label}</h2>
        </header>

        <main className="cda-content">
          <Suspense fallback={<Loading />}>
            {ActiveComponent && <ActiveComponent chamaId={chama?.id} />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
