// elimu/attendance/reports/reportDefs.js -- the report catalogue: what each report asks the database and how it is laid out.
import { reportService } from '../services/reportService';

const rec = (extra) => (x) => reportService.records({ ...x, ...extra });
const col = (key, label, fmt) => ({ key, label, fmt });
const t = (v) => (v ? String(v).slice(0, 5) : '');
const REG_COLS = [col('attendance_date', 'Date'), col('admission_number', 'Adm no.'), col('student_name', 'Student'), col('class_name', 'Class'), col('stream_name', 'Stream'), col('status', 'Status'),
  col('arrival_time', 'Arrived', t), col('departure_time', 'Left', t), col('reason_label', 'Reason')];

export const REPORTS = [
  { key: 'daily_register', label: 'Daily attendance register', needs: ['date'], run: (x) => reportService.records({ ...x, to: x.from }), columns: REG_COLS },
  { key: 'class_register', label: 'Class attendance register', needs: ['range', 'class'], run: rec({}), columns: REG_COLS },
  { key: 'student_history', label: 'Student attendance history', needs: ['range', 'student'], run: rec({}), columns: REG_COLS },
  { key: 'monthly', label: 'Monthly attendance summary', needs: ['range'], run: (x) => reportService.monthly(x),
    columns: [col('month', 'Month', (v) => String(v).slice(0, 7)), col('school_days', 'School days'), col('present', 'Present'), col('late', 'Late'), col('absent', 'Absent'), col('excused', 'Excused'), col('not_marked', 'Not marked'), col('attendance_pct', 'Attendance %')] },
  { key: 'term', label: 'Term attendance summary', needs: ['term'], run: (x) => reportService.classPercentages(x),
    columns: [col('class_name', 'Class'), col('stream_name', 'Stream'), col('school_days', 'School days'), col('student_days', 'Student-days'), col('present', 'Present'), col('absent', 'Absent'), col('excused', 'Excused'), col('attendance_pct', 'Attendance %')] },
  { key: 'absentees', label: 'Absentee list', needs: ['range'], run: rec({ statusGroup: 'ABSENT' }), columns: REG_COLS },
  { key: 'late', label: 'Late-arrival report', needs: ['range'], run: rec({ statuses: ['LATE'] }),
    columns: [col('attendance_date', 'Date'), col('admission_number', 'Adm no.'), col('student_name', 'Student'), col('class_name', 'Class'), col('scheduled_start', 'Start', t), col('arrival_time', 'Arrived', t), col('late_minutes', 'Minutes late'), col('reason_label', 'Reason')] },
  { key: 'early', label: 'Early-departure report', needs: ['range'], run: rec({ earlyOnly: true }),
    columns: [col('attendance_date', 'Date'), col('admission_number', 'Adm no.'), col('student_name', 'Student'), col('class_name', 'Class'), col('departure_time', 'Left', t), col('early_minutes', 'Minutes early'), col('early_departure_approval', 'Approval'), col('reason_label', 'Reason')] },
  { key: 'repeated', label: 'Repeated-absence report', needs: ['range'], run: (x) => reportService.repeated(x),
    columns: [col('admission_number', 'Adm no.'), col('student_name', 'Student'), col('consecutive_absent_days', 'Days in a row'), col('absences_in_window', 'Absences in period'), col('last_absent_date', 'Last absent')] },
  { key: 'pct_class', label: 'Attendance % by class', needs: ['range'], run: (x) => reportService.classPercentages(x),
    columns: [col('class_name', 'Class'), col('stream_name', 'Stream'), col('student_days', 'Student-days'), col('attendance_pct', 'Attendance %')] },
  { key: 'pct_student', label: 'Attendance % by student', needs: ['range'], run: (x) => reportService.studentPercentages(x),
    columns: [col('admission_number', 'Adm no.'), col('student_name', 'Student'), col('days_marked', 'Days marked'), col('present', 'Present'), col('late', 'Late'), col('absent', 'Absent'), col('excused', 'Excused'), col('not_marked', 'Not marked'), col('attendance_pct', 'Attendance %')] },
];
export const reportByKey = (k) => REPORTS.find((r) => r.key === k);
