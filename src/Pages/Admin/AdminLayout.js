import "./umova-theme.css";
import "./AdminLayout.css";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { supabase } from "../../supabaseClient";
import AppLock from "../../security/AppLock";
import {
  Home, Bell, Search, LogOut, ChevronDown, ChevronLeft, MoreHorizontal,
} from "lucide-react";
import {
  APPROVER_ROLES, MORE_KEYS, MORE_MODULE, adminPath, hubPath,
  moduleForPath, moduleByKey, visibleNav,
} from "./adminNav";

// ─────────────────────────────────────────────────────────────────────────
// Umova Admin shell — one app, three form factors:
//   phone  (<768):   top bar + scrolling page + bottom tab bar (app-style).
//                    Tabs open WORKSPACE PAGES (/admin/hub/<module>) that show
//                    cards for that module's screens.
//   tablet (768-1024): icon rail + top bar.
//   desktop (>1024):   full sidebar + top bar.
// All CSS classes are prefixed "um-" because other Admin stylesheets are
// global and already define .avatar, .badge, .card, .header, etc.
// ─────────────────────────────────────────────────────────────────────────

const useOnline = () => {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
};

// Real alerts only. Currently: pending POS businesses + registration requests
// (the same two queries Dashboard.jsx already uses), approvers only.
function useAdminAlerts(isApprover, pathname) {
  const [alerts, setAlerts] = useState([]);
  const load = useCallback(async () => {
    if (!isApprover) { setAlerts([]); return; }
    const out = [];
    try {
      const { data } = await supabase.rpc("list_pos_tenants", { p_status: "pending" });
      const n = (data || []).length;
      if (n) out.push({ id: "pos-tenants", text: `${n} POS business${n > 1 ? "es" : ""} awaiting approval`, to: "/admin/pos-tenants" });
    } catch (e) { /* alert source unavailable — show nothing rather than guess */ }
    try {
      const { count } = await supabase
        .from("pos_registration_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      if (count) out.push({ id: "pos-requests", text: `${count} POS registration request${count > 1 ? "s" : ""} pending`, to: "/admin/pos-requests" });
    } catch (e) { /* same */ }
    setAlerts(out);
  }, [isApprover]);
  useEffect(() => { load(); }, [load, pathname]);
  return alerts;
}

export default function AdminLayout() {
  const { profile, role, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();

  const [search, setSearch] = useState("");
  const [showBell, setShowBell] = useState(false);
  const [openGroups, setOpenGroups] = useState({});

  const isApprover = APPROVER_ROLES.includes(role);
  const nav = useMemo(() => visibleNav(isApprover), [isApprover]);
  const alerts = useAdminAlerts(isApprover, location.pathname);

  const path = location.pathname;
  const activeModule = useMemo(() => moduleForPath(path, nav), [path, nav]);
  const isHub = /^\/admin\/hub\//.test(path);
  const isDashboard = path === "/admin/dashboard";

  // Title + back target for the top bar.
  const { title, backTo } = useMemo(() => {
    if (isDashboard) return { title: "Dashboard", backTo: null };
    if (path === hubPath("more")) return { title: "More", backTo: null };
    if (isHub) {
      const m = activeModule;
      const inMore = m && MORE_KEYS.includes(m.key);
      return { title: m?.label || "Admin", backTo: inMore ? hubPath("more") : null };
    }
    const m = activeModule;
    if (m?.children) {
      const c = m.children.find((x) => path === adminPath(x.to) || path.startsWith(adminPath(x.to) + "/"));
      return { title: c?.label || m.label, backTo: hubPath(m.key) };
    }
    return { title: m?.label || "Admin", backTo: m && MORE_KEYS.includes(m.key) ? hubPath("more") : "/admin/dashboard" };
  }, [path, activeModule, isHub, isDashboard]);

  useEffect(() => {
    if (activeModule?.children) setOpenGroups((g) => ({ ...g, [activeModule.key]: true }));
    setShowBell(false);
  }, [path]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    nav.forEach((n) => {
      if (n.children) {
        n.children.forEach((c) => {
          if (`${n.label} ${c.label}`.toLowerCase().includes(q)) out.push({ label: c.label, group: n.label, to: adminPath(c.to) });
        });
      } else if (n.label.toLowerCase().includes(q)) {
        out.push({ label: n.label, group: "", to: adminPath(n.to) });
      }
    });
    return out.slice(0, 8);
  }, [search, nav]);

  const displayName = profile?.name || "Admin";
  const initials = displayName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const tabActive = (key) => {
    if (key === "home") return isDashboard;
    if (key === "more") return !!activeModule && (activeModule.key === "more" || MORE_KEYS.includes(activeModule.key));
    return activeModule?.key === key;
  };

  const isActiveLink = (to) => path === adminPath(to) || path.startsWith(adminPath(to) + "/");

  // AppLock sits INSIDE StaffGuard (App.js): the staff member is already authenticated and their role resolved,
  // so fingerprint only unlocks the app; it never changes what this role is allowed to do.
  // Same "finance" service as the member app (one Umova Finance account per phone). Web: renders children untouched.
  return (
    <AppLock service="finance" client={supabase} onSignOut={logout}>
    <div className="um-app">
      {/* ───── sidebar (tablet rail / desktop) ───── */}
      <aside className="um-sidebar">
        <Link to="/admin/dashboard" className="um-brand">
          <span className="um-brand-mark">U</span>
          <span className="um-brand-text"><strong>UMOVA</strong><small>ADMIN</small></span>
        </Link>

        <nav className="um-menu" aria-label="Admin navigation">
          {nav.map((n) => {
            const Icon = n.icon;
            if (!n.children) {
              return (
                <Link key={n.key} to={adminPath(n.to)} title={n.label}
                  className={`um-item ${isActiveLink(n.to) ? "active" : ""}`}>
                  <Icon size={20} /><span className="um-item-label">{n.label}</span>
                </Link>
              );
            }
            const open = !!openGroups[n.key];
            return (
              <div key={n.key}>
                <button type="button" title={n.label}
                  className={`um-item um-group ${activeModule?.key === n.key ? "active-module" : ""}`}
                  aria-expanded={open}
                  onClick={() => setOpenGroups((g) => ({ ...g, [n.key]: !g[n.key] }))}>
                  <Icon size={20} /><span className="um-item-label">{n.label}</span>
                  <ChevronDown size={16} className={`um-chev ${open ? "open" : ""}`} />
                </button>
                {open && (
                  <div className="um-sub">
                    <Link to={hubPath(n.key)} className={`um-subitem ${path === hubPath(n.key) ? "active" : ""}`}>Overview</Link>
                    {n.children.map((c) => (
                      <Link key={c.to} to={adminPath(c.to)} className={`um-subitem ${isActiveLink(c.to) ? "active" : ""}`}>{c.label}</Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="um-profile">
          <div className="um-avatar">{initials}</div>
          <div className="um-profile-text">
            <div className="um-pname">{displayName}</div>
            <div className="um-prole">{role || "Staff"}</div>
          </div>
        </div>
      </aside>

      {/* ───── main ───── */}
      <div className="um-main">
        <header className="um-topbar">
          <div className="um-top-left">
            {backTo ? (
              <button className="um-icon-btn um-phone-only" onClick={() => navigate(backTo)} aria-label="Back">
                <ChevronLeft size={24} />
              </button>
            ) : (
              <span className="um-top-mark um-phone-only" aria-hidden="true">U</span>
            )}
            <h1 className="um-title">{title}</h1>
          </div>

          <div className="um-search um-desktop-only">
            <Search size={16} />
            <input placeholder="Search pages…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search pages" />
            {searchResults.length > 0 && (
              <div className="um-search-results">
                {searchResults.map((r) => (
                  <button key={r.to} type="button" onClick={() => { setSearch(""); navigate(r.to); }}>
                    <span>{r.label}</span>{r.group && <small>{r.group}</small>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="um-top-right">
            <span className={`um-status ${online ? "on" : "off"}`} title={online ? "Online" : "Offline — transactions cannot be posted"}>
              <i /><span className="um-status-text">{online ? "Online" : "Offline"}</span>
            </span>

            <div className="um-bell-wrap">
              <button className="um-icon-btn" onClick={() => setShowBell((v) => !v)} aria-label="Notifications" aria-expanded={showBell}>
                <Bell size={22} />
                {alerts.length > 0 && <span className="um-bell-dot">{alerts.length}</span>}
              </button>
              {showBell && (
                <>
                  <div className="um-bell-backdrop" onClick={() => setShowBell(false)} />
                  <div className="um-bell-panel" role="dialog" aria-label="Notifications">
                    <div className="um-bell-head">Notifications</div>
                    {alerts.length === 0 ? (
                      <div className="um-bell-empty">You're all caught up</div>
                    ) : (
                      alerts.map((a) => (
                        <button key={a.id} type="button" className="um-bell-item" onClick={() => navigate(a.to)}>{a.text}</button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <button className="um-icon-btn um-desktop-only" onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {!online && (
          <div className="um-offline" role="alert">
            You are offline. Payments and journals cannot be posted until the connection returns.
          </div>
        )}

        <main className="um-content">
          <div className="um-content-inner um-fade" key={path}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* ───── bottom tab bar (phone) ───── */}
      <nav className="um-tabbar" aria-label="Primary">
        <Link to="/admin/dashboard" className={`um-tab ${tabActive("home") ? "active" : ""}`}>
          <Home size={22} /><span>Home</span>
        </Link>
        {["money", "loans"].map((k) => {
          const n = moduleByKey(k);
          const Icon = n.icon;
          return (
            <Link key={k} to={hubPath(k)} className={`um-tab ${tabActive(k) ? "active" : ""}`}>
              <Icon size={22} /><span>{n.label}</span>
            </Link>
          );
        })}
        <Link to={hubPath("more")} className={`um-tab ${tabActive("more") ? "active" : ""}`}>
          <MoreHorizontal size={22} /><span>More</span>
        </Link>
      </nav>
    </div>
    </AppLock>
  );
}
