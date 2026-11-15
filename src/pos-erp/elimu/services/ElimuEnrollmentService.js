// Enrolment: one row per student per academic year per period; history is kept, never overwritten (005).
import { supabase, unwrap } from './platform.js';

export const enrollmentService = {
  async roster({ academicYearId, classId, streamId }) {
    let q = supabase.from('v_elimu_student_directory').select('*').eq('academic_year_id', academicYearId).eq('class_id', classId).order('last_name');
    if (streamId) q = q.eq('stream_id', streamId);
    return unwrap(await q) || [];
  },
  async history(studentId) { return unwrap(await supabase.from('v_elimu_enrollment_history').select('*').eq('student_id', studentId).order('year_start', { ascending: false })) || []; },
  /** Many students at once; per-student failures come back in `skipped` with a reason, the rest still enrol. */
  async enroll({ academicYearId, termId = null, classId, streamId = null, studentIds, source = 'MANUAL' }) {
    return unwrap(await supabase.rpc('elimu_enroll_students', { p_academic_year_id: academicYearId, p_term_id: termId, p_class_id: classId, p_stream_id: streamId, p_student_ids: studentIds, p_source: source }));
  },
  async move(enrollmentId, classId, streamId = null, reason = null) { return unwrap(await supabase.rpc('elimu_move_enrollment', { p_enrollment: enrollmentId, p_class_id: classId, p_stream_id: streamId, p_reason: reason })); },
  async dataQuality() { return unwrap(await supabase.from('v_elimu_data_quality').select('*').limit(500)) || []; },
};
