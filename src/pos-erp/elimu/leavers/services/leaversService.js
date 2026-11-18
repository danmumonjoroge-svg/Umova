// elimu/leavers/services/leaversService.js -- wrappers over elimu_1008_leavers.sql.
import { rpc } from '../../shared/services/elimuDb';
export const KINDS = [['TRANSFER', 'Transfer to another school'], ['WITHDRAWAL', 'Withdrawal'], ['GRADUATION', 'Graduation']];
export const KIND_LABEL = { TRANSFER: 'Transferred', WITHDRAWAL: 'Withdrawn', GRADUATION: 'Graduated' };
export const leaversService = {
  search: (q) => rpc('elimu_leaver_candidates', { p_search: q }),
  leave: ({ studentId, kind, date, reason, destination, confirmBalance = false }) => rpc('elimu_student_leave', { p_student: studentId, p_kind: kind, p_date: date, p_reason: reason || null, p_destination: destination || null, p_confirm_balance: confirmBalance }),
  reinstate: (studentId, note) => rpc('elimu_student_reinstate', { p_student: studentId, p_note: note || null }),
  list: (kind = null, year = null) => rpc('elimu_leavers_list', { p_kind: kind, p_year: year }),
};
/** What the form still needs before it can be sent (matches the database rules). */
export function leaveProblems({ studentId, kind, date, reason }, today = new Date().toISOString().slice(0, 10)) {
  const p = [];
  if (!studentId) p.push('Choose the student.');
  if (!kind) p.push('Choose what is happening.');
  if (!date) p.push('Enter the leaving date.'); else if (date > today) p.push('The leaving date must be today or earlier.');
  if (kind === 'WITHDRAWAL' && String(reason || '').trim().length < 3) p.push('Say why the student is withdrawing.');
  return p;
}
