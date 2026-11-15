// ELIMU as its own app inside Umova:  <Route path="/school/*" element={<ElimuApp />} />   (see App.js)
// Same sign-in as "My Business" (POSAuthProvider -> POSAuthGate -> app lock), so a school signs in with its business account.
// Phone-first shell: fixed top app bar, ONE scrolling area, bottom tab bar (in ElimuLayout). Registers every Elimu module once.
import React, { Suspense } from 'react';
import { Route, Navigate, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, Home as HomeIcon } from 'lucide-react';
import { POSAuthProvider, POSAuthGate, AppLock, supabase, usePosErpAuth } from './services/platform.js';
import ElimuRoutes from './routes.jsx';
import { registerModule } from './registry.js';
import { elimuAcademicNested } from './routes.academic.jsx';
import { attendanceLayoutRoute } from './routes.attendance.jsx';
import { elimuFinanceRoutes } from './finance/ElimuFinanceRoutes.jsx';

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
  <Route key="fees" path="fees" element={<Navigate to="../school-finance/collect" replace />} />,
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
  return (
    <div className="elimu-app fixed inset-0 flex flex-col bg-[#FBF8EA] text-[#23382B]" style={{ height: '100dvh' }}>
      <style>{CSS}</style>
      <header className="shrink-0 bg-[#12261F] text-white pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3 px-3 h-14">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C9A227] text-[#12261F]"><GraduationCap size={20} /></span>
          <div className="min-w-0 flex-1 leading-tight"><div className="font-bold text-[15px]">Elimu</div><div className="text-[11.5px] text-white/70 truncate">{tenant?.business_name || staffName || ''}</div></div>
          <button type="button" onClick={() => nav('/')} aria-label="Umova home" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><HomeIcon size={19} /></button>
          <button type="button" onClick={logout} aria-label="Sign out" className="h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10"><LogOut size={19} /></button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}><ElimuRoutes basePath={ELIMU_BASE} /></Suspense>
      </div>
    </div>
  );
}

export default function ElimuApp() {
  return (
    <POSAuthProvider>
      <POSAuthGate><ElimuLock><Shell /></ElimuLock></POSAuthGate>
    </POSAuthProvider>
  );
}
