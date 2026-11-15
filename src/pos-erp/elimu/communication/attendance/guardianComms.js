// elimu/communication/attendance/guardianComms.js
//
// Guardian messages about attendance. NO new communication engine:
//   wording         -> communication/templates (Elimu text only)
//   history/outbox  -> the existing lb_communication_log (same columns commEngineService.record writes)
//   open-in-phone   -> commEngineService.deepLink / setStatus ; provider send -> commEngineService.sendViaProvider
//   honest status   -> QUEUED = prepared, OPENED = app opened, SENT = staff confirmed, SUBMITTED/DELIVERED/READ/FAILED = provider only
// Elimu adds only the link row (elimu_attendance_notices) tying a message to student / guardian / attendance record / purpose.
import { posSupabase } from '../../../services/posSupabaseClient';
import { commEngineService } from '../../../services/commEngineService';
import { absenceService } from '../../attendance/services/absenceService';
import { ATTENDANCE_PURPOSES, PURPOSE_LABELS } from '../templates/attendanceTemplates';
import { buildDraft } from './contactPlan';
import { getOfflineAttendance } from '../../attendance/services/offlineAttendance';

export const guardianComms = {
  draft: buildDraft,

  /**
   * Prepares + records a message ("QUEUED" = prepared, not sent) and links it to the attendance record.
   * Offline: the message is queued on the device and recorded when the connection returns; nothing is claimed.
   * @returns {{status:'RECORDED'|'DUPLICATE'|'QUEUED_OFFLINE', log?, notice?}}
   */
  async record({ tenantId, businessId, userId, record, guardian, purpose, channel, draft, final, resend = false, offline = false }) {
    const message = { recordId: record.id || record.record_id, studentId: record.student_id, guardianId: guardian?.guardian_id || null, guardianName: guardian?.guardian_name || null,
      purpose, channel, to: final.to || draft.to, subject: final.subject || draft.subject || null, body: final.body, generated: draft.body, label: `${record.student_name} · ${PURPOSE_LABELS[purpose] || purpose}`, resend };
    if (offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      const q = await getOfflineAttendance(); await q.enqueueMessage({ tenantId, message });
      return { status: 'QUEUED_OFFLINE', message };
    }
    return this._recordOnline({ tenantId, businessId, userId, message });
  },

  async _recordOnline({ tenantId, businessId, userId, message }) {
    if (!message.resend) {
      const history = await absenceService.contactHistory(message.recordId);
      const dup = history.find((h) => !h.superseded_at && h.purpose === message.purpose && h.channel === message.channel && (h.guardian_id || null) === (message.guardianId || null));
      if (dup) return { status: 'DUPLICATE', notice: dup };
    }
    const row = {
      tenant_id: tenantId, business_id: businessId ?? null, channel: message.channel, message_type: 'OTHER', purpose: ATTENDANCE_PURPOSES[message.purpose],
      recipient_kind: 'GUARDIAN', recipient_name: message.guardianName, recipient: message.to, subject: message.subject, generated_message: message.generated, rendered_message: message.body,
      was_edited: message.body !== message.generated, template_source: 'ELIMU', status: 'QUEUED', initiated_by: 'USER',
      reference_type: 'elimu_attendance_record', reference_id: message.recordId, reference_label: message.label, created_by: userId ?? null,
    };
    const { data: log, error } = await posSupabase.from('lb_communication_log').insert(row).select('*').single();
    if (error) throw error;
    const res = await absenceService.recordContact({ recordId: message.recordId, purpose: message.purpose, guardianId: message.guardianId, guardianName: message.guardianName, channel: message.channel, commLogId: log.id, note: null, resend: message.resend });
    return { status: res.duplicate ? 'DUPLICATE' : 'RECORDED', log, notice: res };
  },

  /** A phone call is logged with its outcome; only an ANSWERED call counts as "guardian contacted". */
  logCall: ({ record, guardian, purpose, outcome, note }) => absenceService.recordContact({ recordId: record.id || record.record_id, purpose, guardianId: guardian?.guardian_id, guardianName: guardian?.guardian_name, channel: 'CALL', callOutcome: outcome, note }),

  /** Opens SMS / WhatsApp / mail on the phone. Marks the log OPENED -- which is NOT proof it was sent. */
  async openOnPhone(log, { to, subject, body }) {
    const url = commEngineService.deepLink(log.channel, { to, subject, body });
    if (!url) throw new Error('This guardian has no number or address for that channel.');
    try { await commEngineService.setStatus(log.id, 'OPENED'); } catch { /* history is best-effort here; the message is still prepared */ }
    window.open(url, '_blank');
    return url;
  },
  /** Staff say they pressed Send. Only then is it SENT (and the case marked "guardian contacted"). */
  async confirmSent(log, followupId = null) {
    const updated = await commEngineService.setStatus(log.id, 'SENT');
    if (followupId) await absenceService.update(followupId, { guardian_contacted: true, contact_channel: log.channel });
    return updated;
  },
  sendViaProvider: (logId) => commEngineService.sendViaProvider(logId),

  /** Runs queued offline messages. Called by the offline drain. */
  syncQueued: ({ tenantId, businessId, userId }) => (p) => guardianComms._recordOnline({ tenantId, businessId, userId, message: p.message }),
};
