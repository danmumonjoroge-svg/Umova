// The 15 reasons a school contacts a guardian. A message is always created FOR A PURPOSE: the purpose picks the template,
// the tone, which merge fields exist and whether it may override an opt-out (emergency only).
// Purposes are stored on lb_communication_log.purpose and elimu_message_links.purpose with the ELIMU_ prefix.
// Later modules (attendance, fees, exams, timetable...) add their own purposes through registerPurpose() — they never edit this file.

const BASE = [
  { key: 'ELIMU_ADMISSION_RECEIVED',        label: 'Application received',        group: 'Admissions', fields: ['guardian_name', 'student_name', 'application_no', 'school_name'] },
  { key: 'ELIMU_ADMISSION_UPDATE',          label: 'Application update',          group: 'Admissions', fields: ['guardian_name', 'student_name', 'application_no', 'school_name', 'outcome'] },
  { key: 'ELIMU_ADMISSION_OFFER',           label: 'Offer of a place',            group: 'Admissions', fields: ['guardian_name', 'student_name', 'class_name', 'school_name', 'reply_by'] },
  { key: 'ELIMU_WELCOME',                   label: 'Welcome to the school',       group: 'Admissions', fields: ['guardian_name', 'student_name', 'admission_no', 'class_name', 'school_name'] },
  { key: 'ELIMU_ENROLLMENT_CONFIRMATION',   label: 'Enrolment confirmation',      group: 'Enrolment',  fields: ['guardian_name', 'student_name', 'class_name', 'academic_year', 'school_name'] },
  { key: 'ELIMU_DATA_UPDATE_REQUEST',       label: 'Please confirm your details', group: 'Records',    fields: ['guardian_name', 'student_name', 'school_name'] },
  { key: 'ELIMU_GENERAL_NOTICE',            label: 'General notice',              group: 'General',    fields: ['guardian_name', 'student_name', 'school_name', 'message'] },
  { key: 'ELIMU_EVENT_REMINDER',            label: 'Event reminder',              group: 'General',    fields: ['guardian_name', 'student_name', 'event_name', 'event_date', 'school_name'] },
  { key: 'ELIMU_MEETING_REQUEST',           label: 'Meeting request',             group: 'General',    fields: ['guardian_name', 'student_name', 'meeting_date', 'school_name'] },
  { key: 'ELIMU_CLASS_NOTICE',              label: 'Class notice',                group: 'General',    fields: ['guardian_name', 'student_name', 'class_name', 'message', 'school_name'] },
  { key: 'ELIMU_HEALTH_NOTICE',             label: 'Health / welfare notice',     group: 'Welfare',    fields: ['guardian_name', 'student_name', 'message', 'school_name'] },
  { key: 'ELIMU_ABSENCE_FOLLOWUP',          label: 'Absence follow-up',           group: 'Attendance', fields: ['guardian_name', 'student_name', 'date', 'school_name'] },
  { key: 'ELIMU_FEE_REMINDER',              label: 'Fee reminder',                group: 'Fees',       fields: ['guardian_name', 'student_name', 'amount', 'due_date', 'school_name'] },
  { key: 'ELIMU_RESULTS_AVAILABLE',         label: 'Results available',           group: 'Academics',  fields: ['guardian_name', 'student_name', 'term_name', 'school_name'] },
  { key: 'ELIMU_EMERGENCY',                 label: 'Emergency',                   group: 'Welfare',    fields: ['guardian_name', 'student_name', 'message', 'school_name'], emergency: true },
];

const registry = new Map(BASE.map((p) => [p.key, p]));

export const PURPOSES = () => [...registry.values()];
export const getPurpose = (key) => registry.get(key) || null;
export const isEmergency = (key) => !!registry.get(key)?.emergency;

/** For future Elimu modules. The key must start with ELIMU_ (the database refuses anything else). */
export function registerPurpose(p) {
  if (!p?.key || !/^ELIMU_[A-Z0-9_]+$/.test(p.key)) throw new Error('A purpose key must look like ELIMU_SOMETHING.');
  if (registry.has(p.key)) throw new Error(`Purpose ${p.key} is already registered.`);
  registry.set(p.key, { group: 'Other', fields: ['guardian_name', 'student_name', 'school_name'], ...p });
}
