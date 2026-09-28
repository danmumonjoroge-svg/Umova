// src/pos-erp/POSTopbar.jsx
//
// Kept deliberately simple (brief section 12).
//
//   Desktop: breadcrumb/title on the left; on the right, connection
//            status, date/time, notifications.
//   Mobile:  [menu or back]  title  ........  status  bell
//            The date/time is dropped (no room), and the connection
//            pill shortens itself -- see ConnectionStatus.
//
// `parent` is the workspace a page belongs to (e.g. Retail for My Stock).
// On a phone a child page shows a back arrow to that workspace instead
// of the menu button; on desktop it shows "Retail > My Stock" so the
// user always knows where they are without a nested sidebar.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Menu, ArrowLeft, ChevronRight } from "lucide-react";
import ConnectionStatus from "./offline/ConnectionStatus";

export default function POSTopbar({ title, parent, notificationCount = 0, onMenuClick }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-[56px] md:min-h-[60px] bg-white border-b border-[#DDE3DD] border-t-2 border-t-[#C6A15B] flex items-center justify-between gap-2 px-3 sm:px-6 shrink-0">
      <div className="flex items-center gap-1 min-w-0">
        {/* Phone-only leading control: back to the workspace on a child
            page, otherwise the menu (secondary navigation drawer). */}
        {parent ? (
          <Link to={parent.to} className="md:hidden -ml-1 p-2.5 text-[#26352D]" aria-label={`Back to ${parent.label}`}>
            <ArrowLeft size={22} />
          </Link>
        ) : onMenuClick ? (
          <button onClick={onMenuClick} className="md:hidden -ml-1 p-2.5 text-[#26352D]" aria-label="Open menu">
            <Menu size={22} />
          </button>
        ) : null}

        {parent && (
          <div className="hidden md:flex items-center gap-1.5 text-sm text-[#68756D] shrink-0">
            <Link to={parent.to} className="hover:text-[#237A52] font-medium">{parent.label}</Link>
            <ChevronRight size={14} />
          </div>
        )}
        <h2 className="font-bold text-[#26352D] truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <ConnectionStatus />
        <span className="text-xs text-[#68756D] hidden lg:block whitespace-nowrap">
          {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>

        <Link to="/pos/communication" className="relative p-2 text-[#26352D] hover:text-[#237A52]" aria-label="Notifications">
          <Bell size={20} />
          {notificationCount > 0 && (
            <span className="absolute top-0.5 right-0 bg-[#C6A15B] text-[#123C2A] text-[10px] font-bold leading-none rounded-full px-1.5 py-1">
              {notificationCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
