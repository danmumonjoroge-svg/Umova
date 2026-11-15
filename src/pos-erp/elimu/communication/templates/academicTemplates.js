// elimu/communication/templates/academicTemplates.js
// Reusable academic message templates. NOT a messaging engine: it supplies WORDING + VARIABLES, and renders with the POS's own
// renderText() (same {{variable}} / {{variable?}} syntax as every other POS message). A school can override any wording in the
// EXISTING lb_communication_templates table (purpose = ELIMU_*); see academicCommService.saveBusinessTemplate().
// No page hard-codes message text: pages ask for a purpose and get a generated message the user may edit before sending.
import { renderText } from '../../../supabase/functions/_shared/comm/render.js';
import { findBusinessTemplate } from '../../../supabase/functions/_shared/comm/engine.js';

export const ACADEMIC_PURPOSES = [
  { key: 'ELIMU_RESULT_PUBLISHED',        label: 'Result published',        inputs: [] },
  { key: 'ELIMU_REPORT_CARD_AVAILABLE',   label: 'Report card available',   inputs: [] },
  { key: 'ELIMU_EXAM_REMINDER',           label: 'Examination reminder',    inputs: [{ key: 'exam_date', label: 'Exam date' }, { key: 'exam_notes', label: 'What to bring / notes', optional: true }] },
  { key: 'ELIMU_ACADEMIC_CONCERN',        label: 'Academic concern',        inputs: [{ key: 'concern_details', label: 'What is the concern?' }] },
  { key: 'ELIMU_PERFORMANCE_IMPROVEMENT', label: 'Performance improvement', inputs: [{ key: 'improvement_details', label: 'What improved?', optional: true }] },
  { key: 'ELIMU_PARENT_MEETING',          label: 'Parent meeting',          inputs: [{ key: 'meeting_date', label: 'Meeting date' }, { key: 'meeting_time', label: 'Time', optional: true }, { key: 'meeting_venue', label: 'Venue', optional: true }] },
  { key: 'ELIMU_ACADEMIC_ANNOUNCEMENT',   label: 'Academic announcement',   inputs: [{ key: 'announcement_text', label: 'Announcement' }] },
];
export const PURPOSE_BY_KEY = Object.fromEntries(ACADEMIC_PURPOSES.map((p) => [p.key, p]));

/** Friendly names shown to people editing wording ("[Student name]" instead of {{student_name}}). */
export const ACADEMIC_VARIABLE_LABELS = {
  guardian_name: 'Guardian name', student_name: 'Student name', admission_number: 'Admission number', class_name: 'Class', stream_name: 'Stream',
  subject_name: 'Subject', term_name: 'Term', academic_year: 'Academic year', exam_name: 'Exam name', result_date: 'Result date', school_name: 'School name',
  exam_date: 'Exam date', exam_notes: 'Notes', concern_details: 'Concern', improvement_details: 'Improvement', meeting_date: 'Meeting date', meeting_time: 'Time',
  meeting_venue: 'Venue', announcement_text: 'Announcement',
};

