// elimu/communication/templates/timetableTemplates.js -- default wording for timetable change notices.
export const TIMETABLE_CHANGE_LABELS = {
  MOVED: 'Lesson moved', TEACHER_CHANGED: 'Teacher changed', ROOM_CHANGED: 'Classroom changed', CANCELLED: 'Lesson cancelled',
  REPLACEMENT_SCHEDULED: 'Replacement lesson', CREATED: 'New lesson', UPDATED: 'Lesson updated', RESTORED: 'Lesson restored',
};
// Variables: {{recipient_name}} {{school_name}} {{subject}} {{class_name}} {{day}} {{date}} {{old_time}} {{new_time}} {{old_teacher}} {{new_teacher}} {{old_room}} {{new_room}} {{reason}}
export const TIMETABLE_TEMPLATES = {
  MOVED: 'Dear {{recipient_name}}, the {{subject}} lesson for {{class_name}} has moved from {{old_time}} to {{new_time}} ({{day}}). {{reason}} {{school_name}}.',
  TEACHER_CHANGED: 'Dear {{recipient_name}}, {{subject}} for {{class_name}} on {{date}} will be taught by {{new_teacher}} instead of {{old_teacher}}. {{school_name}}.',
  ROOM_CHANGED: 'Dear {{recipient_name}}, {{subject}} for {{class_name}} on {{date}} ({{new_time}}) will be in {{new_room}} instead of {{old_room}}. {{school_name}}.',
  CANCELLED: 'Dear {{recipient_name}}, the {{subject}} lesson for {{class_name}} on {{date}} ({{old_time}}) is cancelled. Reason: {{reason}}. {{school_name}}.',
  REPLACEMENT_SCHEDULED: 'Dear {{recipient_name}}, a replacement {{subject}} lesson for {{class_name}} is scheduled on {{date}} at {{new_time}}. {{school_name}}.',
  CREATED: 'Dear {{recipient_name}}, a {{subject}} lesson for {{class_name}} has been added on {{day}} at {{new_time}}. {{school_name}}.',
  UPDATED: 'Dear {{recipient_name}}, the {{subject}} lesson for {{class_name}} on {{day}} has been updated. {{school_name}}.',
  RESTORED: 'Dear {{recipient_name}}, the {{subject}} lesson for {{class_name}} on {{day}} is back on the timetable. {{school_name}}.',
};
export const notifiesGuardians = (changeType) => ['CANCELLED', 'MOVED', 'REPLACEMENT_SCHEDULED'].includes(changeType); // teacher/room swaps normally concern staff only
