// elimu/routes.jsx — the ONLY thing the host app needs to mount the academic module.
// In POSApp.jsx (inside the existing <Routes>):   import { elimuAcademicRoutes } from './elimu/routes';   ...   {elimuAcademicRoutes}
// Paths are relative, like the POS's own routes, so they live under the same parent: /elimu, /elimu/subjects, ...
// Access is enforced by the database; each page also uses <AccessGate> for friendly messages (no change to ROUTE_PERMISSIONS needed).
import React from 'react';
import { Route } from 'react-router-dom';
import AcademicHomePage from './academic/pages/AcademicHomePage';
import SubjectsPage from './academic/pages/SubjectsPage';
import AllocationsPage from './academic/pages/AllocationsPage';
import AcademicSetupPage from './academic/pages/AcademicSetupPage';
import AssessmentsPage from './exams/pages/AssessmentsPage';
import MarkEntryPage from './exams/pages/MarkEntryPage';
import GradingSchemesPage from './grading/pages/GradingSchemesPage';
import TermResultsPage from './report_cards/pages/TermResultsPage';
import ReportCardsPage from './report_cards/pages/ReportCardsPage';

export const elimuAcademicRoutes = (
  <>
    <Route path="elimu" element={<AcademicHomePage />} />
    <Route path="elimu/subjects" element={<SubjectsPage />} />
    <Route path="elimu/allocations" element={<AllocationsPage />} />
    <Route path="elimu/setup" element={<AcademicSetupPage />} />
    <Route path="elimu/assessments" element={<AssessmentsPage />} />
    <Route path="elimu/my-assessments" element={<AssessmentsPage />} />
    <Route path="elimu/marks/:assessmentId" element={<MarkEntryPage />} />
    <Route path="elimu/grading" element={<GradingSchemesPage />} />
    <Route path="elimu/results" element={<TermResultsPage />} />
    <Route path="elimu/report-cards" element={<ReportCardsPage />} />
  </>
);

/** Entry for the host's navigation (navConfig MODULES). Shape matches the existing entries; adjust icon/label to taste. */
export const ELIMU_ACADEMIC_NAV = { key: 'elimu', label: 'Academics', path: 'elimu' };

/** Unified shell: nested under "academics" so the pages' relative links ('assessments', '../marks/:id', '../assessments') resolve. */
export const elimuAcademicNested = (
  <Route path="academics">
    <Route index element={<AcademicHomePage />} />
    <Route path="subjects" element={<SubjectsPage />} />
    <Route path="allocations" element={<AllocationsPage />} />
    <Route path="setup" element={<AcademicSetupPage />} />
    <Route path="assessments" element={<AssessmentsPage />} />
    <Route path="my-assessments" element={<AssessmentsPage />} />
    <Route path="marks/:assessmentId" element={<MarkEntryPage />} />
    <Route path="grading" element={<GradingSchemesPage />} />
    <Route path="results" element={<TermResultsPage />} />
    <Route path="report-cards" element={<ReportCardsPage />} />
  </Route>
);
