// elimu/communication/attendance/contactPlan.js -- pure decisions about who to contact and how. No network.
import { ATTENDANCE_TEMPLATES, EMAIL_SUBJECTS } from '../templates/attendanceTemplates';
import { renderTemplate, classLabel } from '../templates/render';

/** Which purposes does an attendance record call for, under the school's notification settings? (A suggestion: staff decide.) */
export function suggestedPurposes(record, settings = {}) {
  if (!record || settings.notify_mode === 'OFF') return [];
  const out = [];
  if (['ABSENT', 'SICK'].includes(record.status) && settings.notify_absent !== false) out.push('ABSENT');
  if (record.status === 'LATE' && settings.notify_late) out.push('LATE');
  if ((record.status === 'LEFT_EARLY' || Number(record.early_minutes) > 0) && settings.notify_left_early !== false) out.push('LEFT_EARLY');
  return out;
}
/** Guardians who may be contacted, primary first, those who opted out of attendance alerts removed. */
export function pickGuardians(guardians = []) {
  return guardians.filter((g) => g.can_receive_attendance_alerts !== false).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
}
/** Channels this guardian can actually be reached on, in the school's preferred order. */
export function availableChannels(guardian, preferred = ['SMS', 'WHATSAPP']) {
  const has = { SMS: !!guardian?.phone, WHATSAPP: !!(guardian?.whatsapp_phone || guardian?.phone), EMAIL: !!guardian?.email, CALL: !!guardian?.phone };
  const order = [...preferred, 'SMS', 'WHATSAPP', 'EMAIL', 'CALL'].filter((c, i, a) => a.indexOf(c) === i);
  return order.filter((c) => has[c]);
}
export function messageVars({ record, guardian, schoolName, classInfo = {}, reason = '' }) {
  return {
    guardian_name: guardian?.guardian_name || 'Parent/Guardian', student_name: record.student_name, admission_number: record.admission_number,
    class_name: classInfo.class_name || record.class_name || '', stream_name: classInfo.stream_name || record.stream_name || '',
    attendance_date: record.attendance_date, arrival_time: record.arrival_time ? String(record.arrival_time).slice(0, 5) : '',
    late_minutes: record.late_minutes ?? '', school_name: schoolName, reason: reason || record.reason_note || record.reason_label || 'not given',
  };
}
/** Builds the editable draft. `template` overrides the default wording (a school's saved version). */
export function buildDraft({ purpose, channel, record, guardian, schoolName, classInfo, reason, template }) {
  const vars = messageVars({ record, guardian, schoolName, classInfo, reason });
  const body = renderTemplate(template || ATTENDANCE_TEMPLATES[purpose], vars);
  const subject = channel === 'EMAIL' ? renderTemplate(EMAIL_SUBJECTS[purpose], vars).text : null;
  // tidy double spaces left by an empty stream name
  return { body: body.text.replace(/ {2,}/g, ' '), subject, missing: body.missing, to: channel === 'EMAIL' ? guardian?.email : (channel === 'WHATSAPP' ? (guardian?.whatsapp_phone || guardian?.phone) : guardian?.phone), label: classLabel(vars.class_name, vars.stream_name) };
}
