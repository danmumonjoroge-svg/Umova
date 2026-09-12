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

import React, { useState, useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { usePosErpAuth } from "./auth/usePosErpAuth";
import { useNotifications } from "./hooks/useNotifications";
import POSTopbar from "./POSTopbar";
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Truck, Users, UserRound, Wallet, Receipt,
  Home, Repeat, Gauge, Scissors, CalendarClock, MessageSquare, Settings, ShieldCheck,
  LogOut, Store, BarChart3, ChevronDown, ShoppingBag, Building2, Landmark,
} from "lucide-react";

// Top-level items, always visible, no grouping.
const TOP_LEVEL = [
  { to: "/pos/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "Till", icon: ShoppingCart, end: true },
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
      { to: "/pos/products", label: "Products", icon: Package },
      { to: "/pos/inventory", label: "Inventory", icon: Boxes },
      { to: "/pos/goods-receiving", label: "Goods Receiving", icon: Truck },
      { to: "/pos/suppliers", label: "Suppliers", icon: Users },
      { to: "/pos/payables", label: "Payables", icon: Wallet },
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
    label: "Accounts",
    icon: Landmark,
    items: [
      { to: "/pos/cash", label: "Cash", icon: Wallet },
      { to: "/pos/expenses", label: "Expenses", icon: Receipt },
      { to: "/pos/reports", label: "Reports", icon: BarChart3 },
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
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-60 bg-slate-950 text-white flex flex-col shrink-0">
        <div className="p-5 flex items-center gap-2 border-b border-slate-800">
          <Store size={20} className="text-amber-400" />
          <div className="min-w-0">
            <div className="font-bold text-sm truncate">{tenant?.business_name || "POS"}</div>
            <div className="text-[11px] text-slate-400 font-mono">{tenant?.business_code}</div>
          </div>
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
        <POSTopbar title={pageTitle} notificationCount={notificationCount} />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
