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
import ImportStudentsPage from './import/pages/ImportStudentsPage.jsx';
import ImportLogPage from './import/pages/ImportLogPage.jsx';
import ImportBalancesPage from './import/pages/ImportBalancesPage.jsx';
import ImportResultsPage from './import/pages/ImportResultsPage.jsx';
import PromotionPage from './promotion/pages/PromotionPage.jsx';
import LeaversPage from './leavers/pages/LeaversPage.jsx';
import StudyMaterialsPage from './materials/pages/StudyMaterialsPage.jsx';
import AssignmentsPage from './materials/pages/AssignmentsPage.jsx';
import FileStoragePage from './storage/pages/FileStoragePage.jsx';
import ActivityLogPage from './audit/pages/ActivityLogPage.jsx';
import { useElimuAccess } from './hooks/useElimu.js';
import { moduleRoutes } from './registry.js';
import { ElimuAccessProvider } from './hooks/useElimu.js';
import RequireElimuAction from './components/RequireElimuAction.jsx';

// Route guard = the person's ELIMU role (elimu_my_access), not POS permission keys.
const AnyOf = ({ actions, children }) => { const { can, loaded } = useElimuAccess(); if (!loaded) return <div className="p-4 text-sm text-slate-500">Loading...</div>; if (!actions.some((a) => can(a))) return <div className="p-4 text-sm text-slate-600">You do not have access to this page. Ask the school owner to give you an Elimu role.</div>; return children; };
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
        <Route path="import/students" element={guard('students.manage', <ImportStudentsPage basePath={basePath} />)} />
        <Route path="import/balances" element={guard('finance.bill', <ImportBalancesPage basePath={basePath} />)} />
        <Route path="import/results" element={guard('marks.manage_all', <ImportResultsPage basePath={basePath} />)} />
        <Route path="promotion" element={guard('enrollment.manage', <PromotionPage />)} />
        <Route path="academics/materials" element={<AnyOf actions={['academic.access', 'marks.manage_all']}><StudyMaterialsPage /></AnyOf>} />
        <Route path="academics/assignments" element={<AnyOf actions={['academic.access', 'marks.manage_all']}><AssignmentsPage /></AnyOf>} />
        <Route path="file-storage" element={guard('settings.manage', <FileStoragePage />)} />
        <Route path="activity" element={guard('settings.manage', <ActivityLogPage />)} />
        <Route path="leavers" element={guard('students.manage', <LeaversPage />)} />
        <Route path="import/log" element={<AnyOf actions={['students.manage', 'finance.bill', 'marks.manage_all']}><ImportLogPage /></AnyOf>} />
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
