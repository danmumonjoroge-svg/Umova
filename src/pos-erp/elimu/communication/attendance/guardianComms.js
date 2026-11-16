// elimu/communication/attendance/guardianComms.js
//
// Guardian messages about attendance. NO new communication engine:
//   wording         -> communication/templates (Elimu text only)
//   history/outbox  -> the existing lb_communication_log (same columns commEngineService.record writes)
//   open-in-phone   -> commEngineService.deepLink / setStatus ; provider send -> commEngineService.sendViaProvider
//   honest status   -> QUEUED = prepared, OPENED = app opened, SENT = staff confirmed, SUBMITTED/DELIVERED/READ/FAILED = provider only
// Elimu adds only the link row (elimu_attendance_notices) tying a message to student / guardian / attendance record / purpose.
import { communicationService } from '../ElimuCommunicationService';
import { registerPurpose } from '../purposes';
import { commEngineService } from '../../../services/commEngineService';
import { absenceService } from '../../attendance/services/absenceService';
import { ATTENDANCE_PURPOSES, PURPOSE_LABELS } from '../templates/attendanceTemplates';
import { buildDraft } from './contactPlan';
import { getOfflineAttendance } from '../../attendance/services/offlineAttendance';

for (const [key, label] of Object.entries(PURPOSE_LABELS)) {
  try { registerPurpose({ key: ATTENDANCE_PURPOSES[key], label, fields: ['guardian_name', 'student_name', 'school_name'] }); } catch (e) { if (!String(e?.message || '').includes('already registered')) throw e; }
}

const communicationServiceLog = async (id) => {
  const { data, error } = await communicationService.getLog(id);
  return { data, error };
};

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
    const recorded = await communicationService.record({
      tenantId, channel: message.channel, purpose: ATTENDANCE_PURPOSES[message.purpose],
      guardianId: message.guardianId, studentId: message.studentId,
      subject: message.subject, body: message.body, generated: message.generated,
      templateSource: 'ELIMU', referenceLabel: message.label, status: 'QUEUED',
    });
    const { data: log, error } = await communicationServiceLog(recorded.logId);
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
