// elimu/report_cards/services/reportCardService.js — results, report cards, workflow, corrections, student history.
import { rpc } from '../../academic/services/rpc';

export const STATUS_LABEL = { DRAFT: 'Draft', REVIEW: 'In review', APPROVED: 'Approved', PUBLISHED: 'Published', SUPERSEDED: 'Replaced by correction' };
export const NEXT_ACTIONS = {   // what the UI offers per status; the database enforces who may do it
  DRAFT: [{ to: 'REVIEW', label: 'Send to review' }],
  REVIEW: [{ to: 'APPROVED', label: 'Approve' }, { to: 'DRAFT', label: 'Send back', needsReason: false }],
  APPROVED: [{ to: 'PUBLISHED', label: 'Publish' }, { to: 'REVIEW', label: 'Withdraw approval', needsReason: true }],
  PUBLISHED: [], SUPERSEDED: [] };

export const reportCardService = {
  computeResults: ({ yearId, termId, classId, streamId }) => rpc('elimu_compute_term_results', { p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId || null }),
  listResults: ({ yearId, termId, classId, streamId, search, page = 0, pageSize = 50 }) => rpc('elimu_list_term_results', { p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId || null, p_search: search || null, p_limit: pageSize, p_offset: page * pageSize }),
  generateCards: ({ yearId, termId, classId, streamId }) => rpc('elimu_generate_report_cards', { p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId || null }),
  listCards: ({ yearId, termId, classId, streamId, status, search, page = 0, pageSize = 50 }) => rpc('elimu_list_report_cards', { p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId || null, p_status: status || null, p_search: search || null, p_limit: pageSize, p_offset: page * pageSize }),
  saveClassTeacherRemarks: (cardId, text) => rpc('elimu_save_report_remarks', { p_card: cardId, p_class_teacher: text, p_head: null, p_set_ct: true, p_set_head: false }),
  saveHeadRemarks: (cardId, text) => rpc('elimu_save_report_remarks', { p_card: cardId, p_class_teacher: null, p_head: text, p_set_ct: false, p_set_head: true }),
  saveSubjectRemark: (subjectResultId, text) => rpc('elimu_save_subject_remark', { p_subject_result: subjectResultId, p_remark: text }),
  transition: (cardId, to, { reason, allowIncomplete = false } = {}) => rpc('elimu_report_card_transition', { p_card: cardId, p_to: to, p_reason: reason || null, p_allow_incomplete: allowIncomplete }),
  bulkTransition: (cardIds, to, { reason, allowIncomplete = false } = {}) => rpc('elimu_bulk_transition', { p_cards: cardIds, p_to: to, p_reason: reason || null, p_allow_incomplete: allowIncomplete }),
  openCorrection: (cardId, reason) => rpc('elimu_open_correction', { p_card: cardId, p_reason: reason }),
  correctPublishedMark: ({ cardId, assessmentId, status, marks, remarks, reason }) => rpc('elimu_correct_published_mark', { p_card: cardId, p_assessment: assessmentId, p_status: status, p_marks: marks ?? null, p_remarks: remarks || null, p_reason: reason }),
  /** Payloads for printing (frozen snapshots once approved). Chunked: the database allows 200 per call. */
  async payloads(cardIds) {
    const out = []; for (let i = 0; i < cardIds.length; i += 100) out.push(...(await rpc('elimu_get_report_cards', { p_cards: cardIds.slice(i, i + 100) }))); return out;
  },
  studentHistory: (studentId, publishedOnly = true) => rpc('elimu_student_history', { p_student: studentId, p_published_only: publishedOnly }),
};

/** Nest the flat history rows: Academic Year -> Term -> Class -> Subjects -> Assessments. */
export function nestHistory(entries = []) {
  const years = new Map();
  for (const e of entries) {
    if (!years.has(e.academic_year_id)) years.set(e.academic_year_id, { id: e.academic_year_id, name: e.year_name, terms: [] });
    years.get(e.academic_year_id).terms.push({ id: e.term_id, name: e.term_name, sequence: e.term_sequence, class_name: e.class_name, stream_name: e.stream_name, enrollment_id: e.enrollment_id,
      mean_percentage: e.mean_percentage, overall_grade: e.overall_grade, class_position: e.class_position, class_size: e.class_size, card_status: e.card_status, subjects: e.subjects });
  }
  return [...years.values()].map((y) => ({ ...y, terms: y.terms.sort((a, b) => a.sequence - b.sequence) })).sort((a, b) => String(b.name).localeCompare(String(a.name)));
}
