// Pure helpers for the parent home hero.
/** Attendance rate over the days the school marked: present / (present + absent + excused). null when nothing is recorded. */
export function attendanceRate(d) {
  const p = Number(d?.present || 0); const total = p + Number(d?.absent || 0) + Number(d?.excused || 0);
  return total > 0 ? Math.round((p / total) * 100) : null;
}
/** "AB" from "Amani Baraka Mwangi" (first and last initial). */
export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length === 0 ? '?' : (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
/** Tone for a fee balance: nothing owed is good news. */
export const feeTone = (owed) => (Number(owed || 0) <= 0 ? 'good' : 'owing');
