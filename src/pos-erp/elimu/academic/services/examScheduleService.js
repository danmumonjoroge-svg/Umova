// Exam timetable and student progress. Rules (clashes, permissions, what parents may see) are in elimu_1002; this only calls them.
import { rpc } from './rpc';

export const examScheduleService = {
  list: ({ yearId, termId, classId }) => rpc('elimu_exam_schedule_list', { p_year: yearId, p_term: termId, p_class: classId || null }),
  set: (assessmentId, { date, start, end, venue, notes }) => rpc('elimu_exam_schedule_set', { p_assessment: assessmentId, p_date: date, p_start: start, p_end: end, p_venue: venue || null, p_notes: notes || null }),
  publish: (assessmentIds, publish = true) => rpc('elimu_exam_schedule_publish', { p_assessments: assessmentIds, p_publish: publish }),
  progress: (studentId) => rpc('elimu_student_progress', { p_student: studentId }),
};
