// ELIMU as its own app inside Umova:  <Route path="/school/*" element={<ElimuApp />} />   (see App.js)
// Same sign-in as "My Business" (POSAuthProvider -> POSAuthGate -> app lock), so a school signs in with its business account.
// Phone-first shell: fixed top app bar, ONE scrolling area, bottom tab bar (in ElimuLayout). Registers every Elimu module once.
import React, { Suspense, useEffect } from 'react';
import { Route, Navigate, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, LayoutGrid, Home as HomeIcon } from 'lucide-react';
import { POSAuthProvider, AppLock, supabase, usePosErpAuth } from './services/platform.js';
import ElimuAuthGate from './auth/ElimuAuthGate.jsx';
import { seedDemoSchoolIfEmpty } from './auth/demo.js';
import ElimuRoutes from './routes.jsx';
import { registerModule } from './registry.js';
import { elimuAcademicNested } from './routes.academic.jsx';
import { attendanceLayoutRoute } from './routes.attendance.jsx';
import { elimuFinanceRoutes, FinanceHub } from './finance/ElimuFinanceRoutes.jsx';
import ThemeSwitcher from './theme/ThemeSwitcher.jsx';
import { ElimuThemeProvider, ElimuShellContext } from './theme/useElimuTheme.jsx';

export const ELIMU_BASE = '/school';

// One registration per module. `key` decides which school tab shows; routes are mounted under the school shell.
registerModule({ key: 'academics', routes: [React.cloneElement(elimuAcademicNested, { key: 'academics' })] });
registerModule({ key: 'attendance', routes: [React.cloneElement(attendanceLayoutRoute, { key: 'attendance' })] });
registerModule({ key: 'timetable', routes: [] });      // pages ship with the attendance group above
registerModule({ key: 'calendar', routes: [] });
registerModule({ key: 'rooms', routes: [] });      // pages ship with the attendance group above
registerModule({ key: 'gate', routes: [] });
registerModule({ key: 'reports', routes: [] });
registerModule({ key: 'fees', routes: [
  React.cloneElement(elimuFinanceRoutes(), { key: 'finance' }),
  <Route key="finance-hub" path="finance/*" element={<FinanceHub basePath={ELIMU_BASE} />} />,
  <Route key="fees" path="fees" element={<Navigate to="../finance" replace />} />,
] });

const CSS = `
.elimu-app{-webkit-tap-highlight-color:transparent;touch-action:manipulation;overscroll-behavior:none;-webkit-text-size-adjust:100%}
.elimu-app input,.elimu-app select,.elimu-app textarea{font-size:16px}           /* stops the phone zooming in on every field */
.elimu-app button,.elimu-app a{-webkit-user-select:none;user-select:none}
.elimu-app *{scrollbar-width:thin}
`;

function ElimuLock({ children }) {
  const { logout } = usePosErpAuth();
  return <AppLock service="business" client={supabase} onSignOut={logout}>{children}</AppLock>;
}

function Shell() {
  const { tenant, staffName, logout } = usePosErpAuth(); const nav = useNavigate();
  useEffect(() => { seedDemoSchoolIfEmpty(tenant).then((r) => { if (r?.seeded) window.location.reload(); }); }, [tenant?.id]);   // demo school only; the database refuses any other school
  return (
    <ElimuThemeProvider tenantId={tenant?.id}><ElimuShellContext.Provider value={true}>
    <div className="elimu-app fixed inset-0 flex flex-col bg-[#FBF8EA] text-[#23382B]" style={{ height: '100dvh' }}>
      <style>{CSS}</style>
      <header className="shrink-0 bg-[#12261F] text-white pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3 px-3 h-14">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C9A227] text-[#12261F]"><GraduationCap size={20} /></span>
          <div className="min-w-0 flex-1 leading-tight"><div className="font-bold text-[15px]">Elimu</div><div className="text-[11.5px] text-white/70 truncate">{tenant?.business_name || staffName || ''}</div></div>
          <ThemeSwitcher tone="dark" />
          <nav aria-label="Account and apps" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <button type="button" onClick={() => nav(`${ELIMU_BASE}/menu`)} title="All menu: every page in Elimu" className="hidden md:inline-flex items-center gap-2 h-10 px-3.5 rounded-full text-[13px] font-semibold bg-white/10 hover:bg-white/20 active:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><LayoutGrid size={17} aria-hidden="true" />All menu</button>
            <button type="button" onClick={() => nav('/')} aria-label="Back to Umova home" title="Leave Elimu and go to the Umova home screen" className="inline-flex items-center gap-2 h-10 min-w-10 justify-center px-2.5 sm:px-3.5 rounded-full text-[13px] font-semibold bg-white/10 hover:bg-white/20 active:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><HomeIcon size={17} aria-hidden="true" /><span className="hidden sm:inline">Umova home</span></button>
            <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/25" />
            <button type="button" onClick={logout} aria-label="Sign out" title="Sign out of Elimu" className="inline-flex items-center gap-2 h-10 min-w-10 justify-center px-2.5 sm:px-3.5 rounded-full text-[13px] font-semibold border border-[#FF9D8F]/60 text-[#FFD5CE] hover:bg-[#FF9D8F]/20 active:bg-[#FF9D8F]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD5CE]"><LogOut size={17} aria-hidden="true" /><span className="hidden sm:inline">Sign out</span></button>
          </nav>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}><ElimuRoutes basePath={ELIMU_BASE} /></Suspense>
      </div>
    </div>
    </ElimuShellContext.Provider></ElimuThemeProvider>
  );
}

export default function ElimuApp() {
  return (
    <POSAuthProvider>
      <ElimuAuthGate><ElimuLock><Shell /></ElimuLock></ElimuAuthGate>
    </POSAuthProvider>
  );
}
