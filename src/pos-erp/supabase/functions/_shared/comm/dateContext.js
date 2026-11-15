// supabase/functions/_shared/comm/dateContext.js
//
// The date-context engine. ONE implementation, used by the app (through utils/comm/*) and by the
// server-side scheduler (Edge Functions), so a message prepared on a phone and a message sent at 2am by
// the scheduler can never disagree about "tomorrow" or "overdue".
//
// Pure functions, no dependencies, no module-level clock: "now" is always passed in, so every result is
// reproducible in tests and nothing is hard-wired to a date.
//
// All calendar maths is done on plain YYYY-MM-DD strings in the BUSINESS time zone (default
// Africa/Nairobi), never on raw Date objects, so a late-evening message in Nairobi is not mis-dated by UTC.

export const DEFAULT_TZ = 'Africa/Nairobi';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A usable IANA zone, or the default. Never throws. */
export function resolveTz(tz) {
  if (!tz || typeof tz !== 'string') return DEFAULT_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_TZ; }
}

function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTz(tz), hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Calendar date (YYYY-MM-DD) of an instant, in the business zone.
 * A bare 'YYYY-MM-DD' string is already a calendar date and is returned as it is.
 */
export function toYmd(input, tz) {
  if (input == null || input === '') return null;
  if (typeof input === 'string' && YMD.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const p = partsInTz(d, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 'HH:MM' (24h) of an instant, in the business zone. */
export function toHm(input, tz) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const p = partsInTz(d, tz);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

function dayNumber(ymd) {
  const m = YMD.exec(ymd || '');
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

/** Whole calendar days from `fromYmd` to `toYmd` (positive when `toYmd` is later). */
export function diffDays(fromYmd, toYmd_) {
  const a = dayNumber(fromYmd), b = dayNumber(toYmd_);
  if (a == null || b == null) return null;
  return b - a;
}

export function addDays(ymd, n) {
  const dn = dayNumber(ymd);
  if (dn == null) return null;
  const d = new Date((dn + n) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "7 November 2026" */
export function formatLongDate(ymd, { weekday = false } = {}) {
  const m = YMD.exec(ymd || '');
  if (!m) return '';
  const day = +m[3];
  const base = `${day} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  if (!weekday) return base;
  return `${WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, day)).getUTCDay()]}, ${base}`;
}

/** "10:30 AM" from 'HH:MM' or 'HH:MM:SS'. */
export function formatTime12(hms) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hms || '');
  if (!m) return '';
  const h = +m[1], min = m[2];
  if (h > 23) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "1 day", "2 days" */
export function plural(n, one, many) {
  const k = Math.abs(n);
  return `${n} ${k === 1 ? one : (many || `${one}s`)}`;
}
export const daysLabel = (n) => plural(n, 'day');

/** Local wall-clock time in `tz` -> the real instant. Handles zones with daylight saving. */
export function zonedToInstant(ymd, hms, tz) {
  const dm = YMD.exec(ymd || '');
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(hms || '00:00');
  if (!dm || !tm) return null;
  const wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], +(tm[3] || 0));
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = partsInTz(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    guess += wall - seen;
  }
  return new Date(guess);
}

export function nowInTz(now, tz) {
  const zone = resolveTz(tz);
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  const p = partsInTz(d, zone);
  return { tz: zone, instant: d, today: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.hh)}:${pad(p.mm)}`, hour: p.hh };
}

/**
 * What a date means relative to "now".
 *   state: PAST | TODAY | TOMORROW | FUTURE
 *   days:  signed, positive = in the future ("daysAhead"), negative = in the past
 *   daysRemaining / daysOverdue: never negative, 0 when not applicable
 * With a time: minutesUntil, and timePassed when it is today and the time has gone.
 */
export function dateContext({ date, time = null, now, tz } = {}) {
  const n = nowInTz(now, tz);
  const ymd = toYmd(date, n.tz);
  if (!ymd) return { valid: false, tz: n.tz, today: n.today };
  const days = diffDays(n.today, ymd);
  const state = days < 0 ? 'PAST' : days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : 'FUTURE';
  const hasTime = !!(time && formatTime12(time));
  const instant = hasTime ? zonedToInstant(ymd, time, n.tz) : null;
  const minutesUntil = instant ? Math.round((instant.getTime() - n.instant.getTime()) / 60000) : null;
  return {
    valid: true,
    tz: n.tz,
    today: n.today,
    date: ymd,
    state,
    days,
    daysRemaining: days > 0 ? days : 0,
    daysOverdue: days < 0 ? -days : 0,
    isPast: state === 'PAST',
    isToday: state === 'TODAY',
    isTomorrow: state === 'TOMORROW',
    isFuture: state === 'FUTURE' || state === 'TOMORROW',
    dateLong: formatLongDate(ymd),
    dateLongWithWeekday: formatLongDate(ymd, { weekday: true }),
    hasTime,
    time: hasTime ? time.slice(0, 5) : null,
    timeLabel: hasTime ? formatTime12(time) : '',
    instant,
    minutesUntil,
    timePassed: hasTime && minutesUntil < 0,
  };
}

/** True when `now` falls inside quiet hours (start > end means the window crosses midnight). */
export function inQuietHours(now, tz, { start = '20:00', end = '07:00' } = {}) {
  if (!start || !end || start === end) return false;
  const { time } = nowInTz(now, tz);
  return start < end ? (time >= start && time < end) : (time >= start || time < end);
}
