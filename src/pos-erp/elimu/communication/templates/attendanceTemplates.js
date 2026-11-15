// elimu/communication/templates/attendanceTemplates.js -- default wording (editable before sending; a school may save its own).
export const ATTENDANCE_PURPOSES = {
  ABSENT: 'ELIMU_ATTENDANCE_ABSENT', LATE: 'ELIMU_ATTENDANCE_LATE', LEFT_EARLY: 'ELIMU_ATTENDANCE_LEFT_EARLY',
  REPEATED_ABSENCE: 'ELIMU_ATTENDANCE_REPEATED', CORRECTION: 'ELIMU_ATTENDANCE_CORRECTION', CONCERN: 'ELIMU_ATTENDANCE_CONCERN',
};
export const PURPOSE_LABELS = { ABSENT: 'Absent today', LATE: 'Arrived late', LEFT_EARLY: 'Left early', REPEATED_ABSENCE: 'Repeated absence', CORRECTION: 'Attendance corrected', CONCERN: 'Attendance concern' };

export const ATTENDANCE_TEMPLATES = {
  ABSENT: 'Dear {{guardian_name}}, {{student_name}} was marked absent from school today, {{attendance_date}}. Please contact {{school_name}} if you have already notified the school.',
  LATE: 'Dear {{guardian_name}}, {{student_name}} ({{class_name}} {{stream_name}}) arrived late at {{arrival_time}} on {{attendance_date}}, {{late_minutes}} minutes after the start of school. Regards, {{school_name}}.',
  LEFT_EARLY: 'Dear {{guardian_name}}, {{student_name}} left school early on {{attendance_date}}. Reason noted: {{reason}}. Please contact {{school_name}} if you have any questions.',
  REPEATED_ABSENCE: 'Dear {{guardian_name}}, {{student_name}} ({{admission_number}}, {{class_name}} {{stream_name}}) has been absent from school several times recently, most recently on {{attendance_date}}. We would like to understand how we can help. Please contact {{school_name}}.',
  CORRECTION: 'Dear {{guardian_name}}, we have corrected the attendance record for {{student_name}} on {{attendance_date}}. Our earlier message may no longer apply. Sorry for the confusion. {{school_name}}.',
  CONCERN: 'Dear {{guardian_name}}, we would like to talk to you about {{student_name}}\'s attendance ({{class_name}} {{stream_name}}). Please contact {{school_name}} at your earliest convenience.',
};
export const EMAIL_SUBJECTS = {
  ABSENT: 'Attendance: {{student_name}} absent on {{attendance_date}}', LATE: 'Attendance: {{student_name}} arrived late on {{attendance_date}}',
  LEFT_EARLY: 'Attendance: {{student_name}} left early on {{attendance_date}}', REPEATED_ABSENCE: 'Attendance concern: {{student_name}}',
  CORRECTION: 'Attendance corrected: {{student_name}}', CONCERN: 'Attendance concern: {{student_name}}',
};
