// elimu/teachers/services/teacherExport.js -- CSV and PDF of a teacher report, and CSV of the teacher list. No libraries: the PDF is written by hand
// (plain text, A4, Helvetica) so it works on any phone and cannot fail on a missing dependency. Pure functions plus one small download helper.
import { download, isNative } from '../../utils/fileDownload.js';
import { groupName, KIND_LABEL, ROLE_LABEL, LEVEL_LABEL } from './teacherService.js';

const n1 = (v) => (v == null ? '' : Number(v).toFixed(1));
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvOf = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n');
export const fileSafe = (s) => String(s || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/** The report as plain rows of text: the single source for both the CSV and the PDF, so they always agree. */
export function reportSections(d) {
  const t = d.teacher, term = `${d.term.name} ${d.term.year}`; const out = [];
  out.push({ title: 'Teacher report', rows: [['Teacher', t.name], ['Term', term], ['Roles', (t.roles || []).join(', ')], ['Average', n1(d.performance.overall_mean)], ['Change on last term (points)', n1(d.performance.change)],
    ['Learners taught', d.load.learners], ['Classes', d.load.classes], ['Subjects', d.load.subjects], ['Lessons per week', d.load.lessons_per_week]] });
  out.push({ title: 'Results by class and subject', head: ['Class and subject', 'Learners', 'Average', 'Class average', 'Last term', 'Change', 'Pass rate', 'Highest', 'Lowest', 'Stream rank'],
    rows: d.performance.rows.map((r) => [groupName(r), r.learners, n1(r.mean), n1(r.class_mean), n1(r.previous_mean), n1(r.change), r.pass_rate == null ? '' : `${Math.round(r.pass_rate)}%`, n1(r.highest), n1(r.lowest), r.stream_rank ? `${r.stream_rank} of ${r.stream_count}` : '']) });
  const cmp = []; d.performance.rows.forEach((r) => (r.streams || []).forEach((s) => cmp.push([groupName(r), s.name, s.teacher || '', s.learners, n1(s.mean), s.is_mine ? 'this teacher' : '']))); 
  if (cmp.length) out.push({ title: 'Comparison with other streams', head: ['Class and subject', 'Stream', 'Teacher', 'Learners', 'Average', ''], rows: cmp });
  if ((d.class_teacher || []).length) out.push({ title: 'Class teacher duties', head: ['Class', 'Learners', 'Class average', 'Report cards', 'With remark'], rows: d.class_teacher.map((c) => [`${c.class_name}${c.stream_name ? ` ${c.stream_name}` : ''}`, c.learners, n1(c.class_mean), c.cards_total, c.cards_with_remarks]) });
  out.push({ title: 'Marking, registers and assignments', rows: [['Exams and tests set', d.marking.assessments], ['Finished and locked', d.marking.locked], ['Marks still to enter', d.marking.marks_pending], ['Lesson registers opened', d.attendance?.lessons_taken ?? 0], ['Lesson registers submitted', d.attendance?.lessons_submitted ?? 0],
    ['Assignments set', d.assignments?.set ?? 0], ['Handed in', d.assignments?.handed_in ?? 0], ['Marked', d.assignments?.marked ?? 0]] });
  out.push({ title: 'Activities this year', head: ['Activity', 'Kind', 'Role'], rows: d.activities.map((a) => [a.name, KIND_LABEL[a.kind] || a.kind, ROLE_LABEL[a.role] || a.role]) });
  if (d.events.length) out.push({ title: 'Events and results this term', head: ['Date', 'Activity', 'Event', 'Level', 'Result'], rows: d.events.map((e) => [String(e.date).slice(0, 10), e.activity, e.title, LEVEL_LABEL[e.level] || e.level, e.result || '']) });
  if (d.pay_visible && d.pay?.linked) out.push({ title: 'Pay (confidential)', rows: [['Basic (KES)', d.pay.basic], ['Allowances (KES)', d.pay.allowances], ['Gross a month (KES)', d.pay.gross], ['Last take-home (KES)', d.pay.last_net ?? ''], ['Last pay period', d.pay.last_period || '']] });
  return out;
}

/** One CSV file; sections are separated by a blank line and start with their title. A byte-order mark lets Excel read it correctly. */
export function reportCsv(d) {
  const lines = []; reportSections(d).forEach((s, i) => { if (i) lines.push([]); lines.push([s.title]); if (s.head) lines.push(s.head); s.rows.forEach((r) => lines.push(r)); });
  return `﻿${csvOf(lines)}\r\n`;
}
export function listCsv(list) {
  const head = ['Teacher', 'Class teacher of', 'Subjects', 'Learners', 'Lessons per week', 'Average', 'Change on last term', 'Activities', 'Leads'];
  return `﻿${csvOf([head, ...(list.teachers || []).map((t) => [t.name, (t.class_teacher_of || []).join('; '), t.subjects, t.learners, t.lessons_per_week, n1(t.mean), n1(t.change), t.activities, t.leads])])}\r\n`;
}

// ------------------------------------------------------------------ PDF (text only)
const latin = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '?');
const esc = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function wrap(text, max) { const words = latin(text).split(' '); const out = []; let cur = ''; words.forEach((w) => { if ((cur + ' ' + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }); if (cur) out.push(cur); return out.length ? out : ['']; }

/** Lines for the PDF: {t, b} where b = bold. Rows are written as "label: value" and tables as aligned columns. */
export function reportPdfLines(d, school) {
  const L = []; L.push({ t: school ? `${school} - Teacher report` : 'Teacher report', b: true, big: true });
  reportSections(d).forEach((s, i) => {
    if (i) { L.push({ t: '' }); L.push({ t: s.title, b: true }); } else L.push({ t: '' });
    if (!s.head) { s.rows.forEach((r) => wrap(`${r[0]}: ${r[1] === '' ? '-' : r[1]}`, 92).forEach((x) => L.push({ t: x }))); return; }
    if (s.rows.length === 0) { L.push({ t: 'None.' }); return; }
    s.rows.forEach((r) => wrap(r.map((v, k) => (v === '' || v == null ? null : k === 0 ? String(v) : `${s.head[k] ? `${s.head[k]} ` : ''}${v}`)).filter(Boolean).join(' | '), 92).forEach((x, j) => L.push({ t: j ? `   ${x}` : x })));
  });
  L.push({ t: '' }); L.push({ t: `Printed ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}` });
  return L;
}

export function buildPdf(lines) {
  const PER = 52, pages = []; for (let i = 0; i < lines.length; i += PER) pages.push(lines.slice(i, i + PER)); if (!pages.length) pages.push([{ t: '' }]);
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('PAGES'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((pg, pi) => {
    let y = 800; let c = '';
    pg.forEach((ln) => { const size = ln.big ? 15 : 10; c += `BT /${ln.b ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${esc(ln.t)}) Tj ET\n`; y -= ln.big ? 20 : 14; });
    c += `BT /F1 8 Tf 50 24 Td (Page ${pi + 1} of ${pages.length}) Tj ET\n`;
    const cid = add(`<< /Length ${c.length} >>\nstream\n${c}endstream`); const pid = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`); kids.push(pid);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const off = []; objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export { download };

/** Print. A browser prints the page (only the report is drawn). The phone app cannot print a web page, so it opens the share sheet with the PDF, which has a Print option. */
export async function printReport(name, pdfBytes) {
  if (isNative()) return download(name, pdfBytes, 'application/pdf');
  window.print(); return 'printed';
}
