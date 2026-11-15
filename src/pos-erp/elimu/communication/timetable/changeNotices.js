// elimu/communication/timetable/changeNotices.js -- who to tell about a timetable change, and the editable wording.
// Messages go through the same lb_communication_log as attendance messages; elimu_timetable_change_notices guarantees one notice
// per (change, recipient, channel) so the same change is never announced twice to the same person.
import { posSupabase } from '../../../services/posSupabaseClient';
import { rpc } from '../../shared/services/elimuDb';
import { renderTemplate } from '../templates/render';
import { TIMETABLE_TEMPLATES, notifiesGuardians } from '../templates/timetableTemplates';
import { hhmm, DAY_NAMES, isoDow } from '../../shared/utils/time';

/** Variables for one change-history row. names = { subject(id), class(id,stream), teacher(id), room(id) } lookup functions. */
export function changeVars(change, names, recipientName, schoolName) {
  const prev = change.previous_value || {}; const next = change.new_value || prev;
  const day = DAY_NAMES[Number(next.day_of_week || prev.day_of_week)] || '';
  return {
    recipient_name: recipientName, school_name: schoolName, subject: names.subject(next.subject_id || prev.subject_id), class_name: names.class(change.class_id, change.stream_id), day, date: change.effective_date || day,
    old_time: prev.start_time ? `${hhmm(prev.start_time)}-${hhmm(prev.end_time)}` : '', new_time: next.start_time ? `${hhmm(next.start_time)}-${hhmm(next.end_time)}` : '',
    old_teacher: names.teacher(change.previous_teacher_id || prev.teacher_id), new_teacher: names.teacher(next.teacher_id), old_room: names.room(prev.room_id), new_room: names.room(next.room_id), reason: change.reason || '',
  };
}
/** Audience plan: teachers always; the class/guardians only for changes that affect when students must be somewhere. */
export function audienceFor(change) {
  const a = [];
  if (change.teacher_id) a.push({ audience: 'TEACHER', ref: change.teacher_id, label: 'New / current teacher' });
  if (change.previous_teacher_id && change.previous_teacher_id !== change.teacher_id) a.push({ audience: 'TEACHER', ref: change.previous_teacher_id, label: 'Previous teacher' });
  a.push({ audience: 'CLASS', ref: `${change.class_id}${change.stream_id ? ':' + change.stream_id : ''}`, label: 'Class notice (students)' });
  if (notifiesGuardians(change.change_type)) a.push({ audience: 'GUARDIAN', ref: 'class-guardians', label: 'Guardians of the class' });
  return a;
}
export function buildNotice(change, names, recipientName, schoolName, template) {
  const vars = changeVars(change, names, recipientName, schoolName);
  const r = renderTemplate(template || TIMETABLE_TEMPLATES[change.change_type] || TIMETABLE_TEMPLATES.UPDATED, vars);
  return { body: r.text.replace(/ {2,}/g, ' ').trim(), missing: r.missing };
}
/** Records one prepared notice (QUEUED) and its dedupe row. Returns {duplicate:true} if this change was already announced to this recipient on this channel. */
export async function recordNotice({ tenantId, businessId, userId, change, audience, recipientRef, recipientName, channel, to, body }) {
  const dedupe = await rpc('elimu_record_timetable_notice', { p_change_id: change.id, p_audience: audience, p_recipient_ref: String(recipientRef), p_channel: channel, p_comm_log_id: null });
  if (dedupe.duplicate) return { duplicate: true };
  const { data: log, error } = await posSupabase.from('lb_communication_log').insert({
    tenant_id: tenantId, business_id: businessId ?? null, channel, message_type: 'OTHER', purpose: 'ELIMU_TIMETABLE_CHANGE', recipient_kind: audience === 'GUARDIAN' ? 'GUARDIAN' : 'STAFF',
    recipient_name: recipientName, recipient: to, generated_message: body, rendered_message: body, was_edited: false, template_source: 'ELIMU', status: 'QUEUED', initiated_by: 'USER',
    reference_type: 'elimu_timetable_change', reference_id: change.id, reference_label: change.change_type, created_by: userId ?? null }).select('*').single();
  if (error) throw error;
  await rpc('elimu_link_timetable_notice', { p_notice_id: dedupe.id, p_comm_log_id: log.id });
  return { duplicate: false, log };
}
