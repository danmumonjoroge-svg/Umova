// ELIMU as its own app inside Umova:  <Route path="/school/*" element={<ElimuApp />} />   (see App.js; pass base="/elimu" if you mount it there)
//
//   POSAuthProvider                shared identity state machine (no UI)                         <- reused infrastructure
//     ElimuAuthProvider            builds the ElimuSession: school, user, role, permissions       (app/auth)
//       ElimuAuthGate              Elimu's own login / register / waiting / new-password screens  (auth/)
//         ElimuLock                inactivity PIN lock (shared security component)
//           ElimuAppRoutes         shell (app bar, menu, bell, account menu) + settings hub + notifications + every module   (app/)
//
// There is NO POS login or POS dashboard in this path. Every module registers itself once (below); later modules do the same via registerModule().
import React, { lazy } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { POSAuthProvider, AppLock, supabase } from './services/platform.js';
import ElimuAuthGate from './auth/ElimuAuthGate.jsx';
import { ElimuAuthProvider, useElimuSession } from './app/auth/ElimuAuthContext.jsx';
import ElimuAppRoutes from './app/routes/ElimuAppRoutes.jsx';
import { ElimuProvider } from './shared/hooks/ElimuContext';
import { registerModule } from './registry.js';
import { elimuAcademicNested } from './routes.academic.jsx';
import { attendanceLayoutRoute } from './routes.attendance.jsx';
import { elimuFinanceRoutes, FinanceHub } from './finance/ElimuFinanceRoutes.jsx';

export const ELIMU_BASE = '/school';

// Existing setup pages become SECTIONS of the ONE Settings hub (they keep their own deep links too: nothing is removed).
const SchoolSettings = lazy(() => import('./pages/ElimuSettingsPage.jsx'));
const AcademicSetup = lazy(() => import('./academic/pages/AcademicSetupPage'));
const AttendanceSettings = lazy(() => import('./attendance/pages/AttendanceSettingsPage'));
const TimetableSetup = lazy(() => import('./timetable/pages/TimetableSetupPage'));
const AccessPage = lazy(() => import('./shared/pages/AccessPage'));
const FeeSetup = lazy(() => import('./finance/pages/ElimuFeeSetupPage'));
const inAttendanceContext = (el) => <ElimuProvider>{el}</ElimuProvider>;     // these pages read the attendance-group context

// One registration per module. `key` decides which menu entries show; routes are mounted under the shell.
registerModule({ key: 'foundation', routes: [], settingsSections: [{ key: 'school', element: ({ base }) => <SchoolSettings basePath={base} />, action: 'settings.manage' }] });
registerModule({ key: 'academics', routes: [React.cloneElement(elimuAcademicNested, { key: 'academics' })], settingsSections: [{ key: 'academic', element: <AcademicSetup />, action: 'settings.manage' }] });
registerModule({ key: 'attendance', routes: [React.cloneElement(attendanceLayoutRoute, { key: 'attendance' })],
  settingsSections: [{ key: 'attendance', element: inAttendanceContext(<AttendanceSettings />), action: 'settings.manage' }, { key: 'users_roles', element: inAttendanceContext(<AccessPage />), action: 'settings.manage' }] });
registerModule({ key: 'timetable', routes: [], settingsSections: [{ key: 'timetable', element: inAttendanceContext(<TimetableSetup />), action: 'settings.manage' }] });   // pages ship with the attendance group
registerModule({ key: 'calendar', routes: [] });
registerModule({ key: 'rooms', routes: [] });      // pages ship with the attendance group above
registerModule({ key: 'gate', routes: [] });
registerModule({ key: 'reports', routes: [] });
registerModule({ key: 'fees', routes: [
  React.cloneElement(elimuFinanceRoutes(), { key: 'finance' }),
  <Route key="finance-hub" path="finance/*" element={<FinanceHub basePath={ELIMU_BASE} />} />,
  <Route key="fees" path="fees" element={<Navigate to="../finance" replace />} />,
], settingsSections: [{ key: 'finance', element: <FeeSetup />, action: 'finance.configure' }] });

/** Inactivity PIN lock is kept: it is shared security infrastructure, not POS UI. Signing out from it ends the Elimu session. */
function ElimuLock({ children }) {
  const { signOut } = useElimuSession();
  return <AppLock service="business" client={supabase} onSignOut={signOut}>{children}</AppLock>;
}

/** props: base (mount path, default '/school'), adapter (auth adapter; default = shared Umova identity), accessOverride (tests: skips the permissions fetch),
 *        homeHref (link back to the Umova home in the account menu; null hides it) */
export default function ElimuApp({ base = ELIMU_BASE, adapter, accessOverride, homeHref = '/' }) {
  return (
    <POSAuthProvider>
      <ElimuAuthProvider adapter={adapter} accessOverride={accessOverride}>
        <ElimuAuthGate><ElimuLock><ElimuAppRoutes base={base} homeHref={homeHref} /></ElimuLock></ElimuAuthGate>
      </ElimuAuthProvider>
    </POSAuthProvider>
  );
}
