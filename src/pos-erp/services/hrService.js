// Staff records and payroll (phase31_hr_payroll.sql). Every call is a database function that re-checks who
// you are; pay figures are worked out in the database, never here. Errors start with a code.
import { posSupabase as supabase } from './posSupabaseClient';

const REASONS = {
  NOT_ALLOWED: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.',
  LOCKED: 'This payroll run is locked. Only a draft run can be changed.',
  ALREADY_DECIDED: 'This has already been decided.',
  NOT_APPROVED: 'Approve the run before marking it paid.',
  ALREADY_EXISTS: 'There is already a payroll run for that month.',
};
export function friendlyHrError(msg = '') {
  const m = msg.match(/^(?:RATES_NOT_CONFIRMED|RATES_MISSING|SECOND_PERSON|NO_EMPLOYEES|BAD_DATES|BAD_AMOUNT|BAD_PARAMS|SOURCE_REQUIRED|REASON_REQUIRED|NAME_REQUIRED|NEGATIVE_NET|OVERLAP|FUTURE_DATE|BAD_CODE):\s*(.*)$/);
  if (m) return m[1] || msg;
  if (/violates unique constraint/i.test(msg)) return 'That employee number is already used.';
  if (/violates check constraint/i.test(msg)) return 'One of the values is not allowed.';
  const hit = Object.keys(REASONS).find((k) => msg.includes(k));
  if (hit) return REASONS[hit];
  return msg;
}
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyHrError(error.message));
  return data;
}

export const hrService = {
  listEmployees: (business) => rpc('pos_hr_list_employees', { p_business: business }),
  saveEmployee: (business, id, data) => rpc('pos_hr_save_employee', { p_business: business, p_id: id || null, p_data: data }),
  setAttendance: (employee, date, status, note) => rpc('pos_hr_set_attendance', { p_employee: employee, p_date: date, p_status: status, p_note: note || null }),
  attendanceMonth: (business, month) => rpc('pos_hr_attendance_month', { p_business: business, p_month: month }),
  requestLeave: (employee, type, from, to, reason) => rpc('pos_hr_leave_request', { p_employee: employee, p_type: type, p_from: from, p_to: to, p_reason: reason || null }),
  decideLeave: (id, approve) => rpc('pos_hr_leave_decide', { p_id: id, p_approve: approve }),
  listLeave: (business) => rpc('pos_hr_leave_list', { p_business: business }),
};

export const payrollService = {
  listRates: () => rpc('pos_payroll_rates_list', {}),
  setRate: (code, from, params, source) => rpc('pos_payroll_rate_set', { p_code: code, p_effective_from: from, p_params: params, p_source: source }),
  confirmRate: (code, from) => rpc('pos_payroll_rate_confirm', { p_code: code, p_effective_from: from }),
  createRun: (business, start, end) => rpc('pos_payroll_create_run', { p_business: business, p_period_start: start, p_period_end: end }),
  editLine: (line, allowances, other, notes) => rpc('pos_payroll_edit_line', { p_line: line, p_allowances: allowances, p_other_deductions: other, p_notes: notes || null }),
  approve: (run) => rpc('pos_payroll_approve', { p_run: run }),
  markPaid: (run) => rpc('pos_payroll_mark_paid', { p_run: run }),
  cancel: (run, reason) => rpc('pos_payroll_cancel', { p_run: run, p_reason: reason }),
  listRuns: (business) => rpc('pos_payroll_list_runs', { p_business: business }),
  getRun: (run) => rpc('pos_payroll_get_run', { p_run: run }),
};
