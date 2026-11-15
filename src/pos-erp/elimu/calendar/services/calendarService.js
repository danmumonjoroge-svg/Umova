// elimu/calendar/services/calendarService.js -- school calendar events (dates only; no exam marks or grading).
import { select, write } from '../../shared/services/elimuDb';

export const EVENT_TYPES = [
  ['SCHOOL_OPENING', 'School opening'], ['SCHOOL_CLOSING', 'School closing'], ['TERM_START', 'Term starts'], ['TERM_END', 'Term ends'],
  ['HOLIDAY', 'School holiday'], ['PUBLIC_HOLIDAY', 'Public holiday'], ['EXAM_PERIOD', 'Examination period'], ['SCHOOL_EVENT', 'School event'],
  ['STAFF_MEETING', 'Staff meeting'], ['PARENT_MEETING', 'Parent meeting'], ['SPORTS_DAY', 'Sports day'], ['SPECIAL_ACTIVITY', 'Special activity'], ['OTHER', 'Other'],
];
export const NO_SCHOOL_TYPES = ['HOLIDAY', 'PUBLIC_HOLIDAY', 'SCHOOL_CLOSING'];
export const calendarService = {
  /** Events touching a date range (a month at a time). */
  range: (from, to) => select('elimu_school_calendar_events', (q) => q.lte('start_date', to).gte('end_date', from).eq('is_cancelled', false).order('start_date')),
  save: (row) => (row.id ? write('elimu_school_calendar_events', 'update', row, (q) => q.eq('id', row.id)) : write('elimu_school_calendar_events', 'insert', row)),
  cancel: (id) => write('elimu_school_calendar_events', 'update', { is_cancelled: true }, (q) => q.eq('id', id)),
};
/** Events on one date (client-side, from an already-loaded range). */
export const eventsOn = (events, date) => events.filter((e) => !e.is_cancelled && e.start_date <= date && e.end_date >= date);
