// elimu/grading/utils/gradingEngine.js
// PURE functions (no I/O). Mirror of the database functions elimu_grade_lookup() / elimu_validate_scheme() (grading/schema/20_grading.sql).
// The database is the source of truth for stored results; this file powers live previews, the scheme editor and offline hints.
// Nothing here knows any particular school's grades: bands come in as data.

/** Round a percentage to the scheme's decimals after clamping to 0..100 (same as the SQL). */
export function roundPercent(pct, decimals = 0) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(Math.max(n, 0), 100);
  const f = 10 ** decimals;
  return Math.round((clamped + Number.EPSILON) * f) / f;
}

/**
 * Floor match: the band with the HIGHEST min_percent that is <= the rounded percentage.
 * rules: [{ grade, min_percent, max_percent, grade_point, descriptor, remark, is_pass }]
 * Returns the rule or null (no band at or below the percentage).
 */
export function lookupGrade(rules, pct, decimals = 0) {
  const p = roundPercent(pct, decimals);
  if (p === null) return null;
  let best = null;
  for (const r of rules || []) {
    const min = Number(r.min_percent);
    if (min <= p && (best === null || min > Number(best.min_percent))) best = r;
  }
  return best;
}

/** Problems that make a scheme unsafe to use ([] = fine). Same checks as elimu_validate_scheme(). */
export function validateScheme(rules, decimals = 0) {
  const problems = [];
  const list = [...(rules || [])].map((r) => ({ ...r, min: Number(r.min_percent), max: Number(r.max_percent), grade: String(r.grade ?? '').trim() }));
  if (list.length === 0) return ['The scheme has no grade bands.'];
  const step = 10 ** -decimals;
  list.sort((a, b) => a.min - b.min);
  const seen = new Set();
  list.forEach((r, i) => {
    if (!r.grade) problems.push('Every band needs a grade.');
    if (seen.has(r.grade)) problems.push(`The grade ${r.grade} appears more than once.`);
    seen.add(r.grade);
    if (!(r.min >= 0 && r.max <= 100 && r.min <= r.max)) problems.push(`${r.grade}: the range ${r.min}-${r.max} must be inside 0-100 with the minimum not above the maximum.`);
    if (i > 0) {
      const prev = list[i - 1];
      if (r.min <= prev.max) problems.push(`${prev.grade} (${prev.min}-${prev.max}) overlaps ${r.grade} (${r.min}-${r.max}).`);
      else if (r.min - prev.max > step + 1e-9) problems.push(`Gap between ${prev.max} and ${r.min}: some percentages would have no clear band.`);
    }
  });
  if (list[0].min !== 0) problems.push(`The lowest band starts at ${list[0].min}, not 0.`);
  if (list[list.length - 1].max < 100) problems.push(`The highest band ends at ${list[list.length - 1].max}, not 100.`);
  return problems;
}
