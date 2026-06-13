import React, { useState, useEffect, useMemo, useCallback } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useChama } from "./ChamaContext";
import { supabase } from "../../supabaseClient";
import {
  LayoutDashboard, Users, FileText, ShieldAlert, Settings, 
  LogOut, Menu, X, Landmark, Bell, Search, Command, 
  Sparkles, ChevronRight, HelpCircle
} from "lucide-react";

import "./ChamaDashboardLayout.css";

// ── NAVIGATION MAP ROUTE ARCHITECTURE ───────────────────────────────────
const NAV_ITEMS = [
  { key: "dashboard", to: "",         label: "Overview Hub",    icon: LayoutDashboard, badgeKey: "none" },
  { key: "members",   to: "members",   label: "Chama Roster",    icon: Users,           badgeKey: "memberCount" },
  { key: "ledgers",   to: "ledgers",   label: "Ledger Accounts", icon: FileText,        badgeKey: "none" },
  { key: "audit",     to: "audit",     label: "Audit Matrix",    icon: ShieldAlert,     badgeKey: "pendingCount", treasurerOnly: true },
  { key: "settings",  to: "settings",  label: "System Settings",  icon: Settings,        badgeKey: "none" },
];

export default function AdvancedChamaDashboardLayout() {
  const { chama, member } = useChama();
  const location = useLocation();
  const navigate = useNavigate();

  // Navigation & Shell UI States
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");

  // Telemetry Engine States (Badges & Mini Counter Hooks)
  const [telemetry, setTelemetry] = useState({
    pendingCount: 0,
    memberCount: 0,
    walletLiquidity: 0
  });

  const role = String(member?.role || "member").toLowerCase().trim();
  const isTreasurerOrAdmin = ["treasurer", "admin", "super_admin"].includes(role);

  // ── LIVE TELEMETRY STREAM ENGINE (REALTIME BADGES) ─────────────────────
  const fetchLiveWorkspaceTelemetry = useCallback(async () => {
    if (!chama?.id) return;
    try {
      const [pendingTx, activeMembers, wallets] = await Promise.all([
        supabase.from("chama_contributions").select("id", { count: "exact" }).eq("chama_id", chama.id).eq("status", "pending"),
        supabase.from("chama_members").select("id", { count: "exact" }).eq("chama_id", chama.id),
        supabase.from("chama_wallets").select("balance").eq("chama_id", chama.id)
      ]);

      const aggregateLiquid = (wallets.data || []).reduce((acc, curr) => acc + Number(curr.balance || 0), 0);

      setTelemetry({
        pendingCount: pendingTx.count || 0,
        memberCount: activeMembers.count || 0,
        walletLiquidity: aggregateLiquid
      });
    } catch (err) {
      console.error("Layout metrics telemetry pipeline interruption:", err);
    }
  }, [chama?.id]);

  useEffect(() => {
    fetchLiveWorkspaceTelemetry();
    
    // Instantiate real-time listeners for instant status syncs
    const channel = supabase
      .channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "chama_contributions" }, () => fetchLiveWorkspaceTelemetry())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLiveWorkspaceTelemetry]);

  // ── KEYBOARD SHORTCUTS MATRIX (CMD + K INTERCEPTOR) ────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.getElementById("global-workspace-search");
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filter view items matching routing permission configurations
  const allowedNavTree = useMemo(() => {
    return NAV_ITEMS.filter((item) => !item.treasurerOnly || isTreasurerOrAdmin);
  }, [isTreasurerOrAdmin]);

  // Dynamically resolve current route path text headers
  const activeRouteLabel = useMemo(() => {
    const currentPath = location.pathname.split("/").pop();
    const activeItem = NAV_ITEMS.find(item => item.to === currentPath);
    return activeItem ? activeItem.label : "Overview Hub";
  }, [location.pathname]);

  const handleLogOutLifeCycle = async () => {
    try {
      await supabase.auth.signOut();
      navigate("/login");
    } catch (err) {
      console.error("Failed termination of system session tokens:", err);
    }
  };

  return (
    <div className="cd-shell">
      
      {/* ── LEFT CONTAINER: SIDEBAR SYSTEM PANELS ────────────────────── */}
      <aside className={`cd-sidebar ${mobileOpen ? "open" : ""}`}>
        
        {/* Core Corporate Identity Branding Header */}
        <div className="cd-brand">
          <div className="cd-brand-icon-wrapper">
            <Landmark size={20} className="brand-primary-icon" />
            <div className="brand-glow-element" />
          </div>
          <div className="cd-brand-text">
            <h1>{chama?.name || "Premium Workspace"}</h1>
            <div className="chama-status-indicator">
              <span className="pulse-dot" />
              <span>SASRA Compliant Vault</span>
            </div>
          </div>
          <button 
            className="cd-mobile-close" 
            onClick={() => setMobileOpen(false)}
            aria-label="Close Mobile View Nav Drawer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Global Omnibox Mock Search Node */}
        <div className={`cd-sidebar-search ${searchFocused ? "focused" : ""}`}>
          <Search size={14} className="search-icon" />
          <input 
            id="global-workspace-search"
            type="text" 
            placeholder="Search ledgers, profiles..."
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <kbd className="search-shortcut">
            <Command size={10} /><span>K</span>
          </kbd>
        </div>

        {/* Main Operational Core Navigation Paths */}
        <nav className="cd-nav">
          <span className="cd-nav-group-title">Main Accounting Menu</span>
          {allowedNavTree.map(({ key, to, label, icon: Icon, badgeKey }) => {
            const hasBadge = badgeKey !== "none" && telemetry[badgeKey] > 0;
            return (
              <NavLink
                key={key}
                to={to}
                end={to === ""}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `cd-nav-link ${isActive ? "active" : ""}`}
              >
                <div className="cd-nav-link-inner">
                  <Icon size={18} className="nav-vector" />
                  <span>{label}</span>
                </div>
                {hasBadge && (
                  <span className={`cd-nav-telemetry-badge ${badgeKey}`}>
                    {telemetry[badgeKey]}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Dynamic Context Mini Dashboard Widget Card inside Sidebar Foot */}
        <div className="cd-sidebar-widget-card">
          <div className="widget-header">
            <Sparkles size={13} className="spark-accent" />
            <span>Realtime Pooled Funds</span>
          </div>
          <div className="widget-balance">
            {new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(telemetry.walletLiquidity)}
          </div>
          <div className="widget-progress-track">
            <div className="widget-progress-fill" style={{ width: "78%" }} />
          </div>
          <span className="widget-desc">System balances automatically updated</span>
        </div>

        {/* Lower Session Controller Panel Grouping */}
        <div className="cd-sidebar-footer">
          <div className="cd-user-profile-anchor">
            <div className="cd-user-avatar-hex">
              {String(member?.member_name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="cd-user-meta-stack">
              <span className="user-profile-title">{member?.member_name || "Active Session Member"}</span>
              <span className={`user-role-badge ${role}`}>{role}</span>
            </div>
          </div>
          <button 
            className="cd-logout-action-trigger" 
            onClick={handleLogOutLifeCycle}
            title="Terminate Active Token Lifecycles"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Responsive Structural Overlay Mask Backdrop */}
      {mobileOpen && (
        <div className="cd-overlay-mask-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── RIGHT CONTAINER: MAIN ACTION FRAME CANVAS ────────────────── */}
      <div className="cd-main-canvas">
        
        {/* Top Floating Core Actions Header Ribbon */}
        <header className="cd-workspace-topbar">
          <div className="topbar-left-cluster">
            <button 
              className="cd-mobile-drawer-toggle" 
              onClick={() => setMobileOpen(true)}
              aria-label="Open Responsive Workspace Menu"
            >
              <Menu size={20} />
            </button>
            <div className="cd-breadcrumbs">
              <span className="breadcrumb-parent">Chama Workspace Cluster</span>
              <ChevronRight size={12} className="breadcrumb-divider" />
              <span className="breadcrumb-current">{activeRouteLabel}</span>
            </div>
          </div>

          <div className="topbar-right-cluster">
            {/* System Notification Hub Badge */}
            <button className="topbar-utility-icon-btn" aria-label="System Notifications">
              <Bell size={18} />
              {telemetry.pendingCount > 0 && <span className="notification-alert-ping" />}
            </button>
            <button className="topbar-utility-icon-btn" aria-label="Documentation Manuals">
              <HelpCircle size={18} />
            </button>
            <div className="topbar-vertical-divider" />
            <div className="topbar-system-node-tag">
              <span className="node-status-pulse" />
              <span>Node: Ke-Nrb-01</span>
            </div>
          </div>
        </header>

        {/* Core Subroute DOM Engine Mounting Portal Container */}
        <main className="cd-router-viewport-content">
          <Outlet />
        </main>
      </div>

    </div>
  );
}