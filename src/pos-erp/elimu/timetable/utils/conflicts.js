// elimu/timetable/utils/conflicts.js -- client-side PREVIEW of timetable clashes (instant feedback while editing, grid highlighting).
// The DATABASE is the authority (elimu_timetable_conflicts / elimu_save_timetable_entry); this mirrors its rules so the two can be tested against each other.
import { overlaps, durationMinutes, DAY_NAMES, timeRange, toMinutes } from '../../shared/utils/time';

const rangesOverlap = (aFrom, aTo, bFrom, bTo) => (aFrom || '0001-01-01') <= (bTo || '9999-12-31') && (aTo || '9999-12-31') >= (bFrom || '0001-01-01');

/**
 * @param draft   the entry being edited {id?, term_id, day_of_week, start_time, end_time, class_id, stream_id, teacher_id, room_id, valid_from, valid_to, expected_students}
 * @param ctx     { entries, rooms, periods, availability, hours:{opening,closing}|null, teacherNames:{id:name} }
 * @returns [{code, severity:'BLOCK'|'WARN', overridable, message, otherEntryId}]
 */
export function findConflicts(draft, ctx = {}) {
  const out = []; const { entries = [], rooms = [], periods = [], availability = [], hours = null, teacherNames = {} } = ctx;
  const day = Number(draft.day_of_week); const name = DAY_NAMES[day] || '';
  if (!day || day < 1 || day > 7) return [{ code: 'INVALID_DAY', severity: 'BLOCK', overridable: false, message: 'Choose a day of the week from Monday to Sunday.' }];
  const dur = durationMinutes(draft.start_time, draft.end_time);
  if (dur == null || dur <= 0) return [{ code: 'INVALID_DURATION', severity: 'BLOCK', overridable: false, message: 'The lesson must end after it starts.' }];
  if (dur < 5 || dur > 480) out.push({ code: 'INVALID_DURATION', severity: 'BLOCK', overridable: false, message: `A lesson of ${dur} minutes is not valid. It must be between 5 minutes and 8 hours.` });

  const sameSlot = (e) => e.status !== 'CANCELLED' && e.id !== draft.id && (e.term_id || null) === (draft.term_id || null) && Number(e.day_of_week) === day
    && overlaps(e.start_time, e.end_time, draft.start_time, draft.end_time) && rangesOverlap(e.valid_from, e.valid_to, draft.valid_from, draft.valid_to);
  for (const e of entries.filter(sameSlot)) {
    const when = `${name} from ${timeRange(e.start_time, e.end_time).replace('–', ' to ')}`;
    if (e.class_id === draft.class_id && (!e.stream_id || !draft.stream_id || e.stream_id === draft.stream_id)) out.push({ code: 'CLASS_CLASH', severity: 'BLOCK', overridable: true, message: `This class already has a lesson on ${when}.`, otherEntryId: e.id });
    if (draft.teacher_id && e.teacher_id === draft.teacher_id) out.push({ code: 'TEACHER_CLASH', severity: 'BLOCK', overridable: true, message: `${teacherNames[draft.teacher_id] || 'This teacher'} is already teaching on ${when}.`, otherEntryId: e.id });
    if (draft.room_id && e.room_id === draft.room_id) out.push({ code: 'ROOM_CLASH', severity: 'BLOCK', overridable: true, message: `${rooms.find((r) => r.id === draft.room_id)?.name || 'This room'} is already booked on ${when}.`, otherEntryId: e.id });
  }
  const room = draft.room_id ? rooms.find((r) => r.id === draft.room_id) : null;
  if (room) {
    if (room.is_active === false) out.push({ code: 'ROOM_INACTIVE', severity: 'BLOCK', overridable: false, message: `${room.name} is switched off and cannot be used.` });
    if (room.capacity && draft.expected_students && Number(draft.expected_students) > Number(room.capacity)) out.push({ code: 'ROOM_CAPACITY', severity: 'WARN', overridable: true, message: `${room.name} seats ${room.capacity} but this lesson expects ${draft.expected_students} students.` });
  }
  if (hours && (toMinutes(draft.start_time) < toMinutes(hours.opening) || toMinutes(draft.end_time) > toMinutes(hours.closing))) {
    out.push({ code: 'OUTSIDE_HOURS', severity: 'BLOCK', overridable: true, message: `This lesson (${timeRange(draft.start_time, draft.end_time)}) is outside school hours (${timeRange(hours.opening, hours.closing)}).` });
  }
  for (const p of periods.filter((p) => p.is_active !== false && !['LESSON', 'ACTIVITY'].includes(p.period_type) && (p.days || []).includes(day) && (!p.term_id || p.term_id === draft.term_id) && overlaps(p.start_time, p.end_time, draft.start_time, draft.end_time))) {
    out.push({ code: 'OVERLAPS_BREAK', severity: 'BLOCK', overridable: true, message: `This lesson overlaps "${p.name}" (${timeRange(p.start_time, p.end_time)}).` });
  }
  if (draft.teacher_id) {
    const av = availability.filter((a) => a.staff_id === draft.teacher_id && a.is_active !== false);
    const wd = av.filter((a) => a.kind === 'WORKING_DAY');
    if (wd.length && !wd.some((a) => Number(a.day_of_week) === day)) out.push({ code: 'TEACHER_NOT_WORKING', severity: 'BLOCK', overridable: true, message: `This teacher does not work on ${name}s.` });
    for (const a of av.filter((x) => x.kind === 'UNAVAILABLE_PERIOD' && Number(x.day_of_week) === day && overlaps(x.start_time, x.end_time, draft.start_time, draft.end_time))) {
      out.push({ code: 'TEACHER_UNAVAILABLE', severity: 'BLOCK', overridable: true, message: `This teacher is unavailable on ${name} from ${timeRange(a.start_time, a.end_time).replace('–', ' to ')}${a.reason ? ` (${a.reason})` : ''}.` });
    }
    if (draft.valid_from) for (const a of av.filter((x) => x.kind === 'LEAVE' && x.start_date <= (draft.valid_to || draft.valid_from) && x.end_date >= draft.valid_from)) {
      out.push({ code: 'TEACHER_ON_LEAVE', severity: 'BLOCK', overridable: true, message: `This teacher is on leave from ${a.start_date} to ${a.end_date}.` });
    }
  }
  return out;
}
export const hasBlocking = (cs) => cs.some((c) => c.severity === 'BLOCK');
export const hasUnoverridable = (cs) => cs.some((c) => c.severity === 'BLOCK' && !c.overridable);
