// elimu/timetable/utils/grid.js -- turns entries + periods into a weekly grid for any view (class, stream, teacher, room, student, day).
import { toMinutes, hhmm, isoDow } from '../../shared/utils/time';

/** Which entries apply on a calendar date? Weekly entries + one-off ones, minus cancelled occurrences; teacher/room swaps applied. */
export function entriesForDate(entries, date, exceptions = []) {
  const dow = isoDow(date);
  return entries.filter((e) => e.status !== 'CANCELLED' && Number(e.day_of_week) === dow && (!e.valid_from || e.valid_from <= date) && (!e.valid_to || e.valid_to >= date))
    .map((e) => {
      const ex = exceptions.filter((x) => x.entry_id === e.id && x.exception_date === date);
      if (ex.some((x) => x.kind === 'CANCELLED')) return { ...e, cancelledToday: true };
      const t = ex.find((x) => x.kind === 'TEACHER_CHANGED'); const r = ex.find((x) => x.kind === 'ROOM_CHANGED');
      return { ...e, teacher_id: t ? t.new_teacher_id : e.teacher_id, room_id: r ? r.new_room_id : e.room_id, changedToday: !!(t || r) };
    })
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}
/** The slot rows of the grid: the school's periods (breaks included) plus any entry time not covered by a period. */
export function slotRows(periods, entries, day = null) {
  const rows = new Map();
  periods.filter((p) => p.is_active !== false && (!day || (p.days || []).includes(day))).forEach((p) => rows.set(`${hhmm(p.start_time)}-${hhmm(p.end_time)}`, { key: `${hhmm(p.start_time)}-${hhmm(p.end_time)}`, start: hhmm(p.start_time), end: hhmm(p.end_time), label: p.name, type: p.period_type, teaching: ['LESSON', 'ACTIVITY'].includes(p.period_type) }));
  entries.forEach((e) => { const k = `${hhmm(e.start_time)}-${hhmm(e.end_time)}`; if (!rows.has(k)) rows.set(k, { key: k, start: hhmm(e.start_time), end: hhmm(e.end_time), label: '', type: 'LESSON', teaching: true }); });
  return [...rows.values()].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}
/** grid[rowKey][day] = entries[] (usually 0-1; more than one means a clash or parallel streams). */
export function buildWeekGrid(entries, periods, { days = [1, 2, 3, 4, 5] } = {}) {
  const rows = slotRows(periods, entries);
  const grid = {}; rows.forEach((r) => { grid[r.key] = {}; days.forEach((d) => { grid[r.key][d] = []; }); });
  entries.filter((e) => e.status !== 'CANCELLED').forEach((e) => { const k = `${hhmm(e.start_time)}-${hhmm(e.end_time)}`; if (grid[k] && grid[k][e.day_of_week]) grid[k][e.day_of_week].push(e); });
  return { rows, grid, days };
}
/** View filters. The student view is the class/stream the student is enrolled in (resolved by the caller from elimu_v_roster). */
export const viewFilters = {
  class: (classId, streamId) => (e) => e.class_id === classId && (!streamId || !e.stream_id || e.stream_id === streamId),
  teacher: (teacherId) => (e) => e.teacher_id === teacherId,
  room: (roomId) => (e) => e.room_id === roomId,
};
