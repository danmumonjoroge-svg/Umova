// src/pos-erp/POSLayout.jsx
//
// "My Business" shell -- hybrid navigation (brief sections 3, 4, 5, 15).
//
//   md and up    Forest Green sidebar, always visible. ONE flat line per
//                module (Home, Sell, Retail, My Money, ...). No expandable
//                groups -- clicking Retail opens the Retail WORKSPACE (a
//                full page of cards); the sidebar only says where you are,
//                the workspace says what you can do.
//   below md     No permanent sidebar. A fixed bottom bar carries Home,
//                Sell, Money, People, More. The old off-canvas drawer is
//                kept as a secondary route to everything (hamburger).
//
// Everything here reads navigation/navConfig.js -- the sidebar, bottom
// bar, More screen, topbar title and breadcrumb cannot disagree. Routes
// are ordinary React Router links, so the browser back button works and
// nothing is intercepted.
//
// History: the previous version had collapsible Retail/Rentals/Salon/
// Accounts/Admin groups and a slate-950 sidebar, and hid nothing by
// business type. Capabilities (navigation/CapabilitiesContext.jsx) now
// decide which of Retail/Rentals/Salon appear; routes are never removed.

import React, { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { usePosErpAuth } from "./auth/usePosErpAuth";
import { useNotifications } from "./hooks/useNotifications";
import { settingsService } from "./services/settingsService";
import POSTopbar from "./POSTopbar";
import BottomNav from "./components/BottomNav";
import { CapabilitiesProvider, useCapabilities } from "./navigation/CapabilitiesContext";
import { resolveLocation, visibleModules } from "./navigation/navConfig";
import { LogOut, Store, X } from "lucide-react";

function Shell() {
  const { staffName, role, tenant, logout } = usePosErpAuth();
  const location = useLocation();
  const { count: notificationCount } = useNotifications();
  const { enabled } = useCapabilities();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    if (!tenant?.business_id) return;
    settingsService.getBusinessProfile(tenant.business_id).then((p) => setLogoUrl(p?.logo_url || null)).catch(() => {});
  }, [tenant?.business_id]);

  // Close the drawer whenever the route changes (only ever visible below md).
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  const loc = resolveLocation(location.pathname);
  const modules = visibleModules(enabled);
  const title = loc.page?.label || loc.module?.label
    || (location.pathname.startsWith("/pos/communication") ? "Notifications" : "My Business");
  const parent = loc.page && loc.module ? { label: loc.module.label, to: loc.module.to } : null;

  const NavItem = ({ m }) => {
    const Icon = m.icon;
    const active = loc.module?.key === m.key;
    return (
      <Link
        to={m.to}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 px-5 min-h-[44px] text-sm transition border-l-4 ${
          active
            ? "bg-[#237A52] text-white font-semibold border-[#C6A15B]"
            : "text-white/75 hover:bg-[#1B5138] hover:text-white border-transparent"
        }`}
      >
        <Icon size={18} />
        {m.label}
      </Link>
    );
  };

  return (
    // 100dvh (with h-screen as the fallback for browsers without dvh)
    // so the phone browser's collapsing URL bar can't push the bottom
    // bar off-screen.
    <div className="h-screen overflow-hidden bg-[#F7F6F0] text-[#26352D] flex print:h-auto print:overflow-visible" style={{ height: "100dvh" }}>
      {drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} className="fixed inset-0 bg-black/40 z-40 md:hidden" aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#123C2A] text-white flex flex-col shrink-0 print:hidden
          transform transition-transform duration-200 ease-out
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 md:static md:z-auto md:w-60`}
      >
        <div className="p-5 flex items-center gap-2.5 border-b border-white/10">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-white" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-[#237A52] flex items-center justify-center shrink-0"><Store size={18} className="text-[#C6A15B]" /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm truncate">{tenant?.business_name || "My Business"}</div>
            <div className="text-[11px] text-white/60 font-mono truncate">{tenant?.business_code}</div>
          </div>
          <button onClick={() => setDrawerOpen(false)} className="md:hidden text-white/70 hover:text-white p-2 -mr-2" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto" aria-label="Main">
          {modules.map((m) => <NavItem key={m.key} m={m} />)}
        </nav>

        <div className="p-4 border-t border-white/10" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="text-sm font-semibold truncate">{staffName || "Staff"}</div>
          <div className="text-[11px] text-white/60 capitalize mb-3">{role || "—"}</div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold bg-[#1B5138] hover:bg-[#237A52] text-white/85 hover:text-white min-h-[40px] rounded-lg transition"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="print:hidden">
          <POSTopbar
            title={title}
            parent={parent}
            notificationCount={notificationCount}
            onMenuClick={() => setDrawerOpen(true)}
          />
        </div>
        {/* Bottom padding on phones keeps the last of every page clear of
            the fixed bottom bar (plus the device's safe-area inset). */}
        <main className="flex-1 min-w-0 overflow-y-auto pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0 print:overflow-visible print:pb-0">
          <Outlet />
        </main>
      </div>

      <BottomNav moduleKey={loc.module?.key} />
    </div>
  );
}

export default function POSLayout() {
  return (
    <CapabilitiesProvider>
      <Shell />
    </CapabilitiesProvider>
  );
}
