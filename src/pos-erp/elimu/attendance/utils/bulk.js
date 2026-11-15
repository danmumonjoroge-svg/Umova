// elimu/attendance/utils/bulk.js -- bulk actions for a register. Pure: returns what WOULD change so the screen can ask first.
export const BULK_ACTIONS = {
  MARK_ALL_PRESENT: { label: 'Mark all present', status: 'PRESENT', scope: 'unmarked_or_all' },
  MARK_SELECTED_ABSENT: { label: 'Mark selected absent', status: 'ABSENT', scope: 'selected' },
  MARK_SELECTED_LATE: { label: 'Mark selected late', status: 'LATE', scope: 'selected' },
  MARK_SELECTED_PRESENT: { label: 'Mark selected present', status: 'PRESENT', scope: 'selected' },
  CLEAR_SELECTED: { label: 'Clear selected marks', status: 'NOT_MARKED', scope: 'selected' },
  CLEAR_ALL: { label: 'Clear all marks', status: 'NOT_MARKED', scope: 'all' },
};
/**
 * @param action key of BULK_ACTIONS
 * @param rows   [{enrollment_id, student_name, status}]
 * @param selected Set of enrollment_ids
 * @returns {{changes: Array<{enrollment_id, status}>, overwrites: number, label, status}}
 *   overwrites = how many already-marked students would be changed to a DIFFERENT status (the screen confirms when > 0).
 *   "Mark all present" fills only the unmarked by default: it never silently flips someone already marked absent.
 */
export function planBulk(action, rows, selected = new Set(), { includeMarked = false } = {}) {
  const a = BULK_ACTIONS[action];
  if (!a) throw new Error(`Unknown bulk action ${action}`);
  let target = rows;
  if (a.scope === 'selected') target = rows.filter((r) => selected.has(r.enrollment_id));
  else if (a.scope === 'unmarked_or_all' && !includeMarked) target = rows.filter((r) => r.status === 'NOT_MARKED');
  const changes = target.filter((r) => r.status !== a.status).map((r) => ({ enrollment_id: r.enrollment_id, status: a.status }));
  const overwrites = target.filter((r) => r.status !== 'NOT_MARKED' && r.status !== a.status).length;
  return { changes, overwrites, label: a.label, status: a.status, count: changes.length };
}
export function applyChanges(rows, changes) {
  const m = new Map(changes.map((c) => [c.enrollment_id, c]));
  return rows.map((r) => (m.has(r.enrollment_id) ? { ...r, ...m.get(r.enrollment_id), dirty: true } : r));
}
