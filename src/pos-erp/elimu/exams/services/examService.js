// elimu/exams/services/examService.js — assessment types, assessments, mark sheet, bulk save, submit, unlock, void, history.
import { rpc, table } from '../../academic/services/rpc';

export const examService = {
  async listTypes({ includeInactive = false } = {}) {
    let q = table('elimu_assessment_types').select('*').order('sort_order').order('name'); if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw new Error(error.message); return data || [];
  },
  async saveType(tenantId, t) {
    const row = { code: t.code, name: t.name, is_examination: !!t.is_examination, default_max_marks: t.default_max_marks || null, default_weight: t.default_weight ?? null, is_active: t.is_active ?? true, sort_order: Number(t.sort_order) || 0 };
    const q = t.id ? table('elimu_assessment_types').update(row).eq('id', t.id) : table('elimu_assessment_types').insert({ ...row, tenant_id: tenantId });
    const { data, error } = await q.select().single(); if (error) throw new Error(error.message.includes('ux_elimu_atype_code') ? 'An assessment type with that code already exists.' : error.message); return data;
  },

  /** Paginated, filtered list (never loads the whole school). */
  async listAssessments({ yearId, termId, classId, streamId, subjectId, status, search, page = 0, pageSize = 25 }) {
    let q = table('elimu_assessments').select('*, subject:elimu_subjects(id,code,name), type:elimu_assessment_types(id,code,name)', { count: 'exact' })
      .order('assessment_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
    if (yearId) q = q.eq('academic_year_id', yearId); if (termId) q = q.eq('term_id', termId); if (classId) q = q.eq('class_id', classId);
    if (streamId) q = q.eq('stream_id', streamId); if (subjectId) q = q.eq('subject_id', subjectId); if (status) q = q.eq('status', status);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data, error, count } = await q; if (error) throw new Error(error.message); return { rows: data || [], total: count || 0 };
  },
  createAssessment: (p) => rpc('elimu_create_assessment', { p }),
  updateAssessment: (id, p, reason) => rpc('elimu_update_assessment', { p_id: id, p, p_reason: reason || null }),
  setAssessmentStatus: (id, status, reason) => rpc('elimu_set_assessment_status', { p_id: id, p_status: status, p_reason: reason || null }),
  checkWeights: (yearId, termId, classId, subjectId) => rpc('elimu_check_weights', { p_year: yearId, p_term: termId, p_class: classId, p_subject: subjectId }),

  getMarkSheet: (assessmentId, { search = null, limit = 100, offset = 0 } = {}) => rpc('elimu_get_mark_sheet', { p_assessment: assessmentId, p_search: search, p_limit: limit, p_offset: offset }),
  saveMarks: (assessmentId, entries, { submit = false, batch = null } = {}) => rpc('elimu_save_marks', { p_assessment: assessmentId, p_entries: entries, p_submit: submit, p_client_batch: batch }),
  submitMarks: (assessmentId, markRemainingAs = null) => rpc('elimu_submit_marks', { p_assessment: assessmentId, p_mark_remaining_as: markRemainingAs }),
  unlockMarks: (assessmentId, reason, enrollmentIds = null) => rpc('elimu_unlock_marks', { p_assessment: assessmentId, p_reason: reason, p_enrollments: enrollmentIds }),
  voidMark: (markId, reason) => rpc('elimu_void_mark', { p_mark: markId, p_reason: reason }),
  markHistory: (assessmentId, enrollmentId) => rpc('elimu_mark_history_for', { p_assessment: assessmentId, p_enrollment: enrollmentId }),
};
