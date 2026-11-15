// elimu/ElimuHost.jsx -- the ONE entry point the POS app mounts:   <Route path="elimu/*" element={<ElimuHost />} />   (-> /pos/elimu/...)
// It joins the four Elimu route sets that were built separately, without editing any of them:
//   students / guardians / admissions / classes / communication / settings  -> foundation routes (routes.jsx)
//   attendance, absences, reports, timetable, calendar, access              -> attendance + timetable routes (routes.attendance.jsx)
//   academics/...                                                           -> academic + exams + grading + report cards (pages used directly)
//   fees                                                                    -> sends to the fee screens at /pos/school-finance/... (mounted separately)
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ElimuRoutes from './routes.jsx';
import AttendanceRoutes from './routes.attendance.jsx';
import { registerModule } from './registry.js';
import AcademicHomePage from './academic/pages/AcademicHomePage';
import SubjectsPage from './academic/pages/SubjectsPage';
import AllocationsPage from './academic/pages/AllocationsPage';
import AcademicSetupPage from './academic/pages/AcademicSetupPage';
import AssessmentsPage from './exams/pages/AssessmentsPage';
import MarkEntryPage from './exams/pages/MarkEntryPage';
import GradingSchemesPage from './grading/pages/GradingSchemesPage';
import TermResultsPage from './report_cards/pages/TermResultsPage';
import ReportCardsPage from './report_cards/pages/ReportCardsPage';

export const ELIMU_BASE = '/pos/elimu';   // inside the POS menu; the stand-alone site (ElimuApp.jsx) passes base="/elimu"
const ATTENDANCE_SEGMENTS = ['attendance', 'absences', 'reports', 'timetable', 'calendar', 'access'];

// Makes the foundation's tab bar show the other modules (it only shows a tab once that module has registered).
['attendance', 'timetable', 'calendar', 'reports', 'academics', 'fees'].forEach((key) => registerModule({ key, routes: [] }));

export default function ElimuHost({ base = ELIMU_BASE, feesTo = '/pos/school-finance/collect' }) {
  const { pathname } = useLocation();
  const first = pathname.slice(base.length).replace(/^\//, '').split('/')[0];
  return (
    <Routes>
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
      <Route path="fees" element={<Navigate to={feesTo} replace />} />
      <Route path="*" element={ATTENDANCE_SEGMENTS.includes(first) ? <AttendanceRoutes /> : <ElimuRoutes basePath={base} />} />
    </Routes>
  );
}
