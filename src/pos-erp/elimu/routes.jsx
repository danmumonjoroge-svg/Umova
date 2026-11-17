// Route table for the Elimu module. Mount once in the host router:   <Route path="/elimu/*" element={<ElimuRoutes />} />
// Every route is wrapped in RequirePermission (display guard; the database still refuses data without the right).
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequirePermission } from './services/platform.js';
import ElimuLayout from './components/ElimuLayout.jsx';
import ElimuDashboard from './pages/ElimuDashboard.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import StudentProfilePage from './pages/StudentProfilePage.jsx';
import { GuardiansPage, GuardianProfilePage } from './pages/GuardiansPage.jsx';
import AdmissionsPage from './pages/AdmissionsPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import CommunicationPage from './pages/CommunicationPage.jsx';
import ElimuSettingsPage from './pages/ElimuSettingsPage.jsx';
import ElimuStaffPage from './pages/ElimuStaffPage.jsx';
import SchoolMenuPage from './pages/SchoolMenuPage.jsx';
import { moduleRoutes } from './registry.js';
import { ElimuAccessProvider } from './hooks/useElimu.js';
import RequireElimuAction from './components/RequireElimuAction.jsx';

// Route guard = the person's ELIMU role (elimu_my_access), not POS permission keys.
const guard = (action, el) => <RequireElimuAction action={action}>{el}</RequireElimuAction>;

export default function ElimuRoutes({ basePath = '/elimu', accessOverride }) {
  return (
    <ElimuAccessProvider value={accessOverride}>
    <Routes>
      <Route element={<ElimuLayout basePath={basePath} />}>
        <Route index element={guard('students.view', <ElimuDashboard basePath={basePath} />)} />
        <Route path="students" element={guard('students.view', <StudentsPage basePath={basePath} />)} />
        <Route path="students/:id" element={guard('students.view', <StudentProfilePage basePath={basePath} />)} />
        <Route path="guardians" element={guard('guardians.view', <GuardiansPage basePath={basePath} />)} />
        <Route path="guardians/:id" element={guard('guardians.view', <GuardianProfilePage basePath={basePath} />)} />
        <Route path="admissions" element={guard('admissions.view', <AdmissionsPage />)} />
        <Route path="classes" element={guard('structure.view', <ClassesPage basePath={basePath} />)} />
        <Route path="communication" element={guard('comms.history', <CommunicationPage basePath={basePath} />)} />
        <Route path="menu/*" element={<SchoolMenuPage basePath={basePath} />} />
        <Route path="staff" element={<ElimuStaffPage />} />
        <Route path="settings" element={guard('settings.manage', <ElimuSettingsPage />)} />
        {moduleRoutes()}
        <Route path="*" element={<Navigate to={basePath} replace />} />
      </Route>
    </Routes>
    </ElimuAccessProvider>
  );
}
