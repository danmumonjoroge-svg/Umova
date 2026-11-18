// elimu/import/utils/resultsImport.js -- past exam results from an old system.
// Two layouts: LONG (one row per mark) and WIDE (one row per student, one column per subject -- how most mark lists look).
import { toIsoDate } from './studentImport.js';
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const LONG_FIELDS = [
  { key: 'admission_no', label: 'Admission number', required: true, aliases: ['admissionno', 'admno', 'admission', 'admissionnumber', 'regno', 'adm', 'studentno'] },
  { key: 'year', label: 'Year', required: true, aliases: ['year', 'academicyear', 'schoolyear'] },
  { key: 'term', label: 'Term', required: true, aliases: ['term', 'termname', 'semester'] },
  { key: 'class', label: 'Class', required: true, aliases: ['class', 'grade', 'form', 'classname', 'level'] },
  { key: 'subject', label: 'Subject', required: true, aliases: ['subject', 'subjectname', 'subjectcode', 'learningarea', 'paper'] },
  { key: 'exam', label: 'Exam name', required: true, aliases: ['exam', 'examname', 'assessment', 'assessmentname', 'test', 'testname', 'examination'] },
  { key: 'marks', label: 'Marks', required: true, aliases: ['marks', 'mark', 'score', 'scores', 'result', 'obtained', 'marksobtained'] },
  { key: 'out_of', label: 'Out of (optional)', aliases: ['outof', 'max', 'maxmarks', 'maximum', 'total', 'totalmarks', 'maxscore'] },
  { key: 'type', label: 'Assessment type (optional)', aliases: ['type', 'assessmenttype', 'examtype', 'category'] },
  { key: 'date', label: 'Date (optional)', aliases: ['date', 'examdate', 'assessmentdate', 'dateofexam'] },
];
export function autoMapLong(headers) {
  const hs = headers.map(norm); const used = new Set(); const map = {};
  for (const f of LONG_FIELDS) { const i = hs.findIndex((h, ix) => !used.has(ix) && f.aliases.includes(h)); map[f.key] = i; if (i >= 0) used.add(i); }
  return map;
}
export const longProblems = (map) => LONG_FIELDS.filter((f) => f.required && !(map[f.key] >= 0)).map((f) => `Choose the ${f.label} column.`);
export function buildLongRows(rows, map) {
  const out = [];
  for (const r of rows) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const o = {}; for (const f of LONG_FIELDS) { let v = map[f.key] >= 0 ? String(r[map[f.key]] ?? '').trim() : ''; if (f.key === 'admission_no') v = v.replace(/\.0+$/, ''); if (f.key === 'date') v = toIsoDate(v); o[f.key] = v; }
    out.push(o);
  }
  return out;
}

// ---- wide layout
const NON_SUBJECT = ['name', 'studentname', 'fullname', 'firstname', 'lastname', 'surname', 'othernames', 'gender', 'sex', 'stream', 'class', 'grade', 'form', 'total', 'totals', 'mean', 'average', 'avg', 'meanscore', 'meangrade', 'position', 'pos', 'rank', 'classposition', 'streamposition', 'overallposition', 'overall', 'points', 'totalpoints', 'meanpoints', 'remarks', 'comment', 'comments', 'deviation', 'dev', 'sign', 'percentage', 'percent', 'grade', 'overallgrade', 'upi', 'nemis', 'sn', 'no', 'sno', 'serial'];
const ADM_ALIASES = ['admissionno', 'admno', 'admission', 'admissionnumber', 'regno', 'adm', 'studentno', 'registrationnumber'];
const CLASS_ALIASES = ['class', 'grade', 'form', 'classname'];
/** { adm: index, cls: index|-1, subjects: [indexes] } -- subject columns are everything that is not a name, class, total, position... column. */
export function guessWide(headers) {
  const hs = headers.map(norm); const adm = hs.findIndex((h) => ADM_ALIASES.includes(h)); const cls = hs.findIndex((h) => CLASS_ALIASES.includes(h));
  const subjects = hs.map((h, i) => (h && !ADM_ALIASES.includes(h) && !NON_SUBJECT.includes(h) ? i : -1)).filter((i) => i >= 0);
  return { adm, cls, subjects };
}
export function wideProblems(w, fixed) {
  const p = []; if (!(w.adm >= 0)) p.push('Choose the Admission number column.'); if (!w.subjects.length) p.push('Tick at least one subject column.');
  if (!String(fixed.year || '').trim()) p.push('Enter the year.'); if (!String(fixed.term || '').trim()) p.push('Enter the term.'); if (!String(fixed.exam || '').trim()) p.push('Enter the exam name.');
  if (!(w.cls >= 0) && !String(fixed.class || '').trim()) p.push('Choose a Class column or type the class.');
  return p;
}
/** Turns "one row per student" into one row per mark. Empty subject cells are dropped here (a student who did not sit a subject has no row). */
export function pivotWide(headers, rows, w, fixed) {
  const out = [];
  for (const r of rows) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const adm = String(r[w.adm] ?? '').trim().replace(/\.0+$/, ''); const cls = w.cls >= 0 ? String(r[w.cls] ?? '').trim() : String(fixed.class || '').trim();
    for (const i of w.subjects) {
      const v = String(r[i] ?? '').trim(); if (v === '') continue;
      out.push({ admission_no: adm, year: String(fixed.year).trim(), term: String(fixed.term).trim(), class: cls, subject: headers[i], exam: String(fixed.exam).trim(), marks: v, out_of: String(fixed.out_of || '').trim(), type: '', date: toIsoDate(fixed.date || '') });
    }
  }
  return out;
}
export const LONG_TEMPLATE_CSV = 'Admission number,Year,Term,Class,Subject,Exam name,Marks,Out of,Date\nADM-0001,2025,Term 1,Grade 5,Mathematics,End of Term 1,78,100,2025-04-02\nADM-0001,2025,Term 1,Grade 5,English,End of Term 1,ABS,100,2025-04-03\nADM-0002,2025,Term 1,Grade 5,Mathematics,End of Term 1,64.5,100,2025-04-02\n';
export const WIDE_TEMPLATE_CSV = 'Admission number,Name,Mathematics,English,Kiswahili,Science,Total,Position\nADM-0001,Amani Oduor,78,70,65,81,294,3\nADM-0002,Baraka Oduor,64.5,58,ABS,72,194.5,9\n';
