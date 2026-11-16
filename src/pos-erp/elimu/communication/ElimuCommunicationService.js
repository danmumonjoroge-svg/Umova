// ElimuCommunicationService — the ONE place Elimu screens prepare, hand off and record guardian messages and calls.
// It is an ADAPTOR over the existing Umova communication engine: messages are rows in lb_communication_log (written through
// elimu_record_message, schema/006), history/delivery/webhooks stay the engine's job. Nothing here talks to an SMS/WhatsApp/email
// provider directly and nothing invents credentials.
//
// HONESTY (also enforced by the database):
//   prepare()            -> text only, nothing written, nothing sent
//   handOff()            -> opens sms: / wa.me / mailto: / tel: on THIS device and records OPENED (call: INTENDED). Never "sent".
//   confirmSentByHand()  -> only when the person says "I sent it"; recorded as "Marked as sent by staff".
//   sendViaProvider()    -> asks the existing comm-send edge function; if the school has no provider it returns { ok:false, code } and the
//                           UI offers the phone route. SUBMITTED/DELIVERED/READ only ever arrive from the provider.
//   offline              -> the draft is kept on the device (utils/offlineDrafts.js) as PENDING; nothing is recorded or shown as sent.
import { supabase, unwrap } from '../services/platform.js';
import { resolveTemplate, buildVars } from './ElimuTemplateResolver.js';
import { eligibility } from './consent.js';
import { getPurpose } from './purposes.js';
import { contactFor } from '../utils/phone.js';
import { saveDraft, newDraftId } from '../utils/offlineDrafts.js';

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** wa.me / sms: / mailto: / tel: links. Text is URL-encoded; an email subject is passed through. */
export function handOffUrl(channel, { recipient, body, subject }) {
  const enc = encodeURIComponent;
  if (channel === 'WHATSAPP') return `https://wa.me/${String(recipient).replace(/\D/g, '')}?text=${enc(body || '')}`;
  if (channel === 'SMS') return `sms:${recipient}?body=${enc(body || '')}`;
  if (channel === 'EMAIL') return `mailto:${recipient}?subject=${enc(subject || '')}&body=${enc(body || '')}`;
  if (channel === 'CALL') return `tel:${recipient}`;
  throw new Error('Unknown channel');
}

