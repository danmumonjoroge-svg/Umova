// elimu/app/navigation/settingsRegistry.js -- the catalog of sections inside the ONE Settings hub. Pure.
// This file owns label / description / required action. The SCREEN for a section is supplied by its module through
// registerModule({ key, settingsSections: [{ key, element, action? }] }), so a section only appears when its module is registered.
export const SETTINGS_SECTIONS = [
  { key: 'school',     label: 'School profile & setup', description: 'Academic years and terms, school switches, statuses and who may do what.', icon: 'school',   module: 'foundation', action: 'settings.manage' },
  { key: 'academic',   label: 'Academic setup',         description: 'Subjects, class levels, streams and how results are calculated.',        icon: 'academics', module: 'academics',  action: 'settings.manage' },
  { key: 'attendance', label: 'Attendance',             description: 'Registers, late and absence rules and who is notified.',                  icon: 'attendance', module: 'attendance', action: 'settings.manage' },
  { key: 'timetable',  label: 'Timetable',              description: 'Lesson periods, days and rooms.',                                         icon: 'timetable', module: 'timetable',  action: 'settings.manage' },
  { key: 'finance',    label: 'Fees & billing',         description: 'Fee structures, billing rules and payment set-up.',                       icon: 'fees',     module: 'fees',       action: 'finance.configure' },
  { key: 'users_roles', label: 'Users & roles',         description: 'Give staff an Elimu role and see what each role can do.',                 icon: 'shield',   module: 'attendance', action: 'settings.manage' },
];

/** Sections this person may open: module registered, action held, and the module actually supplied a screen (`supplied` = Set of section keys). */
export function visibleSettings({ can = () => false, modules = new Set(), supplied = new Set() } = {}) {
  return SETTINGS_SECTIONS.filter((s) => modules.has(s.module) && supplied.has(s.key) && can(s.action));
}
export const findSection = (key) => SETTINGS_SECTIONS.find((s) => s.key === key) || null;
