// elimu/academic/services/academicService.js — access, roles, settings, subjects, allocations, class teachers, electives, reference lists.
import { rpc, table } from './rpc';

export const academicService = {
  // ---- who am I / what may I do (UI hints only; the database decides)
  access: () => rpc('elimu_my_access'),
  listStaff: () => rpc('elimu_list_staff'),
  setRole: (staffId, role, granted) => rpc('elimu_set_academic_role', { p_staff: staffId, p_role: role, p_granted: granted }),
  seedDefaults: () => rpc('elimu_seed_defaults'),

  // ---- settings (policies, head teacher, display)
  getSettings: () => rpc('elimu_get_settings'),
  async saveSettings(tenantId, patch) {
    const { data, error } = await table('elimu_academic_settings').update(patch).eq('tenant_id', tenantId).select().single();
    if (error) throw new Error(error.message); return data;
  },

  // ---- subjects (direct table access; RLS + triggers enforce who may write)
  async listSubjects({ includeInactive = false } = {}) {
    let q = table('elimu_subjects').select('*').order('sort_order').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw new Error(error.message); return data || [];
  },
  async saveSubject(tenantId, s) {
    const row = { code: s.code, name: s.name, short_name: s.short_name || null, category: s.category || null, is_compulsory: s.is_compulsory ?? true,
      is_active: s.is_active ?? true, sort_order: Number(s.sort_order) || 0, applicable_levels: s.applicable_levels?.length ? s.applicable_levels : null,
      description: s.description || null, grading_scheme_id: s.grading_scheme_id || null };
    const q = s.id ? table('elimu_subjects').update(row).eq('id', s.id) : table('elimu_subjects').insert({ ...row, tenant_id: tenantId });
    const { data, error } = await q.select().single(); if (error) throw new Error(error.message.includes('ux_elimu_subjects_code') ? 'A subject with that code already exists.' : error.message); return data;
  },
  deactivateSubject: (id) => table('elimu_subjects').update({ is_active: false }).eq('id', id),

  // ---- allocations (history is kept: changing a teacher ENDS the old row and starts a new one)
  async listAllocations({ yearId, classId, streamId, subjectId, teacherId, includeEnded = false }) {
    let q = table('elimu_subject_allocations').select('*, subject:elimu_subjects(id,code,name)').order('started_at', { ascending: false });
    if (yearId) q = q.eq('academic_year_id', yearId); if (classId) q = q.eq('class_id', classId); if (streamId) q = q.eq('stream_id', streamId);
    if (subjectId) q = q.eq('subject_id', subjectId); if (teacherId) q = q.eq('teacher_staff_id', teacherId);
    if (!includeEnded) q = q.eq('status', 'ACTIVE');
    const { data, error } = await q.limit(500); if (error) throw new Error(error.message); return data || [];
  },
  assignSubject: (a) => rpc('elimu_assign_subject', { p_year: a.yearId, p_term: a.termId || null, p_class: a.classId, p_stream: a.streamId || null, p_subject: a.subjectId,
    p_teacher: a.teacherId || null, p_compulsory: a.isCompulsory ?? null, p_replace: a.replace ?? true }),
  endAllocation: (id, reason) => rpc('elimu_end_allocation', { p_id: id, p_reason: reason }),
  setClassTeacher: (yearId, classId, streamId, teacherId) => rpc('elimu_set_class_teacher', { p_year: yearId, p_class: classId, p_stream: streamId || null, p_teacher: teacherId }),
  endClassTeacher: (id, reason) => rpc('elimu_end_class_teacher', { p_id: id, p_reason: reason }),
  async listClassTeachers(yearId) {
    const { data, error } = await table('elimu_class_teachers').select('*').eq('academic_year_id', yearId).eq('status', 'ACTIVE'); if (error) throw new Error(error.message); return data || [];
  },
  selectElective: (enrollmentId, subjectId, termId) => rpc('elimu_select_elective', { p_enrollment: enrollmentId, p_subject: subjectId, p_term: termId || null }),
  endElective: (enrollmentId, subjectId) => rpc('elimu_end_elective', { p_enrollment: enrollmentId, p_subject: subjectId }),

  // ---- foundation reference lists, read through the adapter views (see INTEGRATION.md). Never reads foundation tables directly.
  async refs() {
    const [years, terms, classes, streams] = await Promise.all([
      table('elimu_ref_academic_years').select('*').order('name', { ascending: false }),
      table('elimu_ref_terms').select('*').order('sequence_no'),
      table('elimu_ref_classes').select('*').order('sort_order').order('name'),
      table('elimu_ref_streams').select('*').order('name')]);
    const err = years.error || terms.error || classes.error || streams.error;
    if (err) throw new Error(/does not exist|schema cache/i.test(err.message) ? 'The school foundation (classes, students, terms) is not connected yet. See elimu/INTEGRATION.md.' : err.message);
    return { years: years.data || [], terms: terms.data || [], classes: classes.data || [], streams: streams.data || [] };
  },
};
