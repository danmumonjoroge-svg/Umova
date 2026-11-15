// Elimu notification model. Umova computes its notifications live (there is no shared notification store), so Elimu exposes
// PROVIDERS the host's notification bell can call, plus the persisted "prepared work" queue (elimu_notifications, 006).
// NOTHING here sends a message. A notification says "3 acceptance letters are ready to review"; a person opens the composer.
export const EVENTS = {
  'elimu.application.submitted':  { label: 'Application received',        purpose: 'ELIMU_ADMISSION_RECEIVED', audience: 'GUARDIAN', staffTitle: 'New application' },
  'elimu.application.accepted':   { label: 'Application accepted',        purpose: 'ELIMU_ADMISSION_OFFER',    audience: 'GUARDIAN', staffTitle: 'Tell the guardian: accepted' },
  'elimu.application.waitlisted': { label: 'Application waitlisted',      purpose: 'ELIMU_ADMISSION_UPDATE',   audience: 'GUARDIAN', staffTitle: 'Tell the guardian: waitlisted' },
  'elimu.application.rejected':   { label: 'Application not successful',  purpose: 'ELIMU_ADMISSION_UPDATE',   audience: 'GUARDIAN', staffTitle: 'Tell the guardian: not offered a place' },
  'elimu.student.admitted':       { label: 'Student admitted',            purpose: 'ELIMU_WELCOME',            audience: 'GUARDIAN', staffTitle: 'Welcome the family' },
  'elimu.student.enrolled':       { label: 'Student enrolled',            purpose: 'ELIMU_ENROLLMENT_CONFIRMATION', audience: 'GUARDIAN', staffTitle: 'Confirm enrolment' },
};

/** Future modules publish their own events here; the Elimu settings page lists them so a school can switch each on/off. */
export function registerEvent(type, def) {
  if (!/^elimu\.[a-z_.]+$/.test(type)) throw new Error('An Elimu event type looks like elimu.module.event');
  if (EVENTS[type]) throw new Error(`Event ${type} already registered.`);
  EVENTS[type] = def;
}

/** Data-quality items shown as staff notifications (counts come from v_elimu_data_quality). */
export const QUALITY_LABELS = {
  STUDENT_NO_GUARDIAN: 'Students with no guardian',
  STUDENT_NO_EMERGENCY_CONTACT: 'Students with no emergency contact',
  STUDENT_NOT_ENROLLED: 'Active students not enrolled this year',
  GUARDIAN_NO_CONTACT: 'Guardians with no phone or email',
  GUARDIAN_NO_STUDENT: 'Guardians linked to no student',
};

/** Shape the host's bell expects: [{ id, tone, title, detail, to }]. `summary` = elimu_dashboard_summary(), `queue` = pending elimu_notifications. */
export function notificationItems({ summary, queue = [], basePath = '/elimu' }) {
  const items = [];
  if (queue.length) items.push({ id: 'elimu-queue', tone: 'info', title: `${queue.length} message${queue.length === 1 ? '' : 's'} ready to review`, detail: 'Prepared, not sent.', to: `${basePath}/communication` });
  const dq = summary?.data_quality || {};
  Object.entries(dq).forEach(([k, n]) => { if (n > 0) items.push({ id: `elimu-dq-${k}`, tone: 'warn', title: `${n} ${QUALITY_LABELS[k] || k}`, to: `${basePath}/students?quality=${k}` }); });
  const open = (summary?.applications_by_category?.SUBMITTED || 0);
  if (open) items.push({ id: 'elimu-apps', tone: 'info', title: `${open} new application${open === 1 ? '' : 's'} to review`, to: `${basePath}/admissions` });
  return items;
}
