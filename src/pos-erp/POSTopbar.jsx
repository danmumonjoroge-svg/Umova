// src/pos-erp/POSTopbar.jsx
//
// Sits at the top of POSLayout's main content area. Holds the
// Communication/notifications entry point (bell icon) and a live
// clock/date — the two things that belong at the top of every screen
// rather than duplicated per-page.
//
// notificationCount is a prop rather than something this component
// fetches itself, so POSLayout (which already has tenant/staff context)
// controls what actually counts as a notification — low stock, overdue
// credit, etc. — once those pieces exist. Defaults to 0 so this renders
// correctly before any of that is wired up.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Menu } from "lucide-react";

export default function POSTopbar({ title, notificationCount = 0, onMenuClick }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-16 bg-white border-b border-slate-200 border-t-2 border-t-amber-400 flex items-center justify-between px-4 sm:px-6 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — only rendered on phones/small tablets (md:hidden).
            On md+ the sidebar is always visible as a static panel, so
            there's nothing for this to toggle there. */}
        {onMenuClick && (
          <button onClick={onMenuClick} className="md:hidden text-slate-500 hover:text-slate-800 -ml-1 p-1" aria-label="Open menu">
            <Menu size={22} />
          </button>
        )}
        <h2 className="font-bold text-slate-800 truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-3 sm:gap-5 shrink-0">
        <span className="text-xs text-slate-400 hidden lg:block">
          {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>

        <Link to="/pos/communication" className="relative text-slate-500 hover:text-slate-800">
          <Bell size={20} />
          {notificationCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] leading-none rounded-full px-1.5 py-1">
              {notificationCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
