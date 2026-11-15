// elimu/navigation.js -- the Elimu module expressed in the same shape as an entry of navigation/navConfig.js (MODULE -> children).
// Not imported by POS code in this delivery. INTEGRATION.md shows how to spread it into MODULES when the school edition is switched on.
// `permsAny` uses Elimu action names (not POS permission keys): the owner always sees everything.
export const ELIMU_MODULE = {
  key: 'elimu', label: 'School', to: '/elimu/attendance', capability: 'school', optIn: true,
  children: [
    { to: '/elimu/attendance', label: 'Attendance today', permsAny: ['attendance.take_own', 'attendance.take_any', 'attendance.view_all'] },
    { to: '/elimu/attendance/take', label: 'Take attendance', permsAny: ['attendance.take_own', 'attendance.take_any'] },
    { to: '/elimu/absences', label: 'Absence follow-up', permsAny: ['absence.manage'] },
    { to: '/elimu/reports', label: 'Attendance reports', permsAny: ['reports.view'] },
    { to: '/elimu/timetable', label: 'Timetable', permsAny: ['timetable.view'] },
    { to: '/elimu/timetable/changes', label: 'Timetable changes', permsAny: ['timetable.view'] },
    { to: '/elimu/timetable/setup', label: 'Timetable setup', permsAny: ['timetable.manage'] },
    { to: '/elimu/calendar', label: 'School calendar', permsAny: ['calendar.view'] },
    { to: '/elimu/attendance/settings', label: 'Attendance settings', permsAny: ['settings.manage'] },
    { to: '/elimu/access', label: 'Access', permsAny: ['roles.view'] },
  ],
};
