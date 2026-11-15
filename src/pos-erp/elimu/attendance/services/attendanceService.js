// elimu/attendance/services/attendanceService.js -- thin wrappers over the attendance RPCs. The database enforces every rule;
// these only carry the request. Nothing here ever turns NOT_MARKED into ABSENT.
import { rpc, select, write } from '../../shared/services/elimuDb';

export const attendanceService = {
  seedDefaults: () => rpc('elimu_attendance_seed_defaults'),
  /** Opens (or returns) the register. Same call twice = same session. */
  open: ({ date, classId, streamId = null, kind = 'DAILY', entryId = null, yearId = null, termId = null, className = null, streamName = null }) =>
    rpc('elimu_open_attendance_session', { p_date: date, p_class: classId, p_stream: streamId, p_kind: kind, p_entry: entryId, p_academic_year: yearId, p_term: termId, p_class_name: className, p_stream_name: streamName }),
  records: (sessionId) => select('elimu_attendance_records', (q) => q.eq('session_id', sessionId).order('student_name')),
  session: async (sessionId) => (await select('elimu_v_attendance_sessions', (q) => q.eq('id', sessionId).limit(1)))[0] || null,
  /** marks: [{enrollment_id, status, arrival_time?, departure_time?, reason_id?, reason_note?, marked_at?, base_updated_at?}] */
  saveMarks: (sessionId, marks, source = 'WEB') => rpc('elimu_save_attendance_marks', { p_session_id: sessionId, p_marks: marks, p_source: source }),
  submit: (sessionId, confirmUnmarked = false) => rpc('elimu_submit_attendance', { p_session_id: sessionId, p_confirm_unmarked: confirmUnmarked }),
  amend: (recordId, changes, reason) => rpc('elimu_amend_attendance', { p_record_id: recordId, p_changes: changes, p_reason: reason }),
  decideEarlyDeparture: (recordId, approve, note = null) => rpc('elimu_decide_early_departure', { p_record_id: recordId, p_approve: approve, p_note: note }),
  amendments: (recordId) => select('elimu_attendance_amendments', (q) => q.eq('record_id', recordId).order('amended_at', { ascending: false })),
  // lookups
  settings: async () => (await rpc('elimu_get_attendance_settings')),
  saveSettings: (tenantId, businessId, values, userId) => write('elimu_attendance_settings', 'upsert', { tenant_id: tenantId, business_id: businessId, ...values, updated_by: userId ?? null }, { onConflict: 'tenant_id' }),
  statuses: () => select('elimu_attendance_status_defs', (q) => q.order('sort_order')),
  saveStatus: (row) => write('elimu_attendance_status_defs', 'upsert', row, { onConflict: 'tenant_id,code' }),
  reasons: () => select('elimu_attendance_reasons', (q) => q.order('sort_order')),
  saveReason: (row) => write('elimu_attendance_reasons', 'upsert', row, { onConflict: 'tenant_id,code' }),
  isSchoolDay: (date) => rpc('elimu_is_school_day', { p_date: date }),
  // dashboard
  overview: ({ date, yearId = null, termId = null, classId = null, streamId = null }) => rpc('elimu_daily_overview', { p_date: date, p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId }),
  summary: ({ date, yearId = null, termId = null, classId = null, streamId = null }) => rpc('elimu_daily_summary', { p_date: date, p_year: yearId, p_term: termId, p_class: classId, p_stream: streamId }),
  repeatedAbsences: ({ asOf, classId = null, streamId = null, limit = 200 }) => rpc('elimu_repeated_absences', { p_as_of: asOf, p_class: classId, p_stream: streamId, p_limit: limit }),
};
