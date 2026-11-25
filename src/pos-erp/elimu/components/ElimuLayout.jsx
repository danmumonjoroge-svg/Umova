// The Elimu shell, built to feel like a phone app.
//   phone  : content scrolls inside the screen; a bottom bar (Home + the major modules Academics / Students / Finance, then Menu) stays put; a module tab opens that module's grouped menu
//   tablet+: the same items as a pill bar at the top
// Items owned by other modules appear only when that module has registered itself (see registry.js), so there are no dead links.
// Hidden entries never remove a route: a bookmark still works; the database decides access.
import React, { Suspense, useCallback, useContext, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, CalendarCheck, Wallet, LayoutGrid, GraduationCap, ClipboardList, Layers, UserRound, MessageSquare, CalendarDays, BarChart3, Settings, Clock, DoorOpen, ScanLine, UserCog, Building2, ShieldCheck, Briefcase, FileText, Trophy, LifeBuoy } from 'lucide-react';
import { SCHOOL_TREE } from '../navigation/schoolTree.js';
import { bottomTabs, moduleOfPath } from '../navigation/bottomBar.js';
import { NAV_ITEMS } from '../utils/permissions.js';
import SideTree from './SideTree.jsx';
import { readFlag, writeFlag } from '../navigation/pins.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { OfflineBanner } from './ui.jsx';
import { useOnline } from '../hooks/useAsync.js';
import { registeredModules } from '../registry.js';
import ThemeSwitcher from '../theme/ThemeSwitcher.jsx';
import { ElimuShellContext } from '../theme/useElimuTheme.jsx';
import LicenceGate from './LicenceGate.jsx';

const ICONS = { dashboard: Home, students: Users, admissions: ClipboardList, classes: Layers, guardians: UserRound, academics: GraduationCap, attendance: CalendarCheck,
  timetable: Clock, teachers: Briefcase, 'my-report': FileText, activities: Trophy, rooms: DoorOpen, gate: ScanLine, fees: Wallet, communication: MessageSquare, calendar: CalendarDays, reports: BarChart3, settings: Settings, staff: UserCog };
const MODULE_ICONS = { LifeBuoy, Building2, ClipboardList, GraduationCap, ShieldCheck, Wallet, Users, Settings };   // icon names used by the menu tree
const PRIMARY = ['dashboard', 'students', 'attendance', 'fees'];       // tablet pills and the desktop side list keep these first; the PHONE bar uses the major modules below

export default function ElimuLayout({ basePath = '/elimu' }) {
  const inShell = useContext(ElimuShellContext); const { can, isOwner } = useElimuAccess(); const online = useOnline(); const loc = useLocation(); const nav = useNavigate();
  const mods = registeredModules();
  const [narrow, setNarrow] = useState(() => readFlag('elimu-side-narrow'));   // laptop sidebar: full or icons only, remembered on this device
  const toggleNarrow = useCallback(() => setNarrow((v) => { writeFlag('elimu-side-narrow', !v); return !v; }), []);
  const items = NAV_ITEMS.filter((n) => (!n.ownerOnly || isOwner) && (n.owned || mods.has(n.key)) && (n.anyOf ? n.anyOf.some((a) => can(a)) : can(n.action)));
  const href = (n) => `${basePath}${n.to}`;
  const isOn = (n) => (n.to === '' ? loc.pathname.replace(/\/$/, '') === basePath : loc.pathname.startsWith(href(n)) || (n.also || []).some((a) => loc.pathname.startsWith(`${basePath}${a}`)));
  const tabs = items.filter((n) => PRIMARY.includes(n.key)); const rest = items.filter((n) => !PRIMARY.includes(n.key));
  const moreActive = rest.some(isOn);
  // phone bar: Home + the first three major modules this person can see + Menu
  const bar = bottomTabs(SCHOOL_TREE, (a) => can(a), isOwner);
  const rel = loc.pathname.replace(basePath, '').replace(/^\/+|\/+$/g, ''); const here = moduleOfPath(SCHOOL_TREE, rel);
  const atHome = rel === ''; const inTabModule = bar.modules.some((m) => m.key === here); const menuOn = !atHome && !inTabModule;
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#FBF8EA]">
      {/* inside the ERP there is no Elimu header, so the colour button lives in a slim top strip */}
      {!inShell && <div className="shrink-0 flex items-center justify-between px-3 h-12 bg-[#12261F] text-white"><span className="font-bold text-sm">Elimu</span><ThemeSwitcher tone="dark" /></div>}
      {/* tablet: pills on top */}
      <nav aria-label="School" className="hidden md:block lg:hidden shrink-0 bg-[#FBF8EA] px-3 py-2 overflow-x-auto whitespace-nowrap border-b border-[#E3DBB8]">
        {items.map((n) => (
          <NavLink key={n.key} to={href(n)} end={n.to === ''} className={({ isActive }) => `inline-flex items-center px-3 min-h-[40px] mr-1 rounded-full text-sm font-medium ${isActive ? 'bg-[#1F6B45] text-white' : 'text-[#23382B] hover:bg-[#EFE8C8]'}`}>{n.label}</NavLink>
        ))}
      </nav>

      <div className="flex-1 min-h-0 flex">
        {/* laptop / desktop: sidebar */}
        <nav aria-label="School sections" className={`hidden lg:flex flex-col shrink-0 overflow-y-auto border-r border-[#E3DBB8] bg-white py-4 transition-[width] duration-150 ${narrow ? 'w-[68px] px-2' : 'w-64 pl-3 pr-2'}`}>
          <SideTree tree={SCHOOL_TREE} basePath={basePath} can={can} isOwner={isOwner} loc={loc} icons={MODULE_ICONS} showHome={items.some((n) => n.key === 'dashboard')} collapsed={narrow} onToggle={toggleNarrow} />
        </nav>

        {/* the ONE scrolling area */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="w-full max-w-[1500px] mx-auto px-3 md:px-5 lg:px-6 pt-3 md:pt-5 pb-6 min-h-full"><OfflineBanner online={online} /><LicenceGate><Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}><Outlet /></Suspense></LicenceGate></div>
        </main>
      </div>

      {/* phone: bottom tab bar */}
      <nav aria-label="School tabs" className="md:hidden shrink-0 grid bg-white border-t border-[#E3DBB8] pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${bar.modules.length + 2}, minmax(0, 1fr))` }}>
        <NavLink to={basePath} end aria-current={atHome ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${atHome ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
          <span className={`flex h-7 w-12 items-center justify-center rounded-full ${atHome ? 'bg-[#E4F0E8]' : ''}`}><Home size={20} strokeWidth={atHome ? 2.4 : 2} /></span>Home
        </NavLink>
        {bar.modules.map((m) => { const Icon = MODULE_ICONS[m.icon] || LayoutGrid; const on = here === m.key; return (
          <NavLink key={m.key} to={m.to ? `${basePath}/${m.to}` : `${basePath}/menu/${m.key}`} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${on ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} strokeWidth={on ? 2.4 : 2} /></span>{m.label}
          </NavLink>); })}
        <button type="button" onClick={() => nav(`${basePath}/menu`)} className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold ${menuOn ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
          <span className={`flex h-7 w-12 items-center justify-center rounded-full ${menuOn ? 'bg-[#E4F0E8]' : ''}`}><LayoutGrid size={20} strokeWidth={menuOn ? 2.4 : 2} /></span>Menu
        </button>
      </nav>
    </div>
  );
}
