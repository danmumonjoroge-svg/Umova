import React, { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useChama } from "./ChamaContext";
import {
  LayoutDashboard, Users, FileText, ShieldAlert,
  Settings, LogOut, Menu, X
} from "lucide-react";

import "./ChamaDashboardLayout.css";

// ============================================================
// SIDEBAR NAVIGATION DEFINITION
// ============================================================
// Each entry maps to a child route rendered via <Outlet/> in
// ChamaDashboardLayout. Add/remove items here to control nav.
// ============================================================
const NAV_ITEMS = [
  { key: "dashboard", to: "",          label: "Overview",   icon: LayoutDashboard },
  { key: "members",   to: "members",   label: "Members",    icon: Users },
  { key: "ledgers",   to: "ledgers",   label: "Ledgers",     icon: FileText },
  { key: "audit",     to: "audit",     label: "Audit",       icon: ShieldAlert, treasurerOnly: true },
  { key: "settings",  to: "settings",  label: "Settings",    icon: Settings },
];

export default function ChamaDashboardLayout() {
  const { chama, member } = useChama();
  const [mobileOpen, setMobileOpen] = useState(false);

  const role = String(member?.role || "member").toLowerCase().trim();
  const isTreasurerOrAdmin = ["treasurer", "admin", "super_admin"].includes(role);

  const visibleNav = NAV_ITEMS.filter((item) => !item.treasurerOnly || isTreasurerOrAdmin);

  return (
    <div className="cd-shell">

      {/* ===================== SIDEBAR ===================== */}
      <aside className={`cd-sidebar ${mobileOpen ? "open" : ""}`}>

        <div className="cd-brand">
          <div className="cd-brand-mark">
            {String(chama?.name || "C").charAt(0).toUpperCase()}
          </div>
          <div className="cd-brand-text">
            <h1>{chama?.name || "Chama"}</h1>
            <span>Group Finance</span>
          </div>
          <button
            className="cd-mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="cd-nav">
          {visibleNav.map(({ key, to, label, icon: Icon }) => (
            <NavLink
              key={key}
              to={to}
              end={to === ""}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `cd-nav-link ${isActive ? "active" : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="cd-sidebar-footer">
          <div className="cd-user">
            <div className="cd-user-avatar">
              {String(member?.member_name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="cd-user-text">
              <span className="cd-user-name">{member?.member_name || "Member"}</span>
              <span className="cd-user-role">{role}</span>
            </div>
          </div>
          <button className="cd-logout" aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>

      </aside>

      {/* mobile overlay */}
      {mobileOpen && (
        <div className="cd-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* ===================== MAIN ===================== */}
      <div className="cd-main">

        <header className="cd-topbar">
          <button
            className="cd-mobile-toggle"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="cd-topbar-title">
            <span className="cd-eyebrow">Chama Workspace</span>
            <h2>{chama?.name || "Dashboard"}</h2>
          </div>
        </header>

        <main className="cd-content">
          <Outlet />
        </main>

      </div>

    </div>
  );
}