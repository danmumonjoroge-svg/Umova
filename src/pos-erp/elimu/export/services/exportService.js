// elimu/export/services/exportService.js -- download the school's data as CSV (elimu_1020). Administrators only.
import { rpc } from '../../shared/services/elimuDb';
import { csvFile } from '../../utils/fileDownload.js';

export const DATASETS = [
  { key: 'STUDENTS', label: 'Students', hint: 'Every student with class, status and main guardian', dated: false },
  { key: 'GUARDIANS', label: 'Guardians', hint: 'Parents and guardians with phones, emails and children', dated: false },
  { key: 'CLASSES', label: 'Classes and streams', hint: 'Class list with streams and capacity', dated: false },
  { key: 'ENROLMENTS', label: 'Enrolment history', hint: 'Which class each student was in, each term', dated: false },
  { key: 'RESULTS', label: 'Term results', hint: 'Mean, grade and position for each student and term', dated: false },
  { key: 'INVOICES', label: 'Fee invoices', hint: 'Invoices issued in the dates chosen', dated: true },
  { key: 'PAYMENTS', label: 'Fee payments', hint: 'Payments received in the dates chosen', dated: true },
  { key: 'ATTENDANCE', label: 'Daily attendance', hint: 'Daily registers in the dates chosen', dated: true },
];
/** A cell that starts with = + - @ would be run as a formula by Excel; plain numbers and phone numbers are left alone. */
export function safeCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().,-]*$/.test(s) ? `'${s}` : s;
}
export function toCsv(columns, rows) {
  const q = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = columns.map((c) => q(c.replace(/_/g, ' '))).join(',');
  return [head, ...rows.map((r) => columns.map((c) => q(safeCell(r[c]))).join(','))].join('\r\n');
}
export const fileName = (dataset, school, f, t, dated) => `${String(school || 'school').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'}-${dataset.toLowerCase()}${dated ? `-${f}-to-${t}` : `-${new Date().toISOString().slice(0, 10)}`}.csv`;
export function rangeProblem(from, to) {
  if (!from || !to) return 'Choose both dates.';
  if (to < from) return 'The end date is before the start date.';
  if ((new Date(to) - new Date(from)) / 864e5 > 800) return 'Choose a period of at most 800 days.';
  return '';
}
export function saveCsv(name, text) { return csvFile(name, text); }
export const exportService = {
  fetch: (dataset, from, to) => rpc('elimu_export', { p_dataset: dataset, p_from: from || null, p_to: to || null }),
};
