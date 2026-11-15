// elimu/shared/utils/access.js -- Elimu roles and their actions (UNIFIED install).
// MUST equal elimu_role_actions() in schema/elimu_000_core.sql. schema/role_actions.snapshot.json is generated from the database;
// tests/elimu_utils.test.mjs compares this file to it, and tests/unified_tests.sql compares the database to it. This only decides what to SHOW.
export const ROLES = [
  { key: 'school_admin', label: 'School administrator' },
  { key: 'principal', label: 'Principal' },
  { key: 'deputy', label: 'Deputy headteacher' },
  { key: 'headteacher', label: 'Headteacher' },
  { key: 'academic_admin', label: 'Academic administrator' },
  { key: 'exams_officer', label: 'Exams officer' },
  { key: 'class_teacher', label: 'Class teacher' },
  { key: 'subject_teacher', label: 'Subject teacher' },
  { key: 'attendance_officer', label: 'Attendance officer' },
  { key: 'registrar', label: 'Registrar / admissions' },
  { key: 'secretary', label: 'Secretary / front office' },
  { key: 'bursar', label: 'Bursar' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'cashier', label: 'Cashier' },
  { key: 'auditor', label: 'Auditor (read-only finance)' },
  { key: 'staff', label: 'Authorised staff' },
];
export const ROLE_ACTIONS = {
  staff: ['calendar.view', 'timetable.view'],
  bursar: ['enrollment.view', 'finance.approve', 'finance.audit', 'finance.bill', 'finance.collect', 'finance.expense', 'finance.reconcile', 'finance.report', 'finance.view', 'guardians.view', 'structure.view', 'students.view'],
  deputy: ['absence.approve', 'absence.manage', 'academic.access', 'admissions.manage', 'admissions.view', 'assessment.create', 'assessment.lock', 'attendance.amend', 'attendance.take_any', 'attendance.take_own', 'attendance.view_all', 'calendar.manage', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.manage', 'enrollment.view', 'guardians.manage', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'reportcard.review', 'reports.view', 'results.compute', 'roles.view', 'structure.view', 'students.care', 'students.manage', 'students.view', 'timetable.manage', 'timetable.override', 'timetable.view', 'view.all'],
  auditor: ['finance.audit', 'finance.report', 'finance.view', 'reports.view', 'structure.view', 'students.view'],
  cashier: ['enrollment.view', 'finance.collect', 'finance.view', 'structure.view', 'students.view'],
  principal: ['absence.approve', 'absence.manage', 'academic.access', 'admissions.decide', 'admissions.manage', 'admissions.view', 'assessment.create', 'assessment.lock', 'attendance.amend', 'attendance.take_any', 'attendance.take_own', 'attendance.view_all', 'calendar.manage', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'config.manage', 'enrollment.manage', 'enrollment.view', 'finance.approve', 'finance.audit', 'finance.configure', 'finance.report', 'finance.view', 'guardians.manage', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'remarks.head', 'reportcard.approve', 'reportcard.correct', 'reportcard.publish', 'reportcard.review', 'reports.view', 'results.compute', 'roles.view', 'settings.manage', 'structure.manage', 'structure.view', 'students.care', 'students.manage', 'students.view', 'timetable.manage', 'timetable.override', 'timetable.view', 'view.all'],
  registrar: ['admissions.decide', 'admissions.manage', 'admissions.view', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.manage', 'enrollment.view', 'guardians.manage', 'guardians.view', 'structure.manage', 'structure.view', 'students.care', 'students.manage', 'students.view'],
  secretary: ['admissions.manage', 'admissions.view', 'calendar.manage', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.view', 'guardians.manage', 'guardians.view', 'structure.view', 'students.manage', 'students.view'],
  accountant: ['enrollment.view', 'finance.audit', 'finance.expense', 'finance.reconcile', 'finance.report', 'finance.view', 'structure.view', 'students.view'],
  headteacher: ['absence.approve', 'absence.manage', 'academic.access', 'admissions.decide', 'admissions.manage', 'admissions.view', 'assessment.create', 'assessment.lock', 'attendance.amend', 'attendance.take_any', 'attendance.take_own', 'attendance.view_all', 'calendar.manage', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'config.manage', 'enrollment.manage', 'enrollment.view', 'finance.report', 'finance.view', 'guardians.manage', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'remarks.head', 'reportcard.approve', 'reportcard.correct', 'reportcard.publish', 'reportcard.review', 'reports.view', 'results.compute', 'roles.view', 'settings.manage', 'structure.manage', 'structure.view', 'students.care', 'students.manage', 'students.view', 'timetable.manage', 'timetable.override', 'timetable.view', 'view.all'],
  school_admin: ['absence.approve', 'absence.manage', 'academic.access', 'admissions.decide', 'admissions.manage', 'admissions.view', 'assessment.create', 'assessment.lock', 'attendance.amend', 'attendance.take_any', 'attendance.take_own', 'attendance.view_all', 'calendar.manage', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'config.manage', 'enrollment.manage', 'enrollment.view', 'finance.configure', 'finance.report', 'finance.view', 'guardians.manage', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'reportcard.approve', 'reportcard.publish', 'reportcard.review', 'reports.view', 'results.compute', 'roles.view', 'settings.manage', 'structure.manage', 'structure.view', 'students.care', 'students.manage', 'students.view', 'timetable.manage', 'timetable.override', 'timetable.view', 'view.all'],
  class_teacher: ['absence.manage', 'academic.access', 'assessment.create', 'attendance.take_own', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.view', 'guardians.view', 'marks.enter', 'structure.view', 'students.view', 'timetable.view'],
  exams_officer: ['academic.access', 'admissions.view', 'assessment.create', 'assessment.lock', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.view', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'reportcard.review', 'results.compute', 'structure.view', 'students.view', 'timetable.view', 'view.all'],
  academic_admin: ['academic.access', 'admissions.view', 'assessment.create', 'assessment.lock', 'attendance.view_all', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'config.manage', 'enrollment.view', 'guardians.view', 'marks.enter', 'marks.manage_all', 'marks.unlock', 'reportcard.approve', 'reportcard.publish', 'reportcard.review', 'reports.view', 'results.compute', 'structure.view', 'students.view', 'timetable.view', 'view.all'],
  subject_teacher: ['academic.access', 'assessment.create', 'attendance.take_own', 'calendar.view', 'comm.send', 'enrollment.view', 'marks.enter', 'structure.view', 'students.view', 'timetable.view'],
  attendance_officer: ['absence.manage', 'admissions.view', 'attendance.take_any', 'attendance.take_own', 'attendance.view_all', 'calendar.view', 'comm.send', 'comms.history', 'comms.send', 'enrollment.view', 'guardians.view', 'reports.view', 'structure.view', 'students.view', 'timetable.view'],
};
export function actionsForRoles(roles = [], isOwner = false) {
  const s = new Set();
  if (isOwner) { ['school_admin', 'principal', 'bursar'].forEach((r) => ROLE_ACTIONS[r].forEach((a) => s.add(a))); s.add('roles.manage'); return s; }
  roles.forEach((r) => (ROLE_ACTIONS[r] || []).forEach((a) => s.add(a))); return s;
}
