// src/pos-erp/POSLayout.jsx
//
// Sidebar restructured into collapsible groups (was a flat 19-item list)
// — Retail/Rentals/Salon/Accounts each collapse into one line until
// clicked open. Dashboard/Till/Customers/Messages stay top-level: Till
// because it's the single most-used screen (every sale goes through it —
// burying it behind a group click adds friction to the most common
// action), Customers/Messages because they're used across every business
// type, not specific to one capability group.
//
// Groups aren't hidden based on business type — get_pos_profile() doesn't
// return one (see AUDIT.md Phase 8), so there's no reliable signal to
// hide "Rentals" for a pure retail shop without also hiding it from a
// brand-new property business that hasn't created its first unit yet.
// All groups always show; collapsing (not hiding) is what keeps the
// sidebar tidy without that problem.
//
// RESPONSIVE FIX: the sidebar used to be a permanent w-60 flex sibling —
// on a ~360-400px phone that's over half the screen gone before any page
// content renders (confirmed from screenshots: the Till's payment method
// row and "Close Shift" button were being clipped off the right edge,
// not actually broken — there just wasn't room left). Below the `md`
// breakpoint the sidebar is now an off-canvas drawer (fixed, translated
// off-screen, toggled by a hamburger button in the topbar, with a
// backdrop and auto-close on navigation); at `md` and up it reverts to
// the original always-visible static panel. This is the single change
// that should fix the phone screenshots — the individual pages (Till
// included) already had reasonable `flex-col md:flex-row` responsive
// classes of their own, they just never had the width to use them.

import React, { useState, useMemo, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { usePosErpAuth } from "./auth/usePosErpAuth";
import { useNotifications } from "./hooks/useNotifications";
// Phase 15: the sidebar's own tiny logo fetch. Deliberately NOT the full
// useSettings() hook (that also pulls POS settings this layout doesn't
// need) — just the one field this header actually renders.
import { settingsService } from "./services/settingsService";
import POSTopbar from "./POSTopbar";
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Truck, Users, UserRound, Wallet, Receipt,
  Home, Repeat, Gauge, Scissors, CalendarClock, MessageSquare, Settings, ShieldCheck,
  LogOut, Store, BarChart3, ChevronDown, ShoppingBag, Building2, Landmark, FileBarChart, X, ClipboardList,
  HardHat,
  Smartphone,
} from "lucide-react";

// Owner-facing labels (brief §1): plain wording instead of accounting/
// inventory jargon. Routes/components are untouched — this is a label
// pass only, nothing here changes what a page does or how it's built.
// Two items intentionally keep their existing label: "Customers" and
// "Suppliers" are already plain words, and CustomersPage already has its
// own "People who owe me" filter/toggle built in (Phase 2) — no separate
// nav item exists for that, so it isn't relabeled here.
const TOP_LEVEL = [
  { to: "/pos/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/pos", label: "Sell", icon: ShoppingCart, end: true },
];

const AFTER_GROUPS = [
  { to: "/pos/customers", label: "Customers", icon: UserRound },
  { to: "/pos/messages", label: "Messages", icon: MessageSquare },
];

