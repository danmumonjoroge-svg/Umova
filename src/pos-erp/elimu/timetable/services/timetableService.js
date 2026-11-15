// elimu/timetable/services/timetableService.js
import { rpc, select, write } from '../../shared/services/elimuDb';

export const timetableService = {
  rooms: () => select('elimu_school_rooms', (q) => q.order('name')),
  saveRoom: (row) => (row.id ? write('elimu_school_rooms', 'update', row, (q) => q.eq('id', row.id)) : write('elimu_school_rooms', 'insert', row)),
  periods: ({ termId = null } = {}) => select('elimu_timetable_periods', (q) => { let x = q.order('sort_order').order('start_time'); if (termId) x = x.or(`term_id.eq.${termId},term_id.is.null`); return x; }),
  savePeriod: (row) => (row.id ? write('elimu_timetable_periods', 'update', row, (q) => q.eq('id', row.id)) : write('elimu_timetable_periods', 'insert', row)),
  removePeriod: (id) => write('elimu_timetable_periods', 'delete', null, (q) => q.eq('id', id)),
  /** One term's weekly entries (never "everything"). */
  entries: ({ termId = null, classId = null, teacherId = null, roomId = null } = {}) => select('elimu_timetable_entries', (q) => {
    let x = q.eq('status', 'ACTIVE').order('day_of_week').order('start_time');
    x = termId ? x.eq('term_id', termId) : x.is('term_id', null); if (classId) x = x.eq('class_id', classId); if (teacherId) x = x.eq('teacher_id', teacherId); if (roomId) x = x.eq('room_id', roomId); return x;
  }),
  exceptions: ({ from, to }) => select('elimu_timetable_exceptions', (q) => q.gte('exception_date', from).lte('exception_date', to)),
  /** Live clash preview from the database (the grid also previews instantly in the browser). */
  conflicts: (d) => rpc('elimu_timetable_conflicts', { p_exclude: d.id || null, p_term: d.term_id || null, p_day: d.day_of_week, p_start: d.start_time, p_end: d.end_time, p_class: d.class_id, p_stream: d.stream_id || null, p_teacher: d.teacher_id || null, p_room: d.room_id || null, p_from: d.valid_from || null, p_to: d.valid_to || null, p_expected: d.expected_students || null }),
  /** Saves; NEVER overwrites silently. Returns { ok:false, conflicts, overridable } or { ok:true, id, change_id }. Pass overrideReason only after the user saw the clashes. */
  save: (entry, overrideReason = null) => rpc('elimu_save_timetable_entry', { p_entry: entry, p_override_reason: overrideReason }),
  cancel: (entryId, { date = null, reason, expectedVersion = null }) => rpc('elimu_cancel_timetable_entry', { p_entry_id: entryId, p_date: date, p_reason: reason, p_expected_version: expectedVersion }),
  changeForDate: ({ entryId, date, kind, teacherId = null, roomId = null, reason, overrideReason = null }) => rpc('elimu_set_timetable_exception', { p_entry_id: entryId, p_date: date, p_kind: kind, p_new_teacher: teacherId, p_new_room: roomId, p_reason: reason, p_override_reason: overrideReason }),
  history: ({ entryId = null, limit = 100 } = {}) => select('elimu_timetable_change_history', (q) => { let x = q.order('changed_at', { ascending: false }).limit(limit); if (entryId) x = x.eq('entry_id', entryId); return x; }),
  availability: (staffId = null) => select('elimu_teacher_availability', (q) => { let x = q.eq('is_active', true); if (staffId) x = x.eq('staff_id', staffId); return x; }),
  saveAvailability: (row) => write('elimu_teacher_availability', 'insert', row),
  removeAvailability: (id) => write('elimu_teacher_availability', 'update', { is_active: false }, (q) => q.eq('id', id)),
  workload: ({ termId = null } = {}) => select('elimu_v_teacher_workload', (q) => (termId ? q.eq('term_id', termId) : q)),
};
