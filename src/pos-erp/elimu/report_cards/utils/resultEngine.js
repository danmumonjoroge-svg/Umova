// elimu/report_cards/utils/resultEngine.js
// PURE mirror of elimu_compute_one() (report_cards/schema/41_compute_results.sql) for ONE subject of ONE student.
// Used for previews ("what will this student get if...?"), the weight checker, and tests that keep JS and SQL in step.
// The database remains the source of truth for stored results.
import { lookupGrade } from '../../grading/utils/gradingEngine.js';

export const DEFAULT_SETTINGS = { absent_policy: 'ZERO', not_submitted_policy: 'ZERO', weight_tolerance: 0.01 };

/** Sum of the weights that count (weight > 0, not cancelled). */
export function totalWeight(assessments) {
  return (assessments || []).filter((a) => a.status !== 'CANCELLED' && Number(a.weight) > 0).reduce((s, a) => s + Number(a.weight), 0);
}
export function weightsOk(assessments, tolerance = DEFAULT_SETTINGS.weight_tolerance) {
  return Math.abs(totalWeight(assessments) - 100) <= tolerance;
}

/**
 * components: [{ assessment_id, name, max_marks, weight, mark_status, obtained_marks, entry_status }]
 *   mark_status missing => PENDING.  entry_status must be 'SUBMITTED' for a mark to count.
 * returns { completeness, percentage, breakdown, issues, grade... }
 *   completeness: COMPLETE | INCOMPLETE | NO_ASSESSMENTS | WEIGHTS_INVALID | NOT_APPLICABLE (every component exempt)
 */
export function computeSubjectResult({ components, settings = DEFAULT_SETTINGS, rules = [], decimals = 0 }) {
  const comps = (components || []).filter((c) => Number(c.weight) > 0);
  const issues = []; const breakdown = [];
  let wTotal = 0; let wIncl = 0; let acc = 0; let rawO = 0; let rawM = 0; let incomplete = false; let allExempt = true;
  for (const c of comps) {
    wTotal += Number(c.weight);
    const ms = c.mark_status || 'PENDING';
    let state; let pc = null; let included = false;
    if (ms === 'PENDING') { state = 'PENDING'; incomplete = true; allExempt = false; issues.push({ code: 'PENDING', assessment: c.name }); }
    else if (c.entry_status !== 'SUBMITTED') { state = 'NOT_FINAL'; incomplete = true; allExempt = false; issues.push({ code: 'NOT_SUBMITTED_BY_TEACHER', assessment: c.name }); }
    else if (ms === 'EXEMPTED') state = 'EXEMPTED';
    else if (ms === 'ABSENT') { allExempt = false; if (settings.absent_policy === 'ZERO') { state = 'ABSENT_ZERO'; pc = 0; included = true; } else state = 'ABSENT_EXCLUDED'; }
    else if (ms === 'NOT_SUBMITTED') { allExempt = false; if (settings.not_submitted_policy === 'ZERO') { state = 'NOT_SUBMITTED_ZERO'; pc = 0; included = true; } else state = 'NOT_SUBMITTED_EXCLUDED'; }
    else { state = 'COUNTED'; allExempt = false; pc = (Number(c.obtained_marks) / Number(c.max_marks)) * 100; included = true; }
    if (included) { wIncl += Number(c.weight); acc += pc * Number(c.weight); rawM += Number(c.max_marks); rawO += Number(c.obtained_marks || 0); }
    breakdown.push({ assessment_id: c.assessment_id, name: c.name, weight: Number(c.weight), max_marks: Number(c.max_marks), mark_status: ms, obtained_marks: c.obtained_marks ?? null, percent: pc, included, state });
  }
  const out = { completeness: null, percentage: null, grade: null, grade_point: null, descriptor: null, is_pass: null, breakdown, issues, raw_obtained: rawO, raw_max: rawM };
  if (comps.length === 0) { out.completeness = 'NO_ASSESSMENTS'; return out; }
  if (Math.abs(wTotal - 100) > settings.weight_tolerance) { out.completeness = 'WEIGHTS_INVALID'; issues.push({ code: 'WEIGHTS_INVALID', total: wTotal }); return out; }
  if (incomplete) { out.completeness = 'INCOMPLETE'; return out; }
  if (allExempt) { out.completeness = 'NOT_APPLICABLE'; return out; }
  if (wIncl === 0) { out.completeness = 'NO_ASSESSMENTS'; issues.push({ code: 'ALL_EXCLUDED' }); return out; }
  out.completeness = 'COMPLETE';
  out.percentage = Math.round((acc / wIncl) * 1000) / 1000;
  const g = lookupGrade(rules, out.percentage, decimals);
  if (g) { out.grade = g.grade; out.grade_point = g.grade_point ?? null; out.descriptor = g.descriptor ?? null; out.is_pass = g.is_pass ?? null; }
  else issues.push({ code: rules?.length ? 'NO_MATCHING_BAND' : 'NO_GRADING_SCHEME' });
  return out;
}

/** Overall: mean of COMPLETE subject percentages; the overall grade only when every expected subject is complete. */
export function computeOverall(subjectResults, { rules = [], decimals = 0 } = {}) {
  const expected = subjectResults.filter((s) => s.completeness !== 'NOT_APPLICABLE');
  const done = expected.filter((s) => s.completeness === 'COMPLETE' && s.percentage != null);
  const mean = done.length ? Math.round((done.reduce((a, s) => a + s.percentage, 0) / done.length) * 1000) / 1000 : null;
  const isComplete = expected.length > 0 && done.length === expected.length;
  const g = isComplete && mean != null ? lookupGrade(rules, mean, decimals) : null;
  const gps = done.filter((s) => s.grade_point != null);
  return { subjects_expected: expected.length, subjects_complete: done.length, is_complete: isComplete, mean_percentage: mean,
    total_percentage: done.length ? Math.round(done.reduce((a, s) => a + s.percentage, 0) * 1000) / 1000 : null,
    overall_grade: g?.grade ?? null, overall_grade_point: isComplete && gps.length ? Math.round((gps.reduce((a, s) => a + s.grade_point, 0) / gps.length) * 1000) / 1000 : null };
}

/** Standard-competition ranking (1,2,2,4) of complete results by mean percentage. Returns Map(id -> position). */
export function rank(results) {
  const ranked = results.filter((r) => r.is_complete && r.mean_percentage != null).sort((a, b) => b.mean_percentage - a.mean_percentage);
  const pos = new Map(); let last = null; let lastPos = 0;
  ranked.forEach((r, i) => { if (r.mean_percentage !== last) { lastPos = i + 1; last = r.mean_percentage; } pos.set(r.id, lastPos); });
  return pos;
}
