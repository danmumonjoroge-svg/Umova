// Display helpers. No PII is ever logged from here.
export const fullName = (p) => [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ');
export const shortName = (p) => (p?.preferred_name ? `${p.preferred_name} ${p.last_name || ''}`.trim() : [p?.first_name, p?.last_name].filter(Boolean).join(' '));
export const initials = (p) => ((p?.first_name?.[0] || '') + (p?.last_name?.[0] || '')).toUpperCase() || '?';

export function ageFrom(dob, today = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let a = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a -= 1;
  return a >= 0 ? a : null;
}

export function formatDate(d, locale = 'en-KE') {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(d, locale = 'en-KE') {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const RELATIONSHIPS = [
  ['MOTHER', 'Mother'], ['FATHER', 'Father'], ['GUARDIAN', 'Guardian'], ['GRANDPARENT', 'Grandparent'],
  ['SIBLING', 'Sibling'], ['UNCLE_AUNT', 'Uncle / Aunt'], ['SPONSOR', 'Sponsor'], ['OTHER', 'Other'],
];
export const relationshipLabel = (k) => (RELATIONSHIPS.find(([v]) => v === k) || [k, k || '—'])[1];

export const GENDERS = [['F', 'Female'], ['M', 'Male']];   // optional everywhere; never required
