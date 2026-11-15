// Run:  node --experimental-default-type=module --test elimu/tests/        (no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupGrade, validateScheme, roundPercent } from '../grading/utils/gradingEngine.js';
import { computeSubjectResult, computeOverall, rank, weightsOk } from '../report_cards/utils/resultEngine.js';
import { parseMarks, validateRow, buildSavePayload } from '../exams/utils/markValidation.js';

const A_E = [
  { grade: 'A', min_percent: 80, max_percent: 100, grade_point: 4, descriptor: 'Excellent', is_pass: true },
  { grade: 'B', min_percent: 70, max_percent: 79, grade_point: 3, is_pass: true },
  { grade: 'C', min_percent: 60, max_percent: 69, grade_point: 2, is_pass: true },
  { grade: 'D', min_percent: 50, max_percent: 59, grade_point: 1, is_pass: true },
  { grade: 'E', min_percent: 0, max_percent: 49, grade_point: 0, is_pass: false },
];

test('grading: bands are data, boundaries and rounding match the SQL', () => {
  assert.equal(lookupGrade(A_E, 80, 0).grade, 'A');
  assert.equal(lookupGrade(A_E, 79, 0).grade, 'B');
  assert.equal(lookupGrade(A_E, 69.6, 0).grade, 'B', '69.6 rounds to 70 with 0 decimals');
  assert.equal(lookupGrade(A_E, 69.4, 0).grade, 'C');
  assert.equal(lookupGrade(A_E, 79.6, 2).grade, 'B', 'floor match: gap 79..80 resolves downwards');
  assert.equal(lookupGrade(A_E, 150, 0).grade, 'A', 'clamped to 100');
  assert.equal(lookupGrade(A_E, -5, 0).grade, 'E', 'clamped to 0');
  assert.equal(roundPercent('abc'), null);
});
test('grading: a different school scheme works with no code change', () => {
  const cbc = [{ grade: 'EE', min_percent: 75, max_percent: 100 }, { grade: 'ME', min_percent: 50, max_percent: 74 }, { grade: 'AE', min_percent: 25, max_percent: 49 }, { grade: 'BE', min_percent: 0, max_percent: 24 }];
  assert.equal(lookupGrade(cbc, 74.4, 0).grade, 'ME');
  assert.deepEqual(validateScheme(cbc, 0), []);
});
test('grading: validation finds overlaps, gaps and missing ends', () => {
  assert.deepEqual(validateScheme(A_E, 0), []);
  assert.match(validateScheme([...A_E.slice(0, 2), { grade: 'X', min_percent: 75, max_percent: 85 }, ...A_E.slice(2)], 0).join('|'), /overlaps/);
  assert.match(validateScheme([{ grade: 'A', min_percent: 50, max_percent: 90 }], 0).join('|'), /not 0|not 100/);
  assert.match(validateScheme([{ grade: 'A', min_percent: 0, max_percent: 40 }, { grade: 'B', min_percent: 60, max_percent: 100 }], 0).join('|'), /Gap/);
  assert.deepEqual(validateScheme([], 0), ['The scheme has no grade bands.']);
});

