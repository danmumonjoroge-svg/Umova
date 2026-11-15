// elimu/shared/services/foundationService.js -- READ-ONLY access to the Elimu foundation (AI 1 / AI 2) through the adapter views.
// Elimu never writes students, guardians, classes, subjects or terms. If a view is missing the call returns { connected:false }
// so screens show "Student records not connected yet" instead of an empty, misleading register.
import { posSupabase } from './elimuDb';

async function read(view, build) {
  let q = posSupabase.from(view).select('*'); if (build) q = build(q);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message || '') || error.code === '42P01' || error.code === 'PGRST205') return { connected: false, rows: [] };
    throw new Error(error.message);
  }
  return { connected: true, rows: data || [] };
}
export const foundationService = {
  classStreams: ({ yearId } = {}) => read('elimu_v_class_streams', (q) => { let x = q.order('sort_order').order('class_name'); if (yearId) x = x.eq('academic_year_id', yearId); return x; }),
  terms: () => read('elimu_v_terms', (q) => q.order('start_date', { ascending: false })),
  subjects: () => read('elimu_v_subjects', (q) => q.order('subject_name')),
  teachers: () => read('elimu_v_teachers', (q) => q.order('teacher_name')),
  /** Guardians of ONE student (never the whole school). */
  guardians: (studentId) => read('elimu_v_guardians', (q) => q.eq('student_id', studentId)),
  /** Roster of one class on one date (used for lesson timetable "students in this class" and offline prefetch; the RPC builds the register itself). */
  roster: ({ classId, streamId }) => read('elimu_v_roster', (q) => { let x = q.eq('class_id', classId).eq('status', 'ACTIVE'); if (streamId) x = x.eq('stream_id', streamId); return x.order('student_name'); }),
  /** The class a student is in now (for the individual student timetable). */
  studentPlacement: (studentId) => read('elimu_v_roster', (q) => q.eq('student_id', studentId).eq('status', 'ACTIVE').limit(1)),
};
