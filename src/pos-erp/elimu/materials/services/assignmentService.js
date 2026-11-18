// elimu/materials/services/assignmentService.js -- assignments and submissions (elimu_1012). Students have no login: parents hand in the child's work.
import { rpc } from '../../shared/services/elimuDb';
import { posSupabase } from '../../../services/posSupabaseClient';
import { uploadFile, openFile } from '../../shared/services/fileStorage.js';

export const SUB_LABEL = { MISSING: 'Not handed in', SUBMITTED: 'Handed in', MARKED: 'Marked' };
/** datetime-local value -> ISO with the browser's time zone. */
export const dueIso = (local) => (local ? new Date(local).toISOString() : null);
export function assignmentProblems({ title, due, maxMarks }) {
  const p = [];
  if (String(title || '').trim().length < 2) p.push('Give the assignment a title.');
  if (!due || new Date(due) <= new Date()) p.push('Choose a deadline in the future.');
  if (maxMarks !== '' && maxMarks != null && !(Number(maxMarks) > 0)) p.push('Marks out of must be more than zero.');
  return p;
}
export const assignmentService = {
  list: () => rpc('elimu_assignment_list'),
  submissions: (id) => rpc('elimu_submission_list', { p_assignment: id }),
  mark: (submissionId, marks, comment) => rpc('elimu_submission_mark', { p_submission: submissionId, p_marks: marks === '' || marks == null ? null : Number(marks), p_comment: comment || null }),
  close: (id, reopen) => rpc('elimu_assignment_close', { p_assignment: id, p_reopen: !!reopen }),
  remove: (id, reason) => rpc('elimu_assignment_remove', { p_assignment: id, p_reason: reason || null }),
  async create({ scope, title, instructions, due, maxMarks, file }) {
    const r = await rpc('elimu_assignment_prepare', { p_class: scope.class_id, p_stream: scope.stream_id || null, p_subject: scope.subject_id, p_title: title, p_instructions: instructions || null, p_due: dueIso(due), p_max_marks: maxMarks === '' ? null : Number(maxMarks), p_file_name: file ? file.name : null, p_mime: file ? file.type || null : null, p_size: file ? file.size : null });
    if (r.needs_upload) { await uploadFile(posSupabase, r.path, file); return rpc('elimu_assignment_confirm', { p_assignment: r.assignment_id }); }
    return r;
  },
  open: (path, name) => openFile(posSupabase, path, name),
};