// Collapsible groups — one sidebar line each until expanded.
const GROUPS = [
  {
    key: "retail",
    label: "Retail",
    icon: ShoppingBag,
    items: [
      { to: "/pos/products", label: "My Items", icon: Package },
      { to: "/pos/inventory", label: "My Stock", icon: Boxes },
      { to: "/pos/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
      { to: "/pos/goods-receiving", label: "Receive Stock", icon: Truck },
      { to: "/pos/suppliers", label: "Suppliers", icon: Users },
      { to: "/pos/payables", label: "People I Owe", icon: Wallet },
    ],
  },
  {
    key: "rentals",
    label: "Rentals",
    icon: Building2,
    items: [
      { to: "/pos/units", label: "Units", icon: Home },
      { to: "/pos/charges", label: "Charges", icon: Repeat },
      { to: "/pos/meters", label: "Meters", icon: Gauge },
    ],
  },
  {
    key: "salon",
    label: "Salon",
    icon: Scissors,
    items: [
      { to: "/pos/services", label: "Services", icon: Scissors },
      { to: "/pos/appointments", label: "Appointments", icon: CalendarClock },
    ],
  },
  {
    key: "accounts",
    label: "My Accounts",
    icon: Landmark,
    items: [
      { to: "/pos/cash", label: "My Money", icon: Wallet },
      { to: "/pos/expenses", label: "My Spending", icon: Receipt },
      { to: "/pos/equipment", label: "My Equipment", icon: HardHat },
      { to: "/pos/mpesa", label: "M-Pesa", icon: Smartphone },
      { to: "/pos/reports", label: "My Reports", icon: BarChart3 },
      { to: "/pos/financials", label: "Financial Statements (Advanced)", icon: FileBarChart },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    items: [
      { to: "/pos/settings", label: "Settings", icon: Settings },
      { to: "/pos/audit", label: "Audit", icon: ShieldCheck },
    ],
  },
];

const ALL_ITEMS = [...TOP_LEVEL, ...AFTER_GROUPS, ...GROUPS.flatMap((g) => g.items)];

export default function POSLayout() {
  const { staffName, role, tenant, logout } = usePosErpAuth();
  const location = useLocation();
  const { count: notificationCount } = useNotifications();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  useEffect(() => {
    if (!tenant?.business_id) return;
    settingsService.getBusinessProfile(tenant.business_id).then(p => setLogoUrl(p?.logo_url || null)).catch(() => {});
  }, [tenant?.business_id]);

  const isActive = (to, end) =>
    end ? location.pathname === to : location.pathname.startsWith(to);

  // The group containing the current page starts expanded; others start
  // collapsed. Whichever groups get toggled open by the user stay open
  // as they navigate within this layout instance (not persisted beyond it).
  const activeGroupKey = useMemo(
    () => GROUPS.find((g) => g.items.some((item) => isActive(item.to, item.end)))?.key,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname]
  );
  const [openGroups, setOpenGroups] = useState(() => new Set(activeGroupKey ? [activeGroupKey] : []));
  const toggleGroup = (key) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Closes the mobile drawer whenever the route changes — otherwise
  // tapping a link would leave the drawer covering the new page. Has no
  // visible effect on md+ (the drawer state is ignored there via CSS).
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const currentPage = ALL_ITEMS.find((item) => isActive(item.to, item.end));
  const pageTitle = currentPage?.label
    || (location.pathname.startsWith("/pos/communication") ? "Notifications" : "POS");

  const NavLink = ({ item, indent }) => {
    const Icon = item.icon;
    const active = isActive(item.to, item.end);
    return (
      <Link
        to={item.to}
        className={`flex items-center gap-3 py-2.5 text-sm transition border-l-4 ${indent ? "pl-9 pr-5" : "px-5"} ${
          active
            ? "bg-emerald-800 text-white border-amber-400"
            : "text-slate-300 hover:bg-slate-900 border-transparent"
        }`}
      >
        <Icon size={indent ? 15 : 17} />
        {item.label}
      </Link>
    );
  };

  return (
    <div className="h-screen overflow-hidden bg-slate-50 flex print:h-auto print:overflow-visible">
      {/* Backdrop — mobile only, only while the drawer is open. Tapping
          it closes the drawer, same as a nav click would. */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 text-white flex flex-col shrink-0 print:hidden
          transform transition-transform duration-200 ease-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 md:static md:z-auto md:w-60`}
      >
        <div className="p-5 flex items-center gap-2 border-b border-slate-800">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
          ) : (
            <Store size={20} className="text-amber-400 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm truncate">{tenant?.business_name || "POS"}</div>
            <div className="text-[11px] text-slate-400 font-mono">{tenant?.business_code}</div>
          </div>
          {/* Close button — mobile only; md+ never shows the drawer state at all */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white p-1" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {TOP_LEVEL.map((item) => <NavLink key={item.label} item={item} />)}

          {GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = openGroups.has(group.key);
            const groupHasActive = group.items.some((item) => isActive(item.to, item.end));
            return (
              <div key={group.key}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition border-l-4 ${
                    groupHasActive ? "text-white border-amber-400/50" : "text-slate-300 hover:bg-slate-900 border-transparent"
                  }`}
                >
                  <GroupIcon size={17} />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && group.items.map((item) => <NavLink key={item.label} item={item} indent />)}
              </div>
            );
          })}

          {AFTER_GROUPS.map((item) => <NavLink key={item.label} item={item} />)}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="text-sm font-semibold truncate">{staffName || "Staff"}</div>
          <div className="text-[11px] text-slate-400 capitalize mb-3">{role || "—"}</div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-400 py-2 rounded-xl transition"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="print:hidden">
          <POSTopbar title={pageTitle} notificationCount={notificationCount} onMenuClick={() => setSidebarOpen(true)} />
        </div>
        <main className="flex-1 min-w-0 overflow-y-auto print:overflow-visible">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
