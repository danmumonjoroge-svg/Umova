// elimu/letters/services/letterService.js -- admission letters (elimu_1018). Wording is a template; the browser fills the placeholders.
import { rpc } from '../../shared/services/elimuDb';

export const LETTER_KINDS = { OFFER: 'Offer letter', JOINING: 'Joining instructions', WAITLIST: 'Waiting list letter', REJECTION: 'Regret letter' };
export const PLACEHOLDERS = ['school_name', 'student_name', 'guardian_name', 'class', 'academic_year', 'term', 'application_no', 'admission_no', 'admission_date', 'waitlist_part', 'reason_part', 'date'];
/** Which letters suit an application, by its decision category (mirrors the database rule). */
export function lettersFor(category) {
  return { ACCEPTED: ['OFFER'], ADMITTED: ['OFFER', 'JOINING'], WAITLISTED: ['WAITLIST'], REJECTED: ['REJECTION'] }[category] || [];
}
/** Replace {{name}} with the value; unknown names are left visible so the school notices a typo. */
export function fillLetter(text, fields) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (fields && fields[k] != null && fields[k] !== '' ? String(fields[k]) : (k in (fields || {}) ? '' : m)));
}
export function templateProblems(subject, body) {
  const p = [];
  if (String(subject || '').trim().length < 3) p.push('Give the letter a subject.');
  if (String(body || '').trim().length < 10) p.push('The letter is too short.');
  if (String(body || '').length > 8000) p.push('The letter is too long (8,000 characters at most).');
  return p;
}
export const letterService = {
  templates: () => rpc('elimu_letter_templates_get'),
  saveTemplate: (kind, subject, body) => rpc('elimu_letter_template_save', { p_kind: kind, p_subject: subject, p_body: body }),
  resetTemplate: (kind) => rpc('elimu_letter_template_save', { p_kind: kind, p_subject: null, p_body: null, p_reset: true }),
  preview: (app, kind) => rpc('elimu_letter_preview', { p_app: app, p_kind: kind }),
  issue: (app, kind) => rpc('elimu_letter_issue', { p_app: app, p_kind: kind }),
  issued: (app) => rpc('elimu_letters_issued_list', { p_app: app }),
};