const S = (o) => ({ entry_status: 'SUBMITTED', ...o });
test('results: SAME numbers as the SQL scenarios (Amina 69.000 -> C)', () => {
  const r = computeSubjectResult({ rules: A_E, components: [
    S({ name: 'CAT 1', max_marks: 20, weight: 20, mark_status: 'PRESENT', obtained_marks: 15 }),
    S({ name: 'CAT 2', max_marks: 20, weight: 20, mark_status: 'PRESENT', obtained_marks: 18 }),
    S({ name: 'Exam', max_marks: 100, weight: 60, mark_status: 'PRESENT', obtained_marks: 60 })] });
  assert.equal(r.completeness, 'COMPLETE'); assert.equal(r.percentage, 69); assert.equal(r.grade, 'C'); assert.equal(r.grade_point, 2);
});
test('results: absent counts as 0, exempt is left out and weights re-scale (Brian 60.000)', () => {
  const r = computeSubjectResult({ rules: A_E, components: [
    S({ name: 'CAT 1', max_marks: 20, weight: 20, mark_status: 'ABSENT' }),
    S({ name: 'CAT 2', max_marks: 20, weight: 20, mark_status: 'EXEMPTED' }),
    S({ name: 'Exam', max_marks: 100, weight: 60, mark_status: 'PRESENT', obtained_marks: 80 })] });
  assert.equal(r.percentage, 60); assert.equal(r.grade, 'C');
  assert.ok(r.breakdown.some((b) => b.state === 'EXEMPTED'));
});
test('results: EXCLUDE policies leave absent / not-submitted out instead of zero', () => {
  const comps = [S({ name: 'A', max_marks: 10, weight: 50, mark_status: 'ABSENT' }), S({ name: 'B', max_marks: 10, weight: 50, mark_status: 'PRESENT', obtained_marks: 8 })];
  assert.equal(computeSubjectResult({ rules: A_E, components: comps, settings: { absent_policy: 'ZERO', not_submitted_policy: 'ZERO', weight_tolerance: 0.01 } }).percentage, 40);
  assert.equal(computeSubjectResult({ rules: A_E, components: comps, settings: { absent_policy: 'EXCLUDE', not_submitted_policy: 'ZERO', weight_tolerance: 0.01 } }).percentage, 80);
});
test('results: a blank / pending / unsubmitted mark is INCOMPLETE, never zero', () => {
  const base = [S({ name: 'CAT', max_marks: 20, weight: 40, mark_status: 'PRESENT', obtained_marks: 20 })];
  const pending = computeSubjectResult({ rules: A_E, components: [...base, { name: 'Exam', max_marks: 100, weight: 60 }] });
  assert.equal(pending.completeness, 'INCOMPLETE'); assert.equal(pending.percentage, null); assert.equal(pending.grade, null);
  const draft = computeSubjectResult({ rules: A_E, components: [...base, { name: 'Exam', max_marks: 100, weight: 60, mark_status: 'PRESENT', obtained_marks: 90, entry_status: 'DRAFT' }] });
  assert.equal(draft.completeness, 'INCOMPLETE', 'only SUBMITTED marks count');
});
test('results: weights must add up to 100', () => {
  const comps = [S({ name: 'A', max_marks: 10, weight: 50, mark_status: 'PRESENT', obtained_marks: 5 }), S({ name: 'B', max_marks: 10, weight: 60, mark_status: 'PRESENT', obtained_marks: 5 })];
  assert.equal(computeSubjectResult({ rules: A_E, components: comps }).completeness, 'WEIGHTS_INVALID');
  assert.equal(weightsOk([{ weight: 50 }, { weight: 50 }]), true);
  assert.equal(weightsOk([{ weight: 50 }, { weight: 50 }, { weight: 10, status: 'CANCELLED' }]), true, 'cancelled assessments do not count');
  assert.equal(computeSubjectResult({ rules: A_E, components: [] }).completeness, 'NO_ASSESSMENTS');
});
test('results: all components exempt => subject not applicable', () => {
  assert.equal(computeSubjectResult({ rules: A_E, components: [S({ name: 'A', max_marks: 10, weight: 100, mark_status: 'EXEMPTED' })] }).completeness, 'NOT_APPLICABLE');
});
test('overall + ranking: only complete students are ranked; ties share a position', () => {
  const o = computeOverall([{ completeness: 'COMPLETE', percentage: 70, grade_point: 3 }, { completeness: 'COMPLETE', percentage: 50, grade_point: 1 }, { completeness: 'NOT_APPLICABLE' }], { rules: A_E });
  assert.equal(o.mean_percentage, 60); assert.equal(o.overall_grade, 'C'); assert.equal(o.overall_grade_point, 2); assert.equal(o.subjects_expected, 2);
  const partial = computeOverall([{ completeness: 'COMPLETE', percentage: 70 }, { completeness: 'INCOMPLETE' }], { rules: A_E });
  assert.equal(partial.overall_grade, null); assert.equal(partial.is_complete, false);
  const pos = rank([{ id: 'a', is_complete: true, mean_percentage: 80 }, { id: 'b', is_complete: true, mean_percentage: 80 }, { id: 'c', is_complete: true, mean_percentage: 60 }, { id: 'd', is_complete: false, mean_percentage: 90 }]);
  assert.deepEqual([pos.get('a'), pos.get('b'), pos.get('c'), pos.has('d')], [1, 1, 3, false]);
});

