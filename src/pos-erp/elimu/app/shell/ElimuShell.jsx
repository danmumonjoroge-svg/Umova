// elimu/app/shell/ElimuShell.jsx -- THE Elimu application shell. One component supplies: app bar (school logo/initials, notification bell, account menu),
// desktop sidebar (grouped), phone bottom tabs + "More" sheet, and ONE scrolling area for the page. The menu comes from app/navigation/navModel.js.
// Pages render in <Outlet/>; they never draw their own app bar or menu.
import React, { Suspense, createContext, useContext, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, LogOut, Home as HomeIcon, ChevronRight, Wifi, WifiOff } from 'lucide-react';
import AppSheet from '../../components/AppSheet.jsx';
import { OfflineBanner } from '../../components/ui.jsx';
import { useOnline } from '../../hooks/useAsync.js';
import { registeredKeys } from '../../registry.js';
import { useElimuSession } from '../auth/ElimuAuthContext.jsx';
import { visibleNav, groupNav, pinnedNav, splitTabs, navHref, isActive, activeItem } from '../navigation/navModel.js';
import { iconFor } from './icons.js';
import { schoolInitials } from './branding.js';
import { useSchoolLogo } from './useSchoolLogo.js';
import { useNotifications } from '../notifications/useNotifications.js';
import NotificationBell from '../notifications/NotificationBell.jsx';
import { LoadingState } from './states.jsx';

const CSS = `
.elimu-app{-webkit-tap-highlight-color:transparent;touch-action:manipulation;overscroll-behavior:none;-webkit-text-size-adjust:100%}
.elimu-app input,.elimu-app select,.elimu-app textarea{font-size:16px}           /* stops the phone zooming in on every field */
.elimu-app button,.elimu-app a{-webkit-user-select:none;user-select:none}
.elimu-app *{scrollbar-width:thin}
`;

const ShellCtx = createContext(null);
/** { base, items, active, notifications } for pages that need them (e.g. the notifications page). */
export const useElimuShell = () => {
  const c = useContext(ShellCtx);
  if (!c) throw new Error('useElimuShell must be used inside <ElimuShell>');
  return c;
};

