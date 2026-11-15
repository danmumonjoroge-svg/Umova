// elimu/attendance/services/reportService.js -- report data (paged, filtered) + CSV/print. Reuses the POS print helper.
import { rpc } from '../../shared/services/elimuDb';

const f = (x) => ({ p_from: x.from, p_to: x.to, p_class: x.classId || null, p_stream: x.streamId || null, p_term: x.termId || null });
export const reportService = {
  records: (x) => rpc('elimu_report_records', { ...f(x), p_student: x.studentId || null, p_status_group: x.statusGroup || null, p_statuses: x.statuses || null, p_kind: x.kind === undefined ? 'DAILY' : x.kind, p_early_only: !!x.earlyOnly, p_limit: x.limit || 500, p_offset: x.offset || 0 }),
  studentPercentages: (x) => rpc('elimu_report_student_percentages', { ...f(x), p_limit: x.limit || 500, p_offset: x.offset || 0 }),
  classPercentages: (x) => rpc('elimu_report_class_percentages', { p_from: x.from, p_to: x.to, p_term: x.termId || null }),
  monthly: (x) => rpc('elimu_report_monthly_summary', f(x)),
  repeated: (x) => rpc('elimu_repeated_absences', { p_as_of: x.to, p_class: x.classId || null, p_stream: x.streamId || null, p_limit: x.limit || 300 }),
  logGenerated: (report, filters, format) => rpc('elimu_log_report_generated', { p_report: report, p_filters: filters || {}, p_format: format || 'SCREEN' }).catch(() => null),
};
