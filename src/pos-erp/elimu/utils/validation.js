// Client-side checks that give a friendly message BEFORE the database says no. The database remains the authority;
// every rule here is also enforced there (constraints / triggers in schema/001-006).
import { normalizeMsisdn, isValidEmail } from './phone.js';

const ok = (errors) => ({ ok: Object.keys(errors).length === 0, errors });

export function validateStudent(s = {}, { today = new Date() } = {}) {
  const e = {};
  if (!String(s.first_name || '').trim()) e.first_name = 'Enter the first name.';
  if (!String(s.last_name || '').trim()) e.last_name = 'Enter the last name.';
  if (s.date_of_birth) {
    const d = new Date(s.date_of_birth);
    if (Number.isNaN(d.getTime())) e.date_of_birth = 'Enter a valid date.';
    else if (d > today) e.date_of_birth = 'Date of birth cannot be in the future.';
  }
  if (s.photo_path && /^[a-z]+:\/\//i.test(s.photo_path)) e.photo_path = 'Photos are stored privately, not as web links.';
  return ok(e);
}

export function validateContact(c = {}) {
  const e = {};
  if (c.kind === 'EMAIL') { if (!isValidEmail(c.value)) e.value = 'Enter a valid email address.'; }
  else if (!normalizeMsisdn(c.value)) e.value = 'Enter a valid phone number, e.g. 0712 345 678.';
  return ok(e);
}

export function validateGuardian(g = {}) {
  const e = {};
  if (!String(g.first_name || '').trim()) e.first_name = 'Enter the first name.';
  if (!String(g.last_name || '').trim()) e.last_name = 'Enter the last name.';
  (g.contacts || []).forEach((c, i) => { const r = validateContact(c); if (!r.ok) e[`contacts.${i}`] = r.errors.value; });
  return ok(e);
}

export function validateApplication(a = {}) {
  const s = validateStudent(a.student);
  const e = { ...s.errors };
  if (!a.requested_class_id) e.requested_class_id = 'Choose the class applied for.';
  if (a.guardian) { const g = validateGuardian(a.guardian); Object.entries(g.errors).forEach(([k, v]) => { e[`guardian.${k}`] = v; }); }
  return ok(e);
}

/** Turns a Postgres/Supabase error into a plain sentence. The database messages are already written for people. */
export function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (/duplicate key|unique/i.test(m)) return 'That record already exists.';
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection. Your changes were not saved.';
  return m || 'Something went wrong.';
}
