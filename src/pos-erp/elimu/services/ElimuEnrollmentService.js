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
  /** Deal the learners who have no stream across the class's streams, evenly. dryRun only reports. */
  async shareStreams(classId, dryRun = false) { return unwrap(await supabase.rpc('elimu_streams_share', { p_class: classId, p_dry_run: dryRun })); },
  /** What a learner studies: class, stream (and the streams to pick from), compulsory subjects and the electives offered. */
  async study(studentId) { return unwrap(await supabase.rpc('elimu_student_study', { p_student: studentId })); },
  /** Add (on = true) or drop (on = false) one elective subject for a learner's current enrolment. */
  async choose(enrollmentId, subjectId, on = true) { return unwrap(await supabase.rpc('elimu_student_choose', { p_enrollment: enrollmentId, p_subject: subjectId, p_on: on })); },
  /** Optional subjects offered to a class (and stream) this year: shown on the admit form. */
  async classElectives(classId, streamId = null) { return unwrap(await supabase.rpc('elimu_class_electives', { p_class: classId, p_stream: streamId || null })) || []; },
  /** Record the electives chosen at admission (once; after that only administration can change them). */
  async admitChoose(enrollmentId, subjectIds) { return unwrap(await supabase.rpc('elimu_admit_choose', { p_enrollment: enrollmentId, p_subjects: subjectIds })); },
  async dataQuality() { return unwrap(await supabase.from('v_elimu_data_quality').select('*').limit(500)) || []; },
};
