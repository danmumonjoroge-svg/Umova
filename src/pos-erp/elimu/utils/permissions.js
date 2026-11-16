// Elimu permissions (decision D2, Option A): every Elimu action is granted by an ELIMU ROLE (table elimu_staff_roles, schema/elimu_000_core.sql),
// never by a POS permission key. The database function elimu_can(action) decides; this file only decides what to SHOW.

export const ELIMU_ACTIONS = [
  'students.view','guardians.view','admissions.view','structure.view','enrollment.view','comms.history','comms.send',
  'students.manage','guardians.manage','admissions.manage','enrollment.manage','students.care',
  'structure.manage','admissions.decide','settings.manage',
];
// Route guards take a list of acceptable "keys"; for Elimu the key IS the action.
export const ACTION_MAP = Object.fromEntries(ELIMU_ACTIONS.map(a => [a, [a]]));

/** has: (action) => boolean, backed by elimu_my_access().actions. Unknown action: closed. */
export function canElimu(has, action) {
  if (!ACTION_MAP[action]) return false;
  return !!has(action);
}

/** School roles -> the Umova role template / overrides an owner should give them today. Documentation as data (shown in Settings). */
export const SCHOOL_ROLES = [
  { key: 'principal',     label: 'Principal / Head',      umovaRole: 'Elimu role', does: 'Everything, including admission decisions and school setup.' },
  { key: 'deputy',        label: 'Deputy head',           umovaRole: 'Elimu role',          does: 'Everything except changing the owner account.' },
  { key: 'registrar',     label: 'Registrar / Admissions',umovaRole: 'Elimu role', does: 'Students, guardians, applications, enrolment, messages. Cannot decide admissions or change setup.' },
  { key: 'secretary',     label: 'Secretary / Front office', umovaRole: 'Elimu role', does: 'Same as registrar; decisions need the principal.' },
  { key: 'teacher',       label: 'Class teacher',         umovaRole: 'Elimu role',           does: 'View students/guardians, contact guardians. Cannot edit records.' },
  { key: 'bursar',        label: 'Bursar / Accounts',     umovaRole: 'Elimu role',           does: 'Fees module (later). Elimu: view students and guardians.' },
  { key: 'parent',        label: 'Parent / Guardian',     umovaRole: 'Elimu role',                  does: 'Future parent portal. Not part of this module.' },
];

/** Roles an owner can give a member of staff in the Staff page (keys are the database role names). */
export const STAFF_ROLE_CHOICES = [
  { key: 'principal',          label: 'Principal',                 does: 'Everything, including admission decisions, school setup and finance approvals.' },
  { key: 'headteacher',        label: 'Head teacher',              does: 'Records, academics, attendance and results; can view finance.' },
  { key: 'deputy',             label: 'Deputy head',               does: 'Records, academics and attendance.' },
  { key: 'academic_admin',     label: 'Academic admin',            does: 'Classes, exams and results setup.' },
  { key: 'exams_officer',      label: 'Exams officer',             does: 'Exams, marks and results.' },
  { key: 'class_teacher',      label: 'Class teacher',             does: 'Own class: attendance, marks, messages to parents.' },
  { key: 'subject_teacher',    label: 'Subject teacher',           does: 'Marks for the subjects they teach, own attendance.' },
  { key: 'attendance_officer', label: 'Gate / security officer',   does: 'Gate check-in for every learner, and the live rooms view.' },
  { key: 'registrar',          label: 'Registrar',                 does: 'Students, guardians, applications and enrolment.' },
  { key: 'secretary',          label: 'Secretary',                 does: 'Same as registrar; decisions need the principal.' },
  { key: 'bursar',             label: 'Bursar',                    does: 'Fees, billing, collections and fee reports.' },
  { key: 'accountant',         label: 'Accountant',                does: 'Finance records and reports.' },
  { key: 'cashier',            label: 'Cashier',                   does: 'Collect fees only.' },
  { key: 'auditor',            label: 'Auditor',                   does: 'Read-only view of finance and records.' },
];

export const NAV_ITEMS = [
  { key: 'dashboard',     label: 'Dashboard',     to: '',               action: 'students.view',  owned: true },
  { key: 'students',      label: 'Students',      to: '/students',      action: 'students.view',  owned: true },
  { key: 'admissions',    label: 'Admissions',    to: '/admissions',    action: 'admissions.view', owned: true },
  { key: 'classes',       label: 'Classes',       to: '/classes',       action: 'structure.view', owned: true },
  { key: 'guardians',     label: 'Guardians',     to: '/guardians',     action: 'guardians.view', owned: true },
  { key: 'academics',     label: 'Academics',     to: '/academics',     action: 'structure.view', owned: false },
  { key: 'attendance',    label: 'Attendance',    to: '/attendance',    action: 'students.view',  owned: false },
  { key: 'timetable',     label: 'Timetable',     to: '/timetable',     action: 'structure.view', owned: false },
  { key: 'rooms',         label: 'Rooms',         to: '/rooms',         action: 'timetable.view', owned: false },
  { key: 'gate',          label: 'Gate',          to: '/gate',          action: 'attendance.take_any', owned: false },
  { key: 'fees',          label: 'Finance',       to: '/finance',       action: 'finance.view',   owned: false,
    anyOf: ['finance.view', 'finance.collect', 'finance.bill', 'finance.approve', 'finance.report', 'finance.configure'], also: ['/school-finance'] },
  { key: 'communication', label: 'Communication', to: '/communication', action: 'comms.history',  owned: true },
  { key: 'calendar',      label: 'Calendar',      to: '/calendar',      action: 'students.view',  owned: false },
  { key: 'reports',       label: 'Reports',       to: '/report-centre', action: 'students.view',  owned: false },
  { key: 'staff',         label: 'Staff',         to: '/staff',         action: 'students.view', owned: true, ownerOnly: true },
  { key: 'settings',      label: 'Settings',      to: '/settings',      action: 'settings.manage', owned: true },
];
