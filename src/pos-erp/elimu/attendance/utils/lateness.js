// elimu/attendance/utils/lateness.js -- late arrival / early departure rules (mirror of elimu_save_attendance_marks).
import { minutesAfter, toMinutes } from '../../shared/utils/time';

/** { status, lateMinutes } for an arrival. A student is LATE only when MORE than `grace` minutes after the scheduled start. */
export function classifyArrival({ scheduledStart, arrival, grace = 10 }) {
  if (!arrival) return { status: null, lateMinutes: null };
  const late = minutesAfter(scheduledStart, arrival);
  if (late == null) return { status: null, lateMinutes: null };
  return late > grace ? { status: 'LATE', lateMinutes: late } : { status: 'PRESENT', lateMinutes: 0 };
}
/** Early departure: minutes before the end of the session, and whether it needs approval under the school's rules. */
export function classifyDeparture({ scheduledEnd, departure, requiresApproval = true, approvalBefore = null }) {
  const e = toMinutes(scheduledEnd); const d = toMinutes(departure);
  if (e == null || d == null || d >= e) return { early: false, earlyMinutes: 0, approval: 'NOT_REQUIRED' };
  const needs = requiresApproval && (approvalBefore == null || d < toMinutes(approvalBefore));
  return { early: true, earlyMinutes: e - d, approval: needs ? 'PENDING' : 'NOT_REQUIRED' };
}