test('mark validation: blank is not zero; status and marks must agree', () => {
  assert.deepEqual(parseMarks(''), { value: null, error: null });
  assert.equal(parseMarks('12,5').value, 12.5);
  assert.ok(parseMarks('abc').error);
  assert.equal(parseMarks('0').value, 0, 'a real zero is allowed');
  assert.equal(validateRow({ marksText: '' }, 20).entry.mark_status, 'PENDING');
  assert.equal(validateRow({ mark_status: 'PRESENT', marksText: '' }, 20).ok, false);
  assert.equal(validateRow({ mark_status: 'PRESENT', marksText: '21' }, 20).ok, false);
  assert.equal(validateRow({ mark_status: 'PRESENT', marksText: '-1' }, 20).ok, false);
  assert.equal(validateRow({ mark_status: 'ABSENT', marksText: '5' }, 20).ok, false);
  assert.equal(validateRow({ mark_status: 'ABSENT', marksText: '' }, 20).entry.obtained_marks, null);
  assert.equal(validateRow({ marksText: '20' }, 20).entry.mark_status, 'PRESENT');
});
test('mark validation: payload only includes changed rows and reports row errors', () => {
  const p = buildSavePayload([{ enrollment_id: 'a', marksText: '10', dirty: true, version: 2 }, { enrollment_id: 'b', marksText: '99', dirty: true }, { enrollment_id: 'c', marksText: '1', dirty: false }], 20);
  assert.equal(p.entries.length, 1); assert.equal(p.entries[0].base_version, 2); assert.ok(p.errors.b); assert.equal(p.hasErrors, true);
});

import { reportCardHtml, reportCardsHtml } from '../report_cards/utils/reportCardHtml.js';
const PAYLOAD = { draft: false, school: { name: 'Sunrise <Academy>', logo_url: 'https://x/y.png', headteacher_title: 'Principal', headteacher_name: 'H. Head' },
  student: { full_name: 'Amina "Ali"', admission_number: 'A001' }, academic_year: { name: '2026' }, term: { name: 'Term 1' }, class: { name: 'Form 1' }, stream: { name: 'East' },
  subjects: [{ name: 'Mathematics', completeness: 'COMPLETE', percentage: 75, grade: 'B', grade_point: 3, descriptor: 'Very Good', teacher_remark: 'Good <progress>' }, { name: 'English', completeness: 'INCOMPLETE' }],
  overall: { mean_percentage: 75, grade: 'B', grade_point: 3, class_position: 2, class_size: 40, is_complete: false }, remarks: { class_teacher: 'Hard worker', head: 'Well done' },
  grading: { scheme_name: 'Standard', bands: [{ grade: 'A', min: 80, max: 100 }] }, display: { show_positions: true, show_grade_points: true }, card: { revision_no: 2 } };
test('report card html: escapes user text, shows every required field', () => {
  const h = reportCardHtml(PAYLOAD);
  assert.ok(h.includes('Sunrise &lt;Academy&gt;') && h.includes('Amina &quot;Ali&quot;') && h.includes('Good &lt;progress&gt;'), 'escaped');
  for (const must of ['A001', 'Form 1', 'East', 'Term 1', '2026', 'Mathematics', '75', 'Hard worker', 'Well done', 'Principal', '2nd', 'logo-less?']) {
    if (must === 'logo-less?') assert.ok(h.includes('<img')); else assert.ok(h.includes(must), `missing ${must}`);
  }
  assert.ok(h.includes('Incomplete'), 'incomplete subject flagged, not shown as zero');
  assert.ok(h.includes('revision 2'), 'corrected revisions say so');
  assert.ok(!h.includes('DRAFT'), 'no watermark when final');
});
test('report card html: drafts are watermarked; hidden columns respected; many cards = one page each', () => {
  const h = reportCardHtml({ ...PAYLOAD, draft: true, display: { show_positions: false, show_grade_points: false } });
  assert.ok(h.includes('DRAFT') && !h.includes('Position in class') && !h.includes('<th class="n">Points</th>'));
  assert.equal((reportCardsHtml([PAYLOAD, PAYLOAD, PAYLOAD]).match(/class="rc"/g) || []).length, 3);
});

