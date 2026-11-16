// elimu/communication/academic/academicCommService.js
// Academic messaging on top of the POS's EXISTING communication system. Nothing here sends anything by itself:
//   * messages are rows in the existing outbox  lb_communication_log  (status QUEUED = "prepared");
//   * opening WhatsApp/SMS/mail on the phone  -> setStatus('OPENED')   (never "sent");
//   * server delivery                          -> commEngineService.sendViaProvider() -> the existing comm-send function;
//   * SENT/DELIVERED/READ are only ever set by the user's confirmation or the provider, exactly as elsewhere in the POS.
// Why a small record() of our own: the POS's commEngineService.record() composes with the POS's built-in purposes only and writes the
// purpose into the enum column message_type. Academic rows use message_type 'OTHER' + purpose 'ELIMU_*' and are linked to the
// student/guardian through elimu_message_links.
import { posSupabase as supabase } from '../../../services/posSupabaseClient';
import { communicationService } from '../ElimuCommunicationService';
import { registerPurpose } from '../purposes';
import { commEngineService } from '../../../services/commEngineService';
import { rpc } from '../../academic/services/rpc';
import { composeAcademic, buildAcademicVars, ACADEMIC_PURPOSES } from '../templates/academicTemplates';
import { checkFinal, contactFor, normalizeMsisdn, toFriendly, fromFriendly } from '../../../utils/comm';
import { ACADEMIC_VARIABLE_LABELS } from '../templates/academicTemplates';

export { ACADEMIC_PURPOSES, buildAcademicVars, composeAcademic };

for (const p of ACADEMIC_PURPOSES) {
  try { registerPurpose({ key: p.key, label: p.label, fields: ['guardian_name', 'student_name', 'school_name'] }); } catch (e) { if (!String(e?.message || '').includes('already registered')) throw e; }
}

export const academicCommService = {
  /** The school's own wording overrides (existing table). */
  listTemplates: ({ tenantId, businessId }) => commEngineService.listTemplates({ tenantId, businessId }),

  /** Pure: generate the editable message for one guardian + channel. */
  prepare({ purpose, channel, guardian, student, schoolName, term, academicYear, exam, subject, resultDate, extras, businessTemplates }) {
    const vars = buildAcademicVars({ guardian, student, schoolName, term, academicYear, exam, subject, resultDate, extras });
    const composed = composeAcademic({ purpose, channel, vars, businessTemplates });
    const to = contactFor(channel, { phone: guardian?.phone, email: guardian?.email });
    return { ...composed, to, purpose, channel, vars };
  },
  /** Last safety check before sending (existing engine rule set: empty text, missing contact, leftover {{ }}). */
  check: ({ channel, subject, body, to }) => checkFinal({ channel, subject, body, to }),

  /** Write the prepared message to the existing outbox and link it to the student/guardian. `final` is what the user will actually send. */
  async record({ tenantId, businessId, userId, composed, final, guardian, student, reference }) {
    const recorded = await communicationService.record({
      tenantId, channel: composed.channel, purpose: composed.purpose,
      guardianId: guardian?.guardian_id || guardian?.id,
      studentId: student?.id || student?.student_id,
      subject: final.subject, body: final.body, generated: composed.body,
      templateId: composed.templateId, templateSource: composed.source || 'ELIMU',
      referenceLabel: reference?.label || null, status: 'QUEUED',
    });
    const { data, error } = await communicationService.getLog(recorded.logId);
    if (error) throw error;
    try {
      await rpc('elimu_link_message', { p_comm_log: data.id, p_student: student.id || student.student_id, p_guardian: guardian?.guardian_id || guardian?.id || null,
        p_enrollment: student.enrollment_id || null, p_purpose: composed.purpose, p_ref_type: reference?.type || null, p_ref_id: reference?.id || null });
    } catch (e) { return { log: data, linkError: e.message }; }
    return { log: data };
  },

  // ---- delivery: all existing machinery
  sendViaProvider: (logId) => commEngineService.sendViaProvider(logId),
  /** Phone route: returns the URL to open and records OPENED (not sent). SMS/WhatsApp/mail apps open with the text filled in. */
  async openOnPhone(log) {
    const url = commEngineService.deepLink(log.channel, { to: log.channel === 'EMAIL' ? log.recipient : normalizeMsisdn(log.recipient) || log.recipient, subject: log.subject, body: log.rendered_message });
    if (url) await commEngineService.setStatus(log.id, 'OPENED');
    return url;
  },
  /** Only after the person confirms they actually sent it. */
  markSentByUser: (logId) => commEngineService.setStatus(logId, 'SENT'),
  cancel: (logId) => commEngineService.setStatus(logId, 'CANCELLED'),

  // ---- who and history
  contacts: (studentId) => rpc('elimu_student_contacts', { p_student: studentId }),
  targets: (cardIds, purpose = 'ELIMU_RESULT_PUBLISHED') => rpc('elimu_guardian_targets', { p_cards: cardIds, p_purpose: purpose }),
  history: (studentId, limit = 50) => rpc('elimu_message_history', { p_student: studentId, p_limit: limit }),

  // ---- the school's own wording (existing lb_communication_templates; message_type OTHER avoids the enum quirk)
  friendly: (body) => toFriendly(body, ACADEMIC_VARIABLE_LABELS), unfriendly: (text) => fromFriendly(text, ACADEMIC_VARIABLE_LABELS),
  async saveBusinessTemplate({ tenantId, businessId, purpose, channel, subject, body, userId }) {
    const payload = { tenant_id: tenantId, business_id: businessId, purpose, message_type: 'OTHER', channel, subject: channel === 'EMAIL' ? subject || null : null, body, is_active: true, is_customised: true, updated_by: userId ?? null };
    const { data: ex } = await supabase.from('lb_communication_templates').select('id').eq('tenant_id', tenantId).eq('business_id', businessId).eq('purpose', purpose).eq('channel', channel).maybeSingle();
    const q = ex?.id ? supabase.from('lb_communication_templates').update(payload).eq('id', ex.id) : supabase.from('lb_communication_templates').insert(payload);
    const { error } = await q.select('id').single(); if (error) throw error;
  },
};
