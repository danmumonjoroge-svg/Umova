// elimu/attendance/services/absenceService.js -- absence follow-up cases.
import { rpc, select } from '../../shared/services/elimuDb';

export const absenceService = {
  /** Open cases first; paged. status: 'OPEN'|'IN_PROGRESS'|'RESOLVED'|'CLOSED'|null(all open+in progress) */
  list: ({ status = null, classId = null, streamId = null, from = null, to = null, limit = 100, offset = 0 } = {}) => select('elimu_absence_followups', (q) => {
    let x = q.order('absence_date', { ascending: false }).range(offset, offset + limit - 1);
    x = status ? x.eq('status', status) : x.in('status', ['OPEN', 'IN_PROGRESS']);
    if (classId) x = x.eq('class_id', classId); if (streamId) x = x.eq('stream_id', streamId);
    if (from) x = x.gte('absence_date', from); if (to) x = x.lte('absence_date', to);
    return x;
  }),
  /** changes: reason_id, explanation_received, explanation_note, guardian_contacted, contact_channel, request_excuse, excuse_decision, excuse_note, assigned_to, follow_up_due, notes, close, closed_reason */
  update: (followupId, changes) => rpc('elimu_update_absence_followup', { p_followup_id: followupId, p_changes: changes }),
  recordContact: ({ recordId, purpose, guardianId, guardianName, channel, commLogId = null, callOutcome = null, note = null, resend = false }) =>
    rpc('elimu_record_guardian_contact', { p_record_id: recordId, p_purpose: purpose, p_guardian_id: guardianId || null, p_guardian_name: guardianName || null, p_channel: channel, p_comm_log_id: commLogId, p_call_outcome: callOutcome, p_note: note, p_resend: resend }),
  /** Contact history for one record, with the REAL delivery status from the communication log. */
  contactHistory: (recordId) => select('elimu_v_attendance_notices', (q) => q.eq('record_id', recordId).order('created_at', { ascending: false })),
  contactHistoryForStudent: (studentId, limit = 50) => select('elimu_v_attendance_notices', (q) => q.eq('student_id', studentId).order('created_at', { ascending: false }).limit(limit)),
};
