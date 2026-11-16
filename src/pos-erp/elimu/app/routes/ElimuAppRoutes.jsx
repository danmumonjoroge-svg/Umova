// elimu/app/routes/ElimuAppRoutes.jsx -- the Elimu route tree, relative to the mount point (host: <Route path="/school/*" element={<ElimuApp />} />).
// By the time it renders, ElimuAuthGate has already admitted an authenticated ElimuSession.
//   (shell)            app bar, menu, bell, account menu, one scrolling area
//     login, register  sign-in lives in the gate, so these only forward to the dashboard
//     dashboard        alias of the base path
//     notifications    all notifications
//     settings/*       THE single Settings module (hub + sections)
//     *                foundation + every registered module (students, attendance, academics, finance, ...) -- routes.jsx + registry.js
import React, { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ElimuRoutes from '../../routes.jsx';
import { useElimuSession } from '../auth/ElimuAuthContext.jsx';
import ElimuShell from '../shell/ElimuShell.jsx';
import NotificationsPage from '../notifications/NotificationsPage.jsx';
import ElimuSettingsHub from '../settings/ElimuSettingsHub.jsx';
import { seedDemoSchoolIfEmpty } from '../../auth/demo.js';

/** Demo school only (the database refuses every other school): fill it once, then reload so the pages show the sample data. */
function DemoSeed() {
  const { school } = useElimuSession();
  useEffect(() => { seedDemoSchoolIfEmpty({ business_code: school?.code }).then((r) => { if (r?.seeded) window.location.reload(); }); }, [school?.id, school?.code]);
  return null;
}

export default function ElimuAppRoutes({ base = '/school', homeHref = '/' }) {
  const home = <Navigate to={base} replace />;
  return (
    <>
      <DemoSeed />
      <Routes>
        <Route element={<ElimuShell base={base} homeHref={homeHref} />}>
          <Route path="login" element={home} />
          <Route path="register" element={home} />
          <Route path="dashboard" element={home} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings/*" element={<ElimuSettingsHub base={base} />} />
          <Route path="*" element={<ElimuRoutes basePath={base} bare />} />
        </Route>
      </Routes>
    </>
  );
}