import { composeAcademic, buildAcademicVars, ACADEMIC_PURPOSES, ACADEMIC_TEMPLATES } from '../communication/templates/academicTemplates.js';
test('templates: every purpose has SMS, WhatsApp and Email wording using only known variables', () => {
  const known = /\{\{\s*(guardian_name|student_name|admission_number|class_name|stream_name|subject_name|term_name|academic_year|exam_name|result_date|school_name|exam_date|exam_notes|concern_details|improvement_details|meeting_date|meeting_time|meeting_venue|announcement_text)\??\s*\}\}/g;
  for (const p of ACADEMIC_PURPOSES) for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
    const t = ACADEMIC_TEMPLATES[p.key][ch]; assert.ok(t?.body, `${p.key}/${ch}`);
    const all = `${t.subject || ''}${t.body}`; const left = all.replace(known, ''); assert.ok(!/\{\{/.test(left), `unknown variable in ${p.key}/${ch}`);
  }
});
test('templates: generates the message; required gaps are reported, optional lines are dropped', () => {
  const vars = buildAcademicVars({ guardian: { full_name: 'Grace Ali' }, student: { full_name: 'Amina Ali', admission_number: 'A001', class_name: 'Form 1' }, schoolName: 'Sunrise', term: 'Term 1', academicYear: '2026' });
  const m = composeAcademic({ purpose: 'ELIMU_RESULT_PUBLISHED', channel: 'SMS', vars });
  assert.ok(m.body.includes('Dear Grace Ali') && m.body.includes('Term 1 2026') && m.body.includes('Sunrise')); assert.deepEqual(m.missing, []);
  const w = composeAcademic({ purpose: 'ELIMU_RESULT_PUBLISHED', channel: 'WHATSAPP', vars });
  assert.ok(!w.body.includes('result date'), 'optional {{result_date?}} line dropped when empty');
  const bad = composeAcademic({ purpose: 'ELIMU_PARENT_MEETING', channel: 'SMS', vars });
  assert.deepEqual(bad.missing, ['meeting_date'], 'missing required details are reported, never invented');
});
test('templates: a school override wins when it can be filled, else falls back with a warning', () => {
  const vars = buildAcademicVars({ guardian: { full_name: 'Grace' }, student: { full_name: 'Amina' }, schoolName: 'Sunrise' });
  const ok = composeAcademic({ purpose: 'ELIMU_REPORT_CARD_AVAILABLE', channel: 'SMS', vars, businessTemplates: [{ id: 't1', purpose: 'ELIMU_REPORT_CARD_AVAILABLE', channel: 'SMS', body: 'Hi {{guardian_name}}, card for {{student_name}} ready', is_active: true, is_customised: true }] });
  assert.equal(ok.body, 'Hi Grace, card for Amina ready'); assert.equal(ok.source, 'BUSINESS');
  const fb = composeAcademic({ purpose: 'ELIMU_REPORT_CARD_AVAILABLE', channel: 'SMS', vars, businessTemplates: [{ id: 't2', purpose: 'ELIMU_REPORT_CARD_AVAILABLE', channel: 'SMS', body: 'Hi {{unknown_thing}}', is_active: true, is_customised: true }] });
  assert.equal(fb.source, 'SYSTEM'); assert.equal(fb.warnings[0].code, 'TEMPLATE_FALLBACK');
});
