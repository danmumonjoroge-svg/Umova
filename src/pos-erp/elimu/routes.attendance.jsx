// elimu/routes.jsx -- ONE route group for the whole Elimu module. Not wired into the POS app by this delivery (the POS files are untouched):
// see INTEGRATION.md "Wiring" for the two-line change. Each page is guarded by Elimu actions; the database enforces the same rules.
import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ElimuProvider, RequireElimu } from './shared/hooks/ElimuContext';
import AttendanceDashboardPage from './attendance/pages/AttendanceDashboardPage';
import AttendanceTakePage from './attendance/pages/AttendanceTakePage';
import AbsenceCasesPage from './attendance/pages/AbsenceCasesPage';
import AttendanceReportsPage from './attendance/pages/AttendanceReportsPage';
import AttendanceSettingsPage from './attendance/pages/AttendanceSettingsPage';
import TimetablePage from './timetable/pages/TimetablePage';
import TimetableChangesPage from './timetable/pages/TimetableChangesPage';
import TimetableSetupPage from './timetable/pages/TimetableSetupPage';
import CalendarPage from './calendar/pages/CalendarPage';
import AccessPage from './shared/pages/AccessPage';
import GatePage from './gate/pages/GatePage.jsx';
import GatePassPage from './gate/pages/GatePassPage.jsx';
import GateExitLogPage from './gate/pages/GateExitLogPage.jsx';
import RoomsPage from './rooms/pages/RoomsPage.jsx';

const G = ({ any, children }) => <RequireElimu any={any}>{children}</RequireElimu>;

const ATT_ROUTES = (
  <>
    <Route path="attendance" element={<G any={['attendance.take_own', 'attendance.take_any', 'attendance.view_all']}><AttendanceDashboardPage /></G>} />
    <Route path="attendance/take" element={<G any={['attendance.take_own', 'attendance.take_any']}><AttendanceTakePage /></G>} />
    <Route path="absences" element={<G any={['absence.manage']}><AbsenceCasesPage /></G>} />
    <Route path="reports" element={<G any={['reports.view']}><AttendanceReportsPage /></G>} />
    <Route path="attendance/settings" element={<G any={['settings.manage', 'attendance.view_all']}><AttendanceSettingsPage /></G>} />
    <Route path="timetable" element={<G any={['timetable.view']}><TimetablePage /></G>} />
    <Route path="timetable/changes" element={<G any={['timetable.view']}><TimetableChangesPage /></G>} />
    <Route path="timetable/setup" element={<G any={['timetable.manage']}><TimetableSetupPage /></G>} />
    <Route path="calendar" element={<G any={['calendar.view']}><CalendarPage /></G>} />
    <Route path="gate" element={<G any={['attendance.take_any']}><GatePage /></G>} />
    <Route path="gate-exits" element={<G any={['attendance.view_all', 'attendance.take_any']}><GateExitLogPage /></G>} />
    <Route path="gate-passes" element={<G any={['attendance.take_own', 'attendance.take_any', 'attendance.view_all']}><GatePassPage /></G>} />
    <Route path="rooms" element={<G any={['timetable.view']}><RoomsPage /></G>} />
    <Route path="access" element={<G any={['roles.view']}><AccessPage /></G>} />
  </>
);

/** For the unified shell: a pathless layout route that supplies the attendance context, with the attendance/timetable/calendar pages
 *  as siblings of the school routes (so the pages' own '../absences' style links resolve).  Use:  {attendanceLayoutRoute} */
export const AttendanceContextLayout = () => <ElimuProvider><Outlet /></ElimuProvider>;
export const attendanceLayoutRoute = <Route element={<AttendanceContextLayout />}>{ATT_ROUTES}</Route>;

/** Stand-alone mount (old style):  <Route path="elimu/*" element={<ElimuRoutes />} />  inside the POS layout route. */
export default function ElimuRoutes() {
  return (
    <ElimuProvider>
      <Routes>
        <Route index element={<Navigate to="attendance" replace />} />
        {ATT_ROUTES}
        <Route path="*" element={<Navigate to="attendance" replace />} />
      </Routes>
    </ElimuProvider>
  );
}
