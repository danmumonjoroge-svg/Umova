// The Elimu shell, built to feel like a phone app.
//   phone  : content scrolls inside the screen; a bottom tab bar (Home, Students, Attendance, Fees, More) stays put; "More" opens a sheet
//   tablet+: the same items as a pill bar at the top
// Items owned by other modules appear only when that module has registered itself (see registry.js), so there are no dead links.
// Hidden entries never remove a route: a bookmark still works; the database decides access.
import React, { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, CalendarCheck, Wallet, LayoutGrid, GraduationCap, ClipboardList, Layers, UserRound, MessageSquare, CalendarDays, BarChart3, Settings, Clock } from 'lucide-react';
import { NAV_ITEMS } from '../utils/permissions.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { OfflineBanner } from './ui.jsx';
import { useOnline } from '../hooks/useAsync.js';
import { registeredModules } from '../registry.js';
import AppSheet from './AppSheet.jsx';

const ICONS = { dashboard: Home, students: Users, admissions: ClipboardList, classes: Layers, guardians: UserRound, academics: GraduationCap, attendance: CalendarCheck,
  timetable: Clock, fees: Wallet, communication: MessageSquare, calendar: CalendarDays, reports: BarChart3, settings: Settings };
const PRIMARY = ['dashboard', 'students', 'attendance', 'fees'];       // the four tabs; everything else lives under More

export default function ElimuLayout({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const online = useOnline(); const loc = useLocation(); const nav = useNavigate();
  const [more, setMore] = useState(false);
  const mods = registeredModules();
  const items = NAV_ITEMS.filter((n) => (n.owned || mods.has(n.key)) && (n.anyOf ? n.anyOf.some((x) => can(x)) : can(n.action)));
  const href = (n) => `${basePath}${n.to}`;
  const isOn = (n) => (n.to === '' ? loc.pathname.replace(/\/$/, '') === basePath : loc.pathname.startsWith(href(n)));
  const tabs = items.filter((n) => PRIMARY.includes(n.key)); const rest = items.filter((n) => !PRIMARY.includes(n.key));
  const moreActive = rest.some(isOn);
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#FBF8EA]">
      {/* tablet / desktop: pills on top */}
      <nav aria-label="School" className="hidden md:block shrink-0 bg-[#FBF8EA] px-3 py-2 overflow-x-auto whitespace-nowrap border-b border-[#E3DBB8]">
        {items.map((n) => (
          <NavLink key={n.key} to={href(n)} end={n.to === ''} className={({ isActive }) => `inline-flex items-center px-3 min-h-[40px] mr-1 rounded-full text-sm font-medium ${isActive ? 'bg-[#1F6B45] text-white' : 'text-[#23382B] hover:bg-[#EFE8C8]'}`}>{n.label}</NavLink>
        ))}
      </nav>

      {/* the ONE scrolling area */}
      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-5xl mx-auto px-3 pt-3 pb-6 min-h-full"><OfflineBanner online={online} /><Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}><Outlet /></Suspense></div>
      </main>

      {/* phone: bottom tab bar */}
      <nav aria-label="School tabs" className="md:hidden shrink-0 grid bg-white border-t border-[#E3DBB8] pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${Math.max(1, tabs.length + (rest.length ? 1 : 0))}, minmax(0, 1fr))` }}>
        {tabs.map((n) => { const Icon = ICONS[n.key] || Home; const on = isOn(n); return (
          <NavLink key={n.key} to={href(n)} end={n.to === ''} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${on ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} strokeWidth={on ? 2.4 : 2} /></span>{n.label}
          </NavLink>); })}
        {rest.length > 0 && (
          <button type="button" onClick={() => setMore(true)} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${moreActive ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreActive ? 'bg-[#E4F0E8]' : ''}`}><LayoutGrid size={20} /></span>More
          </button>)}
      </nav>
      {more && (
        <AppSheet title="More" onClose={() => setMore(false)}>
          <div className="grid grid-cols-3 gap-2 pt-2">
            {rest.map((n) => { const Icon = ICONS[n.key] || LayoutGrid; return (
              <button key={n.key} type="button" onClick={() => { setMore(false); nav(href(n)); }} className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E3DBB8] bg-[#FBF8EA] py-3 px-1 text-xs font-semibold text-[#23382B] active:bg-[#EFE8C8]">
                <Icon size={22} className="text-[#1F6B45]" />{n.label}
              </button>); })}
          </div>
        </AppSheet>)}
    </div>
  );
}