function SidebarLink({ item, base, active }) {
  const Icon = iconFor(item.key);
  return (
    <NavLink to={navHref(item, base)} end={item.to === ''} aria-current={active ? 'page' : undefined} title={item.label}
      className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors ${active ? 'bg-[#E5F0E8] text-[#185C3A] shadow-sm' : 'text-[#536257] hover:bg-[#F1F4EF] hover:text-[#173D2A]'}`}>
      <Icon size={18} strokeWidth={2.1} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{item.label}</span>{active && <ChevronRight size={15} className="text-[#1F6B45]" />}
    </NavLink>
  );
}

function Logo({ url, name, size = 36 }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size };
  return url && !bad
    ? <img src={url} alt="" onError={() => setBad(true)} style={box} className="shrink-0 rounded-xl bg-white object-contain" />
    : <span style={box} className="flex shrink-0 items-center justify-center rounded-xl bg-[#C9A227] text-[13px] font-black text-[#12261F]" aria-hidden="true">{schoolInitials(name)}</span>;
}

export default function ElimuShell({ base = '/school', homeHref = '/' }) {
  const session = useElimuSession(); const { school, user, permissions } = session;
  const loc = useLocation(); const nav = useNavigate(); const online = useOnline() && !session.offline;
  const [more, setMore] = useState(false); const [account, setAccount] = useState(false);
  const logo = useSchoolLogo(school);
  const can = permissions.can; const owner = permissions.isOwner || !!user?.isOwner;
  const items = useMemo(() => visibleNav({ can, isOwner: owner, modules: registeredKeys() }), [can, owner, permissions.loaded]);
  const groups = useMemo(() => groupNav(items), [items]);
  const pinned = useMemo(() => pinnedNav(items), [items]);
  const { tabs, rest } = useMemo(() => splitTabs(items), [items]);
  const active = activeItem(items, loc.pathname, base);
  const notifications = useNotifications({ base, can, schoolId: school?.id, userId: user?.id, enabled: permissions.loaded });
  const ctx = useMemo(() => ({ base, items, active, notifications }), [base, items, active, notifications]);
  const moreActive = rest.some((n) => isActive(n, loc.pathname, base));
  const go = (to) => { setMore(false); setAccount(false); nav(to); };

  return (
    <ShellCtx.Provider value={ctx}>
      <div className="elimu-app fixed inset-0 flex flex-col bg-[#FBF8EA] text-[#23382B]" style={{ height: '100dvh' }}>
        <style>{CSS}</style>
        <header className="shrink-0 bg-[#12261F] text-white pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-3 px-3">
            <Logo url={logo} name={school?.name} />
            <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[15px] font-bold">{school?.name || 'Elimu'}</div><div className="truncate text-[11.5px] text-white/70">Elimu{online ? '' : ' · offline'}</div></div>
            <NotificationBell base={base} notifications={notifications} />
            <button type="button" onClick={() => setAccount(true)} aria-label="Account menu" aria-haspopup="dialog" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold active:bg-white/20">{schoolInitials(user?.name)}</button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#E3E8DF] bg-white md:flex xl:w-[264px]">
            <div className="flex-1 overflow-y-auto px-3 py-4">
              {groups.map((g) => (
                <nav key={g.key} aria-label={g.label || 'Main'} className={g.label ? 'mt-6' : ''}>
                  {g.label && <div className="mb-2 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#9AA69C]">{g.label}</div>}
                  <div className="space-y-1">{g.items.map((n) => <SidebarLink key={n.key} item={n} base={base} active={active?.key === n.key} />)}</div>
                </nav>
              ))}
            </div>
            <div className="border-t border-[#EDF0E9] p-3">
              {pinned.map((n) => <SidebarLink key={n.key} item={n} base={base} active={active?.key === n.key} />)}
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#F7F8F4] px-3 py-2.5 text-[11px] font-medium text-[#758177]">
                {online ? <Wifi size={15} className="text-[#27834E]" /> : <WifiOff size={15} className="text-[#B7791F]" />}<span>{online ? 'Connected' : 'Offline mode'}</span>
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="mx-auto min-h-full w-full max-w-[1600px] px-3 pb-6 pt-3 sm:px-5 sm:pt-5 xl:px-7">
                <OfflineBanner online={online} />
                <Suspense fallback={<LoadingState label="Loading school workspace…" />}><Outlet /></Suspense>
              </div>
            </main>
            <nav aria-label="School tabs" className="grid shrink-0 border-t border-[#E3DBB8] bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, tabs.length + (rest.length ? 1 : 0))}, minmax(0, 1fr))` }}>
              {tabs.map((n) => {
                const Icon = iconFor(n.key); const on = active?.key === n.key;
                return (
                  <NavLink key={n.key} to={navHref(n, base)} end={n.to === ''} aria-current={on ? 'page' : undefined} className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
                    <span className={`flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-[#E4F0E8]' : ''}`}><Icon size={20} strokeWidth={on ? 2.4 : 2} /></span>{n.label}
                  </NavLink>
                );
              })}
              {rest.length > 0 && (
                <button type="button" onClick={() => setMore(true)} aria-expanded={more} className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${moreActive ? 'text-[#1F6B45]' : 'text-[#6F7461]'}`}>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreActive ? 'bg-[#E4F0E8]' : ''}`}><LayoutGrid size={20} /></span>More
                </button>
              )}
            </nav>
          </div>
        </div>

        {more && (
          <AppSheet title="More" onClose={() => setMore(false)}>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4 pt-2">
              {rest.map((n) => { const Icon = iconFor(n.key); return (
                <button key={n.key} type="button" onClick={() => go(navHref(n, base))} className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E3DBB8] bg-[#FBF8EA] px-1 py-3 text-xs font-semibold text-[#23382B] active:bg-[#EFE8C8]">
                  <Icon size={22} className="text-[#1F6B45]" />{n.label}
                </button>); })}
            </div>
          </AppSheet>
        )}

        {account && (
          <AppSheet title="Account" onClose={() => setAccount(false)}>
            <div className="px-4 pb-4">
              <div className="flex items-center gap-3 py-2">
                <Logo url={logo} name={school?.name} size={44} />
                <div className="min-w-0"><div className="truncate font-bold">{user?.name || 'Signed in'}</div><div className="truncate text-sm text-[#5A6B5E]">{[user?.roleLabel, school?.name].filter(Boolean).join(' · ')}</div>{school?.code && <div className="text-xs text-[#8A9A8D]">School code {school.code}</div>}</div>
              </div>
              {homeHref && <button type="button" onClick={() => { setAccount(false); nav(homeHref); }} aria-label="Umova home" className="mt-2 flex h-12 w-full items-center gap-3 rounded-2xl border border-[#E3DBB8] px-4 font-semibold"><HomeIcon size={18} />Umova home</button>}
              <button type="button" onClick={() => { setAccount(false); session.signOut(); }} aria-label="Sign out" className="mt-2 flex h-12 w-full items-center gap-3 rounded-2xl border border-[#12261F] px-4 font-semibold text-[#12261F]"><LogOut size={18} />Sign out</button>
            </div>
          </AppSheet>
        )}
      </div>
    </ShellCtx.Provider>
  );
}