export const communicationService = {
  /** Template overrides for this school (level 2). Empty list when none: the system defaults are used. */
  async loadOverrides() {
    const rows = unwrap(await supabase.from('lb_communication_templates').select('id, purpose, channel, subject, body, is_active').like('purpose', 'ELIMU\\_%')) || [];
    return rows;
  },

  /** Build the starting text for a guardian + channel + purpose. Pure data: nothing is written. */
  prepare({ purpose, channel, guardian, student, application, school, klass, extra, overrides = [], settings = {} }) {
    if (!getPurpose(purpose)) throw new Error('Choose why you are contacting this guardian.');
    const elig = eligibility({ guardian, channel, purpose, settings });
    const vars = buildVars({ guardian, student, application, school, klass, extra });
    const tpl = channel === 'CALL' ? { subject: null, body: '', source: 'SYSTEM', templateId: null, missing: [] } : resolveTemplate({ purpose, channel, overrides, vars });
    return { ...tpl, channel, purpose, eligible: elig.ok, override: !!elig.override, reason: elig.reason || null, recipient: elig.recipient || null, contactId: elig.contact?.id || null, generated: tpl.body, generatedSubject: tpl.subject };
  },

  /**
   * Record a prepared/opened message. Returns { ok, logId } or { ok:false, offline:true, draftId } when there is no signal.
   * status: 'QUEUED' (prepared) | 'OPENED' (handed to the phone's app). Never anything stronger.
   */
  async record({ channel, purpose, guardianId, contactId, studentId, applicationId, subject, body, generated, templateId, templateSource, referenceLabel, status = 'QUEUED', tenantId }) {
    const payload = { channel, purpose, guardian_id: guardianId, contact_id: contactId, student_id: studentId || null, application_id: applicationId || null,
      subject: subject || null, message: body, generated_message: generated ?? body, template_id: templateId || null, template_source: templateSource || null, reference_label: referenceLabel || null, status };
    if (!online()) {
      const draftId = newDraftId();
      await saveDraft({ id: draftId, tenant_id: tenantId, kind: 'MESSAGE', payload });
      return { ok: false, offline: true, draftId, message: 'No internet. Your message is saved on this device as a draft and has NOT been sent.' };
    }
    const r = unwrap(await supabase.rpc('elimu_record_message', { p: payload }));
    return { ok: true, logId: r.log_id, status: r.status, override: r.override };
  },

  /** Open the right app on this device. Returns the URL (the caller assigns window.location / anchor click). */
  async handOff(args) {
    const rec = await this.record({ ...args, status: 'OPENED' });
    if (!rec.ok) return rec;
    return { ...rec, url: handOffUrl(args.channel, { recipient: args.recipient, body: args.body, subject: args.subject }) };
  },

  /** "I sent it myself." The only way a hand-off becomes SENT, and it is labelled as marked by staff. */
  async confirmSentByHand(logId) { return unwrap(await supabase.rpc('elimu_mark_message', { p_log: logId, p_status: 'SENT' })); },
  async cancel(logId) { return unwrap(await supabase.rpc('elimu_mark_message', { p_log: logId, p_status: 'CANCELLED' })); },

  /** Server-side provider send through the EXISTING comm-send function. Never throws for "not configured". */
  async sendViaProvider(logId) {
    try {
      const { data, error } = await supabase.functions.invoke('comm-send', { body: { log_id: logId } });
      if (error) return { ok: false, code: 'PROVIDER_ERROR', message: error.message };
      return data?.ok ? { ok: true, ...data } : { ok: false, code: data?.code || 'NOT_CONFIGURED', message: data?.message || 'No sending service is set up for this school. Use your phone instead.' };
    } catch (e) { return { ok: false, code: 'NETWORK', message: 'Could not reach the sending service.' }; }
  },

  /** A call is only ever an INTENT until a person records what happened. */
  async startCall({ guardianId, contactId, studentId, purpose = 'ELIMU_GENERAL_NOTICE' }) {
    const r = unwrap(await supabase.rpc('elimu_log_call_intent', { p_guardian: guardianId, p_contact: contactId || null, p_student: studentId || null, p_purpose: purpose }));
    return { callId: r.call_id, url: `tel:+${String(r.dial).replace(/\D/g, '')}`, override: r.override };
  },
  async recordCallOutcome(callId, outcome, note) { return unwrap(await supabase.rpc('elimu_record_call_outcome', { p_call: callId, p_outcome: outcome, p_note: note || null })); },

  /** Unified timeline (messages + calls) for a student, guardian or application. */
  async history({ studentId, guardianId, applicationId, limit = 50 } = {}) {
    let q = supabase.from('v_elimu_communication_history').select('*').order('at', { ascending: false }).limit(limit);
    if (studentId) q = q.eq('student_id', studentId);
    if (guardianId) q = q.eq('guardian_id', guardianId);
    if (applicationId) q = q.eq('application_id', applicationId);
    return unwrap(await q) || [];
  },

  async queue() { return unwrap(await supabase.from('elimu_notifications').select('*').eq('status', 'PENDING').order('created_at', { ascending: false })) || []; },
  async resolveQueueItem(id, status) { return unwrap(await supabase.rpc('elimu_resolve_notification', { p_id: id, p_status: status })); },
  async rules() { return unwrap(await supabase.from('elimu_notification_rules').select('*').order('event_type')) || []; },
  async setRule(id, isActive) { return unwrap(await supabase.from('elimu_notification_rules').update({ is_active: isActive }).eq('id', id).select().single()); },

  contactFor,
};
