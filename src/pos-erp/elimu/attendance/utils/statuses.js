// elimu/attendance/utils/statuses.js -- attendance statuses, groups and the one percentage rule.
// Mirrors elimu_system_status_group() and the % rule in schema/003 + 008 (tests keep them in step).
export const SYSTEM_STATUSES = [
  { code: 'PRESENT', label: 'Present', group: 'PRESENT', tone: 'good', key: 'P' },
  { code: 'ABSENT', label: 'Absent', group: 'ABSENT', tone: 'bad', key: 'A' },
  { code: 'LATE', label: 'Late', group: 'PRESENT', tone: 'warn', key: 'L' },
  { code: 'EXCUSED', label: 'Excused', group: 'EXCUSED', tone: 'info', key: 'E' },
  { code: 'SICK', label: 'Sick', group: 'EXCUSED', tone: 'info', key: 'S' },
  { code: 'LEFT_EARLY', label: 'Left early', group: 'PRESENT', tone: 'warn', key: 'Y' },
  { code: 'SUSPENDED', label: 'Suspended', group: 'NEUTRAL', tone: 'neutral', key: 'X' },
  { code: 'NOT_MARKED', label: 'Not marked', group: 'NOT_MARKED', tone: 'neutral', key: '-' },
];
export const SYSTEM_CODES = SYSTEM_STATUSES.map((s) => s.code);
export const GROUPS = ['PRESENT', 'ABSENT', 'EXCUSED', 'NEUTRAL', 'NOT_MARKED'];

/** Merge the school's own extra statuses (rows of elimu_attendance_status_defs) after the system ones. */
export function allStatuses(custom = []) {
  const extra = custom.filter((c) => c.is_active !== false && !SYSTEM_CODES.includes(c.code))
    .map((c) => ({ code: c.code, label: c.label, group: c.status_group, tone: c.status_group === 'PRESENT' ? 'good' : c.status_group === 'ABSENT' ? 'bad' : c.status_group === 'EXCUSED' ? 'info' : 'neutral', custom: true }));
  return [...SYSTEM_STATUSES, ...extra];
}
export const statusMeta = (code, custom = []) => allStatuses(custom).find((s) => s.code === code) || { code, label: code, group: 'NEUTRAL', tone: 'neutral' };
export const groupOf = (code, custom = []) => statusMeta(code, custom).group;

/**
 * Where is a register in its life?  Same rule as the SQL view elimu_v_attendance_sessions.
 *   NOT_TAKEN   no session exists yet (a class nobody has opened) -- its students are NOT absent
 *   NOT_STARTED opened, nothing marked      PARTIAL some marked      COMPLETE all marked, not yet submitted
 *   SUBMITTED   locked                       AMENDED  corrected after submission
 */
export function completionState(session) {
  if (!session) return 'NOT_TAKEN';
  if (session.status === 'AMENDED') return 'AMENDED';
  if (session.status === 'SUBMITTED') return 'SUBMITTED';
  const marked = Number(session.marked_count || 0); const expected = Number(session.expected_count || 0);
  if (marked === 0) return 'NOT_STARTED';
  return marked < expected ? 'PARTIAL' : 'COMPLETE';
}
export const COMPLETION_LABELS = { NOT_TAKEN: 'Not taken yet', NOT_STARTED: 'Not started', PARTIAL: 'Partly marked', COMPLETE: 'All marked (not submitted)', SUBMITTED: 'Submitted', AMENDED: 'Amended' };
export const COMPLETION_TONE = { NOT_TAKEN: 'bad', NOT_STARTED: 'warn', PARTIAL: 'warn', COMPLETE: 'info', SUBMITTED: 'good', AMENDED: 'info' };

/** Count a list of records by group/status. NOT_MARKED is its own bucket: it is never added to absent. */
export function tally(records, custom = []) {
  const t = { total: 0, present: 0, absent: 0, late: 0, excused: 0, left_early: 0, not_marked: 0, neutral: 0 };
  for (const r of records) {
    t.total++;
    const g = groupOf(r.status, custom);
    if (g === 'PRESENT') t.present++;
    else if (g === 'ABSENT') t.absent++;
    else if (g === 'EXCUSED') t.excused++;
    else if (g === 'NEUTRAL') t.neutral++;
    else t.not_marked++;
    if (r.status === 'LATE') t.late++;
    if (r.status === 'LEFT_EARLY' || Number(r.early_minutes) > 0) t.left_early++;
  }
  return t;
}
/** Attendance %: (present [+ excused if the school says so]) / (present + absent + excused). Not-marked & suspended are left out. */
export function attendancePct({ present = 0, absent = 0, excused = 0 }, excusedCountsAsPresent = false) {
  const base = present + absent + excused;
  if (base === 0) return null;
  return Math.round((1000 * (present + (excusedCountsAsPresent ? excused : 0))) / base) / 10;
}
