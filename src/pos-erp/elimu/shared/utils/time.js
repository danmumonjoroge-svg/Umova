// elimu/shared/utils/time.js -- pure date/time helpers (no React, no Supabase). All times are "HH:MM" or "HH:MM:SS" strings.
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function toMinutes(t) {
  if (t == null || t === '') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  return h > 24 || mi > 59 ? null : h * 60 + mi;
}
export function fromMinutes(n) {
  if (n == null || Number.isNaN(n)) return '';
  const h = Math.floor(n / 60); const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export const hhmm = (t) => (toMinutes(t) == null ? '' : fromMinutes(toMinutes(t)));
export const timeRange = (a, b) => `${hhmm(a)}–${hhmm(b)}`;

/** Do [aStart,aEnd) and [bStart,bEnd) overlap? Touching ends (08:40 / 08:40) do NOT overlap. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const [s1, e1, s2, e2] = [toMinutes(aStart), toMinutes(aEnd), toMinutes(bStart), toMinutes(bEnd)];
  if ([s1, e1, s2, e2].some((x) => x == null)) return false;
  return s1 < e2 && e1 > s2;
}
export function durationMinutes(start, end) {
  const s = toMinutes(start); const e = toMinutes(end);
  return s == null || e == null ? null : e - s;
}
/** Minutes after the scheduled start, never negative. */
export function minutesAfter(start, at) {
  const s = toMinutes(start); const a = toMinutes(at);
  return s == null || a == null ? null : Math.max(0, a - s);
}
/** ISO weekday 1=Mon..7=Sun for a YYYY-MM-DD string (timezone-free). */
export function isoDow(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return js === 0 ? 7 : js;
}
export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Today's date in the school's time zone (default Nairobi) as YYYY-MM-DD. */
export function todayInTz(tz = 'Africa/Nairobi', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function nowTimeInTz(tz = 'Africa/Nairobi', now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}
export function prettyDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function datesBetween(from, to, max = 400) {
  const out = []; let d = from;
  while (d <= to && out.length < max) { out.push(d); d = addDays(d, 1); }
  return out;
}
