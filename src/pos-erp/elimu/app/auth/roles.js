// elimu/app/auth/roles.js -- the Elimu role vocabulary for display and normalising. Pure. The DATABASE decides what a role may do (elimu_my_access);
// this file only names roles. Keys come from utils/permissions.js so there is one list.
import { STAFF_ROLE_CHOICES } from '../../utils/permissions.js';

export const ELIMU_ROLES = STAFF_ROLE_CHOICES.map((r) => r.key);
const LABELS = Object.fromEntries(STAFF_ROLE_CHOICES.map((r) => [r.key, r.label]));
const ALIASES = { head_teacher: 'headteacher', head: 'headteacher', deputy_head: 'deputy', deputy_principal: 'deputy', gate_officer: 'attendance_officer', security: 'attendance_officer', gate: 'attendance_officer', teacher: 'subject_teacher', exam_officer: 'exams_officer', admin: 'academic_admin' };

/** 'Class Teacher' / 'class-teacher' -> 'class_teacher'; known aliases map to their key; unknown values come back normalised (never invented). '' for empty. */
export function normalizeRole(v) {
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[k] || k;
}
/** Readable label; owner is shown as 'School owner'; unknown roles are title-cased. */
export function roleLabel(v) {
  const k = normalizeRole(v);
  if (!k) return '';
  if (k === 'owner') return 'School owner';
  return LABELS[k] || k.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