const SIGN = '\n{{school_name}}';
export const ACADEMIC_TEMPLATES = {
  ELIMU_RESULT_PUBLISHED: {
    SMS: { body: 'Dear {{guardian_name}}, {{student_name}} ({{admission_number}}, {{class_name}}) {{term_name}} {{academic_year}} results are ready. Please contact the school to view them.' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\n*{{student_name}}* ({{admission_number}}, {{class_name}} {{stream_name?}}) — the *{{term_name}} {{academic_year}}* results have been published.\nresult date: {{result_date?}}\n\nPlease contact the school to view them.' + SIGN },
    EMAIL: { subject: '{{student_name}}: {{term_name}} {{academic_year}} results published', body: 'Dear {{guardian_name}},\n\nThe {{term_name}} {{academic_year}} results for {{student_name}} ({{admission_number}}, {{class_name}} {{stream_name?}}) have been published.\n\nPlease contact the school to view them.\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_REPORT_CARD_AVAILABLE: {
    SMS: { body: 'Dear {{guardian_name}}, the {{term_name}} {{academic_year}} report card for {{student_name}} ({{class_name}}) is ready for collection.' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\nThe *{{term_name}} {{academic_year}}* report card for *{{student_name}}* ({{admission_number}}, {{class_name}} {{stream_name?}}) is ready.\n\nPlease collect it from the school office.' + SIGN },
    EMAIL: { subject: 'Report card ready: {{student_name}}, {{term_name}} {{academic_year}}', body: 'Dear {{guardian_name}},\n\nThe {{term_name}} {{academic_year}} report card for {{student_name}} ({{admission_number}}, {{class_name}}) is ready.\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_EXAM_REMINDER: {
    SMS: { body: 'Reminder: {{student_name}} ({{class_name}}) sits {{exam_name?}} on {{exam_date}}. {{exam_notes?}}' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\nA reminder that *{{student_name}}* ({{class_name}}) sits *{{exam_name?}}* on *{{exam_date}}*.\n{{exam_notes?}}' + SIGN },
    EMAIL: { subject: 'Exam reminder: {{student_name}}, {{exam_date}}', body: 'Dear {{guardian_name}},\n\n{{student_name}} ({{class_name}}) sits {{exam_name?}} on {{exam_date}}.\n{{exam_notes?}}\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_ACADEMIC_CONCERN: {
    SMS: { body: 'Dear {{guardian_name}}, we would like to discuss {{student_name}}\'s progress{{subject_name?}}. {{concern_details}} Please contact the school.' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\nWe have a concern about *{{student_name}}* ({{class_name}}) in {{subject_name?}}:\n{{concern_details}}\n\nPlease contact us so we can support {{student_name}} together.' + SIGN },
    EMAIL: { subject: 'Academic concern: {{student_name}}', body: 'Dear {{guardian_name}},\n\nWe would like to share a concern about {{student_name}} ({{admission_number}}, {{class_name}}) {{subject_name?}}.\n\n{{concern_details}}\n\nPlease contact the school so we can support {{student_name}} together.\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_PERFORMANCE_IMPROVEMENT: {
    SMS: { body: 'Dear {{guardian_name}}, good news: {{student_name}} ({{class_name}}) has shown improvement. {{improvement_details?}}' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\nGood news! *{{student_name}}* ({{class_name}}) has improved. {{improvement_details?}}\n\nThank you for your support.' + SIGN },
    EMAIL: { subject: 'Good progress: {{student_name}}', body: 'Dear {{guardian_name}},\n\n{{student_name}} ({{admission_number}}, {{class_name}}) has shown improvement. {{improvement_details?}}\n\nThank you for your support.\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_PARENT_MEETING: {
    SMS: { body: 'Dear {{guardian_name}}, you are invited to a meeting about {{student_name}} on {{meeting_date}} {{meeting_time?}} {{meeting_venue?}}.' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\nYou are invited to a meeting about *{{student_name}}*.\nDate: {{meeting_date}}\nTime: {{meeting_time?}}\nVenue: {{meeting_venue?}}' + SIGN },
    EMAIL: { subject: 'Parent meeting: {{student_name}}, {{meeting_date}}', body: 'Dear {{guardian_name}},\n\nYou are invited to a meeting about {{student_name}} on {{meeting_date}}.\nTime: {{meeting_time?}}\nVenue: {{meeting_venue?}}\n\nKind regards,\n{{school_name}}' },
  },
  ELIMU_ACADEMIC_ANNOUNCEMENT: {
    SMS: { body: '{{announcement_text}}' + SIGN },
    WHATSAPP: { body: 'Dear {{guardian_name}},\n\n{{announcement_text}}' + SIGN },
    EMAIL: { subject: 'Announcement from {{school_name}}', body: 'Dear {{guardian_name}},\n\n{{announcement_text}}\n\nKind regards,\n{{school_name}}' },
  },
};

/** Variables for one guardian + student. Anything unknown stays empty (a required one is then reported as missing, never invented). */
export function buildAcademicVars({ guardian, student, schoolName, term, academicYear, exam, subject, resultDate, extras = {} } = {}) {
  return {
    guardian_name: guardian?.full_name || guardian?.guardian_name, student_name: student?.full_name || student?.student_name, admission_number: student?.admission_number,
    class_name: student?.class_name, stream_name: student?.stream_name, subject_name: subject, term_name: term, academic_year: academicYear, exam_name: exam,
    result_date: resultDate, school_name: schoolName, ...extras,
  };
}

/**
 * Generate the message. `businessTemplates` = rows from commEngineService.listTemplates(): the school's own wording wins when it can be
 * fully filled in; otherwise the standard wording is used (and a warning says so). Returns { body, subject, missing, source, warnings }.
 */
export function composeAcademic({ purpose, channel, vars, businessTemplates = [] }) {
  const sys = ACADEMIC_TEMPLATES[purpose]?.[channel];
  if (!sys) return { body: '', subject: null, missing: [], source: null, warnings: [{ code: 'UNKNOWN_PURPOSE', message: 'Unknown message type.' }] };
  const warnings = []; const biz = findBusinessTemplate(businessTemplates, purpose, channel);
  const attempt = (t) => ({ body: renderText(t.body, vars, ACADEMIC_VARIABLE_LABELS), subject: channel === 'EMAIL' ? renderText(t.subject || '', vars, ACADEMIC_VARIABLE_LABELS) : null });
  let out = null; let source = 'SYSTEM'; let templateId = null;
  if (biz) {
    const r = attempt(biz); const miss = [...r.body.missing, ...(r.subject?.missing || [])];
    if (!miss.length) { out = r; source = 'BUSINESS'; templateId = biz.id || null; } else warnings.push({ code: 'TEMPLATE_FALLBACK', message: 'Your saved wording uses details that are not available here, so the standard wording was used.' });
  }
  if (!out) out = attempt(sys);
  return { body: out.body.text, subject: out.subject?.text ?? null, missing: [...out.body.missing, ...(out.subject?.missing || [])], source, templateId, warnings };
}
