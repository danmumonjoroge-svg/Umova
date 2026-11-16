// The Elimu application shell.
// Desktop: persistent permission-aware sidebar + one content scroll area.
// Mobile: the existing four primary tabs + More sheet remain in place.
// Items owned by other modules appear only when that module has registered itself.
// Hiding a link is presentation only; route guards and database RLS remain authoritative.
import React, { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Users, CalendarCheck, Wallet, LayoutGrid, GraduationCap,
  ClipboardList, Layers, UserRound, MessageSquare, CalendarDays,
  BarChart3, Settings, Clock, DoorOpen, ScanLine, UserCog,
  School, ChevronRight, Wifi, WifiOff,
} from 'lucide-react';
import { NAV_ITEMS } from '../utils/permissions.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { OfflineBanner } from './ui.jsx';
import { useOnline } from '../hooks/useAsync.js';
import { registeredModules } from '../registry.js';
import AppSheet from './AppSheet.jsx';

const ICONS = {
  dashboard: Home, students: Users, admissions: ClipboardList, classes: Layers,
  guardians: UserRound, academics: GraduationCap, attendance: CalendarCheck,
  timetable: Clock, rooms: DoorOpen, gate: ScanLine, fees: Wallet,
  communication: MessageSquare, calendar: CalendarDays, reports: BarChart3,
  settings: Settings, staff: UserCog,
};
const PRIMARY = ['dashboard', 'students', 'attendance', 'fees'];

function SidebarLink({ item, href, active }) {
  const Icon = ICONS[item.key] || LayoutGrid;
  return (
    <NavLink
      to={href}
      end={item.to === ''}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={({ isActive }) => [
        'group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors',
        (active || isActive)
          ? 'bg-[#E5F0E8] text-[#185C3A] shadow-sm'
          : 'text-[#536257] hover:bg-[#F1F4EF] hover:text-[#173D2A]',
      ].join(' ')}
    >
      <Icon size={18} strokeWidth={2.1} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {active && <ChevronRight size={15} className="text-[#1F6B45]" />}
    </NavLink>
  );
}

export default function ElimuLayout({ basePath = '/elimu' }) {
  const { can, isOwner } = useElimuAccess();
  const online = useOnline();
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const mods = registeredModules();
  const items = NAV_ITEMS.filter((n) =>
    (!n.ownerOnly || isOwner) &&
    (n.owned || mods.has(n.key)) &&
    (n.anyOf ? n.anyOf.some((a) => can(a)) : can(n.action))
  );
  const href = (n) => `${basePath}${n.to}`;
  const isOn = (n) => (
    n.to === ''
      ? loc.pathname.replace(/\/$/, '') === basePath
      : loc.pathname.startsWith(href(n)) || (n.also || []).some((a) => loc.pathname.startsWith(`${basePath}${a}`))
  );
  const tabs = items.filter((n) => PRIMARY.includes(n.key));
  const rest = items.filter((n) => !PRIMARY.includes(n.key));
  const moreActive = rest.some(isOn);
  const primaryItems = items.filter((n) => n.key !== 'settings');
  const settingsItem = items.find((n) => n.key === 'settings');

  return (
    <div className="flex h-full min-h-0 bg-[#FBF8EA]">
      {/* Desktop workspace navigation */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#E3E8DF] bg-white md:flex xl:w-[264px]">
        <div className="border-b border-[#EDF0E9] px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#173D2A] text-[#E8C75A] shadow-sm">
              <School size={21} />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold tracking-tight text-[#173D2A]">Elimu</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#829087]">School workspace</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <div className="mb-2 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#9AA69C]">Workspace</div>
          <nav aria-label="School workspace" className="space-y-1">
            {primaryItems.map((n) => <SidebarLink key={n.key} item={n} href={href(n)} active={isOn(n)} />)}
          </nav>

          {rest.length > 0 && (
            <>
              <div className="mb-2 mt-7 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#9AA69C]">School management</div>
              <nav aria-label="School management" className="space-y-1">
                {rest.filter((n) => n.key !== 'settings').map((n) => <SidebarLink key={n.key} item={n} href={href(n)} active={isOn(n)} />)}
              </nav>
            </>
          )}
        </div>

        <div className="border-t border-[#EDF0E9] p-3">
          {settingsItem && <SidebarLink item={settingsItem} href={href(settingsItem)} active={isOn(settingsItem)} />}
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#F7F8F4] px-3 py-2.5 text-[11px] font-medium text-[#758177]">
            {online ? <Wifi size={15} className="text-[#27834E]" /> : <WifiOff size={15} className="text-[#B7791F]" />}
            <span>{online ? 'Connected' : 'Offline mode'}</span>
            <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: online ? '#27834E' : '#B7791F' }} />
          </div>
        </div>
      </aside>

      {/* Main content: keep one scrolling region for predictable mobile and desktop behaviour */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="mx-auto min-h-full w-full max-w-[1600px] px-3 pb-6 pt-3 sm:px-5 sm:pt-5 xl:px-7">
            <OfflineBanner online={online} />
            <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading school workspace…</div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        {/* Mobile: retain the familiar bottom navigation and More sheet */}
        <nav
          aria-label="School tabs"
          className="grid shrink-0 border-t border-[#E3DBB8] bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, tabs.length + (rest.length ? 1 : 0))}, minmax(0, 1fr))` }}
        >
          {tabs.map((n) => {
            const Icon = ICONS[n.key] || Home;
            const on = isOn(n);
            return (
              <NavLink key={n.key} to={href(n)} end={n.to === ''} aria-current={on ? 'page' : undefined}
                className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} strokeWidth={on ? 2.4 : 2} /></span>
                {n.label}
              </NavLink>
            );
          })}
          {rest.length > 0 && (
            <button type="button" onClick={() => setMore(true)} aria-expanded={more}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${moreActive ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreActive ? 'bg-[#E4F0E8]' : ''}`}><LayoutGrid size={20} /></span>
              More
            </button>
          )}
        </nav>
      </div>

      {more && (
        <AppSheet title="More" onClose={() => setMore(false)}>
          <div className="grid grid-cols-3 gap-2 pt-2">
            {rest.map((n) => {
              const Icon = ICONS[n.key] || LayoutGrid;
              return (
                <button key={n.key} type="button" onClick={() => { setMore(false); nav(href(n)); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E3DBB8] bg-[#FBF8EA] px-1 py-3 text-xs font-semibold text-[#23382B] active:bg-[#EFE8C8]">
                  <Icon size={22} className="text-[#1F6B45]" />{n.label}
                </button>
              );
            })}
          </div>
        </AppSheet>
      )}
    </div>
  );
}
